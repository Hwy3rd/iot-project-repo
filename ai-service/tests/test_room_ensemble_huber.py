"""Validation selection and loss-scale checks for the two forecast experiments."""
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np
import pandas as pd
try:
    import torch
except ImportError:
    torch = None
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
if torch is not None:
    from room_ensemble_huber import blend, choose_blend, choose_huber, fine_tune, loss_function, tail_gate
    from room_endpoint_forecast import EndpointGRU, HISTORY, fit_normalizer


@unittest.skipIf(torch is None, "Optional experiment: install requirements-sequence.txt")
class EnsembleHuberTests(unittest.TestCase):
    def test_blend_endpoints_and_rejects_invalid_weights(self):
        np.testing.assert_array_equal(blend([1., 2.], [3., 4.], 0), [1., 2.])
        np.testing.assert_array_equal(blend([1., 2.], [3., 4.], 1), [3., 4.])
        with self.assertRaises(ValueError):
            blend([1.], [2.], 1.1)
        with self.assertRaises(ValueError):
            blend([1., 2.], [3.], .5)

    def test_weight_is_selected_from_validation_targets(self):
        current = np.array([2., 4., -20., -25.])
        actual = current + 1
        validation = pd.DataFrame({"temperature": current, "future_temp_15m": actual,
                                   "future_min_15m": actual, "future_max_15m": actual})
        choice = choose_blend(validation, actual + 2, actual - 2)
        self.assertEqual(choice["gru_weight"], .5)
        validation["future_temp_15m"] = actual + 2
        validation["future_min_15m"] = actual + 2
        validation["future_max_15m"] = actual + 2
        self.assertEqual(choose_blend(validation, actual + 2, actual - 2)["gru_weight"], 0)

    def test_normalized_huber_preserves_large_error_gradient_scale(self):
        for beta in [.5, 1., 2.]:
            value = torch.tensor([3.], requires_grad=True)
            loss_function("huber", beta)(value, torch.zeros_like(value)).backward()
            self.assertAlmostEqual(value.grad.item(), 1.)

    def test_huber_is_quadratic_near_zero(self):
        value = torch.tensor([.1], requires_grad=True)
        loss_function("huber", 1.)(value, torch.zeros_like(value)).backward()
        self.assertAlmostEqual(value.grad.item(), .1, places=6)

    def test_loss_selection_rejects_low_p95_with_bad_mae(self):
        metric = lambda mae, p95: {"macro": {"mae": mae, "p95_absolute_error": p95},
                                    "rooms": {"room": {"mae": mae, "p95_absolute_error": p95}}}
        chosen, _ = choose_huber(metric(1., 3.), {"bad_mae": metric(1.2, 1.), "balanced": metric(1.005, 2.)})
        self.assertEqual(chosen, "balanced")

    def test_tail_gain_cannot_hide_mean_error_regression(self):
        before = {"macro": {"mae": 1., "p95_absolute_error": 3.},
                  "rooms": {"r": {"mae": 1., "p95_absolute_error": 3.}}}
        after = {"macro": {"mae": 1.03, "p95_absolute_error": 2.},
                 "rooms": {"r": {"mae": 1.03, "p95_absolute_error": 2.}}}
        self.assertFalse(tail_gate(before, after)["passed"])

    def test_resume_loads_completed_step_without_training_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            past = np.arange(26, dtype=float).reshape(2, 13)
            frame = pd.DataFrame(past, columns=HISTORY)
            frame["temperature"] = past[:, -1]
            frame["future_temp_15m"] = past[:, -1] + .5
            model = EndpointGRU(hidden_size=8)
            base = root / "base.pt"
            torch.save({"config": {"hidden_size": 8, "layers": 1}, "state_dict": model.state_dict(),
                        "normalizer": fit_normalizer(frame), "epochs": 1,
                        "output_schema": "temperature-delta-15min-v1"}, base)
            first, checkpoint, _ = fine_tune(base, frame, "l1", None, 123, root, "cached", "cpu")
            with patch("room_ensemble_huber.torch.optim.AdamW", side_effect=AssertionError("Unexpected retraining")):
                second, loaded, _ = fine_tune(base, frame, "l1", None, 123, root, "cached", "cpu")
            self.assertEqual(checkpoint["epochs"], 6)
            self.assertEqual(loaded["epochs"], 6)
            self.assertTrue(all(torch.equal(first.state_dict()[key], value) for key, value in second.state_dict().items()))


if __name__ == "__main__":
    unittest.main()
