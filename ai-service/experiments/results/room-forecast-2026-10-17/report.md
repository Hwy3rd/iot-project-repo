# Room-threshold forecast experiment

Public Bangkok observations replayed against room presets; these are not measurements from real cold rooms.
Both source channels stay together by source refrigerator. Channel labels never route predictions.

- Sources: 123; rows: 357,684.
- Endpoint target: same sensor at t+15 minutes. Window targets: min/max at t+5, t+10, t+15.
- Evaluation starts only while the current temperature is inside each room's configured bounds, matching the backend.
- Room presets overlap; macro scores give each preset equal weight, not independent sample counts.
- Three grouped tuning folds use development sources only; holdout sources are evaluated once after selection.
- The public dataset has been used in earlier project experiments; this holdout is separate within this run, not a globally untouched dataset.
- All controls are fitted from scratch on their training split. The existing all-source artifact is never scored as a held-out model.
- Alert scores are sample-level, not independent incidents or measured operational lead times.
- All configuration changes, candidate selection and promotion gates are recorded in metrics.json.

## Tuning (grouped out-of-fold)

| Model | Mean room MAE C | Mean room P95 C | Window recall | Window false-positive rate |
|---|---:|---:|---:|---:|
| current | 0.5581 | 2.0042 | 48.87% | 3.50% |
| slow_300 | 0.5535 | 2.0038 | 49.23% | 3.52% |
| slow_500 | 0.5419 | 1.9879 | 50.31% | 3.61% |
| squared_300 | 0.6077 | 1.9353 | 49.66% | 4.88% |

## Source holdout

| Model | Mean room MAE C | Mean room P95 C | Window recall | Window false-positive rate |
|---|---:|---:|---:|---:|
| current | 0.5984 | 2.3989 | 57.31% | 3.51% |
| slow_500 | 0.5794 | 2.3665 | 58.50% | 4.01% |
| selected_with_extrema | 0.5794 | 2.3665 | 65.86% | 5.77% |

## Later-time replay

| Model | Mean room MAE C | Mean room P95 C | Window recall | Window false-positive rate |
|---|---:|---:|---:|---:|
| current | 0.5118 | 1.8562 | 54.88% | 2.71% |
| slow_500 | 0.4549 | 1.7219 | 58.87% | 2.72% |

Selected using tuning only: **slow_500**.

## Promotion decision

{
  "source_holdout": {
    "passed": true,
    "checks": {
      "macro_mae_reduction_at_least_1_percent": true,
      "macro_p95_regression_at_most_5_percent": true,
      "window_miss_rate_regression_at_most_1_point": true,
      "window_false_alarm_rate_regression_at_most_1_point": true,
      "each_room_mae_regression_at_most_5_percent": true
    }
  },
  "later_time": {
    "passed": true,
    "checks": {
      "macro_mae_reduction_at_least_1_percent": true,
      "macro_p95_regression_at_most_5_percent": true,
      "window_miss_rate_regression_at_most_1_point": true,
      "window_false_alarm_rate_regression_at_most_1_point": true,
      "each_room_mae_regression_at_most_5_percent": true
    }
  },
  "passed": true
}

## Final artifact and runtime decision

The approved point model is fitted on all 123 sources and installed as the
default artifact in the isolated AI branch. The source-holdout and temporal
numbers above come from their separately fitted controls, not from scoring
the final all-source artifact on seen data.

Window extrema are retained for offline research only: recall improves but
false-positive rate rises from 4.01% to 5.77% compared with the selected point
model. No extrema values are silently substituted for a temperature at t+15.

The exact pre-tuning artifact is saved as reference_model.pkl for reproduction.
Demo fixtures are regenerated for the approved model and are functional demos,
not additional accuracy measurements.
