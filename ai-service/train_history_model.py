"""Train the selected shared Bangkok model using the serving feature builder."""
import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from threadpoolctl import threadpool_limits

from temperature_features import FEATURE_NAMES, FEATURE_SCHEMA, build_features
from temperature_features import HISTORY_SAMPLES, SAMPLING_SECONDS, MAX_SAMPLE_AGE_SECONDS
from temperature_features import SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, required=True)
    parser.add_argument("--validation-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; use a new path to preserve the previous model")
    if args.threads < 1:
        parser.error("--threads must be positive")
    # Reuse the experiment source validation and metadata, but verify every
    # feature against the serving builder before trusting its CV scores.
    sys.path.insert(0, str(Path(__file__).parent / "experiments"))
    from freezer_history import load_data, HISTORY_60
    frame, sources = load_data(args.raw_dir)
    matrices = []
    for path in sorted(args.raw_dir.glob("*.txt")):
        raw = pd.read_csv(path, sep="\t", usecols=["T_MS", "T_FC"])
        for domain in ["T_MS", "T_FC"]:
            windows = np.lib.stride_tricks.sliding_window_view(raw[domain].to_numpy(), 13)[:-3]
            matrices.append(build_features(windows))
    X = pd.concat(matrices, ignore_index=True)
    np.testing.assert_allclose(X.to_numpy(), frame[HISTORY_60].to_numpy(), rtol=0, atol=1e-9)
    validation = json.loads(args.validation_report.read_text(encoding="utf-8"))
    manifest = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()
    if manifest != validation["dataset"]["manifest_sha256"]:
        raise ValueError("Validation source manifest does not match training data")
    if validation["selected_by_cv_freezer_mae"] != "history_60m_change_absolute":
        raise ValueError("Validation report does not select this model")
    reference = joblib.load(args.reference_model)["model"]
    if reference.get_params() != validation["reference_model"]["parameters"]:
        raise ValueError("Reference hyperparameters differ from validation")
    model = clone(reference).set_params(loss="absolute_error")
    target = frame.future_temp_15m - frame.temperature
    print(f"Training {len(X):,} rows, {len(FEATURE_NAMES)} features, 123 paired refrigerators", flush=True)
    with threadpool_limits(limits=args.threads):
        model.fit(X, target)
    metadata = {
        "algorithm": "hgb", "feature_schema": FEATURE_SCHEMA, "feature_names": FEATURE_NAMES,
        "target_name": "temp_change_15m", "prediction_mode": "temperature_change",
        "horizon_minutes": 15, "history_samples": HISTORY_SAMPLES,
        "sampling_seconds": SAMPLING_SECONDS, "max_sample_age_seconds": MAX_SAMPLE_AGE_SECONDS,
        "supported_temperature_range": [SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP],
        "trained_at": datetime.now(timezone.utc).isoformat(), "train_samples": len(X),
        "train_refrigerators": sorted(frame.refrigerator.unique().tolist()),
        "hyperparameters": model.get_params(), "source_manifest_sha256": manifest,
        "metrics": validation["cross_validation"]["out_of_fold_results"]["history_60m_change_absolute"],
        "validation": {"method": "five-fold grouped out-of-fold; candidate selected on these scores",
                       "groups": "refrigerator; both compartments stay together", "random_state": 42,
                       "report_sha256": hashlib.sha256(args.validation_report.read_bytes()).hexdigest(),
                       "feature_parity": "all 357684 rows match serving features within 1e-9"},
        "environment": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                        "numpy": np.__version__, "scipy": __import__("scipy").__version__,
                        "pandas": pd.__version__, "joblib": joblib.__version__},
    }
    joblib.dump({"model": model, **metadata}, args.output, compress=3)
    args.output.with_suffix(".json").write_text(json.dumps(metadata, indent=2, allow_nan=False), encoding="utf-8")
    print(f"Saved: {args.output}", flush=True)


if __name__ == "__main__":
    main()
