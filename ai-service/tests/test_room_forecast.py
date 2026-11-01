"""Checks for risk metrics and lookahead labels used by offline room tuning."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
from room_forecast import classification, choose_candidate, load_room_data, promotion_gate, room_metrics


class RoomBenchmarkTests(unittest.TestCase):
    def test_transient_breach_is_visible_to_window_benchmark(self):
        # All four presets are represented; the first case recovers by t+15.
        frame = pd.DataFrame({"temperature": [3, 5, -20, -25],
                              "future_temp_15m": [3, 5, -20, -25],
                              "future_min_15m": [3, 5, -20, -25],
                              "future_max_15m": [5, 5, -20, -25]})
        point = frame.future_temp_15m.to_numpy()
        result = room_metrics(frame, point, point, frame.future_max_15m.to_numpy())
        room = result["rooms"]["room_0_4"]
        self.assertEqual(room["endpoint_alerts"]["positives"], 0)
        self.assertEqual(room["window_alerts"]["confusion_matrix"]["fn"], 1)
        self.assertEqual(room["extrema_window_alerts"]["confusion_matrix"]["tp"], 1)

    def test_no_positive_events_are_reported_as_undefined_recall(self):
        values = classification([False, False], [True, False])
        self.assertIsNone(values["recall"])
        self.assertEqual(values["false_positive_rate"], .5)

    def test_lower_mae_does_not_override_a_worse_miss_rate(self):
        baseline = {"macro": {"mae": 1, "p95_absolute_error": 3,
                              "window_alerts": {"false_negative_rate": .2, "false_positive_rate": .1}},
                    "rooms": {"sample_room": {"mae": 1}}}
        improved = copy.deepcopy(baseline)
        improved["macro"]["mae"] = .8
        improved["macro"]["window_alerts"]["false_negative_rate"] = .4
        self.assertEqual(choose_candidate({"current": baseline, "candidate": improved}), "current")
        self.assertFalse(promotion_gate(baseline, improved)["passed"])

    def test_labels_include_all_three_future_samples_without_changing_inputs(self):
        with tempfile.TemporaryDirectory(prefix="iot-room-forecast-") as directory:
            root = Path(directory)
            for index in range(5):
                temperature = np.full(25, 3.0)
                temperature[13] = 6  # t+5 from row 12, returns to 3 by t+15.
                pd.DataFrame({"Time": np.arange(25) * 5, "T_MS": temperature,
                              "T_FC": np.full(25, -20.0)}).to_csv(root / f"source{index}.txt", sep="\t", index=False)
            frame, _ = load_room_data(root)
            row = frame.loc[(frame.refrigerator == "source0") & (frame.compartment == "T_MS") & (frame.elapsed_minutes == 60)].iloc[0]
            self.assertEqual(row.temperature, 3)
            self.assertEqual(row.temp_delta, 0)
            self.assertEqual(row.future_temp_15m, 3)
            self.assertEqual(row.future_max_15m, 6)
            self.assertEqual(row.future_min_15m, 3)


if __name__ == "__main__":
    unittest.main()
