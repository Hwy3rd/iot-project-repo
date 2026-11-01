# GRU multi-horizon temperature-sequence experiment

Public Bangkok data; no real cold-room accuracy claim. Source channel labels are provenance only.

- Inputs: exactly 13 readings from t-60 to t, at 5-minute cadence. No future values in inputs.
- Outputs: temperature changes at t+5, t+10, t+15, added back to the current temperature.
- HGB point control uses t+15 only; HGB multi and GRU warn if any of the three predictions breaches a room bound.
- All models use identical evaluation rows and four overlapping room presets. Metrics are macro averages per preset.
- Warning labels: at least one observed future reading out of bounds, only while current temperature is in range.
- Source evaluation reuses the previous 98-development/25-test split. This dataset/test set was researched before.
- GRU hidden size and epoch count are selected on held-out development sources; normalization fits training data only.
- Final GRUs refit all development sources for the fixed selected epoch count. Every predefined seed is reported.
- Temporal replay independently tunes on the middle segment; training/validation future labels cannot cross boundaries.
- Seed repeats are not independent test sets. Temporal replay uses known source histories, not unseen warehouses.
- Gates: forecasting MAE >=1% lower, P95 <=5% worse, each preset MAE <=5% worse; warning recall >=2 points higher, macro FPR <=0.5 points worse, each preset FPR <=1 point worse.
- These are coursework comparison gates, not food-storage safety limits. No runtime model is changed.

## Source evaluation

Selected on validation: **gru_64**, **11 epochs**.

| Model | Room MAE at 15m (C) | P95 at 15m (C) | Within 1 C | Window recall | Window FPR | Window precision |
|---|---:|---:|---:|---:|---:|---:|
| HGB endpoint 15m | 0.5794 | 2.3665 | 85.55% | 58.50% | 4.01% | 80.67% |
| HGB multi 5/10/15m | 0.5794 | 2.3665 | 85.55% | 61.86% | 4.50% | 78.85% |
| GRU seed 20261031 | 0.5793 | 2.3308 | 85.71% | 61.62% | 4.98% | 77.23% |
| GRU seed 20261101 | 0.5900 | 2.3018 | 85.31% | 61.15% | 4.96% | 78.05% |
| GRU seed 20261102 | 0.5776 | 2.2086 | 86.05% | 60.06% | 4.80% | 79.57% |

### Per-room warning results

| Model | Room | Recall | FPR | Precision |
|---|---|---:|---:|---:|
| HGB endpoint 15m | room_0_4 | 68.66% | 3.41% | 70.73% |
| HGB endpoint 15m | room_2_6 | 50.17% | 1.54% | 77.03% |
| HGB endpoint 15m | room_minus22_minus18 | 64.96% | 10.46% | 82.89% |
| HGB endpoint 15m | room_minus28_minus22 | 50.20% | 0.64% | 92.03% |
| HGB multi 5/10/15m | room_0_4 | 73.13% | 3.87% | 69.40% |
| HGB multi 5/10/15m | room_2_6 | 56.44% | 2.31% | 71.45% |
| HGB multi 5/10/15m | room_minus22_minus18 | 67.27% | 11.16% | 82.45% |
| HGB multi 5/10/15m | room_minus28_minus22 | 50.59% | 0.64% | 92.09% |
| GRU seed 20261031 | room_0_4 | 71.58% | 4.00% | 68.24% |
| GRU seed 20261031 | room_2_6 | 57.77% | 3.05% | 66.01% |
| GRU seed 20261031 | room_minus22_minus18 | 65.37% | 12.41% | 80.42% |
| GRU seed 20261031 | room_minus28_minus22 | 51.78% | 0.47% | 94.24% |
| GRU seed 20261101 | room_0_4 | 70.77% | 4.20% | 66.94% |
| GRU seed 20261101 | room_2_6 | 56.56% | 2.14% | 73.03% |
| GRU seed 20261101 | room_minus22_minus18 | 66.67% | 12.88% | 80.14% |
| GRU seed 20261101 | room_minus28_minus22 | 50.59% | 0.64% | 92.09% |
| GRU seed 20261102 | room_0_4 | 65.91% | 2.84% | 73.56% |
| GRU seed 20261102 | room_2_6 | 53.91% | 2.13% | 72.24% |
| GRU seed 20261102 | room_minus22_minus18 | 67.87% | 13.66% | 79.48% |
| GRU seed 20261102 | room_minus28_minus22 | 52.57% | 0.58% | 93.01% |

### Promotion gates

```json
{
  "20261031": {
    "forecast_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": false,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "warning_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": true,
        "macro_fpr_increase_at_most_half_point": false,
        "each_room_fpr_increase_at_most_1_point": false
      }
    },
    "warning_vs_hgb_multi": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": false,
        "macro_fpr_increase_at_most_half_point": true,
        "each_room_fpr_increase_at_most_1_point": false
      }
    }
  },
  "20261101": {
    "forecast_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": false,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": false
      }
    },
    "warning_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": true,
        "macro_fpr_increase_at_most_half_point": false,
        "each_room_fpr_increase_at_most_1_point": false
      }
    },
    "warning_vs_hgb_multi": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": false,
        "macro_fpr_increase_at_most_half_point": true,
        "each_room_fpr_increase_at_most_1_point": false
      }
    }
  },
  "20261102": {
    "forecast_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": false,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "warning_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": false,
        "macro_fpr_increase_at_most_half_point": false,
        "each_room_fpr_increase_at_most_1_point": false
      }
    },
    "warning_vs_hgb_multi": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": false,
        "macro_fpr_increase_at_most_half_point": true,
        "each_room_fpr_increase_at_most_1_point": false
      }
    }
  }
}
```

## Temporal evaluation

Selected on validation: **gru_64**, **30 epochs**.

| Model | Room MAE at 15m (C) | P95 at 15m (C) | Within 1 C | Window recall | Window FPR | Window precision |
|---|---:|---:|---:|---:|---:|---:|
| HGB endpoint 15m | 0.4549 | 1.7219 | 88.60% | 58.87% | 2.72% | 82.59% |
| HGB multi 5/10/15m | 0.4549 | 1.7219 | 88.60% | 65.63% | 3.31% | 80.98% |
| GRU seed 20261031 | 0.4440 | 1.7510 | 88.91% | 68.81% | 3.52% | 80.36% |

### Per-room warning results

| Model | Room | Recall | FPR | Precision |
|---|---|---:|---:|---:|
| HGB endpoint 15m | room_0_4 | 57.66% | 2.95% | 76.43% |
| HGB endpoint 15m | room_2_6 | 54.26% | 1.56% | 78.26% |
| HGB endpoint 15m | room_minus22_minus18 | 62.46% | 5.01% | 85.08% |
| HGB endpoint 15m | room_minus28_minus22 | 61.10% | 1.36% | 90.60% |
| HGB multi 5/10/15m | room_0_4 | 69.31% | 4.01% | 74.15% |
| HGB multi 5/10/15m | room_2_6 | 60.59% | 2.13% | 74.63% |
| HGB multi 5/10/15m | room_minus22_minus18 | 70.39% | 5.62% | 85.14% |
| HGB multi 5/10/15m | room_minus28_minus22 | 62.25% | 1.49% | 90.00% |
| GRU seed 20261031 | room_0_4 | 71.73% | 4.15% | 74.13% |
| GRU seed 20261031 | room_2_6 | 66.51% | 2.31% | 74.92% |
| GRU seed 20261031 | room_minus22_minus18 | 72.74% | 5.44% | 85.94% |
| GRU seed 20261031 | room_minus28_minus22 | 64.27% | 2.17% | 86.43% |

### Promotion gates

```json
{
  "20261031": {
    "forecast_vs_hgb_15m": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "warning_vs_hgb_15m": {
      "passed": false,
      "checks": {
        "recall_gain_at_least_2_points": true,
        "macro_fpr_increase_at_most_half_point": false,
        "each_room_fpr_increase_at_most_1_point": false
      }
    },
    "warning_vs_hgb_multi": {
      "passed": true,
      "checks": {
        "recall_gain_at_least_2_points": true,
        "macro_fpr_increase_at_most_half_point": true,
        "each_room_fpr_increase_at_most_1_point": true
      }
    }
  }
}
```

## Reproducibility

Full source hashes, source lists, epoch histories, normalization, seeds, environment and scores are in metrics.json.
Predictions are saved in predictions.npz; evaluated model weights are separate artifacts.
Warning scores count overlapping time samples, not independent incidents or actual mobile notifications.
Only samples at t+5/t+10/t+15 are observed; temperatures between these readings are unknown.
