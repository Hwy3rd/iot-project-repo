"""Offline room-warning classifiers, calibrated without looking at test labels.

The outcome is any observed breach at t+5, t+10 or t+15, while the room is
currently in range. Source channels are provenance, never inference inputs.
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
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_curve
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from room_forecast import FEATURE_NAMES, ROOMS, SEED, classification, load_room_data, predict

WARNING_FEATURES = FEATURE_NAMES + [
    "room_min", "room_max", "distance_to_min", "distance_to_max", "room_width",
]
CANDIDATES = ("logistic", "random_forest", "hist_gradient_boosting")


def make_examples(frame):
    """Duplicate overlapping room contexts only after the physical source split."""
    parts = []
    for name, (low, high) in ROOMS.items():
        positions = np.flatnonzero(frame.temperature.between(low, high).to_numpy())
        part = frame.iloc[positions].copy()
        part["row_position"] = positions
        part["room"] = name
        part["room_min"], part["room_max"] = low, high
        part["distance_to_min"] = part.temperature - low
        part["distance_to_max"] = high - part.temperature
        part["room_width"] = high - low
        part["breach"] = (part.future_min_15m < low) | (part.future_max_15m > high)
        parts.append(part)
    return pd.concat(parts, ignore_index=True)


def make_classifier(name, threads):
    if name == "logistic":
        return make_pipeline(StandardScaler(), LogisticRegression(C=1., max_iter=1000, random_state=SEED))
    if name == "random_forest":
        return RandomForestClassifier(n_estimators=120, max_depth=14, min_samples_leaf=20,
                                      max_features=.8, max_samples=.7, n_jobs=threads,
                                      random_state=SEED)
    if name == "hist_gradient_boosting":
        # Fixed rounds avoid a random internal validation split over adjacent rows.
        return HistGradientBoostingClassifier(max_iter=300, learning_rate=.05,
                                             max_leaf_nodes=31, min_samples_leaf=50,
                                             l2_regularization=1., early_stopping=False,
                                             random_state=SEED)
    raise ValueError("Unknown classifier: " + name)


def point_scores(frame, point):
    examples = make_examples(frame)
    values = np.asarray(point)[examples.row_position.to_numpy()]
    return np.maximum(examples.room_min.to_numpy() - values, values - examples.room_max.to_numpy())


def threshold_at_budget(observed, scores, budget):
    """Maximize validation recall within the negative-sample FPR budget.

    Thresholds use >=; None means no alerts (the ROC's infinite threshold).
    Ties prefer fewer false positives, then the higher threshold.
    """
    observed, scores = np.asarray(observed, bool), np.asarray(scores, float)
    if not 0 <= budget <= 1 or len(observed) != len(scores) or not np.isfinite(scores).all():
        raise ValueError("Invalid calibration inputs")
    if not np.any(~observed):
        raise ValueError("Cannot calibrate FPR without negative examples")
    if not observed.any():
        return None
    fpr, tpr, thresholds = roc_curve(observed, scores, drop_intermediate=False)
    eligible = np.flatnonzero(fpr <= budget + 1e-12)
    best = min(eligible, key=lambda i: (-tpr[i], fpr[i], -thresholds[i]))
    return float(thresholds[best]) if np.isfinite(thresholds[best]) else None


def decisions(examples, scores, thresholds):
    predicted = np.zeros(len(examples), bool)
    for name in ROOMS:
        mask = examples.room.to_numpy() == name
        threshold = thresholds[name]
        if threshold is not None:
            predicted[mask] = np.asarray(scores)[mask] >= threshold
    return predicted


def evaluate(examples, observed, predicted, scores=None):
    result = {"rooms": {}}
    for name in ROOMS:
        mask = examples.room.to_numpy() == name
        entry = classification(np.asarray(observed)[mask], np.asarray(predicted)[mask])
        entry["sources"] = int(examples.loc[mask, "refrigerator"].nunique())
        if scores is not None and np.asarray(observed)[mask].any():
            entry["average_precision"] = float(average_precision_score(np.asarray(observed)[mask], np.asarray(scores)[mask]))
        result["rooms"][name] = entry
    keys = ["recall", "precision", "f1", "false_positive_rate", "false_negative_rate"]
    if scores is not None:
        keys.append("average_precision")
    result["macro"] = {}
    for key in keys:
        values = [entry.get(key) for entry in result["rooms"].values()]
        values = [value for value in values if value is not None]
        result["macro"][key] = float(np.mean(values)) if values else None
    return result


def calibrate(examples, scores, budgets):
    y = examples.breach.to_numpy()
    return {name: threshold_at_budget(y[examples.room.to_numpy() == name],
                                     np.asarray(scores)[examples.room.to_numpy() == name], budgets[name])
            for name in ROOMS}


def train_point(reference, train, validation):
    started = time.perf_counter()
    model = clone(reference)
    model.fit(train[FEATURE_NAMES], train.future_temp_15m - train.temperature)
    scores = point_scores(validation, predict(model, validation))
    return model, scores, time.perf_counter() - started


def train_classifier(name, train_examples, validation_examples, threads):
    model = make_classifier(name, threads)
    started = time.perf_counter()
    model.fit(train_examples[WARNING_FEATURES], train_examples.breach)
    scores = model.predict_proba(validation_examples[WARNING_FEATURES])[:, 1]
    return model, scores, time.perf_counter() - started


def collect_oof(frame, reference, candidates, threads, label):
    examples = make_examples(frame)
    scores = {name: np.full(len(examples), np.nan) for name in ["point", *candidates]}
    folds = []
    splits = GroupKFold(n_splits=3, shuffle=True, random_state=SEED).split(frame, groups=frame.refrigerator)
    for number, (train_idx, validation_idx) in enumerate(splits, 1):
        train, validation = frame.iloc[train_idx], frame.iloc[validation_idx]
        training_examples, validation_examples = make_examples(train), make_examples(validation)
        valid_mask = examples.refrigerator.isin(validation.refrigerator.unique()).to_numpy()
        # Both frames preserve room-then-source-row order, making assignment exact.
        if not np.array_equal(examples.loc[valid_mask, ["room", "refrigerator", "compartment", "elapsed_minutes"]].to_numpy(),
                              validation_examples[["room", "refrigerator", "compartment", "elapsed_minutes"]].to_numpy()):
            raise ValueError("OOF example alignment failed")
        if set(train.refrigerator) & set(validation.refrigerator):
            raise ValueError("Physical-source leakage")
        fold = {"number": number, "train_sources": sorted(train.refrigerator.unique()),
                "validation_sources": sorted(validation.refrigerator.unique()), "seconds": {}}
        print(f"{label} fold {number}/3: point regressor", flush=True)
        _, scores["point"][valid_mask], seconds = train_point(reference, train, validation)
        fold["seconds"]["point"] = seconds
        for name in candidates:
            print(f"{label} fold {number}/3: {name}", flush=True)
            _, scores[name][valid_mask], seconds = train_classifier(name, training_examples, validation_examples, threads)
            fold["seconds"][name] = seconds
        folds.append(fold)
        print(json.dumps({"phase": label, "fold": number, "seconds": fold["seconds"]}), flush=True)
    if any(not np.isfinite(score).all() for score in scores.values()):
        raise ValueError("Incomplete OOF scores")
    return examples, scores, folds


def calibration_result(examples, scores):
    y = examples.breach.to_numpy()
    result = {"evaluations": {"point_default": evaluate(examples, y, scores["point"] > 0, scores["point"])},
              "thresholds": {}}
    budgets = {name: value["false_positive_rate"]
               for name, value in result["evaluations"]["point_default"]["rooms"].items()}
    result["per_room_fpr_budgets"] = budgets
    for name, score in scores.items():
        key = "point_calibrated" if name == "point" else name
        thresholds = calibrate(examples, score, budgets)
        result["thresholds"][key] = thresholds
        result["evaluations"][key] = evaluate(examples, y, decisions(examples, score, thresholds), score)
    return result


def evaluate_fixed(examples, scores, thresholds):
    y = examples.breach.to_numpy()
    result = {"point_default": evaluate(examples, y, scores["point"] > 0, scores["point"])}
    for name, score in scores.items():
        key = "point_calibrated" if name == "point" else name
        result[key] = evaluate(examples, y, decisions(examples, score, thresholds[key]), score)
    return result


def paired_source_bootstrap(examples, reference_decisions, candidate_decisions, repeats=2000):
    """Resample whole physical sources, retaining serial and room dependence."""
    sources = sorted(examples.refrigerator.unique())
    counts = np.zeros((2, len(sources), len(ROOMS), 4))
    for source_idx, source in enumerate(sources):
        for room_idx, room in enumerate(ROOMS):
            mask = (examples.refrigerator.to_numpy() == source) & (examples.room.to_numpy() == room)
            y = examples.breach.to_numpy()[mask]
            for model_idx, predictions in enumerate([reference_decisions, candidate_decisions]):
                cm = classification(y, np.asarray(predictions)[mask])["confusion_matrix"]
                counts[model_idx, source_idx, room_idx] = [cm[key] for key in ["tp", "fn", "fp", "tn"]]
    rng = np.random.default_rng(SEED)
    weights = rng.multinomial(len(sources), np.full(len(sources), 1 / len(sources)), size=repeats)
    totals = np.einsum("bs,msrc->mbrc", weights, counts)
    deltas = {}
    for key, numerator, denominator in [("recall", 0, (0, 1)), ("false_positive_rate", 2, (2, 3))]:
        divisor = totals[..., denominator[0]] + totals[..., denominator[1]]
        # Report only paired draws with every room denominator defined.
        valid = (divisor > 0).all(axis=(0, 2))
        # Select the count axis first: mixing a boolean and scalar advanced
        # index in one expression would move the bootstrap axis to the front.
        ratios = totals[..., numerator][:, valid, :] / divisor[:, valid, :]
        difference = ratios[1].mean(axis=1) - ratios[0].mean(axis=1)
        deltas[key] = {"percentile_95_interval": np.quantile(difference, [.025, .975]).tolist(),
                       "valid_replicates": int(valid.sum()), "requested_replicates": repeats}
    return deltas


def comparison_gate(evaluations, selected):
    after = evaluations[selected]
    checks = {}
    for key in ["point_default", "point_calibrated"]:
        before = evaluations[key]
        checks[key + "_recall_improvement_at_least_2_points"] = after["macro"]["recall"] >= before["macro"]["recall"] + .02
        checks[key + "_fpr_increase_at_most_half_point"] = after["macro"]["false_positive_rate"] <= before["macro"]["false_positive_rate"] + .005
        checks[key + "_each_room_fpr_increase_at_most_1_point"] = all(
            after["rooms"][room]["false_positive_rate"] <= before["rooms"][room]["false_positive_rate"] + .01 for room in ROOMS)
    return {"passed": all(checks.values()), "checks": checks}


def render_report(result):
    lines = ["# Room warning objective experiment", "",
             "Outcome: any observed breach at t+5, t+10 or t+15 while currently inside the room bounds.",
             "Bangkok household observations provide supplemental training/evaluation, not real cold-room measurements.", "",
             "- All 22 existing history features plus configured room bounds and current distances; no future inputs or source/channel identifiers.",
             "- Both source channels and overlapping room contexts stay together by physical source.",
             "- Reuses the prior 98/25 source split for paired comparison; this public dataset and holdout have been examined before.",
             "- Three source-grouped development folds select thresholds and the classifier; test labels never tune thresholds.",
             "- Each room's development FPR budget equals the unmodified point regressor's OOF FPR.",
             "- Calibrated point control gets the same threshold search as classifiers, so sensitivity changes alone are controlled.",
             "- The source-held-out models are trained on development only. The all-source runtime pickle is never used for test predictions.",
             "- OOF scores below are calibration/selection scores, not unbiased final test estimates.",
             "- Later-time confirmation repeats grouped calibration on its earlier training portion only.",
             "- Scores count time samples, not independent incidents or operational lead time; room presets may overlap.",
             "- Classifier outputs are risk scores, not validated probability estimates or food-safety guarantees.", ""]
    for key, title in [("development", "Development OOF (used for calibration and selection)"),
                       ("holdout", "Source holdout (fixed thresholds)"),
                       ("temporal", "Later-time replay (separately calibrated on earlier data)")]:
        if key not in result:
            continue
        evaluations = result[key]["evaluations"]
        lines += ["## " + title, "", "| Model | Mean room recall | Mean room FPR | Mean room precision | Mean room AP |",
                  "|---|---:|---:|---:|---:|"]
        for name, evaluation in evaluations.items():
            item = evaluation["macro"]
            lines.append(f"| {name} | {item['recall']:.2%} | {item['false_positive_rate']:.2%} | {item['precision']:.2%} | {item['average_precision']:.4f} |")
        lines.append("")
    if "selected" in result:
        lines += [f"Classifier selected on development only: **{result['selected']}**.", ""]
    if "holdout" in result:
        lines += ["## Holdout per room", "", "| Room | Model | Samples | Positives | Recall | FPR | Precision |", "|---|---|---:|---:|---:|---:|---:|"]
        for room in ROOMS:
            for name in ["point_default", "point_calibrated", result["selected"]]:
                item = result["holdout"]["evaluations"][name]["rooms"][room]
                lines.append(f"| {room} | {name} | {item['samples']} | {item['positives']} | {item['recall']:.2%} | {item['false_positive_rate']:.2%} | {item['precision']:.2%} |")
        lines.append("")
    if "assessment" in result:
        lines += ["## Prespecified experimental checks", "",
                  "Recall must improve by at least 2 percentage points vs both point controls, macro FPR may increase at most 0.5 point, and each room FPR at most 1 point, on both evaluations.",
                  "These are coursework comparison tolerances, not safety limits.", "", "```json", json.dumps(result["assessment"], indent=2), "```", "",
                  "Runtime model and API are unchanged. Evaluated candidate models and their development-calibrated thresholds are saved separately; they are not fitted on all sources or deployed.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, default=SERVICE / "temperature_model_history.pkl")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--resume", action="store_true", help="Reuse verified saved development OOF scores after an interrupted run")
    args = parser.parse_args()
    if args.threads < 1 or (args.output_dir.exists() != args.resume):
        parser.error("Use positive threads and a new output directory, or --resume for an existing run")
    reference_hash = hashlib.sha256(args.reference_model.read_bytes()).hexdigest()
    artifact = joblib.load(args.reference_model)
    if artifact["feature_names"] != FEATURE_NAMES:
        raise ValueError("Incompatible point reference features")
    frame, sources = load_room_data(args.raw_dir.resolve())
    train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=SEED).split(frame, groups=frame.refrigerator))
    development, holdout = frame.iloc[train_idx].reset_index(drop=True), frame.iloc[test_idx].reset_index(drop=True)
    result = {"created_at": datetime.now(timezone.utc).isoformat(), "reference_sha256": reference_hash,
              "dataset": {"rows": len(frame), "sources_count": len(sources), "sources": sources},
              "environment": {"python": platform.python_version(), "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "threads": args.threads},
              "rooms": ROOMS, "features": WARNING_FEATURES,
              "candidate_parameters": {name: {key: str(value) if not isinstance(value, (str, bool, int, float, type(None))) else value
                                                for key, value in make_classifier(name, args.threads).get_params(deep=False).items()} for name in CANDIDATES},
              "split": {"seed": SEED, "development_sources": sorted(development.refrigerator.unique()), "holdout_sources": sorted(holdout.refrigerator.unique())}}
    previous = None
    if args.resume:
        previous = json.loads((args.output_dir / "metrics.json").read_text(encoding="utf-8"))
        for key in ["reference_sha256", "dataset", "environment", "rooms", "features", "candidate_parameters", "split"]:
            # JSON roundtrip normalizes tuple room bounds to lists.
            if previous[key] != json.loads(json.dumps(result[key])):
                raise ValueError("Resume provenance mismatch: " + key)
        if "development" not in previous or not (args.output_dir / "development_scores.npz").exists():
            raise ValueError("No completed development checkpoint to resume")
    args.output_dir.mkdir(parents=True, exist_ok=args.resume)
    def save():
        (args.output_dir / "metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
        (args.output_dir / "report.md").write_text(render_report(result), encoding="utf-8")
    if previous is None:
        save()
    with threadpool_limits(limits=args.threads):
        if previous is None:
            examples, oof, folds = collect_oof(development, artifact["model"], CANDIDATES, args.threads, "Development")
        else:
            examples, folds = make_examples(development), previous["development"]["folds"]
            with np.load(args.output_dir / "development_scores.npz") as stored:
                oof = {name: stored[name] for name in ["point", *CANDIDATES]}
            if any(len(score) != len(examples) or not np.isfinite(score).all() for score in oof.values()):
                raise ValueError("Invalid development checkpoint scores")
            print("Resumed completed development OOF scores with matching provenance", flush=True)
        result["development"] = calibration_result(examples, oof)
        result["development"]["folds"] = folds
        selected = result["selected"] = max(CANDIDATES, key=lambda name: result["development"]["evaluations"][name]["macro"]["recall"])
        np.savez_compressed(args.output_dir / "development_scores.npz", **oof)
        print(json.dumps({"selected": selected, "development": {name: value["macro"] for name, value in result["development"]["evaluations"].items()}}), flush=True)
        save()
        heldout_examples = make_examples(holdout)
        development_examples = make_examples(development)
        print("Source holdout: fit point regressor", flush=True)
        point_model, point_score, seconds = train_point(artifact["model"], development, holdout)
        models, scores, timings = {"point": point_model}, {"point": point_score}, {"point": seconds}
        for name in CANDIDATES:
            print("Source holdout: fit " + name, flush=True)
            models[name], scores[name], timings[name] = train_classifier(name, development_examples, heldout_examples, args.threads)
        thresholds = result["development"]["thresholds"]
        result["holdout"] = {"evaluations": evaluate_fixed(heldout_examples, scores, thresholds), "seconds": timings}
        # Persist expensive fits before the optional confidence-interval report.
        np.savez_compressed(args.output_dir / "holdout_scores.npz", **scores)
        joblib.dump({"models": models, "thresholds": thresholds, "selected": selected, "warning_features": WARNING_FEATURES,
                     "split": result["split"], "trained_on": "development sources only; evaluation artifacts, not runtime"},
                    args.output_dir / "evaluated_warning_models.pkl", compress=3)
        save()
        candidate_decisions = decisions(heldout_examples, scores[selected], thresholds[selected])
        result["holdout"]["paired_source_bootstrap"] = {}
        for control, control_decisions in [("point_default", scores["point"] > 0),
                                           ("point_calibrated", decisions(heldout_examples, scores["point"], thresholds["point_calibrated"]))]:
            result["holdout"]["paired_source_bootstrap"][control] = paired_source_bootstrap(heldout_examples, control_decisions, candidate_decisions)
        print(json.dumps({"holdout": {name: value["macro"] for name, value in result["holdout"]["evaluations"].items()}}), flush=True)
        save()
        limits = frame.groupby(["refrigerator", "compartment"]).elapsed_minutes.transform("max") * .8
        earlier, later = frame.loc[frame.elapsed_minutes + 15 < limits].reset_index(drop=True), frame.loc[frame.elapsed_minutes >= limits].reset_index(drop=True)
        earlier_examples, temporal_oof, temporal_folds = collect_oof(earlier, artifact["model"], [selected], args.threads, "Temporal calibration")
        temporal_calibration = calibration_result(earlier_examples, temporal_oof)
        temporal_thresholds = temporal_calibration["thresholds"]
        later_examples = make_examples(later)
        print("Later-time replay: fit point and selected classifier", flush=True)
        _, temporal_point, _ = train_point(artifact["model"], earlier, later)
        _, temporal_candidate, _ = train_classifier(selected, earlier_examples, later_examples, args.threads)
        temporal_scores = {"point": temporal_point, selected: temporal_candidate}
        result["temporal"] = {"train_rows": len(earlier), "test_rows": len(later), "calibration": temporal_calibration,
                              "folds": temporal_folds, "evaluations": evaluate_fixed(later_examples, temporal_scores, temporal_thresholds)}
        np.savez_compressed(args.output_dir / "temporal_scores.npz", **temporal_scores)
        result["assessment"] = {"source_holdout": comparison_gate(result["holdout"]["evaluations"], selected),
                                "later_time": comparison_gate(result["temporal"]["evaluations"], selected),
                                "runtime_changed": False}
        result["assessment"]["passed_both"] = result["assessment"]["source_holdout"]["passed"] and result["assessment"]["later_time"]["passed"]
        if hashlib.sha256(args.reference_model.read_bytes()).hexdigest() != reference_hash:
            raise RuntimeError("Runtime point reference was modified")
        save()
        print(json.dumps({"selected": selected, "assessment": result["assessment"]}), flush=True)


if __name__ == "__main__":
    main()
