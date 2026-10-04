# Shared vs separate Bangkok compartment models

Run: 2026-10-04T04:40:39.868003+00:00

Compare one shared model trained on T_MS + T_FC with two separately trained models.
All use the reference HistGradientBoostingRegressor parameters without tuning on test data.

- Source refrigerators: 123; usable rows: 360,390.
- Input fields: temperature, temp_delta, temp_moving_avg.
- Target: same sensor's temperature exactly 15 minutes later.
- History: current and previous readings strictly within 15 minutes, max 5 and min 2 readings.
  At the dataset's 5-minute cadence this is normally a three-reading average.
- Humidity and ambient temperature are excluded; hour_of_day is excluded because real starting clock time is unknown.
- Both compartments of a refrigerator always stay in the same train/test partition.
- Persistence baseline forecasts the current temperature unchanged.
- Primary split: 98 train / 25 test refrigerators.
- Separate-model evaluation routes by known compartment label; this does not test automatic routing.
- Data manifest SHA-256: 6ae235de34347ee62513ac1e06cdd8541abd69522aad849585018175aa78a8c5.
- Reference model SHA-256: bfd061e775a0bd9fd88b32ddacb0da50025652bce5cc32b34ac5f9781b551872.

## Primary held-out comparison

| Compartment | Method | MAE (C) | RMSE (C) | R2 | Within 0.5 C | Within 1 C |
|---|---|---:|---:|---:|---:|---:|
| T_MS | persistence | 0.467924 | 0.661118 | 0.957999 | 68.48% | 88.28% |
| T_MS | shared | 0.473128 | 0.673480 | 0.956414 | 66.56% | 87.89% |
| T_MS | separate | 0.486202 | 0.715127 | 0.950857 | 65.27% | 87.43% |
| T_FC | persistence | 1.620724 | 2.305684 | 0.868017 | 28.22% | 47.95% |
| T_FC | shared | 1.545047 | 2.218331 | 0.877828 | 29.22% | 48.48% |
| T_FC | separate | 1.564702 | 2.233058 | 0.876201 | 28.88% | 48.23% |

Shared-model MAE minus separate-model MAE (positive favors separate):

- T_MS: -0.013073 C (-2.69% relative to separate).
- T_FC: -0.019655 C (-1.26% relative to separate).

Freezer samples currently between -25 C and -15 C:

| Method | Samples | MAE (C) | RMSE (C) |
|---|---:|---:|---:|
| persistence | 15,201 | 1.365325 | 1.807777 |
| shared | 15,201 | 1.218841 | 1.655292 |
| separate | 15,201 | 1.218063 | 1.660139 |

## Five-fold grouped cross-validation: pooled out-of-fold predictions

| Compartment | Method | MAE (C) | RMSE (C) | R2 | Within 0.5 C | Within 1 C |
|---|---|---:|---:|---:|---:|---:|
| T_MS | persistence | 0.427904 | 0.637930 | 0.962721 | 73.15% | 91.18% |
| T_MS | shared | 0.438719 | 0.678651 | 0.957809 | 70.88% | 90.01% |
| T_MS | separate | 0.427208 | 0.657933 | 0.960346 | 71.58% | 90.39% |
| T_FC | persistence | 1.551511 | 2.278687 | 0.884610 | 29.13% | 49.13% |
| T_FC | shared | 1.445380 | 2.172194 | 0.895143 | 29.75% | 50.94% |
| T_FC | separate | 1.483501 | 2.188487 | 0.893565 | 28.52% | 49.54% |

Shared-model MAE minus separate-model MAE (positive favors separate):

- T_MS: +0.011511 C (+2.69% relative to separate).
- T_FC: -0.038121 C (-2.57% relative to separate).

Freezer samples currently between -25 C and -15 C:

| Method | Samples | MAE (C) | RMSE (C) |
|---|---:|---:|---:|
| persistence | 65,098 | 1.261719 | 1.859583 |
| shared | 65,098 | 1.116327 | 1.687821 |
| separate | 65,098 | 1.116704 | 1.679574 |

## Fold-level stability

| Fold | Train fridges | Test fridges | T_MS shared - separate MAE | T_FC shared - separate MAE |
|---|---:|---:|---:|---:|
| 1 | 98 | 25 | +0.027287 | -0.049003 |
| 2 | 98 | 25 | +0.023787 | +0.016170 |
| 3 | 98 | 25 | +0.018501 | -0.046424 |
| 4 | 99 | 24 | +0.042959 | -0.031963 |
| 5 | 99 | 24 | -0.056442 | -0.080849 |

## Primary model probes

These are synthetic stable inputs (delta 0, recent average equal to current temperature), not accuracy measurements.

| Current C | Shared C | T_MS model C | T_FC model C | Stored model C |
|---:|---:|---:|---:|---:|
| -30.0 | -26.55 | -3.89 | -26.58 | -4.07 |
| -28.0 | -26.55 | -3.89 | -26.58 | -4.07 |
| -25.0 | -24.95 | -3.89 | -24.68 | -4.07 |
| -22.0 | -21.75 | -3.89 | -21.98 | -4.07 |
| -20.0 | -19.82 | -3.89 | -19.91 | -4.07 |
| -18.0 | -17.93 | -3.89 | -18.00 | -4.07 |
| -15.0 | -15.19 | -3.89 | -15.30 | -4.07 |
| -10.0 | -9.93 | -3.89 | -10.02 | -4.07 |
| -5.0 | -5.13 | -3.69 | -5.68 | -3.80 |
| 0.0 | -0.07 | 0.10 | -2.49 | 0.12 |
| 4.0 | 3.95 | 3.95 | 3.99 | 3.87 |
| 8.0 | 7.99 | 7.96 | 7.16 | 7.96 |
| 12.0 | 12.15 | 12.01 | 7.16 | 12.04 |
| 17.0 | 14.38 | 16.75 | 7.16 | 16.73 |
| 20.0 | 14.38 | 17.00 | 7.16 | 16.89 |
| 25.0 | 14.38 | 17.00 | 7.16 | 16.89 |

## Limits and reproducibility

- These are domestic refrigerator data, not measured warehouse performance.
- T_FC is the freezer compartment OR coldest zone according to the source README; not all refrigerators maintain -18 C.
- Test fridges are unseen, but this experiment does not measure future seasons or different sites.
- Threshold scores in metrics.json are illustrative: future >8 C for T_MS and future >-18 C for T_FC.
  They are not warehouse-specific safe ranges or overall temperature prediction accuracy.
- The prior feature-ablation run used five-reading history and synthetic hour_of_day; its scores are not directly comparable.
- Grouped cross-validation is validation, not an additional untouched final deployment test.
- Stable probes outside each model's own training range do not establish useful extrapolation.
- Stored-model probes use hour 14, humidity 65, ambient 30 and the stable history inputs.
- Existing runtime code, backend supported-range guard and deployed model are unchanged.
- Three primary trial models are saved here; binaries are ignored by Git. CV models are not saved.
- Per-refrigerator primary metrics are in per_refrigerator.csv; source hashes and split IDs are in metrics.json.
- R2 is null for temperature bands containing only one sample; it is undefined there.
- Environment: {"joblib": "1.6.0", "numpy": "1.26.4", "pandas": "2.3.3", "python": "3.10.11", "scikit_learn": "1.7.2", "threads": 4}.

Command:

```powershell
py -3.10 -X utf8 -u -B ai-service/experiments/compartment_comparison.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/temperature_model_hgb.pkl --output-dir ai-service/experiments/results/compartment-comparison-2026-10-04 --threads 4
```
