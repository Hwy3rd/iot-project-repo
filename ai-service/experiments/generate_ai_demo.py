"""Export short attributed Bangkok histories for coursework demos without raw data."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from temperature_features import build_features, FEATURE_SCHEMA
from freezer_history import load_data

PROFILES = {
    "chill-normal": ("T_MS", 0, 4, False),
    "chill-warning": ("T_MS", 0, 4, True),
    "cool-normal": ("T_MS", 2, 6, False),
    "freezer-normal": ("T_FC", -22, -18, False),
    "freezer-warning": ("T_FC", -22, -18, True),
    "freezer-warm-normal": ("T_FC", -20, -15, False),
    "freezer-warm-warning": ("T_FC", -20, -15, True),
    "deep-freezer-normal": ("T_FC", -28, -22, False),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    artifact_path = SERVICE / "temperature_model_history.pkl"
    model = joblib.load(artifact_path)["model"]
    frame, sources = load_data(args.raw_dir)
    with threadpool_limits(limits=4):
        from temperature_features import FEATURE_NAMES
        frame["prediction"] = model.predict(frame[FEATURE_NAMES]) + frame.temperature
    profiles = {}
    for name, (domain, low, high, warning) in PROFILES.items():
        candidates = frame.loc[(frame.compartment == domain) & frame.temperature.between(low, high) & (frame.elapsed_minutes >= 65)].copy()
        if warning:
            candidates = candidates.loc[(candidates.prediction > high + .2) & (candidates.temperature <= high - .2)]
            candidates["distance"] = (candidates.prediction - (high + .75)).abs()
            candidates = candidates.sort_values("distance")
        else:
            candidates = candidates.loc[candidates.prediction.between(low + .5, high - .5)]
            candidates["distance"] = (candidates.prediction - (low + high) / 2).abs()
            candidates = candidates.sort_values(["distance", "temp_std_60m"])
        for row in candidates.itertuples():
            path = args.raw_dir / f"{row.refrigerator}.txt"
            raw = pd.read_csv(path, sep="\t", usecols=["Time", domain])
            index = int(np.flatnonzero(raw.Time.eq(row.elapsed_minutes))[0])
            temperatures = raw[domain].iloc[index - 13:index + 1].to_numpy(dtype=float)
            # Normal demo history stays within its sample room's thresholds.
            if not warning and not ((temperatures >= low) & (temperatures <= high)).all():
                continue
            expected = float(model.predict(build_features(temperatures[-13:]))[0]) + float(temperatures[-1])
            profiles[name] = {
                "compartment": domain, "temp_min": low, "temp_max": high,
                "scenario": "warning" if warning else "normal",
                "temperatures": temperatures.tolist(), "sampling_minutes": 5,
                "source_file": path.name, "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "source_elapsed_minutes": raw.Time.iloc[index - 13:index + 1].astype(int).tolist(),
                "predicted_temp_15m_at_export": round(expected, 2),
            }
            print(f"{name}: {path.name}, current={temperatures[-1]}, forecast={expected:.2f}", flush=True)
            break
        if name not in profiles:
            raise ValueError(f"No suitable source window for {name}")
    result = {
        "purpose": "Coursework demo: public temperature observations, shifted to recent timestamps",
        "source_title": "Dataset of household cold-chain conditions in Bangkok",
        "source_doi": "https://doi.org/10.57745/TMWYBQ", "feature_schema": FEATURE_SCHEMA,
        "model_sha256": hashlib.sha256(artifact_path.read_bytes()).hexdigest(), "profiles": profiles,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
