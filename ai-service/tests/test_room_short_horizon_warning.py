"""Meaningful checks for short-horizon warning labels and fair comparisons."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from room_short_horizon_warning import score_all, score_window

ROOMS = {"example": (2., 8.)}


class ShortHorizonWarningTests(unittest.TestCase):
    def test_transient_breach_at_5_is_positive_for_10_minute_window(self):
        actual = [[9., 6., 6.]]
        result = score_window([6.], actual, [[9., 6.]], 10, ROOMS)
        self.assertEqual(result["rooms"]["example"]["confusion_matrix"], {"tp": 1, "fn": 0, "fp": 0, "tn": 0})
        point10 = score_window([6.], actual, [[6.]], 10, ROOMS)
        self.assertEqual(point10["rooms"]["example"]["confusion_matrix"]["fn"], 1)

    def test_breach_only_at_15_is_negative_for_10_minute_window(self):
        result = score_window([6.], [[6., 6., 9.]], [[9.]], 10, ROOMS)
        self.assertEqual(result["rooms"]["example"]["confusion_matrix"], {"tp": 0, "fn": 0, "fp": 1, "tn": 0})

    def test_5_minute_target_excludes_10_minute_label(self):
        result = score_window([6.], [[6., 9., 9.]], [[6.]], 5, ROOMS)
        self.assertEqual(result["rooms"]["example"]["confusion_matrix"]["tn"], 1)

    def test_already_out_of_range_is_not_an_early_warning_opportunity(self):
        result = score_window([9., 6.], [[9., 9., 9.], [6., 6., 6.]], [[9.], [6.]], 10, ROOMS)
        self.assertEqual(result["rooms"]["example"]["samples"], 1)
        self.assertEqual(result["rooms"]["example"]["confusion_matrix"]["tn"], 1)

    def test_boundaries_are_in_range_and_low_breaches_are_counted(self):
        result = score_window([2., 8., 6.], [[2., 8., 6.], [8., 2., 6.], [1., 6., 6.]], [[2.], [8.], [1.]], 10, ROOMS)
        self.assertEqual(result["rooms"]["example"]["confusion_matrix"], {"tp": 1, "fn": 0, "fp": 0, "tn": 2})

    def test_all_policies_share_truth_and_undefined_precision_stays_undefined(self):
        current = np.array([6., 6., 6.])
        actual = np.array([[9., 6., 6.], [6., 9., 6.], [6., 6., 9.]])
        prediction = np.full((3, 3), 6.)
        result = score_all(current, actual, prediction, np.full(3, 6.), ROOMS)
        for policy in result["10"].values():
            self.assertEqual(policy["rooms"]["example"]["positives"], 2)
            self.assertIsNone(policy["macro"]["precision"])
        self.assertEqual(result["5"]["hgb_5m"]["rooms"]["example"]["positives"], 1)

    def test_invalid_shapes_or_nonfinite_predictions_are_rejected(self):
        for actual, prediction in (([[6., 6.]], [[6.]]), ([[6., 6., 6.]], [[np.nan]])):
            with self.assertRaises(ValueError):
                score_window([6.], actual, prediction, 10, ROOMS)


if __name__ == "__main__":
    unittest.main()
