"""Reproducible HGB tuning and 15-minute extrema evaluation by room thresholds.

Source T_MS/T_FC labels are provenance only, never model-routing inputs.
All fitted controls are retrained inside their split; the deployed artifact
already saw every source and must not be evaluated as a held-out control.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from threadpoolctl import threadpool_limits

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from temperature_features import FEATURE_NAMES, FEATURE_SCHEMA
from freezer_history import load_data

# Matches the four room presets in server/src/seeds/master-data.seed.ts.
ROOMS = {
    "room_0_4": (0.0, 4.0), "room_2_6": (2.0, 6.0),
    "room_minus22_minus18": (-22.0, -18.0),
    "room_minus28_minus22": (-28.0, -22.0),
}
CANDIDATES = {
    "current": {},
    "slow_300": {"max_iter": 300, "learning_rate": .05},
    "slow_500": {"max_iter": 500, "learning_rate": .03, "max_leaf_nodes": 63},
    "squared_300": {"max_iter": 300, "learning_rate": .05, "loss": "squared_error"},
}
SEED = 20261017


def regression(actual, predicted):
    error = np.asarray(predicted) - np.asarray(actual)
    absolute = np.abs(error)
    return {"samples": len(error), "mae": float(absolute.mean()),
            "rmse": float(np.sqrt(np.mean(error ** 2))),
            "p95_absolute_error": float(np.quantile(absolute, .95)),
            "within_1c": float(np.mean(absolute <= 1)), "bias": float(error.mean())}


def classification(observed, predicted):
    observed, predicted = np.asarray(observed, bool), np.asarray(predicted, bool)
    tp = int(np.sum(observed & predicted)); fn = int(np.sum(observed & ~predicted))
    fp = int(np.sum(~observed & predicted)); tn = int(np.sum(~observed & ~predicted))
    ratio = lambda n, d: n / d if d else None
    return {"samples": len(observed), "positives": tp + fn,
            "precision": ratio(tp, tp + fp), "recall": ratio(tp, tp + fn),
            "false_negative_rate": ratio(fn, tp + fn),
            "false_positive_rate": ratio(fp, tn + fp),
            "f1": ratio(2 * tp, 2 * tp + fp + fn),
            "confusion_matrix": {"tp": tp, "fn": fn, "fp": fp, "tn": tn}}


def room_metrics(frame, point, lower=None, upper=None):
    point = np.asarray(point)
    if len(point) != len(frame) or not np.isfinite(point).all():
        raise ValueError("Invalid point predictions")
    if (lower is None) != (upper is None):
        raise ValueError("Both extrema predictions are required")
    current = frame.temperature.to_numpy()
    actual = frame.future_temp_15m.to_numpy()
    actual_min, actual_max = frame.future_min_15m.to_numpy(), frame.future_max_15m.to_numpy()
    result = {"overall": regression(actual, point), "rooms": {}}
    for name, (low, high) in ROOMS.items():
        mask = (current >= low) & (current <= high)
        if not mask.any():
            raise ValueError("No evaluation samples for " + name)
        alarm = (point[mask] < low) | (point[mask] > high)
        window_observed = (actual_min[mask] < low) | (actual_max[mask] > high)
        item = {"temp_min": low, "temp_max": high,
                **regression(actual[mask], point[mask]),
                "endpoint_alerts": classification((actual[mask] < low) | (actual[mask] > high), alarm),
                "window_alerts": classification(window_observed, alarm)}
        near = mask & (np.minimum(current - low, high - current) <= 1)
        if near.any():
            item["near_threshold"] = regression(actual[near], point[near])
            near_alarm = (point[near] < low) | (point[near] > high)
            item["near_threshold"]["endpoint_alerts"] = classification(
                (actual[near] < low) | (actual[near] > high), near_alarm)
            item["near_threshold"]["window_alerts"] = classification(
                (actual_min[near] < low) | (actual_max[near] > high), near_alarm)
        if lower is not None:
            # The last future sample belongs to the same three-point window.
            # Projection enforces the physical ordering of predicted extrema.
            lo = np.minimum(np.minimum(lower, upper), point)
            hi = np.maximum(np.maximum(lower, upper), point)
            item["extrema_window_alerts"] = classification(
                window_observed, (lo[mask] < low) | (hi[mask] > high))
        result["rooms"][name] = item
    def average(getter):
        values = [getter(room) for room in result["rooms"].values()]
        values = [value for value in values if value is not None]
        return float(np.mean(values)) if values else None
    result["macro"] = {key: average(lambda room, k=key: room[k])
                       for key in ["mae", "p95_absolute_error", "within_1c"]}
    for mode in ["endpoint_alerts", "window_alerts", *(["extrema_window_alerts"] if lower is not None else [])]:
        result["macro"][mode] = {key: average(lambda room, k=key: room[mode][k])
                                  for key in ["recall", "precision", "f1", "false_negative_rate", "false_positive_rate"]}
    return result


def load_room_data(raw_dir):
    frame, sources = load_data(raw_dir)
    future = []
    for entry in sources:
        raw = pd.read_csv(raw_dir / entry["file"], sep="\t", usecols=["Time", "T_MS", "T_FC"])
        for domain in ["T_MS", "T_FC"]:
            lookahead = np.column_stack([raw[domain].shift(-lag) for lag in [1, 2, 3]])
            future.append(pd.DataFrame({
                "refrigerator": Path(entry["file"]).stem, "compartment": domain,
                "elapsed_minutes": raw.Time,
                "future_min_15m": lookahead.min(axis=1),
                "future_max_15m": lookahead.max(axis=1),
            }))
    merged = frame.merge(pd.concat(future, ignore_index=True),
                         on=["refrigerator", "compartment", "elapsed_minutes"],
                         how="left", validate="one_to_one", sort=False)
    if len(merged) != len(frame) or not np.isfinite(merged[["future_min_15m", "future_max_15m"]]).all().all():
        raise ValueError("Window target alignment failed")
    return merged, sources


def choose_candidate(evaluations):
    baseline = evaluations["current"]["macro"]
    eligible = ["current"]
    for name, result in evaluations.items():
        item = result["macro"]
        if (item["mae"] < baseline["mae"]
                and item["p95_absolute_error"] <= baseline["p95_absolute_error"] * 1.05
                and item["window_alerts"]["false_negative_rate"] <= baseline["window_alerts"]["false_negative_rate"] + .01
                and item["window_alerts"]["false_positive_rate"] <= baseline["window_alerts"]["false_positive_rate"] + .01):
            eligible.append(name)
    return min(eligible, key=lambda name: evaluations[name]["macro"]["mae"])


def promotion_gate(baseline, candidate):
    before, after = baseline["macro"], candidate["macro"]
    checks = {
        "macro_mae_reduction_at_least_1_percent": after["mae"] <= before["mae"] * .99,
        "macro_p95_regression_at_most_5_percent": after["p95_absolute_error"] <= before["p95_absolute_error"] * 1.05,
        "window_miss_rate_regression_at_most_1_point": after["window_alerts"]["false_negative_rate"] <= before["window_alerts"]["false_negative_rate"] + .01,
        "window_false_alarm_rate_regression_at_most_1_point": after["window_alerts"]["false_positive_rate"] <= before["window_alerts"]["false_positive_rate"] + .01,
        "each_room_mae_regression_at_most_5_percent": all(candidate["rooms"][name]["mae"] <= room["mae"] * 1.05 for name, room in baseline["rooms"].items()),
    }
    return {"passed": all(checks.values()), "checks": checks}


def fit(reference, train, candidate, target="future_temp_15m"):
    model = clone(reference).set_params(**CANDIDATES[candidate])
    started = time.perf_counter()
    model.fit(train[FEATURE_NAMES], train[target] - train.temperature)
    return model, {"seconds": time.perf_counter() - started, "iterations": int(model.n_iter_),
                   "samples": len(train), "target": target, "parameters": model.get_params()}


def predict(model, frame):
    return model.predict(frame[FEATURE_NAMES]) + frame.temperature.to_numpy()


def render_report(result):
    lines = ["# Room-threshold forecast experiment", "",
             "Public Bangkok observations replayed against room presets; these are not measurements from real cold rooms.",
             "Both source channels stay together by source refrigerator. Channel labels never route predictions.", "",
             f"- Sources: {result['dataset']['sources_count']}; rows: {result['dataset']['rows']:,}.",
             "- Endpoint target: same sensor at t+15 minutes. Window targets: min/max at t+5, t+10, t+15.",
             "- Evaluation starts only while the current temperature is inside each room's configured bounds, matching the backend.",
             "- Room presets overlap; macro scores give each preset equal weight, not independent sample counts.",
             "- Three grouped tuning folds use development sources only; holdout sources are evaluated once after selection.",
             "- The public dataset has been used in earlier project experiments; this holdout is separate within this run, not a globally untouched dataset.",
             "- All controls are fitted from scratch on their training split. The existing all-source artifact is never scored as a held-out model.",
             "- Alert scores are sample-level, not independent incidents or measured operational lead times.",
             "- All configuration changes, candidate selection and promotion gates are recorded in metrics.json.", ""]
    for title, entries in [("Tuning (grouped out-of-fold)", result.get("tuning", {}).get("evaluations", {})),
                           ("Source holdout", result.get("holdout", {}).get("evaluations", {})),
                           ("Later-time replay", result.get("temporal", {}).get("evaluations", {}))]:
        if not entries:
            continue
        lines += ["## " + title, "", "| Model | Mean room MAE C | Mean room P95 C | Window recall | Window false-positive rate |", "|---|---:|---:|---:|---:|"]
        for name, entry in entries.items():
            m = entry["macro"]; alarm = m.get("extrema_window_alerts", m["window_alerts"])
            lines.append(f"| {name} | {m['mae']:.4f} | {m['p95_absolute_error']:.4f} | {alarm['recall']:.2%} | {alarm['false_positive_rate']:.2%} |")
        lines.append("")
    if "selected" in result:
        lines += [f"Selected using tuning only: **{result['selected']}**.", ""]
    if "promotion" in result:
        lines += ["## Promotion decision", "", json.dumps(result["promotion"], indent=2), ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, default=SERVICE / "temperature_model_history.pkl")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1 or args.output_dir.exists():
        parser.error("Use positive threads and a new output directory")
    reference_hash = hashlib.sha256(args.reference_model.read_bytes()).hexdigest()
    artifact = joblib.load(args.reference_model)
    if artifact["feature_schema"] != FEATURE_SCHEMA or artifact["feature_names"] != FEATURE_NAMES:
        raise ValueError("Incompatible reference artifact")
    frame, sources = load_room_data(args.raw_dir.resolve())
    development_indices, holdout_indices = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=SEED).split(frame, groups=frame.refrigerator))
    development, holdout = frame.iloc[development_indices].reset_index(drop=True), frame.iloc[holdout_indices].reset_index(drop=True)
    result = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {"rows": len(frame), "sources_count": len(sources), "sources": sources,
                    "manifest_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()},
        "environment": {"python": platform.python_version(), "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "threads": args.threads},
        "reference_sha256": reference_hash, "rooms": ROOMS, "candidates": CANDIDATES,
        "split": {"seed": SEED, "development_sources": sorted(development.refrigerator.unique()), "holdout_sources": sorted(holdout.refrigerator.unique())},
        "tuning": {"folds": [], "evaluations": {}},
    }
    args.output_dir.mkdir(parents=True)
    (args.output_dir / "reference_model.pkl").write_bytes(args.reference_model.read_bytes())
    def save():
        (args.output_dir / "metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
        (args.output_dir / "report.md").write_text(render_report(result), encoding="utf-8")
    save()
    oof = {name: np.full(len(development), np.nan) for name in CANDIDATES}
    splits = list(GroupKFold(n_splits=3, shuffle=True, random_state=SEED).split(development, groups=development.refrigerator))
    with threadpool_limits(limits=args.threads):
        for number, (train_indices, validation_indices) in enumerate(splits, 1):
            train, validation = development.iloc[train_indices], development.iloc[validation_indices]
            fold = {"number": number, "train_sources": sorted(train.refrigerator.unique()), "validation_sources": sorted(validation.refrigerator.unique()), "training": {}}
            for name in CANDIDATES:
                print(f"Tuning {number}/3: {name}", flush=True)
                model, timing = fit(artifact["model"], train, name)
                prediction = predict(model, validation)
                oof[name][validation_indices] = prediction
                fold["training"][name] = timing
                print(json.dumps({"fold": number, "candidate": name, "seconds": round(timing["seconds"], 1), "macro": room_metrics(validation, prediction)["macro"]}), flush=True)
            result["tuning"]["folds"].append(fold)
            save()
        result["tuning"]["evaluations"] = {name: room_metrics(development, prediction) for name, prediction in oof.items()}
        selected = result["selected"] = choose_candidate(result["tuning"]["evaluations"])
        print("Selected using development folds: " + selected, flush=True)
        save()
        result["holdout"] = {"evaluations": {}, "training": {}}
        heldout_models = {}
        for name in dict.fromkeys(["current", selected]):
            print("Holdout fit: " + name, flush=True)
            model, timing = fit(artifact["model"], development, name)
            heldout_models[name] = model
            result["holdout"]["training"][name] = timing
            result["holdout"]["evaluations"][name] = room_metrics(holdout, predict(model, holdout))
        point = predict(heldout_models[selected], holdout)
        extrema = {}
        for name in ["future_min_15m", "future_max_15m"]:
            print("Window fit: " + name, flush=True)
            model, timing = fit(artifact["model"], development, selected, target=name)
            extrema[name] = model
            result["holdout"]["training"][name] = timing
        result["holdout"]["evaluations"]["selected_with_extrema"] = room_metrics(
            holdout, point, predict(extrema["future_min_15m"], holdout), predict(extrema["future_max_15m"], holdout))
        before = result["holdout"]["evaluations"]["current"]
        after = result["holdout"]["evaluations"][selected]
        result["promotion"] = {"source_holdout": promotion_gate(before, after)}
        save()
        # Future-time check: current history may cross the cut, training labels may not.
        limits = frame.groupby(["refrigerator", "compartment"]).elapsed_minutes.transform("max") * .8
        temporal_train = frame.loc[frame.elapsed_minutes + 15 < limits]
        temporal_test = frame.loc[frame.elapsed_minutes >= limits]
        result["temporal"] = {"train_samples": len(temporal_train), "test_samples": len(temporal_test), "evaluations": {}}
        for name in dict.fromkeys(["current", selected]):
            print("Later-time fit: " + name, flush=True)
            model, timing = fit(artifact["model"], temporal_train, name)
            result["temporal"]["evaluations"][name] = room_metrics(temporal_test, predict(model, temporal_test))
        result["promotion"]["later_time"] = promotion_gate(result["temporal"]["evaluations"]["current"], result["temporal"]["evaluations"][selected])
        result["promotion"]["passed"] = all(value["passed"] for value in result["promotion"].values())
        save()
        # Keep evaluated split models for reproducibility, never silently promote.
        joblib.dump({"point": heldout_models[selected], "minimum": extrema["future_min_15m"],
                     "maximum": extrema["future_max_15m"], "selected": selected,
                     "feature_names": FEATURE_NAMES, "split": result["split"]}, args.output_dir / "evaluated_models.pkl", compress=3)
        if result["promotion"]["passed"]:
            print("Training approved point candidate on all sources", flush=True)
            model, timing = fit(artifact["model"], frame, selected)
            candidate = {**artifact, "model": model, "trained_at": datetime.now(timezone.utc).isoformat(),
                         "hyperparameters": model.get_params(), "metrics": result["holdout"]["evaluations"][selected],
                         "environment": result["environment"],
                         "validation": {"method": "room-threshold grouped tuning, source holdout and later-time replay", "report": "metrics.json", "seed": SEED},
                         "experiment_candidate": selected}
            joblib.dump(candidate, args.output_dir / "approved_candidate.pkl", compress=3)
            metadata = {key: value for key, value in candidate.items() if key != "model"}
            (args.output_dir / "approved_candidate.json").write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
            result["final_training"] = timing
        if hashlib.sha256(args.reference_model.read_bytes()).hexdigest() != reference_hash:
            raise RuntimeError("Runtime reference artifact was modified")
        save()
    print(json.dumps({"selected": selected, "promotion": result["promotion"]}), flush=True)


if __name__ == "__main__":
    main()
