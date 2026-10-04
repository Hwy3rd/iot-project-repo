# Offline temperature history upgrade

Run: 2026-10-04T08:08:38.129613+00:00

Coursework experiment using only the existing public Bangkok refrigerator data.
Forecast horizon stays at 15 minutes. Every candidate is evaluated on the same rows.

- Refrigerators: 123; paired compartment rows: 357,684.
- Source cadence: five minutes. Derive each feature separately within its own refrigerator and compartment.
- All inputs use current or earlier values; future temperature is used only as the target.
- Long history consists of lags and differences through 60 minutes, plus recent mean, standard deviation and range.
- Rolling windows include the current point and have durations expressed as half-open time windows.
- No humidity, ambient temperature, synthetic clock time, door or fan state is used.
- Temperature-change candidates learn future temperature minus current temperature, then add the current value back.
- Hyperparameters use the existing HGB model, except the stated target and loss. No parameter search on test rows.
- Both compartments of a refrigerator are always assigned to the same partition.
- Primary held-out split: 98 train / 25 test fridges.
- CV uses five shuffled GroupKFold splits with random seed 42.
- Persistence baseline predicts the current temperature unchanged.
- Source manifest SHA-256: bbc8dc499a18a97b6c9f6acd2a2c9e1d8bbfc3481c4fe6da4a4f23a965ef75f2.
- Deployed model SHA-256: bfd061e775a0bd9fd88b32ddacb0da50025652bce5cc32b34ac5f9781b551872.

## Primary held-out results

| Variant | T_MS MAE C | T_FC MAE C | T_FC RMSE C | T_FC within 1 C | T_FC -25..-15 C MAE |
|---|---:|---:|---:|---:|---:|
| persistence | 0.467909 | 1.621318 | 2.306367 | 47.94% | 1.367736 |
| short_history | 0.474079 | 1.550856 | 2.229153 | 48.14% | 1.223095 |
| history_30m | 0.412618 | 1.322027 | 1.914701 | 54.62% | 1.076158 |
| history_60m | 0.381142 | 1.090169 | 1.596245 | 62.45% | 0.933310 |
| history_60m_change | 0.339853 | 1.007706 | 1.522630 | 65.85% | 0.854594 |
| history_60m_change_absolute | 0.292800 | 0.985430 | 1.558911 | 67.86% | 0.788904 |

## Five-fold grouped CV: pooled out-of-fold results

| Variant | T_MS MAE C | T_FC MAE C | T_FC RMSE C | T_FC within 1 C | T_FC -25..-15 C MAE |
|---|---:|---:|---:|---:|---:|
| persistence | 0.427693 | 1.552660 | 2.280362 | 49.10% | 1.263442 |
| short_history | 0.438744 | 1.444336 | 2.166574 | 50.79% | 1.116868 |
| history_30m | 0.401495 | 1.266016 | 2.000400 | 58.49% | 0.968618 |
| history_60m | 0.372697 | 1.034403 | 1.614756 | 65.91% | 0.851461 |
| history_60m_change | 0.327839 | 0.938522 | 1.533075 | 70.98% | 0.784687 |
| history_60m_change_absolute | 0.299215 | 0.921211 | 1.610333 | 72.60% | 0.750763 |

## Candidate selected for further work

Lowest CV freezer MAE: history_60m_change_absolute.
- MAE reduction vs matched-row short history: 36.22%.
- Fraction within 1 C: 50.79% -> 72.60%.
- Selection uses these validation scores. It is not a new untouched final test.

## Fold-level freezer MAE

| Fold | persistence | short_history | history_30m | history_60m | history_60m_change | history_60m_change_absolute |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1.558041 | 1.482489 | 1.358928 | 1.156640 | 1.047640 | 1.031553 |
| 2 | 1.636655 | 1.629896 | 1.444359 | 1.095129 | 1.000122 | 0.975918 |
| 3 | 1.565543 | 1.428529 | 1.184839 | 0.924128 | 0.847145 | 0.847880 |
| 4 | 1.582677 | 1.380779 | 1.191261 | 1.032695 | 0.924395 | 0.928900 |
| 5 | 1.416122 | 1.291326 | 1.142771 | 0.960395 | 0.870005 | 0.817984 |

## Limits and integration

- These results are reproducible offline evaluation on domestic refrigerators, not measurements in a warehouse.
- Public T_FC denotes freezer compartment or coldest zone, with varying operating temperatures.
- Future door openings or control events cannot be inferred perfectly from temperature history.
- Current firmware reports every 5 seconds, while these features are defined at 5-minute lags.
  Backend integration must retrieve history by elapsed time and match the feature definitions.
- Current backend exposes only short history; longer-history candidates need backend and FastAPI input changes.
- Change-target .pkl files contain a temperature-change regressor: add current temperature to model output.
  They must not be substituted directly into the old absolute-temperature inference code.
- Primary trial models are saved separately, and the deployed model and runtime code are unchanged.
- Single-sample temperature-band R2 values are null.
- Environment: {"joblib": "1.6.0", "numpy": "1.26.4", "pandas": "2.3.3", "python": "3.10.11", "scikit_learn": "1.7.2", "threads": 4}.

Command:

```powershell
py -3.10 -X utf8 -u -B ai-service/experiments/freezer_history.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/temperature_model_hgb.pkl --output-dir ai-service/experiments/results/history-upgrade-2026-10-04 --threads 4
```
