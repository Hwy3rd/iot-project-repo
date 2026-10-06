#!/usr/bin/env python3
"""Compare a shared T_MS/T_FC forecast with two compartment-specific forecasts."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits

FEATURES = ["temperature", "temp_delta", "temp_moving_avg"]
TARGET = "future_temp_15m"
DOMAINS = ["T_MS", "T_FC"]
METHODS = ["persistence", "shared", "separate"]
THRESHOLDS = {"T_MS": 8.0, "T_FC": -18.0}
BANDS = [
    ("below_-25", -np.inf, -25), ("-25_to_-20", -25, -20),
    ("-20_to_-15", -20, -15), ("-15_to_-5", -15, -5),
    ("-5_to_0", -5, 0), ("0_to_8", 0, 8),
    ("8_to_15", 8, 15), ("15_and_above", 15, np.inf),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_series(root: Path) -> tuple[pd.DataFrame, list[dict]]:
    parts, sources = [], []
    files = sorted(root.glob("*.txt"))
    if len(files) < 5:
        raise ValueError("At least five source refrigerators are needed.")
    for path in files:
        raw = pd.read_csv(path, sep="\t", usecols=["Time", *DOMAINS])
        raw = raw.apply(pd.to_numeric, errors="raise")
        if not np.isfinite(raw.to_numpy(dtype=float)).all():
            raise ValueError(f"Missing/non-finite required values in {path.name}")
        if len(raw) < 8 or not raw.Time.diff().iloc[1:].eq(5).all():
            raise ValueError(f"Expected a regular, ordered five-minute series: {path.name}")
        sources.append({
            "file": path.name, "sha256": digest(path), "raw_rows": len(raw),
            "raw_ranges": {c: [float(raw[c].min()), float(raw[c].max())] for c in DOMAINS},
        })
        for domain in DOMAINS:
            temp = raw[domain]
            # Backend query is ts > current - 15 min, at most 5 readings, min 2.
            # At the source's 5-min cadence this includes current, t-5 and t-10.
            part = pd.DataFrame({
                "refrigerator": path.stem,
                "compartment": domain,
                "elapsed_minutes": raw.Time,
                "temperature": temp,
                "temp_delta": temp.diff().round(2),
                "temp_moving_avg": temp.rolling(3, min_periods=2).mean().round(2),
                TARGET: temp.shift(-3),
            }).dropna(subset=[*FEATURES, TARGET])
            if not (raw.Time.shift(-3).loc[part.index] - part.elapsed_minutes).eq(15).all():
                raise ValueError(f"Target is not exactly 15 minutes ahead: {path.name}")
            parts.append(part)
    frame = pd.concat(parts, ignore_index=True)
    if not np.isfinite(frame[[*FEATURES, TARGET]].to_numpy()).all():
        raise ValueError("Non-finite derived data")
    return frame, sources


def score(actual: np.ndarray, prediction: np.ndarray) -> dict:
    error = prediction - actual
    absolute = np.abs(error)
    return {
        "samples": len(actual), "mae": float(mean_absolute_error(actual, prediction)),
        "rmse": float(np.sqrt(mean_squared_error(actual, prediction))),
        "r2": float(r2_score(actual, prediction)) if len(actual) > 1 else None, "bias": float(error.mean()),
        "p95_absolute_error": float(np.quantile(absolute, .95)),
        "within_0_5c": float((absolute <= .5).mean()),
        "within_1c": float((absolute <= 1).mean()),
    }


def threshold_score(actual: np.ndarray, prediction: np.ndarray, threshold: float) -> dict:
    observed, forecast = actual > threshold, prediction > threshold
    tp = int((observed & forecast).sum())
    fp = int((~observed & forecast).sum())
    fn = int((observed & ~forecast).sum())
    tn = int((~observed & ~forecast).sum())
    return {
        "threshold_c": threshold, "actual_positive_samples": int(observed.sum()),
        "accuracy": float((observed == forecast).mean()),
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "recall": tp / (tp + fn) if tp + fn else 0.0,
        "f1": 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def evaluate(frame: pd.DataFrame, predictions: dict[str, np.ndarray]) -> dict:
    if any(len(p) != len(frame) or not np.isfinite(p).all() for p in predictions.values()):
        raise ValueError("Invalid predictions")
    actual = frame[TARGET].to_numpy()
    temperature = frame.temperature.to_numpy()
    result = {}
    for method, prediction in predictions.items():
        result[method] = {"overall": score(actual, prediction), "domains": {}}
        for domain in DOMAINS:
            mask = frame.compartment.eq(domain).to_numpy()
            bands = {}
            for name, low, high in BANDS:
                band = mask & (temperature >= low) & (temperature < high)
                if band.any():
                    bands[name] = score(actual[band], prediction[band])
            cold = mask & (temperature >= -25) & (temperature <= -15)
            item = {
                **score(actual[mask], prediction[mask]),
                "bands_by_current_temperature": bands,
                "illustrative_overheat": threshold_score(actual[mask], prediction[mask], THRESHOLDS[domain]),
            }
            if cold.any():
                item["minus_25_to_minus_15"] = score(actual[cold], prediction[cold])
            result[method]["domains"][domain] = item
    return result


def train_models(reference, train: pd.DataFrame) -> tuple[dict, dict]:
    models, timings = {}, {}
    for name, domain in [("shared", None), ("T_MS", "T_MS"), ("T_FC", "T_FC")]:
        subset = train if domain is None else train.loc[train.compartment.eq(domain)]
        start = time.perf_counter()
        model = clone(reference)
        model.fit(subset[FEATURES], subset[TARGET])
        models[name] = model
        timings[name] = {"seconds": time.perf_counter() - start, "train_samples": len(subset)}
    return models, timings


def predict_models(models: dict, test: pd.DataFrame) -> dict:
    separate = np.empty(len(test), dtype=float)
    for domain in DOMAINS:
        mask = test.compartment.eq(domain).to_numpy()
        separate[mask] = models[domain].predict(test.loc[mask, FEATURES])
    return {
        "persistence": test.temperature.to_numpy(),
        "shared": models["shared"].predict(test[FEATURES]),
        "separate": separate,
    }


def fridge_rows(frame: pd.DataFrame, predictions: dict) -> list[dict]:
    rows = []
    for refrigerator in sorted(frame.refrigerator.unique()):
        for domain in DOMAINS:
            mask = (frame.refrigerator.eq(refrigerator) & frame.compartment.eq(domain)).to_numpy()
            for method in METHODS:
                rows.append({"refrigerator": refrigerator, "compartment": domain,
                             "method": method, **score(frame.loc[mask, TARGET].to_numpy(), predictions[method][mask])})
    return rows


def render_report(result: dict) -> str:
    lines = [
        "# Shared vs separate Bangkok compartment models", "",
        f"Run: {result['created_at']}", "",
        "Compare one shared model trained on T_MS + T_FC with two separately trained models.",
        "All use the reference HistGradientBoostingRegressor parameters without tuning on test data.", "",
        f"- Source refrigerators: {result['dataset']['refrigerators']}; usable rows: {result['dataset']['rows']:,}.",
        f"- Input fields: {', '.join(FEATURES)}.",
        "- Target: same sensor's temperature exactly 15 minutes later.",
        "- History: current and previous readings strictly within 15 minutes, max 5 and min 2 readings.",
        "  At the dataset's 5-minute cadence this is normally a three-reading average.",
        "- Humidity and ambient temperature are excluded; hour_of_day is excluded because real starting clock time is unknown.",
        "- Both compartments of a refrigerator always stay in the same train/test partition.",
        "- Persistence baseline forecasts the current temperature unchanged.",
        f"- Primary split: {len(result['primary']['train_refrigerators'])} train / {len(result['primary']['test_refrigerators'])} test refrigerators.",
        "- Separate-model evaluation routes by known compartment label; this does not test automatic routing.",
        f"- Data manifest SHA-256: {result['dataset']['manifest_sha256']}.",
        f"- Reference model SHA-256: {result['reference_model']['sha256']}.", "",
    ]
    for title, evaluation in [
        ("Primary held-out comparison", result["primary"]["results"]),
        ("Five-fold grouped cross-validation: pooled out-of-fold predictions", result["cross_validation"]["out_of_fold_results"]),
    ]:
        lines.extend([f"## {title}", "",
            "| Compartment | Method | MAE (C) | RMSE (C) | R2 | Within 0.5 C | Within 1 C |",
            "|---|---|---:|---:|---:|---:|---:|"])
        for domain in DOMAINS:
            for method in METHODS:
                m = evaluation[method]["domains"][domain]
                lines.append(f"| {domain} | {method} | {m['mae']:.6f} | {m['rmse']:.6f} | {m['r2']:.6f} | {m['within_0_5c']:.2%} | {m['within_1c']:.2%} |")
        lines.extend(["", "Shared-model MAE minus separate-model MAE (positive favors separate):", ""])
        for domain in DOMAINS:
            mixed = evaluation["shared"]["domains"][domain]["mae"]
            single = evaluation["separate"]["domains"][domain]["mae"]
            lines.append(f"- {domain}: {mixed-single:+.6f} C ({(mixed/single-1)*100:+.2f}% relative to separate).")
        lines.extend(["", "Freezer samples currently between -25 C and -15 C:", "",
            "| Method | Samples | MAE (C) | RMSE (C) |",
            "|---|---:|---:|---:|"])
        for method in METHODS:
            m = evaluation[method]["domains"]["T_FC"]["minus_25_to_minus_15"]
            lines.append(f"| {method} | {m['samples']:,} | {m['mae']:.6f} | {m['rmse']:.6f} |")
        lines.append("")
    lines.extend(["## Fold-level stability", "",
        "| Fold | Train fridges | Test fridges | T_MS shared - separate MAE | T_FC shared - separate MAE |",
        "|---|---:|---:|---:|---:|"])
    for fold in result["cross_validation"]["folds"]:
        domain_results = fold["results"]
        differences = [domain_results["shared"]["domains"][d]["mae"] - domain_results["separate"]["domains"][d]["mae"] for d in DOMAINS]
        lines.append(f"| {fold['fold']} | {len(fold['train_refrigerators'])} | {len(fold['test_refrigerators'])} | {differences[0]:+.6f} | {differences[1]:+.6f} |")
    lines.extend(["", "## Primary model probes", "",
        "These are synthetic stable inputs (delta 0, recent average equal to current temperature), not accuracy measurements.", "",
        "| Current C | Shared C | T_MS model C | T_FC model C | Stored model C |",
        "|---:|---:|---:|---:|---:|"])
    for p in result["primary"]["probes"]:
        lines.append(f"| {p['temperature']:.1f} | {p['shared']:.2f} | {p['T_MS']:.2f} | {p['T_FC']:.2f} | {p['stored_model']:.2f} |")
    lines.extend(["", "## Limits and reproducibility", "",
        "- These are domestic refrigerator data, not measured warehouse performance.",
        "- T_FC is the freezer compartment OR coldest zone according to the source README; not all refrigerators maintain -18 C.",
        "- Test fridges are unseen, but this experiment does not measure future seasons or different sites.",
        "- Threshold scores in metrics.json are illustrative: future >8 C for T_MS and future >-18 C for T_FC.",
        "  They are not warehouse-specific safe ranges or overall temperature prediction accuracy.",
        "- The prior feature-ablation run used five-reading history and synthetic hour_of_day; its scores are not directly comparable.",
        "- Grouped cross-validation is validation, not an additional untouched final deployment test.",
        "- Stable probes outside each model's own training range do not establish useful extrapolation.",
        "- Stored-model probes use hour 14, humidity 65, ambient 30 and the stable history inputs.",
        "- Existing runtime code, backend supported-range guard and deployed model are unchanged.",
        "- Three primary trial models are saved here; binaries are ignored by Git. CV models are not saved.",
        "- Per-refrigerator primary metrics are in per_refrigerator.csv; source hashes and split IDs are in metrics.json.",
        "- R2 is null for temperature bands containing only one sample; it is undefined there.",
        f"- Environment: {json.dumps(result['environment'], sort_keys=True)}.", "",
        "Command:", "",
        "```powershell",
        "py -3.10 -X utf8 -u -B ai-service/experiments/compartment_comparison.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/temperature_model_hgb.pkl --output-dir ai-service/experiments/results/compartment-comparison-2026-10-04 --threads 4",
        "```", "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    output = args.output_dir.resolve()
    if output.exists():
        parser.error("Use a new output directory; existing results are preserved.")
    reference_path = args.reference_model.resolve()
    reference_hash = digest(reference_path)
    artifact = joblib.load(reference_path)
    frame, sources = load_series(args.raw_dir.resolve())
    ids = sorted(frame.refrigerator.unique())
    cut = int(len(ids) * .8)
    primary_mask = frame.refrigerator.isin(ids[:cut]).to_numpy()
    train, test = frame.loc[primary_mask], frame.loc[~primary_mask]
    if set(train.refrigerator) & set(test.refrigerator):
        raise ValueError("Primary split has refrigerator leakage")
    result = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "raw_dir": str(args.raw_dir.resolve()), "rows": len(frame), "refrigerators": len(ids),
            "manifest_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
            "sources": sources,
            "domains": {d: {
                "rows": int(frame.compartment.eq(d).sum()),
                "temperature_range": [float(frame.loc[frame.compartment.eq(d), "temperature"].min()), float(frame.loc[frame.compartment.eq(d), "temperature"].max())],
            } for d in DOMAINS},
            "features": FEATURES, "sampling_minutes": 5, "horizon_minutes": 15,
            "backend_history": {"window_minutes_strict": 15, "max_samples": 5, "min_samples": 2, "samples_at_5_min_cadence": 3},
        },
        "reference_model": {"path": str(reference_path), "sha256": reference_hash, "parameters": artifact["model"].get_params()},
        "environment": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                        "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__, "threads": args.threads},
        "primary": {"train_refrigerators": ids[:cut], "test_refrigerators": ids[cut:],
                    "train_samples": len(train), "test_samples": len(test)},
    }
    output.mkdir(parents=True)
    with threadpool_limits(limits=args.threads):
        print(f"Primary: {cut} train / {len(ids)-cut} test refrigerators; {len(frame):,} total rows", flush=True)
        models, timings = train_models(artifact["model"], train)
        predictions = predict_models(models, test)
        result["primary"].update({"training": timings, "results": evaluate(test, predictions)})
        for name, model in models.items():
            filename = f"primary__{name}.pkl"
            domain = name if name in DOMAINS else None
            domain_metrics = result["primary"]["results"]["separate"]["domains"][domain] if domain else result["primary"]["results"]["shared"]["overall"]
            joblib.dump({
                "model": model, "algorithm": "hgb", "feature_names": FEATURES, "target_name": TARGET,
                "trained_at": result["created_at"], "metrics": domain_metrics,
                "train_samples": timings[name]["train_samples"],
                "test_samples": domain_metrics["samples"], "hyperparameters": model.get_params(),
                "experiment": {"kind": name, "dataset_manifest_sha256": result["dataset"]["manifest_sha256"],
                               "train_refrigerators": ids[:cut], "test_refrigerators": ids[cut:]},
            }, output / filename)
        pd.DataFrame(fridge_rows(test, predictions)).to_csv(output / "per_refrigerator.csv", index=False)
        temperatures = [-30, -28, -25, -22, -20, -18, -15, -10, -5, 0, 4, 8, 12, 17, 20, 25]
        probe = pd.DataFrame({"temperature": temperatures, "temp_delta": 0, "temp_moving_avg": temperatures})
        probe_predictions = {name: model.predict(probe[FEATURES]) for name, model in models.items()}
        legacy_probe = probe.assign(hour_of_day=14, humidity=65, ambient_temp=30)
        probe_predictions["stored_model"] = artifact["model"].predict(legacy_probe[artifact["feature_names"]])
        result["primary"]["probes"] = [
            {"temperature": t, **{name: float(pred[i]) for name, pred in probe_predictions.items()}}
            for i, t in enumerate(temperatures)
        ]
        print(json.dumps({"primary_mae": {m: {d: result["primary"]["results"][m]["domains"][d]["mae"] for d in DOMAINS} for m in METHODS}}), flush=True)
        oof = {method: np.full(len(frame), np.nan) for method in METHODS}
        assignments = np.zeros(len(frame), dtype=int)
        folds = []
        splitter = GroupKFold(n_splits=5, shuffle=True, random_state=42)
        for fold_number, (train_index, test_index) in enumerate(splitter.split(frame[FEATURES], groups=frame.refrigerator), 1):
            cv_train, cv_test = frame.iloc[train_index], frame.iloc[test_index]
            train_ids, test_ids = sorted(cv_train.refrigerator.unique()), sorted(cv_test.refrigerator.unique())
            if set(train_ids) & set(test_ids):
                raise ValueError("CV refrigerator leakage")
            print(f"CV fold {fold_number}/5: {len(train_ids)} train / {len(test_ids)} test refrigerators", flush=True)
            cv_models, cv_timings = train_models(artifact["model"], cv_train)
            cv_predictions = predict_models(cv_models, cv_test)
            for method in METHODS:
                oof[method][test_index] = cv_predictions[method]
            assignments[test_index] += 1
            fold = {"fold": fold_number, "train_refrigerators": train_ids, "test_refrigerators": test_ids,
                    "training": cv_timings, "results": evaluate(cv_test, cv_predictions)}
            folds.append(fold)
            print(json.dumps({"fold": fold_number, "mae": {m: {d: fold["results"][m]["domains"][d]["mae"] for d in DOMAINS} for m in METHODS}}), flush=True)
        if not (assignments == 1).all():
            raise ValueError("Every row must have exactly one out-of-fold prediction")
        result["cross_validation"] = {"n_splits": 5, "shuffle": True, "random_state": 42,
                                      "folds": folds, "out_of_fold_results": evaluate(frame, oof)}
    if digest(reference_path) != reference_hash:
        raise RuntimeError("Deployed reference artifact changed")
    (output / "metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    (output / "report.md").write_text(render_report(result), encoding="utf-8")
    print(f"Completed. Report: {output / 'report.md'}", flush=True)


if __name__ == "__main__":
    main()
