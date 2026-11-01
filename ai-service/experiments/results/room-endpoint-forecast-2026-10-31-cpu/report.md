# Forecast ablation: complete temperature lags and single-target GRU

Offline public Bangkok observations, not measured cold-room performance.

- Primary objective: temperature at t+15 minutes. Every model is scored on the same rows.
- HGB extension: append only raw lags 25/35/40/50/55 minutes to the 22 original features (27 total).
- GRU extension: one temperature-change output and L1 at 15 minutes; other input, optimizer and search settings match the previous trial.
- GRU width 32/64 and epoch count use only validation. All three predefined seeds are reported in BOTH evaluations.
- Source partitions, validation source lists and temporal boundaries match the previous experiment.
- HGB control and multi-head GRU predictions are reused only after checking labels and source/channel/time keys.
- HGB hyperparameters remain fixed, including its existing internal early_stopping='auto'.
- Normalization uses training data only. Future labels cannot cross temporal split boundaries.
- Both channels of one physical source stay together. Channel/source identifiers are never model inputs.
- Previous multi-head GRU is scored at its 15-minute output here; its three-horizon warning union is not reused.
- MAE/P95/within-1C are macro averages over four overlapping room presets while current temperature is in range.
- Improvement gate: MAE at least 1% lower, macro P95 at most 5% worse and each preset MAE at most 5% worse.
- Source test data have been researched repeatedly; this is exploratory evaluation, not a fresh independent test.
- Temporal replay uses later data of known sources. Seeds are not independent test sets.
- No runtime/API/production model is replaced.

## Source evaluation

GRU chosen on validation: **gru_64**, **15 epochs**.

| Model | MAE 15m (C) | P95 (C) | Within 1 C |
|---|---:|---:|---:|
| HGB original 22 features | 0.579421 | 2.366543 | 85.55% |
| HGB complete lags, 27 features | 0.580617 | 2.377871 | 85.72% |
| Previous multi-head GRU seed 20261031 | 0.579292 | 2.330805 | 85.71% |
| Previous multi-head GRU seed 20261101 | 0.590034 | 2.301780 | 85.31% |
| Previous multi-head GRU seed 20261102 | 0.577577 | 2.208561 | 86.05% |
| Single-target GRU seed 20261031 | 0.554893 | 2.252354 | 85.78% |
| Single-target GRU seed 20261101 | 0.556947 | 2.192735 | 85.99% |
| Single-target GRU seed 20261102 | 0.551524 | 2.236465 | 86.30% |
| Single-target GRU mean (3 seeds) | 0.554455 | 2.227185 | 86.02% |

### Per-room MAE

| Model | room_0_4 | room_2_6 | room_minus22_minus18 | room_minus28_minus22 |
|---|---:|---:|---:|---:|
| HGB original 22 features | 0.451214 | 0.280314 | 0.959615 | 0.626541 |
| HGB complete lags, 27 features | 0.457579 | 0.276723 | 0.958628 | 0.629540 |
| Previous multi-head GRU seed 20261031 | 0.431975 | 0.276843 | 0.982979 | 0.625371 |
| Previous multi-head GRU seed 20261101 | 0.416192 | 0.285567 | 1.013775 | 0.644603 |
| Previous multi-head GRU seed 20261102 | 0.417023 | 0.269143 | 0.985288 | 0.638853 |
| Single-target GRU seed 20261031 | 0.404118 | 0.270017 | 0.930053 | 0.615383 |
| Single-target GRU seed 20261101 | 0.396755 | 0.260595 | 0.957421 | 0.613016 |
| Single-target GRU seed 20261102 | 0.407236 | 0.264751 | 0.928445 | 0.605664 |

### Gates against the original HGB point control

```json
{
  "hgb_full_lags": {
    "passed": false,
    "checks": {
      "macro_mae_reduction_at_least_1_percent": false,
      "macro_p95_increase_at_most_5_percent": true,
      "each_room_mae_increase_at_most_5_percent": true
    }
  },
  "gru_single": {
    "20261031": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "20261101": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "20261102": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    }
  }
}
```

## Temporal evaluation

GRU chosen on validation: **gru_64**, **30 epochs**.

| Model | MAE 15m (C) | P95 (C) | Within 1 C |
|---|---:|---:|---:|
| HGB original 22 features | 0.454884 | 1.721889 | 88.60% |
| HGB complete lags, 27 features | 0.450529 | 1.748426 | 88.59% |
| Previous multi-head GRU seed 20261031 | 0.444023 | 1.751040 | 88.91% |
| Single-target GRU seed 20261031 | 0.433558 | 1.763810 | 89.27% |
| Single-target GRU seed 20261101 | 0.434517 | 1.739094 | 88.99% |
| Single-target GRU seed 20261102 | 0.437146 | 1.748913 | 89.00% |
| Single-target GRU mean (3 seeds) | 0.435074 | 1.750606 | 89.09% |

### Per-room MAE

| Model | room_0_4 | room_2_6 | room_minus22_minus18 | room_minus28_minus22 |
|---|---:|---:|---:|---:|
| HGB original 22 features | 0.344651 | 0.256852 | 0.588170 | 0.629863 |
| HGB complete lags, 27 features | 0.345076 | 0.255867 | 0.583824 | 0.617348 |
| Previous multi-head GRU seed 20261031 | 0.322908 | 0.238020 | 0.565322 | 0.649841 |
| Single-target GRU seed 20261031 | 0.323644 | 0.241980 | 0.541140 | 0.627468 |
| Single-target GRU seed 20261101 | 0.328384 | 0.240299 | 0.542715 | 0.626672 |
| Single-target GRU seed 20261102 | 0.321042 | 0.239930 | 0.558241 | 0.629371 |

### Gates against the original HGB point control

```json
{
  "hgb_full_lags": {
    "passed": false,
    "checks": {
      "macro_mae_reduction_at_least_1_percent": false,
      "macro_p95_increase_at_most_5_percent": true,
      "each_room_mae_increase_at_most_5_percent": true
    }
  },
  "gru_single": {
    "20261031": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "20261101": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    },
    "20261102": {
      "passed": true,
      "checks": {
        "macro_mae_reduction_at_least_1_percent": true,
        "macro_p95_increase_at_most_5_percent": true,
        "each_room_mae_increase_at_most_5_percent": true
      }
    }
  }
}
```

## Combined decision

```json
{
  "hgb_full_lags_passes_both_evaluations": false,
  "gru_single_all_seeds_pass_both_evaluations": true
}
```

## Reproducibility

metrics.json includes raw source hashes, exact split lists, runtime/input hashes, seed histories and environment versions.
predictions.npz and saved model weights permit replay using --verify-only. verification.json records the checks.
Threshold-alert metrics in metrics.json are secondary diagnostics of each 15-minute output; this experiment selects models for regression.
