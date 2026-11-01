"""Guard the independent calibration split, temporal boundaries and comparison."""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
from room_warning_tuning import ROOMS, compare, source_parts, temporal_parts


class RoomWarningTuningTests(unittest.TestCase):
    def test_three_way_source_split_preserves_channels_and_fixed_test(self):
        frame = pd.DataFrame([{"refrigerator": f"source-{source:02}", "compartment": channel,
                               "elapsed_minutes": minute, "temperature": 3.}
                              for source in range(20) for channel in ["a", "b"] for minute in [60, 65]])
        first = source_parts(frame, 20261018)
        second = source_parts(frame, 20261019)
        groups = {key: set(part.refrigerator) for key, part in first.items()}
        self.assertFalse(groups["fit"] & groups["calibration"])
        self.assertFalse(groups["fit"] & groups["test"])
        self.assertFalse(groups["calibration"] & groups["test"])
        self.assertEqual(set(frame.refrigerator), set.union(*groups.values()))
        self.assertEqual(groups["test"], set(second["test"].refrigerator))
        self.assertNotEqual(groups["calibration"], set(second["calibration"].refrigerator))
        for part in first.values():
            self.assertTrue((part.groupby("refrigerator").size() == 4).all())

    def test_temporal_calibration_labels_cannot_enter_the_test_period(self):
        frame = pd.DataFrame([{"refrigerator": source, "compartment": channel, "elapsed_minutes": minute}
                              for source in ["a", "b"] for channel in ["first", "second"]
                              for minute in np.arange(0, 505, 5)])
        parts = temporal_parts(frame)
        self.assertTrue((parts["fit"].elapsed_minutes + 15 < 300).all())
        self.assertTrue((parts["calibration"].elapsed_minutes >= 300).all())
        self.assertTrue((parts["calibration"].elapsed_minutes + 15 < 400).all())
        self.assertTrue((parts["test"].elapsed_minutes >= 400).all())
        self.assertTrue(all(len(part) > 0 for part in parts.values()))

    def test_recall_gain_is_rejected_if_a_room_has_too_many_false_alarms(self):
        before = {"macro": {"recall": .5, "false_positive_rate": .04},
                  "rooms": {room: {"false_positive_rate": .04} for room in ROOMS}}
        after = {"macro": {"recall": .65, "false_positive_rate": .043},
                 "rooms": {room: {"false_positive_rate": .04} for room in ROOMS}}
        self.assertTrue(compare(before, after)["passed"])
        after["rooms"][next(iter(ROOMS))]["false_positive_rate"] = .06
        self.assertFalse(compare(before, after)["passed"])
        after["rooms"][next(iter(ROOMS))]["false_positive_rate"] = .04
        after["macro"]["false_positive_rate"] = .06
        self.assertFalse(compare(before, after)["passed"])


if __name__ == "__main__":
    unittest.main()
