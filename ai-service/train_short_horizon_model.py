"""Fit the benchmarked HGB 5/10-minute configuration on all development data.

Use a new output filename. Held-out metrics are copied as provenance, never
recomputed on the final model's training rows.
"""
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
from threadpoolctl import threadpool_limits


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root, raw, output = args.worktree.resolve(), args.raw_dir.resolve(), args.output.resolve()
    if output.exists() or output.with_suffix(".json").exists():
        parser.error("Use a new output path; existing models are never overwritten")
    service = root / "ai-service"
    sys.path.insert(0, str(service))
    sys.path.insert(0, str(service / "experiments"))
    from temperature_features import (FEATURE_NAMES, FEATURE_SCHEMA, HISTORY_SAMPLES, MAX_SAMPLE_AGE_SECONDS,
                                      SAMPLING_SECONDS, SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP, build_features)
    from room_forecast import load_room_data
    report_dir = service / "experiments/results/room-warning-5-10m-2026-11-01"
    report = json.loads((report_dir / "metrics.json").read_text(encoding="utf-8"))
    manifest = json.loads((report_dir / "manifest.json").read_text(encoding="utf-8"))
    reference_path = service / "experiments/results/room-sequence-gru-2026-10-31/source_hgb.joblib"
    cached = joblib.load(reference_path)
    print("Verifying feature and target alignment for all source files", flush=True)
    frame, sources = load_room_data(raw)
    if sources != manifest["sources"]:
        raise ValueError("Dataset differs from the evaluated short-horizon benchmark")
    matrices, target_parts = [], {"5": [], "10": []}
    for source in sources:
        data = pd.read_csv(raw / source["file"], sep="\t", usecols=["T_MS", "T_FC"])
        for channel in ("T_MS", "T_FC"):
            windows = np.lib.stride_tricks.sliding_window_view(data[channel].to_numpy(dtype=float), 16)
            matrices.append(build_features(windows[:, :13]))
            for index, minutes in enumerate((5, 10)):
                target_parts[str(minutes)].append(windows[:, 13 + index] - windows[:, 12])
    features = pd.concat(matrices, ignore_index=True)
    np.testing.assert_allclose(features.to_numpy(), frame[FEATURE_NAMES].to_numpy(), rtol=0, atol=1e-9)
    if len(features) != len(frame):
        raise AssertionError("Feature row count differs from evaluated data")
    models, training = {}, {}
    with threadpool_limits(limits=4):
        for minutes in (5, 10):
            reference = cached["models"][f"future_temp_{minutes}m"]
            if reference.get_params() != manifest["tuned_parameters"]:
                raise ValueError("Model configuration differs from the benchmark")
            target = np.concatenate(target_parts[str(minutes)])
            if not np.isfinite(target).all() or len(target) != len(features):
                raise ValueError("Invalid training target")
            model = clone(reference)
            started = time.perf_counter()
            print(f"Training HGB +{minutes}m on {len(features):,} rows from {len(sources)} sources", flush=True)
            model.fit(features, target)
            models[str(minutes)] = model
            training[str(minutes)] = {"seconds": time.perf_counter() - started, "iterations": int(model.n_iter_),
                                      "parameters": model.get_params()}
            print(json.dumps({"minutes": minutes, **training[str(minutes)]}), flush=True)
    metadata = {
        "algorithm": "hgb", "feature_schema": FEATURE_SCHEMA, "feature_names": FEATURE_NAMES,
        "forecast_schema": "temperature-warning-5-10-v1", "prediction_mode": "temperature_change",
        "horizons_minutes": [5, 10], "target_names": {"5": "temp_change_5m", "10": "temp_change_10m"},
        "history_samples": HISTORY_SAMPLES, "sampling_seconds": SAMPLING_SECONDS,
        "max_sample_age_seconds": MAX_SAMPLE_AGE_SECONDS,
        "supported_temperature_range": [SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP],
        "trained_at": datetime.now(timezone.utc).isoformat(), "train_samples": len(features),
        "source_count": len(sources), "training": training,
        "source_manifest_sha256": hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
        "sources": sources,
        "validation": {"report_sha256": sha256(report_dir / "metrics.json"), "reference_sha256": sha256(reference_path),
                       "method": "Fixed configurations from matched offline benchmark; no test-label tuning; final fit uses all sources",
                       "limitations": "Public repeatedly researched data; sample-level metrics; observed future checkpoints only"},
        "metrics": {phase: {"window_10m": report[phase]["evaluation"]["10"]["hgb_5_10m"]["macro"],
                            "endpoint_5m": report[phase]["evaluation"]["5"]["hgb_5m"]["macro"]}
                    for phase in ("source", "temporal")},
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
                        "scikit_learn": sklearn.__version__, "joblib": joblib.__version__},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": models, **metadata}, output, compress=3)
    loaded = joblib.load(output)
    indices = np.linspace(0, len(features) - 1, 257, dtype=int)
    with threadpool_limits(limits=4):
        for minutes in (5, 10):
            a = models[str(minutes)].predict(features.iloc[indices])
            b = loaded["models"][str(minutes)].predict(features.iloc[indices])
            np.testing.assert_array_equal(a, b)
            assert np.isfinite(b).all()
    metadata["artifact_sha256"] = sha256(output)
    metadata["verification"] = {"feature_parity_all_training_rows": True, "checkpoint_replay_exact": True,
                                "replay_rows": len(indices)}
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
    print("SAVED " + str(output), flush=True)


if __name__ == "__main__":
    main()
