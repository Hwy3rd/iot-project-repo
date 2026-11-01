"""Checks the two isolated changes in the 15-minute forecast experiment."""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
try:
    import torch
except ImportError:
    torch = None

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
if torch is not None:
    from room_endpoint_forecast import (EXTRA_LAGS, FEATURE_NAMES, HISTORY, EndpointGRU,
                                        endpoint_targets, fit_normalizer, hgb_inputs, predict_endpoint)


@unittest.skipIf(torch is None, "Optional experiment: install requirements-sequence.txt")
class EndpointForecastTests(unittest.TestCase):
    def frame(self):
        from temperature_features import build_features
        past = np.arange(26, dtype=float).reshape(2, 13)
        frame = build_features(past)
        for index, name in enumerate(HISTORY):
            frame[name] = past[:, index]
        frame["future_temp_5m"] = [999., -999.]
        frame["future_temp_10m"] = [-999., 999.]
        frame["future_temp_15m"] = frame.temperature + [2., -3.]
        return frame

    def test_extra_features_fill_only_the_five_missing_lags(self):
        frame = self.frame()
        features = hgb_inputs(frame)
        self.assertEqual(features.shape, (2, 27))
        self.assertEqual(features.columns.tolist()[:22], FEATURE_NAMES)
        self.assertEqual(features.columns.tolist()[22:], EXTRA_LAGS)
        self.assertEqual(len(set(features.columns)), 27)
        for lag in [25, 35, 40, 50, 55]:
            self.assertEqual(features.iloc[0][f"history_{lag}m"], 12 - lag // 5)

    def test_future_values_and_identifiers_cannot_change_hgb_features(self):
        frame = self.frame()
        expected = hgb_inputs(frame).to_numpy(copy=True)
        frame["future_temp_15m"] = [123456., -123456.]
        frame["refrigerator"], frame["compartment"] = "unseen", "other"
        np.testing.assert_array_equal(hgb_inputs(frame).to_numpy(), expected)

    def test_target_is_only_the_15_minute_change(self):
        frame = self.frame()
        np.testing.assert_array_equal(endpoint_targets(frame), [[2.], [-3.]])
        frame["future_temp_5m"], frame["future_temp_10m"] = 99999., -99999.
        np.testing.assert_array_equal(endpoint_targets(frame), [[2.], [-3.]])

    def test_single_head_and_current_temperature_are_used(self):
        model = EndpointGRU(hidden_size=8)
        self.assertEqual(tuple(model(torch.zeros(2, 13, 2)).shape), (2, 1))
        for parameter in model.parameters():
            torch.nn.init.zeros_(parameter)
        frame = self.frame()
        result = predict_endpoint(model, frame, fit_normalizer(frame), "cpu")
        np.testing.assert_array_equal(result, frame.temperature.to_numpy())


if __name__ == "__main__":
    unittest.main()
