#!/usr/bin/env python3
"""Reproduce the Bangkok evaluation and compare reduced feature sets."""
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
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from threadpoolctl import threadpool_limits

FEATURES = [
    "hour_of_day", "temperature", "humidity", "temp_delta",
    "temp_moving_avg", "ambient_temp",
]
TARGET = "future_temp_15m"
VARIANTS = {
    "full": FEATURES,
    "without_ambient_and_average": [
        "hour_of_day", "temperature", "humidity", "temp_delta",
    ],
    "without_ambient_humidity_and_average": [
        "hour_of_day", "temperature", "temp_delta",
    ],
    "without_ambient_and_humidity": [
        "hour_of_day", "temperature", "temp_delta", "temp_moving_avg",
    ],
}
LABELS = {
    "full": "Full model: 6 features",
    "without_ambient_and_average": "Drop ambient_temp + temp_moving_avg",
    "without_ambient_humidity_and_average": "Drop ambient_temp + humidity + temp_moving_avg",
    "without_ambient_and_humidity": "Drop ambient_temp + humidity; keep history average",
    "stored_model_full_inputs": "Stored model with all measured dataset inputs",
    "stored_model_default_external_inputs": "Stored model with humidity=65, ambient_temp=30",
    "persistence": "Baseline: forecast equals current temperature",
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    actual = y_true > 8.0
    forecast = y_pred > 8.0
    tn, fp, fn, tp = confusion_matrix(actual, forecast, labels=[False, True]).ravel()
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
        "threshold_accuracy": float(accuracy_score(actual, forecast)),
        "overheat_precision": float(precision_score(actual, forecast, zero_division=0)),
        "overheat_recall": float(recall_score(actual, forecast, zero_division=0)),
        "overheat_f1": float(f1_score(actual, forecast, zero_division=0)),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def band_errors(temperature: np.ndarray, y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    masks = {
        "below_minus_2": temperature < -2,
        "minus_2_to_2": (temperature >= -2) & (temperature < 2),
        "2_to_8": (temperature >= 2) & (temperature < 8),
        "8_to_17": (temperature >= 8) & (temperature < 17),
        "17_and_above": temperature >= 17,
    }
    return {
        name: {
            "samples": int(mask.sum()),
            "mae": float(mean_absolute_error(y_true[mask], y_pred[mask])),
        }
        for name, mask in masks.items() if mask.any()
    }


def make_record(name: str, temperature: np.ndarray, actual: np.ndarray,
                prediction: np.ndarray, features: list[str], duration: float = 0.0) -> dict:
    if not np.isfinite(prediction).all():
        raise ValueError(f"Non-finite prediction in {name}")
    return {
        "name": name,
        "label": LABELS[name],
        "feature_names": features,
        "training_seconds": duration,
        "metrics": metrics(actual, prediction),
        "temperature_band_mae": band_errors(temperature, actual, prediction),
    }


def markdown_report(result: dict) -> str:
    lines = [
        "# Bangkok temperature feature ablation",
        "",
        f"Run: {result['created_at']}",
        "",
        "Data: the existing preprocessed Bangkok CSV; middle-shelf air temperature (T_MS).",
        "All variants use the same rows, target, model parameters and random seed.",
        "Dropped fields are excluded from training and prediction, rather than imputed.",
        "",
        f"- Rows: {result['dataset']['rows']:,}; inferred refrigerator series: {result['dataset']['series_count']}.",
        f"- Input temperature range: {result['dataset']['temperature_range']} degrees C.",
        f"- Prediction target: temperature 15 minutes ahead, at a 5-minute sampling interval.",
        f"- Dataset SHA-256: {result['dataset']['sha256']}",
        f"- Original model SHA-256: {result['reference_model']['sha256']}",
        f"- scikit-learn: {result['environment']['scikit_learn']}",
        "",
        "## Reference reproduction",
        "",
        "The stored model is re-evaluated on the original 80/20 split. Saved metrics",
        "must match recomputed metrics within 1e-9 before any training is attempted.",
        "",
        "## Comparisons",
        "",
    ]
    for split in result["splits"]:
        lines.extend([
            f"### {split['name']}",
            "",
            split["description"],
            "",
            f"Train: {split['train_samples']:,}; test: {split['test_samples']:,}.",
            "",
            "| Model / input set | MAE (C) | RMSE (C) | R2 | >8C accuracy | >8C recall | >8C F1 |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ])
        for item in split["results"]:
            m = item["metrics"]
            lines.append(
                f"| {item['label']} | {m['mae']:.6f} | {m['rmse']:.6f} | "
                f"{m['r2']:.6f} | {m['threshold_accuracy']:.2%} | "
                f"{m['overheat_recall']:.2%} | {m['overheat_f1']:.4f} |"
            )
        full = next(r for r in split["results"] if r["name"] == "full")
        lines.extend(["", "MAE change relative to the retrained full model:", ""])
        for item in split["results"]:
            if item["name"] in VARIANTS and item["name"] != "full":
                difference = item["metrics"]["mae"] - full["metrics"]["mae"]
                relative = difference / full["metrics"]["mae"] * 100
                lines.append(f"- {item['label']}: {difference:+.6f} C ({relative:+.2f}%).")
        lines.append("")
    lines.extend([
        "## Limits of this experiment",
        "",
        "- The CSV contains T_MS only. It does not evaluate freezer temperatures around -18 C.",
        "- Refrigerator boundaries are inferred from timestamp resets because the CSV omits source IDs.",
        "- The strict split holds out whole series; the legacy split is kept only to reproduce the old score.",
        "- hour_of_day comes from a simulated start date in the original preprocessing script; it is not verified local clock time.",
        "- Existing preprocessing drops rows containing any missing raw field, including fields outside the selected feature set.",
        "- This experiment keeps existing preprocessing and model settings fixed to isolate feature removal.",
        "- The stored model/default-input comparison uses the CSV history features; it does not emulate device sampling intervals or the backend history window.",
        "- Threshold scores concern future temperature >8 C only, not arbitrary room thresholds.",
        "- Results measure the Bangkok test set, not measured performance in the user's warehouse.",
        "- Runtime model selection is not changed by this experiment. Trial models are saved separately.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")

    data_path = args.data.resolve()
    model_path = args.reference_model.resolve()
    output = args.output_dir.resolve()
    if output.exists():
        parser.error("Output directory already exists; use a new directory to preserve prior results.")

    original_digest = digest(model_path)
    artifact = joblib.load(model_path)
    reference_model = artifact["model"]
    if list(artifact["feature_names"]) != FEATURES:
        raise ValueError("Unexpected reference model feature order.")
    frame = pd.read_csv(data_path)
    required = ["timestamp", *FEATURES, TARGET]
    if not set(required).issubset(frame.columns):
        raise ValueError("CSV is missing required columns.")
    if not np.isfinite(frame[[*FEATURES, TARGET]].to_numpy(dtype=float)).all():
        raise ValueError("CSV contains missing or non-finite values; do not silently alter evaluation rows.")
    timestamps = pd.to_datetime(frame["timestamp"], errors="raise")
    groups = (timestamps.diff() < pd.Timedelta(0)).cumsum()
    intervals = timestamps.groupby(groups).diff().dropna()
    if not intervals.eq(pd.Timedelta(minutes=5)).all():
        raise ValueError("Dataset is not a regular 5-minute series.")
    series = groups.unique()
    if len(series) < 2:
        raise ValueError("At least two refrigerator series are needed for held-out evaluation.")
    legacy_cut = int(artifact["train_samples"])
    if len(frame) != legacy_cut + int(artifact["test_samples"]):
        raise ValueError("CSV sample count does not match reference metadata.")

    with threadpool_limits(limits=args.threads):
        legacy_test = frame.iloc[legacy_cut:]
        reproduced = metrics(
            legacy_test[TARGET].to_numpy(),
            reference_model.predict(legacy_test[FEATURES]),
        )
    for key, saved in artifact["metrics"].items():
        if not np.isclose(reproduced[key], saved, rtol=0, atol=1e-9):
            raise ValueError(f"Reference metric {key} does not reproduce: {saved} vs {reproduced[key]}")

    group_cut = int(np.floor(len(series) * 0.8))
    strict_train_mask = groups.isin(series[:group_cut]).to_numpy()
    splits = [
        ("original_80_20",
         "Original concatenated-row split for comparison with the deployed model's saved metrics; one series crosses the train/test boundary.",
         np.arange(legacy_cut), np.arange(legacy_cut, len(frame))),
        ("held_out_refrigerators",
         f"First {group_cut} whole series for training; remaining {len(series)-group_cut} whole series for testing. No refrigerator series appears in both sets.",
         np.flatnonzero(strict_train_mask), np.flatnonzero(~strict_train_mask)),
    ]
    result = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {
            "path": str(data_path), "sha256": digest(data_path),
            "rows": len(frame), "series_count": int(len(series)),
            "series_rows": sorted(int(n) for n in groups.value_counts().unique()),
            "temperature_range": [float(frame.temperature.min()), float(frame.temperature.max())],
            "target_range": [float(frame[TARGET].min()), float(frame[TARGET].max())],
        },
        "reference_model": {
            "path": str(model_path), "sha256": original_digest,
            "saved_metrics": artifact["metrics"], "recomputed_metrics": reproduced,
            "parameters": reference_model.get_params(),
        },
        "environment": {
            "python": platform.python_version(), "scikit_learn": sklearn.__version__,
            "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__,
            "threads": args.threads,
        },
        "splits": [],
    }
    output.mkdir(parents=True)
    with threadpool_limits(limits=args.threads):
        for split_name, description, train_index, test_index in splits:
            train = frame.iloc[train_index]
            test = frame.iloc[test_index]
            actual = test[TARGET].to_numpy()
            temperature = test.temperature.to_numpy()
            split_result = {
                "name": split_name, "description": description,
                "train_samples": len(train), "test_samples": len(test),
                "train_series_count": int(groups.iloc[train_index].nunique()),
                "test_series_count": int(groups.iloc[test_index].nunique()),
                "shared_series_count": len(set(groups.iloc[train_index]) & set(groups.iloc[test_index])),
                "results": [],
            }
            split_result["results"].append(make_record(
                "persistence", temperature, actual, temperature, ["temperature"],
            ))
            if split_name == "original_80_20":
                split_result["results"].append(make_record(
                    "stored_model_full_inputs", temperature, actual,
                    reference_model.predict(test[FEATURES]), FEATURES,
                ))
                default_inputs = test[FEATURES].copy()
                default_inputs["humidity"] = 65.0
                default_inputs["ambient_temp"] = 30.0
                split_result["results"].append(make_record(
                    "stored_model_default_external_inputs", temperature, actual,
                    reference_model.predict(default_inputs), FEATURES,
                ))
            for name, features in VARIANTS.items():
                print(f"Training {split_name}: {name} ({len(features)} features)", flush=True)
                candidate = clone(reference_model)
                start = time.perf_counter()
                candidate.fit(train[features], train[TARGET])
                elapsed = time.perf_counter() - start
                prediction = candidate.predict(test[features])
                item = make_record(name, temperature, actual, prediction, features, elapsed)
                trial_path = output / f"{split_name}__{name}.pkl"
                joblib.dump({
                    "model": candidate, "algorithm": "hgb", "feature_names": features,
                    "target_name": TARGET, "critical_threshold": 8.0,
                    "trained_at": datetime.now(timezone.utc).isoformat(),
                    "metrics": item["metrics"], "train_samples": len(train),
                    "test_samples": len(test), "hyperparameters": candidate.get_params(),
                    "experiment": {
                        "variant": name, "split": split_name,
                        "dataset_sha256": result["dataset"]["sha256"],
                        "temperature_range": result["dataset"]["temperature_range"],
                    },
                }, trial_path)
                item["model_file"] = trial_path.name
                split_result["results"].append(item)
                print(json.dumps({"split": split_name, "variant": name,
                                  "seconds": round(elapsed, 2), **item["metrics"]}), flush=True)
            result["splits"].append(split_result)
            (output / "metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    if digest(model_path) != original_digest:
        raise RuntimeError("Reference model changed during the experiment.")
    (output / "report.md").write_text(markdown_report(result), encoding="utf-8")
    print(f"Report: {output / 'report.md'}", flush=True)


if __name__ == "__main__":
    main()
