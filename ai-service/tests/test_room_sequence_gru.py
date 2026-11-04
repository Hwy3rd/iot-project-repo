"""Tests prevent sequence lookahead, cross-source leaks and metric mix-ups."""
import sys
import tempfile
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
    from room_sequence_gru import HISTORY, TARGETS, TemperatureGRU, fit_normalizer, load_sequence_data, sequence_inputs, sequence_metrics, temporal_positions, warning_gate


@unittest.skipIf(torch is None, "Optional experiment: install requirements-sequence.txt")
class SequenceBenchmarkTests(unittest.TestCase):
    def test_past_windows_and_future_labels_stay_in_their_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for source in range(5):
                values = np.arange(40, dtype=float) + source * 100
                pd.DataFrame({"Time": np.arange(40) * 5, "T_MS": values, "T_FC": values - 50}).to_csv(
                    root / f"source{source}.txt", sep="\t", index=False)
            frame, sources = load_sequence_data(root)
            row = frame.loc[(frame.refrigerator == "source2") & (frame.compartment == "T_MS") & (frame.elapsed_minutes == 60)].iloc[0]
            np.testing.assert_array_equal(row[HISTORY].to_numpy(dtype=float), np.arange(200, 213))
            np.testing.assert_array_equal(row[TARGETS].to_numpy(dtype=float), [213, 214, 215])
            self.assertEqual(len(frame), 5 * 2 * (40 - 15))
            self.assertEqual(len(sources), 5)

    def test_future_changes_do_not_change_past_input_or_normalizer(self):
        past = pd.DataFrame(np.arange(26, dtype=float).reshape(2, 13), columns=HISTORY)
        before = fit_normalizer(past)
        past["future_temp_15m"] = [9999., -9999.]
        self.assertEqual(before, fit_normalizer(past))
        inputs = sequence_inputs(past, before)
        self.assertEqual(inputs.shape, (2, 13, 2))
        np.testing.assert_array_equal(inputs[:, -1, 1], [0., 0.])

    def test_future_labels_do_not_cross_temporal_boundaries(self):
        frame = pd.DataFrame({"refrigerator": ["a"] * 100 + ["b"] * 100,
                              "compartment": ["T_MS"] * 200,
                              "elapsed_minutes": list(np.arange(100) * 5) * 2})
        splits = temporal_positions(frame)
        for source in ["a", "b"]:
            fit = frame.iloc[splits["fit"]].query("refrigerator == @source")
            validation = frame.iloc[splits["validation"]].query("refrigerator == @source")
            train = frame.iloc[splits["final_train"]].query("refrigerator == @source")
            test = frame.iloc[splits["test"]].query("refrigerator == @source")
            self.assertLess(fit.elapsed_minutes.max() + 15, 495 * .6)
            self.assertLess(validation.elapsed_minutes.max() + 15, 495 * .8)
            self.assertLess(train.elapsed_minutes.max() + 15, test.elapsed_minutes.min())
            self.assertFalse(set(splits["validation"]) & set(splits["test"]))

    def test_multi_horizon_warning_sees_transient_breach(self):
        current = np.array([3., 5., -20., -25.])
        future = np.repeat(current[:, None], 3, axis=1)
        future[0, 0] = 5.
        frame = pd.DataFrame({"temperature": current, "refrigerator": ["a", "b", "c", "d"],
                              "future_min_15m": future.min(axis=1), "future_max_15m": future.max(axis=1),
                              **{target: future[:, i] for i, target in enumerate(TARGETS)}})
        metrics = sequence_metrics(frame, future)
        self.assertEqual(metrics["window"]["rooms"]["room_0_4"]["confusion_matrix"]["tp"], 1)
        self.assertEqual(metrics["endpoint_15m"]["rooms"]["room_0_4"]["window_alerts"]["confusion_matrix"]["fn"], 1)

    def test_higher_recall_with_excess_false_alarms_does_not_pass(self):
        before = {"macro": {"recall": .5, "false_positive_rate": .04},
                  "rooms": {"room": {"false_positive_rate": .04}}}
        after = {"macro": {"recall": .8, "false_positive_rate": .1},
                 "rooms": {"room": {"false_positive_rate": .1}}}
        self.assertFalse(warning_gate(before, after)["passed"])

    def test_gru_outputs_three_temperature_deltas(self):
        model = TemperatureGRU(hidden_size=8)
        self.assertEqual(tuple(model(torch.zeros(4, 13, 2)).shape), (4, 3))


if __name__ == "__main__":
    unittest.main()
