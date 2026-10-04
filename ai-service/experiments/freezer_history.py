#!/usr/bin/env python3
"""Offline Bangkok comparison of longer history and temperature-change targets."""
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
from sklearn.model_selection import GroupKFold
from threadpoolctl import threadpool_limits

from compartment_comparison import DOMAINS, TARGET, digest, evaluate, score

SHORT = ["temperature", "temp_delta", "temp_moving_avg"]
HISTORY_30 = [
    *SHORT, *[f"temp_lag_{m}m" for m in [5, 10, 15, 20, 30]],
    *[f"temp_delta_{m}m" for m in [10, 15, 30]],
    "temp_mean_30m", "temp_std_15m", "temp_std_30m", "temp_range_30m",
]
HISTORY_60 = [
    *HISTORY_30, "temp_lag_45m", "temp_lag_60m",
    "temp_delta_45m", "temp_delta_60m",
    "temp_mean_60m", "temp_std_60m", "temp_range_60m",
]
VARIANTS = {
    "short_history": {"features": SHORT, "mode": "absolute_temperature", "loss": "squared_error"},
    "history_30m": {"features": HISTORY_30, "mode": "absolute_temperature", "loss": "squared_error"},
    "history_60m": {"features": HISTORY_60, "mode": "absolute_temperature", "loss": "squared_error"},
    "history_60m_change": {"features": HISTORY_60, "mode": "temperature_change", "loss": "squared_error"},
    "history_60m_change_absolute": {"features": HISTORY_60, "mode": "temperature_change", "loss": "absolute_error"},
}


def load_data(root: Path) -> tuple[pd.DataFrame, list[dict]]:
    parts, sources = [], []
    files = sorted(root.glob("*.txt"))
    if len(files) < 5:
        raise ValueError("At least five refrigerator sources are required")
    for path in files:
        raw = pd.read_csv(path, sep="\t", usecols=["Time", *DOMAINS]).apply(pd.to_numeric, errors="raise")
        if not np.isfinite(raw.to_numpy(dtype=float)).all():
            raise ValueError(f"Non-finite required input in {path.name}")
        if not raw.Time.diff().iloc[1:].eq(5).all():
            raise ValueError(f"Non-regular five-minute series in {path.name}")
        sources.append({"file": path.name, "sha256": digest(path), "raw_rows": len(raw)})
        for domain in DOMAINS:
            temp = raw[domain]
            part = pd.DataFrame({
                "refrigerator": path.stem, "compartment": domain,
                "elapsed_minutes": raw.Time, "temperature": temp,
                "temp_delta": temp.diff().round(2),
                "temp_moving_avg": temp.rolling(3, min_periods=3).mean().round(2),
                TARGET: temp.shift(-3),
            })
            for minutes in [5, 10, 15, 20, 30, 45, 60]:
                part[f"temp_lag_{minutes}m"] = temp.shift(minutes // 5)
                if minutes in [10, 15, 30, 45, 60]:
                    part[f"temp_delta_{minutes}m"] = (temp - temp.shift(minutes // 5)).round(2)
            for minutes in [15, 30, 60]:
                window = temp.rolling(minutes // 5, min_periods=minutes // 5)
                part[f"temp_std_{minutes}m"] = window.std(ddof=0).round(4)
                if minutes in [30, 60]:
                    part[f"temp_mean_{minutes}m"] = window.mean().round(4)
                    part[f"temp_range_{minutes}m"] = (window.max() - window.min()).round(2)
            # All variants use identical rows with a full 60-minute past and 15-minute target.
            part = part.dropna(subset=[*HISTORY_60, TARGET])
            if not (raw.Time.shift(-3).loc[part.index] - part.elapsed_minutes).eq(15).all():
                raise ValueError("Target alignment failed")
            if not (part.elapsed_minutes - raw.Time.shift(12).loc[part.index]).eq(60).all():
                raise ValueError("History alignment failed")
            parts.append(part)
    frame = pd.concat(parts, ignore_index=True)
    if not np.isfinite(frame[[*HISTORY_60, TARGET]].to_numpy()).all():
        raise ValueError("Non-finite derived data")
    return frame, sources


def train(reference, frame: pd.DataFrame, variant: str) -> tuple[object, dict]:
    config = VARIANTS[variant]
    model = clone(reference).set_params(loss=config["loss"])
    target = frame[TARGET]
    if config["mode"] == "temperature_change":
        target = target - frame.temperature
    start = time.perf_counter()
    model.fit(frame[config["features"]], target)
    return model, {
        "seconds": time.perf_counter() - start, "iterations": int(model.n_iter_),
        "train_samples": len(frame), "feature_names": config["features"],
        "prediction_mode": config["mode"], "loss": config["loss"],
    }


def forecast(model, frame: pd.DataFrame, variant: str) -> np.ndarray:
    config = VARIANTS[variant]
    predicted = model.predict(frame[config["features"]])
    if config["mode"] == "temperature_change":
        predicted = predicted + frame.temperature.to_numpy()
    return predicted


def summarize(evaluation: dict) -> dict:
    return {name: {domain: {
        key: values["domains"][domain][key] for key in ["mae", "rmse", "within_1c"]
    } for domain in DOMAINS} for name, values in evaluation.items()}


def report(result: dict) -> str:
    lines = [
        "# Offline temperature history upgrade", "",
        f"Run: {result['created_at']}", "",
        "Coursework experiment using only the existing public Bangkok refrigerator data.",
        "Forecast horizon stays at 15 minutes. Every candidate is evaluated on the same rows.", "",
        f"- Refrigerators: {result['dataset']['refrigerators']}; paired compartment rows: {result['dataset']['rows']:,}.",
        "- Source cadence: five minutes. Derive each feature separately within its own refrigerator and compartment.",
        "- All inputs use current or earlier values; future temperature is used only as the target.",
        "- Long history consists of lags and differences through 60 minutes, plus recent mean, standard deviation and range.",
        "- Rolling windows include the current point and have durations expressed as half-open time windows.",
        "- No humidity, ambient temperature, synthetic clock time, door or fan state is used.",
        "- Temperature-change candidates learn future temperature minus current temperature, then add the current value back.",
        "- Hyperparameters use the existing HGB model, except the stated target and loss. No parameter search on test rows.",
        "- Both compartments of a refrigerator are always assigned to the same partition.",
        f"- Primary held-out split: {len(result['primary']['train_refrigerators'])} train / {len(result['primary']['test_refrigerators'])} test fridges.",
        "- CV uses five shuffled GroupKFold splits with random seed 42.",
        "- Persistence baseline predicts the current temperature unchanged.",
        f"- Source manifest SHA-256: {result['dataset']['manifest_sha256']}.",
        f"- Deployed model SHA-256: {result['reference_model']['sha256']}.", "",
    ]
    for title, evaluation in [
        ("Primary held-out results", result["primary"]["results"]),
        ("Five-fold grouped CV: pooled out-of-fold results", result["cross_validation"]["out_of_fold_results"]),
    ]:
        lines.extend([f"## {title}", "",
            "| Variant | T_MS MAE C | T_FC MAE C | T_FC RMSE C | T_FC within 1 C | T_FC -25..-15 C MAE |",
            "|---|---:|---:|---:|---:|---:|"])
        for name, entry in evaluation.items():
            ms, fc = entry["domains"]["T_MS"], entry["domains"]["T_FC"]
            cold = fc["minus_25_to_minus_15"]
            lines.append(f"| {name} | {ms['mae']:.6f} | {fc['mae']:.6f} | {fc['rmse']:.6f} | {fc['within_1c']:.2%} | {cold['mae']:.6f} |")
        lines.append("")
    cv = result["cross_validation"]["out_of_fold_results"]
    winner = result["selected_by_cv_freezer_mae"]
    before, after = cv["short_history"]["domains"]["T_FC"], cv[winner]["domains"]["T_FC"]
    lines.extend([
        "## Candidate selected for further work", "",
        f"Lowest CV freezer MAE: {winner}.",
        f"- MAE reduction vs matched-row short history: {(1-after['mae']/before['mae']):.2%}.",
        f"- Fraction within 1 C: {before['within_1c']:.2%} -> {after['within_1c']:.2%}.",
        "- Selection uses these validation scores. It is not a new untouched final test.", "",
        "## Fold-level freezer MAE", "",
        "| Fold | " + " | ".join(["persistence", *VARIANTS]) + " |",
        "|---|" + "|".join(["---:"] * (len(VARIANTS)+1)) + "|",
    ])
    for fold in result["cross_validation"]["folds"]:
        values = [fold["results"][name]["domains"]["T_FC"]["mae"] for name in ["persistence", *VARIANTS]]
        lines.append(f"| {fold['fold']} | " + " | ".join(f"{v:.6f}" for v in values) + " |")
    lines.extend(["", "## Limits and integration", "",
        "- These results are reproducible offline evaluation on domestic refrigerators, not measurements in a warehouse.",
        "- Public T_FC denotes freezer compartment or coldest zone, with varying operating temperatures.",
        "- Future door openings or control events cannot be inferred perfectly from temperature history.",
        "- Current firmware reports every 5 seconds, while these features are defined at 5-minute lags.",
        "  Backend integration must retrieve history by elapsed time and match the feature definitions.",
        "- Current backend exposes only short history; longer-history candidates need backend and FastAPI input changes.",
        "- Change-target .pkl files contain a temperature-change regressor: add current temperature to model output.",
        "  They must not be substituted directly into the old absolute-temperature inference code.",
        "- Primary trial models are saved separately, and the deployed model and runtime code are unchanged.",
        "- Single-sample temperature-band R2 values are null.",
        f"- Environment: {json.dumps(result['environment'], sort_keys=True)}.", "",
        "Command:", "",
        "```powershell",
        "py -3.10 -X utf8 -u -B ai-service/experiments/freezer_history.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/temperature_model_hgb.pkl --output-dir ai-service/experiments/results/history-upgrade-2026-10-04 --threads 4",
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
        parser.error("Use a new output directory to preserve earlier runs")
    reference_path = args.reference_model.resolve()
    reference_hash = digest(reference_path)
    reference = joblib.load(reference_path)["model"]
    frame, sources = load_data(args.raw_dir.resolve())
    ids = sorted(frame.refrigerator.unique())
    cut = int(len(ids) * .8)
    mask = frame.refrigerator.isin(ids[:cut]).to_numpy()
    primary_train, primary_test = frame.loc[mask], frame.loc[~mask]
    assert not set(primary_train.refrigerator) & set(primary_test.refrigerator)
    result = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {"raw_dir": str(args.raw_dir.resolve()), "rows": len(frame),
                    "refrigerators": len(ids), "sources": sources,
                    "manifest_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
                    "horizon_minutes": 15, "sampling_minutes": 5,
                    "domain_rows": {d:int(frame.compartment.eq(d).sum()) for d in DOMAINS}},
        "variants": VARIANTS,
        "reference_model": {"path": str(reference_path), "sha256": reference_hash, "parameters": reference.get_params()},
        "environment": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                        "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__, "threads": args.threads},
        "primary": {"train_refrigerators": ids[:cut], "test_refrigerators": ids[cut:],
                    "train_samples": len(primary_train), "test_samples": len(primary_test), "training": {}},
        "cross_validation": {"n_splits": 5, "random_state": 42, "shuffle": True, "folds": []},
    }
    output.mkdir(parents=True)
    with threadpool_limits(limits=args.threads):
        predictions = {"persistence": primary_test.temperature.to_numpy()}
        for name, config in VARIANTS.items():
            print(f"Primary: {name} ({len(config['features'])} features)", flush=True)
            model, training = train(reference, primary_train, name)
            predictions[name] = forecast(model, primary_test, name)
            result["primary"]["training"][name] = training
            trial_result = evaluate(primary_test, {name:predictions[name]})[name]
            joblib.dump({
                "model": model, "algorithm": "hgb", "feature_names": config["features"],
                "target_name": "temp_change_15m" if config["mode"] == "temperature_change" else TARGET,
                "prediction_mode": config["mode"], "trained_at": result["created_at"],
                "metrics": trial_result, "train_samples": len(primary_train), "test_samples": len(primary_test),
                "hyperparameters": model.get_params(),
                "experiment": {"variant": name, "source_manifest_sha256": result["dataset"]["manifest_sha256"],
                               "train_refrigerators": ids[:cut], "test_refrigerators": ids[cut:]},
            }, output / f"primary__{name}.pkl")
            print(json.dumps({name: {d:trial_result["domains"][d]["mae"] for d in DOMAINS}}), flush=True)
        result["primary"]["results"] = evaluate(primary_test, predictions)
        oof = {name:np.full(len(frame), np.nan) for name in ["persistence", *VARIANTS]}
        coverage = np.zeros(len(frame), dtype=int)
        splitter = GroupKFold(n_splits=5, shuffle=True, random_state=42)
        for number, (train_index, test_index) in enumerate(splitter.split(frame[SHORT], groups=frame.refrigerator), 1):
            fold_train, fold_test = frame.iloc[train_index], frame.iloc[test_index]
            train_ids, test_ids = sorted(fold_train.refrigerator.unique()), sorted(fold_test.refrigerator.unique())
            assert not set(train_ids) & set(test_ids)
            fold = {"fold": number, "train_refrigerators": train_ids, "test_refrigerators": test_ids, "training": {}}
            fold_predictions = {"persistence": fold_test.temperature.to_numpy()}
            for name in VARIANTS:
                print(f"CV {number}/5: {name}", flush=True)
                model, training = train(reference, fold_train, name)
                fold_predictions[name] = forecast(model, fold_test, name)
                fold["training"][name] = training
            fold["results"] = evaluate(fold_test, fold_predictions)
            for name, prediction in fold_predictions.items():
                oof[name][test_index] = prediction
            coverage[test_index] += 1
            result["cross_validation"]["folds"].append(fold)
            print(json.dumps({"fold":number, "results":summarize(fold["results"])}), flush=True)
        assert (coverage == 1).all()
        result["cross_validation"]["out_of_fold_results"] = evaluate(frame, oof)
    cv = result["cross_validation"]["out_of_fold_results"]
    result["selected_by_cv_freezer_mae"] = min(VARIANTS, key=lambda name:cv[name]["domains"]["T_FC"]["mae"])
    if digest(reference_path) != reference_hash:
        raise RuntimeError("Deployed model changed during experiment")
    (output / "metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    (output / "report.md").write_text(report(result), encoding="utf-8")
    print(json.dumps({"cv_summary":summarize(cv), "selected":result["selected_by_cv_freezer_mae"]}), flush=True)
    print(f"Report: {output / 'report.md'}", flush=True)


if __name__ == "__main__":
    main()
