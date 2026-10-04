"""Shared training/inference features for one temperature sensor, oldest first."""
import numpy as np
import pandas as pd

FEATURE_SCHEMA = "temperature-history-v1"
HISTORY_SAMPLES = 13
SAMPLING_SECONDS = 300
MAX_SAMPLE_AGE_SECONDS = 60
SUPPORTED_MIN_TEMP = -28.0
SUPPORTED_MAX_TEMP = 19.6
FEATURE_NAMES = [
    "temperature", "temp_delta", "temp_moving_avg",
    *[f"temp_lag_{m}m" for m in [5, 10, 15, 20, 30]],
    *[f"temp_delta_{m}m" for m in [10, 15, 30]],
    "temp_mean_30m", "temp_std_15m", "temp_std_30m", "temp_range_30m",
    "temp_lag_45m", "temp_lag_60m", "temp_delta_45m", "temp_delta_60m",
    "temp_mean_60m", "temp_std_60m", "temp_range_60m",
]


def build_features(windows) -> pd.DataFrame:
    """Each row is exactly 13 readings at t-60, t-55, ..., t minutes.

    Rolling statistics use (t-duration, t], i.e. 3/6/12 readings for
    15/30/60 minutes, and population standard deviation (ddof=0).
    """
    values = np.asarray(windows, dtype=float)
    if values.ndim == 1:
        values = values.reshape(1, -1)
    if values.ndim != 2 or values.shape[1] != HISTORY_SAMPLES:
        raise ValueError("Exactly 13 chronological temperature readings required")
    if not np.isfinite(values).all():
        raise ValueError("Temperature history must be finite")
    current = values[:, -1]
    features = {
        "temperature": current,
        "temp_delta": np.round(current - values[:, -2], 2),
        "temp_moving_avg": np.round(values[:, -3:].mean(axis=1), 2),
    }
    for minutes in [5, 10, 15, 20, 30, 45, 60]:
        lag = values[:, -1 - minutes // 5]
        features[f"temp_lag_{minutes}m"] = lag
        if minutes in [10, 15, 30, 45, 60]:
            features[f"temp_delta_{minutes}m"] = np.round(current - lag, 2)
    for minutes in [15, 30, 60]:
        recent = values[:, -minutes // 5:]
        features[f"temp_std_{minutes}m"] = np.round(recent.std(axis=1, ddof=0), 4)
        if minutes in [30, 60]:
            features[f"temp_mean_{minutes}m"] = np.round(recent.mean(axis=1), 4)
            features[f"temp_range_{minutes}m"] = np.round(np.ptp(recent, axis=1), 2)
    return pd.DataFrame(features, columns=FEATURE_NAMES)
