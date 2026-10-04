# Bangkok temperature feature ablation

Run: 2026-10-04T03:37:06.205151+00:00

Data: the existing preprocessed Bangkok CSV; middle-shelf air temperature (T_MS).
All variants use the same rows, target, model parameters and random seed.
Dropped fields are excluded from training and prediction, rather than imputed.

- Rows: 179,826; inferred refrigerator series: 123.
- Input temperature range: [-8.2, 19.6] degrees C.
- Prediction target: temperature 15 minutes ahead, at a 5-minute sampling interval.
- Dataset SHA-256: 7b984e02d4db50487ed8692524c34a95546fc9ee0732aa612c4d9d60fe402eed
- Original model SHA-256: bfd061e775a0bd9fd88b32ddacb0da50025652bce5cc32b34ac5f9781b551872
- scikit-learn: 1.7.2

## Reference reproduction

The stored model is re-evaluated on the original 80/20 split. Saved metrics
must match recomputed metrics within 1e-9 before any training is attempted.

## Comparisons

### original_80_20

Original concatenated-row split for comparison with the deployed model's saved metrics; one series crosses the train/test boundary.

Train: 143,860; test: 35,966.

| Model / input set | MAE (C) | RMSE (C) | R2 | >8C accuracy | >8C recall | >8C F1 |
|---|---:|---:|---:|---:|---:|---:|
| Baseline: forecast equals current temperature | 0.465209 | 0.659930 | 0.958767 | 98.29% | 85.84% | 0.8596 |
| Stored model with all measured dataset inputs | 0.466163 | 0.685786 | 0.955473 | 97.98% | 86.16% | 0.8393 |
| Stored model with humidity=65, ambient_temp=30 | 0.504179 | 0.728187 | 0.949796 | 98.06% | 85.34% | 0.8429 |
| Full model: 6 features | 0.466163 | 0.685786 | 0.955473 | 97.98% | 86.16% | 0.8393 |
| Drop ambient_temp + temp_moving_avg | 0.487697 | 0.720640 | 0.950831 | 98.32% | 86.07% | 0.8625 |
| Drop ambient_temp + humidity + temp_moving_avg | 0.488754 | 0.721368 | 0.950732 | 98.32% | 85.98% | 0.8624 |
| Drop ambient_temp + humidity; keep history average | 0.457579 | 0.676814 | 0.956630 | 98.32% | 86.30% | 0.8628 |

MAE change relative to the retrained full model:

- Drop ambient_temp + temp_moving_avg: +0.021534 C (+4.62%).
- Drop ambient_temp + humidity + temp_moving_avg: +0.022591 C (+4.85%).
- Drop ambient_temp + humidity; keep history average: -0.008584 C (-1.84%).

### held_out_refrigerators

First 98 whole series for training; remaining 25 whole series for testing. No refrigerator series appears in both sets.

Train: 143,276; test: 36,550.

| Model / input set | MAE (C) | RMSE (C) | R2 | >8C accuracy | >8C recall | >8C F1 |
|---|---:|---:|---:|---:|---:|---:|
| Baseline: forecast equals current temperature | 0.468011 | 0.661295 | 0.957970 | 98.31% | 85.84% | 0.8596 |
| Full model: 6 features | 0.467668 | 0.679750 | 0.955591 | 97.93% | 84.39% | 0.8306 |
| Drop ambient_temp + temp_moving_avg | 0.492000 | 0.716658 | 0.950638 | 98.36% | 86.07% | 0.8629 |
| Drop ambient_temp + humidity + temp_moving_avg | 0.492725 | 0.724513 | 0.949550 | 98.36% | 86.03% | 0.8634 |
| Drop ambient_temp + humidity; keep history average | 0.459352 | 0.672994 | 0.956470 | 98.01% | 86.57% | 0.8394 |

MAE change relative to the retrained full model:

- Drop ambient_temp + temp_moving_avg: +0.024332 C (+5.20%).
- Drop ambient_temp + humidity + temp_moving_avg: +0.025057 C (+5.36%).
- Drop ambient_temp + humidity; keep history average: -0.008316 C (-1.78%).

## Limits of this experiment

- The CSV contains T_MS only. It does not evaluate freezer temperatures around -18 C.
- Refrigerator boundaries are inferred from timestamp resets because the CSV omits source IDs.
- The strict split holds out whole series; the legacy split is kept only to reproduce the old score.
- hour_of_day comes from a simulated start date in the original preprocessing script; it is not verified local clock time.
- Existing preprocessing drops rows containing any missing raw field, including fields outside the selected feature set.
- This experiment keeps existing preprocessing and model settings fixed to isolate feature removal.
- The stored model/default-input comparison uses the CSV history features; it does not emulate device sampling intervals or the backend history window.
- Threshold scores concern future temperature >8 C only, not arbitrary room thresholds.
- Results measure the Bangkok test set, not measured performance in the user's warehouse.
- Runtime model selection is not changed by this experiment. Trial models are saved separately.
