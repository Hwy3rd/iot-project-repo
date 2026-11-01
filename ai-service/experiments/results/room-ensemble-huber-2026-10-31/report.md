# One-hour forecast: HGB/GRU blending and Huber fine-tuning

Public Bangkok observations; repeatedly researched test partitions, not real cold-room measurements.

- Input stays 13 temperatures over one hour. Target stays t+15 minutes.
- Blend: (1-alpha)*HGB + alpha*GRU. Alpha grid 0..1 step .05; chosen on validation MAE with P95 <=102% and each-room MAE <=105% of the GRU component.
- Huber is normalized Huber/delta (SmoothL1), delta candidates .5/1/2 Celsius, fixed 5 extra epochs at LR 1e-4.
- Equal-budget L1 continuation starts from the same weights, with identical optimizer reset, learning rate, epochs and batch-order seed.
- Delta chosen for lowest validation P95 subject to MAE <=101% and each-room MAE <=105% of continued L1. If none qualify, lowest-MAE Huber is retained and marked exploratory.
- Every weight/delta is frozen before test predictions. Three predefined seeds are all reported in each evaluation.
- HGB validation is fitted only on fit sources/time; GRU validation checkpoints never trained on validation rows.
- Test components use their final-training checkpoints. New fine-tuning keeps the baseline training-only normalizer.
- Source grouping, overlapping presets and temporal target gaps match the previous experiments. Identifiers never enter models.
- Forecast gate: MAE >=1% lower, macro P95 <=5% worse, every-room MAE <=5% worse.
- Tail gate: P95 >=3% lower, MAE <=1% worse, every-room MAE and P95 <=5% worse.
- Validation is reused for choices in this exploratory study; it is not a fresh independent calibration dataset. Seeds are not independent test sets.
- Runtime and production artifacts are not changed. Step caches support --resume.

## Source evaluation

Validation choices: baseline blend GRU weight **0.50**; Huber delta **0.5**; Huber blend GRU weight **0.40**.

| Model (three-seed mean except HGB) | MAE (C) | P95 (C) | Within 1 C |
|---|---:|---:|---:|
| HGB | 0.579421 | 2.366543 | 85.55% |
| Current GRU L1 | 0.554455 | 2.227185 | 86.02% |
| l1_blend | 0.552354 | 2.263920 | 86.16% |
| l1_continued | 0.552304 | 2.216480 | 86.00% |
| huber | 0.553771 | 2.163305 | 86.29% |
| huber_blend | 0.556033 | 2.249923 | 86.18% |

### All seeds

| Model | Seed | MAE | P95 |
|---|---|---:|---:|
| l1 | 20261031 | 0.554893 | 2.252354 |
| l1 | 20261101 | 0.556947 | 2.192735 |
| l1 | 20261102 | 0.551524 | 2.236465 |
| l1_blend | 20261031 | 0.552681 | 2.284671 |
| l1_blend | 20261101 | 0.554137 | 2.234775 |
| l1_blend | 20261102 | 0.550244 | 2.272315 |
| l1_continued | 20261031 | 0.541901 | 2.192724 |
| l1_continued | 20261101 | 0.554449 | 2.182955 |
| l1_continued | 20261102 | 0.560561 | 2.273761 |
| huber | 20261031 | 0.544521 | 2.119590 |
| huber | 20261101 | 0.554074 | 2.146364 |
| huber | 20261102 | 0.562718 | 2.223959 |
| huber_blend | 20261031 | 0.552727 | 2.233643 |
| huber_blend | 20261101 | 0.555404 | 2.237118 |
| huber_blend | 20261102 | 0.559968 | 2.279007 |

Full per-room metrics, validation grids and gates are in metrics.json.

## Temporal evaluation

Validation choices: baseline blend GRU weight **0.70**; Huber delta **0.5**; Huber blend GRU weight **0.75**.

| Model (three-seed mean except HGB) | MAE (C) | P95 (C) | Within 1 C |
|---|---:|---:|---:|
| HGB | 0.454884 | 1.721889 | 88.60% |
| Current GRU L1 | 0.435074 | 1.750606 | 89.09% |
| l1_blend | 0.429841 | 1.720457 | 89.22% |
| l1_continued | 0.429752 | 1.728644 | 89.25% |
| huber | 0.433173 | 1.678474 | 89.64% |
| huber_blend | 0.428957 | 1.672823 | 89.67% |

### All seeds

| Model | Seed | MAE | P95 |
|---|---|---:|---:|
| l1 | 20261031 | 0.433558 | 1.763810 |
| l1 | 20261101 | 0.434517 | 1.739094 |
| l1 | 20261102 | 0.437146 | 1.748913 |
| l1_blend | 20261031 | 0.428030 | 1.709339 |
| l1_blend | 20261101 | 0.429221 | 1.721962 |
| l1_blend | 20261102 | 0.432271 | 1.730071 |
| l1_continued | 20261031 | 0.427056 | 1.723489 |
| l1_continued | 20261101 | 0.430694 | 1.751758 |
| l1_continued | 20261102 | 0.431507 | 1.710685 |
| huber | 20261031 | 0.430164 | 1.678588 |
| huber | 20261101 | 0.434106 | 1.691488 |
| huber | 20261102 | 0.435250 | 1.665346 |
| huber_blend | 20261031 | 0.426226 | 1.666661 |
| huber_blend | 20261101 | 0.429550 | 1.685150 |
| huber_blend | 20261102 | 0.431094 | 1.666659 |

Full per-room metrics, validation grids and gates are in metrics.json.

## Gates across both evaluations and every seed

```json
{
  "l1_blend": {
    "forecast_gate_all_phases_seeds": false,
    "tail_gate_all_phases_seeds": false
  },
  "l1_continued": {
    "forecast_gate_all_phases_seeds": false,
    "tail_gate_all_phases_seeds": false
  },
  "huber": {
    "forecast_gate_all_phases_seeds": false,
    "tail_gate_all_phases_seeds": false
  },
  "huber_blend": {
    "forecast_gate_all_phases_seeds": false,
    "tail_gate_all_phases_seeds": false
  },
  "huber_vs_equal_budget_l1": {
    "forecast_gate_all_phases_seeds": false,
    "tail_gate_all_phases_seeds": false
  }
}
```

## Verification

verification.json records component-weight replay, blend equality, metric recomputation and unchanged input/runtime hashes.
Cache files and choices are protected by signatures; --resume rejects a changed manifest. Incomplete runs do not count as benchmark results.
