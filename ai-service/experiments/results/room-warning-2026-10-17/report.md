# Room warning objective experiment

Outcome: any observed breach at t+5, t+10 or t+15 while currently inside the room bounds.
Bangkok household observations provide supplemental training/evaluation, not real cold-room measurements.

- All 22 existing history features plus configured room bounds and current distances; no future inputs or source/channel identifiers.
- Both source channels and overlapping room contexts stay together by physical source.
- Reuses the prior 98/25 source split for paired comparison; this public dataset and holdout have been examined before.
- Three source-grouped development folds select thresholds and the classifier; test labels never tune thresholds.
- Each room's development FPR budget equals the unmodified point regressor's OOF FPR.
- Calibrated point control gets the same threshold search as classifiers, so sensitivity changes alone are controlled.
- The source-held-out models are trained on development only. The all-source runtime pickle is never used for test predictions.
- OOF scores below are calibration/selection scores, not unbiased final test estimates.
- Later-time confirmation repeats grouped calibration on its earlier training portion only.
- Scores count time samples, not independent incidents or operational lead time; room presets may overlap.
- Classifier outputs are risk scores, not validated probability estimates or food-safety guarantees.

## Development OOF (used for calibration and selection)

| Model | Mean room recall | Mean room FPR | Mean room precision | Mean room AP |
|---|---:|---:|---:|---:|
| point_default | 50.31% | 3.61% | 74.88% | 0.6491 |
| point_calibrated | 50.32% | 3.59% | 75.00% | 0.6491 |
| logistic | 14.41% | 3.60% | 44.93% | 0.3112 |
| random_forest | 42.71% | 3.61% | 71.69% | 0.6432 |
| hist_gradient_boosting | 43.22% | 3.61% | 71.95% | 0.6505 |

## Source holdout (fixed thresholds)

| Model | Mean room recall | Mean room FPR | Mean room precision | Mean room AP |
|---|---:|---:|---:|---:|
| point_default | 58.50% | 4.01% | 80.67% | 0.7033 |
| point_calibrated | 58.50% | 4.01% | 80.67% | 0.7033 |
| logistic | 17.94% | 6.84% | 46.03% | 0.3649 |
| random_forest | 47.27% | 2.51% | 80.84% | 0.7103 |
| hist_gradient_boosting | 48.78% | 1.98% | 83.42% | 0.7448 |

## Later-time replay (separately calibrated on earlier data)

| Model | Mean room recall | Mean room FPR | Mean room precision | Mean room AP |
|---|---:|---:|---:|---:|
| point_default | 58.87% | 2.72% | 82.59% | 0.7478 |
| point_calibrated | 58.86% | 2.70% | 82.69% | 0.7478 |
| hist_gradient_boosting | 56.65% | 2.40% | 84.35% | 0.8030 |

Classifier selected on development only: **hist_gradient_boosting**.

## Holdout per room

| Room | Model | Samples | Positives | Recall | FPR | Precision |
|---|---|---:|---:|---:|---:|---:|
| room_0_4 | point_default | 21705 | 2326 | 68.66% | 3.41% | 70.73% |
| room_0_4 | point_calibrated | 21705 | 2326 | 68.66% | 3.41% | 70.73% |
| room_0_4 | hist_gradient_boosting | 21705 | 2326 | 65.69% | 3.15% | 71.47% |
| room_2_6 | point_default | 18675 | 1738 | 50.17% | 1.54% | 77.03% |
| room_2_6 | point_calibrated | 18675 | 1738 | 50.17% | 1.54% | 77.03% |
| room_2_6 | hist_gradient_boosting | 18675 | 1738 | 45.22% | 1.46% | 76.09% |
| room_minus22_minus18 | point_default | 2280 | 999 | 64.96% | 10.46% | 82.89% |
| room_minus22_minus18 | point_calibrated | 2280 | 999 | 64.96% | 10.46% | 82.89% |
| room_minus22_minus18 | hist_gradient_boosting | 2280 | 999 | 54.15% | 2.97% | 93.44% |
| room_minus28_minus22 | point_default | 1973 | 253 | 50.20% | 0.64% | 92.03% |
| room_minus28_minus22 | point_calibrated | 1973 | 253 | 50.20% | 0.64% | 92.03% |
| room_minus28_minus22 | hist_gradient_boosting | 1973 | 253 | 30.04% | 0.35% | 92.68% |

## Prespecified experimental checks

Recall must improve by at least 2 percentage points vs both point controls, macro FPR may increase at most 0.5 point, and each room FPR at most 1 point, on both evaluations.
These are coursework comparison tolerances, not safety limits.

```json
{
  "source_holdout": {
    "passed": false,
    "checks": {
      "point_default_recall_improvement_at_least_2_points": false,
      "point_default_fpr_increase_at_most_half_point": true,
      "point_default_each_room_fpr_increase_at_most_1_point": true,
      "point_calibrated_recall_improvement_at_least_2_points": false,
      "point_calibrated_fpr_increase_at_most_half_point": true,
      "point_calibrated_each_room_fpr_increase_at_most_1_point": true
    }
  },
  "later_time": {
    "passed": false,
    "checks": {
      "point_default_recall_improvement_at_least_2_points": false,
      "point_default_fpr_increase_at_most_half_point": true,
      "point_default_each_room_fpr_increase_at_most_1_point": true,
      "point_calibrated_recall_improvement_at_least_2_points": false,
      "point_calibrated_fpr_increase_at_most_half_point": true,
      "point_calibrated_each_room_fpr_increase_at_most_1_point": true
    }
  },
  "runtime_changed": false,
  "passed_both": false
}
```

Runtime model and API are unchanged. Evaluated candidate models and their development-calibrated thresholds are saved separately; they are not fitted on all sources or deployed.
