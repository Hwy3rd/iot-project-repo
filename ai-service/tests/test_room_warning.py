"""Guard warning labels, allowed inputs, source grouping and FPR calibration."""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
from room_warning import FEATURE_NAMES, ROOMS, WARNING_FEATURES, make_examples, paired_source_bootstrap, threshold_at_budget


class RoomWarningTests(unittest.TestCase):
    def frame(self):
        frame = pd.DataFrame(np.zeros((6, len(FEATURE_NAMES))), columns=FEATURE_NAMES)
        frame["temperature"] = [3., 5., -20., -25., 10., 3.]
        frame["future_temp_15m"] = frame.temperature
        frame["future_min_15m"] = frame.temperature
        frame["future_max_15m"] = frame.temperature
        frame.loc[0, "future_max_15m"] = 5.  # Breach at t+5; recovered at t+15.
        frame["refrigerator"] = ["a", "b", "c", "d", "a", "a"]
        frame["compartment"] = ["T_MS"] * 5 + ["T_FC"]
        frame["elapsed_minutes"] = np.arange(6) * 5
        return frame

    def test_window_breach_not_endpoint_and_current_outside_excluded(self):
        examples = make_examples(self.frame())
        sample = examples.loc[(examples.row_position == 0) & (examples.room == "room_0_4")].iloc[0]
        self.assertTrue(sample.breach)
        self.assertEqual(sample.future_temp_15m, 3.)
        self.assertFalse((examples.row_position == 4).any())
        self.assertTrue((examples.loc[examples.row_position == 0, "room"] == "room_2_6").any())
        self.assertFalse(examples.loc[(examples.row_position == 0) & (examples.room == "room_2_6"), "breach"].iloc[0])

    def test_future_values_and_source_identifiers_cannot_change_model_inputs(self):
        original = self.frame()
        changed = original.copy()
        changed["future_temp_15m"] += 100
        changed["future_min_15m"] -= 100
        changed["future_max_15m"] += 100
        changed["refrigerator"] = "another-source"
        changed["compartment"] = "another-channel"
        pd.testing.assert_frame_equal(make_examples(original)[WARNING_FEATURES], make_examples(changed)[WARNING_FEATURES])
        self.assertTrue(make_examples(changed).breach.all())

    def test_all_room_contexts_and_both_channels_stay_in_one_source_group(self):
        examples = make_examples(self.frame())
        folds = GroupKFold(n_splits=3).split(examples, groups=examples.refrigerator)
        for train, validation in folds:
            self.assertFalse(set(examples.iloc[train].refrigerator) & set(examples.iloc[validation].refrigerator))
            if "a" in set(examples.iloc[validation].refrigerator):
                self.assertEqual(set(examples.loc[examples.refrigerator == "a"].index),
                                 set(examples.iloc[validation].loc[lambda item: item.refrigerator == "a"].index))

    def test_threshold_respects_budget_including_tied_scores(self):
        y = np.array([True, True, False, False])
        scores = np.array([.9, .8, .8, .1])
        threshold = threshold_at_budget(y, scores, 0.)
        predicted = scores >= threshold
        self.assertEqual(int(np.sum(predicted & ~y)), 0)
        self.assertEqual(int(np.sum(predicted & y)), 1)
        threshold = threshold_at_budget(y, scores, .5)
        self.assertEqual(threshold, .8)
        self.assertIsNone(threshold_at_budget(y, np.full(4, .5), 0.))
        self.assertIsNone(threshold_at_budget([False, False], [.2, .7], .1))
        with self.assertRaises(ValueError):
            threshold_at_budget([True, True], [.2, .7], .1)

    def test_source_bootstrap_preserves_known_paired_improvement(self):
        examples = pd.DataFrame([{"room": room, "refrigerator": source, "breach": breach}
                                 for source in ["a", "b", "c", "d", "e"]
                                 for room in ROOMS for breach in [True, False]])
        result = paired_source_bootstrap(examples, np.zeros(len(examples), bool),
                                         examples.breach.to_numpy(), repeats=32)
        self.assertEqual(result["recall"]["percentile_95_interval"], [1., 1.])
        self.assertEqual(result["false_positive_rate"]["percentile_95_interval"], [0., 0.])
        self.assertEqual(result["recall"]["valid_replicates"], 32)


if __name__ == "__main__":
    unittest.main()
