"""Offline, matched-data GRU versus HGB temperature-sequence experiment.

No runtime artifact is replaced. Source channel names are provenance only.
Selection uses validation data; all final training seeds are reported.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
import joblib
import numpy as np
import pandas as pd
import sklearn
import torch
from sklearn.base import clone
from sklearn.model_selection import GroupShuffleSplit
from threadpoolctl import threadpool_limits
from torch import nn

SERVICE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE))
from temperature_features import FEATURE_NAMES
from room_forecast import ROOMS, SEED, classification, load_room_data, regression, room_metrics

HORIZONS = (5, 10, 15)
HISTORY = [f"history_{minutes}m" for minutes in range(60, -1, -5)]
TARGETS = [f"future_temp_{minutes}m" for minutes in HORIZONS]
GRU_CONFIGS = {
    "gru_32": {"hidden_size": 32, "layers": 1, "learning_rate": .001},
    "gru_64": {"hidden_size": 64, "layers": 1, "learning_rate": .001},
}
FINAL_SEEDS = [20261031, 20261101, 20261102]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, data):
    Path(path).write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")


def load_sequence_data(root):
    """Join exact 13 past readings and 3 future labels to canonical HGB rows."""
    frame, sources = load_room_data(root)
    parts = []
    for source in sources:
        path = root / source["file"]
        raw = pd.read_csv(path, sep="\t", usecols=["Time", "T_MS", "T_FC"])
        for channel in ["T_MS", "T_FC"]:
            values = raw[channel].to_numpy(dtype=np.float64)
            if len(values) < 16:
                continue
            windows = np.lib.stride_tricks.sliding_window_view(values, 16)
            part = pd.DataFrame(windows[:, :13], columns=HISTORY)
            part["refrigerator"], part["compartment"] = path.stem, channel
            part["elapsed_minutes"] = raw.Time.to_numpy()[12:-3]
            for index, target in enumerate(TARGETS):
                part["sequence_" + target] = windows[:, 13 + index]
            parts.append(part)
    merged = frame.merge(pd.concat(parts, ignore_index=True),
                         on=["refrigerator", "compartment", "elapsed_minutes"],
                         how="left", validate="one_to_one", sort=False)
    future = merged[["sequence_" + name for name in TARGETS]].to_numpy()
    if len(merged) != len(frame) or not np.isfinite(merged[HISTORY].to_numpy()).all():
        raise ValueError("History alignment failed")
    if not np.array_equal(merged[HISTORY[-1]].to_numpy(), merged.temperature.to_numpy()):
        raise ValueError("History includes the wrong current reading")
    checks = [(future[:, 2], merged.future_temp_15m),
              (future.min(axis=1), merged.future_min_15m),
              (future.max(axis=1), merged.future_max_15m)]
    if not np.isfinite(future).all() or any(not np.array_equal(a, b) for a, b in checks):
        raise ValueError("Future-label alignment failed")
    for index, name in enumerate(TARGETS):
        merged[name] = future[:, index]
        merged.drop(columns="sequence_" + name, inplace=True)
    return merged, sources


def temporal_positions(frame):
    """Future labels may not cross a validation or test boundary."""
    last = frame.groupby(["refrigerator", "compartment"]).elapsed_minutes.transform("max")
    validation_start, test_start = last * .6, last * .8
    now = frame.elapsed_minutes
    return {
        "fit": np.flatnonzero((now + 15 < validation_start).to_numpy()),
        "validation": np.flatnonzero(((now >= validation_start) & (now + 15 < test_start)).to_numpy()),
        "final_train": np.flatnonzero((now + 15 < test_start).to_numpy()),
        "test": np.flatnonzero((now >= test_start).to_numpy()),
    }


def fit_normalizer(frame):
    values = frame[HISTORY].to_numpy(dtype=np.float64)
    return {"center": float(values.mean()), "scale": max(float(values.std()), 1.)}


def sequence_inputs(frame, normalizer):
    values = frame[HISTORY].to_numpy(dtype=np.float32)
    absolute = (values - normalizer["center"]) / normalizer["scale"]
    relative = (values - values[:, -1:]) / 5.
    return np.stack([absolute, relative], axis=-1).astype(np.float32)


class TemperatureGRU(nn.Module):
    def __init__(self, hidden_size=32, layers=1):
        super().__init__()
        self.gru = nn.GRU(2, hidden_size, num_layers=layers, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden_size + 1, hidden_size), nn.SiLU(), nn.Linear(hidden_size, 3))

    def forward(self, x):
        sequence, _ = self.gru(x)
        context = torch.cat([sequence[:, -1, :], x[:, -1, 0:1]], dim=1)
        return self.head(context)


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.use_deterministic_algorithms(True)


def predict_gru(model, frame, normalizer, device, batch_size=4096):
    inputs = sequence_inputs(frame, normalizer)
    predicted = []
    model.eval()
    with torch.inference_mode():
        for start in range(0, len(inputs), batch_size):
            x = torch.from_numpy(inputs[start:start + batch_size]).to(device)
            predicted.append(model(x).cpu().numpy())
    return np.concatenate(predicted).astype(np.float64) + frame.temperature.to_numpy()[:, None]


def sequence_metrics(frame, predictions):
    predictions = np.asarray(predictions, dtype=float)
    if predictions.shape != (len(frame), 3) or not np.isfinite(predictions).all():
        raise ValueError("Expected three finite future-temperature predictions per row")
    actual = frame[TARGETS].to_numpy()
    point = room_metrics(frame, predictions[:, 2])
    result = {"horizons": {str(m): regression(actual[:, i], predictions[:, i])
                           for i, m in enumerate(HORIZONS)},
              "endpoint_15m": point, "window": {"rooms": {}}}
    for name, (low, high) in ROOMS.items():
        mask = frame.temperature.between(low, high).to_numpy()
        observed = np.any((actual[mask] < low) | (actual[mask] > high), axis=1)
        predicted = np.any((predictions[mask] < low) | (predictions[mask] > high), axis=1)
        result["window"]["rooms"][name] = {
            **classification(observed, predicted),
            "sources": int(frame.loc[mask, "refrigerator"].nunique()),
            "horizons": {str(m): regression(actual[mask, i], predictions[mask, i])
                         for i, m in enumerate(HORIZONS)},
        }
    result["window"]["macro"] = {
        key: float(np.mean([item[key] for item in result["window"]["rooms"].values()
                            if item[key] is not None]))
        for key in ["recall", "precision", "false_positive_rate", "f1"]
    }
    return result


def warning_gate(baseline, candidate):
    before, after = baseline["macro"], candidate["macro"]
    checks = {
        "recall_gain_at_least_2_points": after["recall"] >= before["recall"] + .02,
        "macro_fpr_increase_at_most_half_point": after["false_positive_rate"] <= before["false_positive_rate"] + .005,
        "each_room_fpr_increase_at_most_1_point": all(
            candidate["rooms"][name]["false_positive_rate"] <= item["false_positive_rate"] + .01
            for name, item in baseline["rooms"].items()),
    }
    return {"passed": all(checks.values()), "checks": checks}


def forecast_gate(baseline, candidate):
    before, after = baseline["macro"], candidate["macro"]
    checks = {
        "macro_mae_reduction_at_least_1_percent": after["mae"] <= before["mae"] * .99,
        "macro_p95_increase_at_most_5_percent": after["p95_absolute_error"] <= before["p95_absolute_error"] * 1.05,
        "each_room_mae_increase_at_most_5_percent": all(
            candidate["rooms"][name]["mae"] <= item["mae"] * 1.05
            for name, item in baseline["rooms"].items()),
    }
    return {"passed": all(checks.values()), "checks": checks}


def train_gru(train, validation, config, seed, args, checkpoint, fixed_epochs=None):
    set_seed(seed)
    normalizer = fit_normalizer(train)
    inputs = torch.from_numpy(sequence_inputs(train, normalizer)).to(args.device)
    targets = torch.from_numpy((train[TARGETS].to_numpy() - train.temperature.to_numpy()[:, None]).astype(np.float32)).to(args.device)
    model = TemperatureGRU(config["hidden_size"], config["layers"]).to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config["learning_rate"], weight_decay=.0001)
    loss_fn = nn.L1Loss()
    best, best_epoch, best_state, stale = float("inf"), 0, None, 0
    history = []
    started = time.perf_counter()
    epochs = fixed_epochs or args.max_epochs
    for epoch in range(1, epochs + 1):
        model.train()
        order = torch.randperm(len(train), device=args.device)
        loss_sum = 0.
        for start in range(0, len(train), args.batch_size):
            index = order[start:start + args.batch_size]
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(inputs[index]), targets[index])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            optimizer.step()
            loss_sum += float(loss.detach()) * len(index)
        entry = {"epoch": epoch, "train_multi_horizon_mae": loss_sum / len(train)}
        if validation is not None:
            prediction = predict_gru(model, validation, normalizer, args.device)
            score = room_metrics(validation, prediction[:, 2])["macro"]["mae"]
            entry["validation_macro_mae_15m"] = score
            if score < best - 1e-5:
                best, best_epoch, stale = score, epoch, 0
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
            else:
                stale += 1
        history.append(entry)
        print(json.dumps({"training": checkpoint.stem, **entry}), flush=True)
        if validation is not None and stale >= args.patience:
            break
    if validation is not None:
        model.load_state_dict(best_state)
    else:
        best_epoch = epochs
    info = {"seed": seed, "config": config, "normalizer": normalizer,
            "train_samples": len(train), "validation_samples": 0 if validation is None else len(validation),
            "best_epoch": best_epoch, "epochs_run": len(history), "history": history,
            "seconds": time.perf_counter() - started,
            "parameters": sum(parameter.numel() for parameter in model.parameters())}
    torch.save({"state_dict": {key: value.detach().cpu() for key, value in model.state_dict().items()},
                "normalizer": normalizer, "config": config, "seed": seed,
                "epochs": best_epoch, "input_schema": "13-temperature-readings-5min-v1",
                "output_schema": "temperature-deltas-5-10-15min-v1"}, checkpoint)
    return model, info


def tune_gru(train, validation, args, output, prefix):
    trials = {}
    for name, config in GRU_CONFIGS.items():
        model, info = train_gru(train, validation, config, FINAL_SEEDS[0], args, output / f"{prefix}_{name}_validation.pt")
        predictions = predict_gru(model, validation, info["normalizer"], args.device)
        trials[name] = {"training": info, "evaluation": sequence_metrics(validation, predictions)}
        del model
        if args.device == "cuda":
            torch.cuda.empty_cache()
    selected = min(trials, key=lambda name: trials[name]["evaluation"]["endpoint_15m"]["macro"]["mae"])
    return selected, trials


def fit_hgb(reference, train, test, output, prefix):
    predictions, timings, models = [], {}, {}
    for target in TARGETS:
        model = clone(reference)
        started = time.perf_counter()
        model.fit(train[FEATURE_NAMES], train[target] - train.temperature)
        predictions.append(model.predict(test[FEATURE_NAMES]) + test.temperature.to_numpy())
        timings[target] = {"seconds": time.perf_counter() - started, "iterations": int(model.n_iter_)}
        models[target] = model
        print(json.dumps({"hgb": prefix, "target": target, **timings[target]}), flush=True)
    joblib.dump({"models": models, "feature_names": FEATURE_NAMES}, output / f"{prefix}_hgb.joblib", compress=3)
    return np.column_stack(predictions), timings


def point_warning(metrics):
    return {"macro": metrics["macro"]["window_alerts"],
            "rooms": {name: room["window_alerts"] for name, room in metrics["rooms"].items()}}


def compare_models(frame, hgb, predictions):
    point = room_metrics(frame, hgb[:, 2])
    multi = sequence_metrics(frame, hgb)
    result = {"hgb_15m": point, "hgb_multi": multi, "gru": {}, "gates": {}}
    for name, prediction in predictions.items():
        metrics = sequence_metrics(frame, prediction)
        result["gru"][name] = metrics
        result["gates"][name] = {
            "forecast_vs_hgb_15m": forecast_gate(point, metrics["endpoint_15m"]),
            "warning_vs_hgb_15m": warning_gate(point_warning(point), metrics["window"]),
            "warning_vs_hgb_multi": warning_gate(multi["window"], metrics["window"]),
        }
    result["seed_summary"] = {}
    for metric, getter in {
        "macro_mae_15m": lambda m: m["endpoint_15m"]["macro"]["mae"],
        "macro_recall": lambda m: m["window"]["macro"]["recall"],
        "macro_fpr": lambda m: m["window"]["macro"]["false_positive_rate"],
    }.items():
        values = [getter(m) for m in result["gru"].values()]
        result["seed_summary"][metric] = {"mean": float(np.mean(values)), "std": float(np.std(values)),
                                          "min": float(min(values)), "max": float(max(values))}
    return result


def render_report(result):
    lines = ["# GRU multi-horizon temperature-sequence experiment", "",
             "Public Bangkok data; no real cold-room accuracy claim. Source channel labels are provenance only.", "",
             "- Inputs: exactly 13 readings from t-60 to t, at 5-minute cadence. No future values in inputs.",
             "- Outputs: temperature changes at t+5, t+10, t+15, added back to the current temperature.",
             "- HGB point control uses t+15 only; HGB multi and GRU warn if any of the three predictions breaches a room bound.",
             "- All models use identical evaluation rows and four overlapping room presets. Metrics are macro averages per preset.",
             "- Warning labels: at least one observed future reading out of bounds, only while current temperature is in range.",
             "- Source evaluation reuses the previous 98-development/25-test split. This dataset/test set was researched before.",
             "- GRU hidden size and epoch count are selected on held-out development sources; normalization fits training data only.",
             "- Final GRUs refit all development sources for the fixed selected epoch count. Every predefined seed is reported.",
             "- Temporal replay independently tunes on the middle segment; training/validation future labels cannot cross boundaries.",
             "- Seed repeats are not independent test sets. Temporal replay uses known source histories, not unseen warehouses.",
             "- Gates: forecasting MAE >=1% lower, P95 <=5% worse, each preset MAE <=5% worse; warning recall >=2 points higher, macro FPR <=0.5 points worse, each preset FPR <=1 point worse.",
             "- These are coursework comparison gates, not food-storage safety limits. No runtime model is changed.", ""]
    for name in ["source", "temporal"]:
        if name not in result or "evaluation" not in result[name]:
            continue
        entry = result[name]
        lines += [f"## {name.capitalize()} evaluation", "",
                  f"Selected on validation: **{entry['selected']}**, **{entry['selected_epochs']} epochs**.", "",
                  "| Model | Room MAE at 15m (C) | P95 at 15m (C) | Within 1 C | Window recall | Window FPR | Window precision |",
                  "|---|---:|---:|---:|---:|---:|---:|"]
        evaluation = entry["evaluation"]
        rows = [("HGB endpoint 15m", evaluation["hgb_15m"], point_warning(evaluation["hgb_15m"])),
                ("HGB multi 5/10/15m", evaluation["hgb_multi"]["endpoint_15m"], evaluation["hgb_multi"]["window"])]
        rows += [(f"GRU seed {seed}", metric["endpoint_15m"], metric["window"])
                 for seed, metric in evaluation["gru"].items()]
        for label, forecast, warning in rows:
            f, w = forecast["macro"], warning["macro"]
            lines.append(f"| {label} | {f['mae']:.4f} | {f['p95_absolute_error']:.4f} | {f['within_1c']:.2%} | {w['recall']:.2%} | {w['false_positive_rate']:.2%} | {w['precision']:.2%} |")
        lines += ["", "### Per-room warning results", "",
                  "| Model | Room | Recall | FPR | Precision |", "|---|---|---:|---:|---:|"]
        for label, _, warning in rows:
            for room, metric in warning["rooms"].items():
                fmt = lambda value: "undefined" if value is None else f"{value:.2%}"
                lines.append(f"| {label} | {room} | {fmt(metric['recall'])} | {fmt(metric['false_positive_rate'])} | {fmt(metric['precision'])} |")
        lines += ["", "### Promotion gates", "", "```json", json.dumps(evaluation["gates"], indent=2), "```", ""]
    lines += ["## Reproducibility", "", "Full source hashes, source lists, epoch histories, normalization, seeds, environment and scores are in metrics.json.",
              "Predictions are saved in predictions.npz; evaluated model weights are separate artifacts.",
              "Warning scores count overlapping time samples, not independent incidents or actual mobile notifications.",
              "Only samples at t+5/t+10/t+15 are observed; temperatures between these readings are unknown.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--split-report", type=Path, default=SERVICE / "experiments/results/room-forecast-2026-10-17/metrics.json")
    parser.add_argument("--reference-model", type=Path, default=SERVICE / "temperature_model_history.pkl")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--max-epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.output_dir.exists() or min(args.max_epochs, args.patience, args.batch_size, args.threads) < 1:
        parser.error("Use a new output directory and positive training arguments")
    if args.device == "auto":
        args.device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    protected = [args.reference_model, SERVICE / "temperature_model_history.json", SERVICE / "ai_service.py"]
    original_hashes = {str(path): sha256(path) for path in protected}
    old_report = json.loads(args.split_report.read_text(encoding="utf-8"))
    frame, sources = load_sequence_data(args.raw_dir.resolve())
    if sources != old_report["dataset"]["sources"]:
        raise ValueError("Raw source manifest changed from the matched HGB experiment")
    dev_sources, test_sources = old_report["split"]["development_sources"], old_report["split"]["holdout_sources"]
    if set(dev_sources) & set(test_sources) or set(frame.refrigerator.unique()) != set(dev_sources) | set(test_sources):
        raise ValueError("Invalid source split")
    development = frame.loc[frame.refrigerator.isin(dev_sources)].reset_index(drop=True)
    test = frame.loc[frame.refrigerator.isin(test_sources)].reset_index(drop=True)
    fit_idx, valid_idx = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=20261031).split(development, groups=development.refrigerator))
    fit_frame, valid_frame = development.iloc[fit_idx], development.iloc[valid_idx]
    reference = joblib.load(args.reference_model)["model"]
    params = reference.get_params()
    if params["max_iter"] != 500 or params["max_leaf_nodes"] != 63 or params["loss"] != "absolute_error":
        raise ValueError("Expected the selected HGB500 absolute-error control")
    result = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset": {"sources": sources, "rows": len(frame), "source_count": len(sources)},
        "environment": {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.version.cuda,
                        "device": args.device, "gpu": torch.cuda.get_device_name(0) if args.device == "cuda" else None,
                        "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__},
        "protocol": {"gru_configs": GRU_CONFIGS, "final_seeds": FINAL_SEEDS, "selection": "lowest validation macro room MAE at 15m",
                     "max_epochs": args.max_epochs, "patience": args.patience, "batch_size": args.batch_size,
                     "loss": "mean L1 over temperature deltas at 5,10,15 minutes", "hgb_parameters": params,
                     "source_validation_seed": 20261031, "threads": args.threads},
        "protected_before": original_hashes,
        "source": {"development_sources": dev_sources, "test_sources": test_sources,
                   "fit_sources": sorted(fit_frame.refrigerator.unique()), "validation_sources": sorted(valid_frame.refrigerator.unique()),
                   "development_rows": len(development), "test_rows": len(test)},
    }
    output = args.output_dir
    output.mkdir(parents=True)
    def save():
        dump(output / "metrics.json", result)
        (output / "report.md").write_text(render_report(result), encoding="utf-8")
    save()
    predictions = {}
    with threadpool_limits(limits=args.threads):
        print("Source validation: selecting GRU size and epoch count", flush=True)
        selected, trials = tune_gru(fit_frame, valid_frame, args, output, "source")
        epochs = trials[selected]["training"]["best_epoch"]
        result["source"].update(selected=selected, selected_epochs=epochs, validation_trials=trials)
        save()
        hgb, timing = fit_hgb(reference, development, test, output, "source")
        # This exact endpoint control must reproduce the previous benchmark.
        expected = old_report["holdout"]["evaluations"]["slow_500"]["macro"]["mae"]
        observed = room_metrics(test, hgb[:, 2])["macro"]["mae"]
        if not np.isclose(expected, observed, atol=1e-9, rtol=0):
            raise ValueError(f"HGB control did not reproduce: {observed} != {expected}")
        result["source"]["hgb_training"] = timing
        result["source"]["hgb_reproduction_mae"] = observed
        gru_predictions, training = {}, {}
        for seed in FINAL_SEEDS:
            model, info = train_gru(development, None, GRU_CONFIGS[selected], seed, args,
                                    output / f"source_gru_{seed}.pt", fixed_epochs=epochs)
            gru_predictions[str(seed)] = predict_gru(model, test, info["normalizer"], args.device)
            training[str(seed)] = info
            del model
        result["source"]["gru_training"] = training
        result["source"]["evaluation"] = compare_models(test, hgb, gru_predictions)
        predictions.update(source_hgb=hgb, source_actual=test[TARGETS].to_numpy(), source_current=test.temperature.to_numpy(),
                           source_id=test.refrigerator.to_numpy(dtype=str), source_channel=test.compartment.to_numpy(dtype=str),
                           source_time=test.elapsed_minutes.to_numpy())
        predictions.update({f"source_gru_{key}": value for key, value in gru_predictions.items()})
        save()
        np.savez_compressed(output / "predictions.npz", **predictions)
        positions = temporal_positions(frame)
        temporal_fit, temporal_validation = frame.iloc[positions["fit"]], frame.iloc[positions["validation"]]
        temporal_train, temporal_test = frame.iloc[positions["final_train"]], frame.iloc[positions["test"]]
        result["temporal"] = {key + "_rows": len(value) for key, value in positions.items()}
        print("Temporal validation: selecting independently before final-time test", flush=True)
        selected, trials = tune_gru(temporal_fit, temporal_validation, args, output, "temporal")
        epochs = trials[selected]["training"]["best_epoch"]
        result["temporal"].update(selected=selected, selected_epochs=epochs, validation_trials=trials)
        save()
        hgb, timing = fit_hgb(reference, temporal_train, temporal_test, output, "temporal")
        seed = FINAL_SEEDS[0]
        model, info = train_gru(temporal_train, None, GRU_CONFIGS[selected], seed, args,
                                output / f"temporal_gru_{seed}.pt", fixed_epochs=epochs)
        prediction = predict_gru(model, temporal_test, info["normalizer"], args.device)
        result["temporal"]["hgb_training"] = timing
        result["temporal"]["gru_training"] = {str(seed): info}
        result["temporal"]["evaluation"] = compare_models(temporal_test, hgb, {str(seed): prediction})
        predictions.update(temporal_hgb=hgb, temporal_gru=prediction, temporal_actual=temporal_test[TARGETS].to_numpy(),
                           temporal_current=temporal_test.temperature.to_numpy(), temporal_id=temporal_test.refrigerator.to_numpy(dtype=str),
                           temporal_channel=temporal_test.compartment.to_numpy(dtype=str), temporal_time=temporal_test.elapsed_minutes.to_numpy())
        np.savez_compressed(output / "predictions.npz", **predictions)
        result["protected_after"] = {str(path): sha256(path) for path in protected}
        if result["protected_after"] != original_hashes:
            raise RuntimeError("A protected runtime file changed")
        result["completed_at"] = datetime.now(timezone.utc).isoformat()
        save()
        print(json.dumps({name: result[name]["evaluation"]["seed_summary"] for name in ["source", "temporal"]}), flush=True)
        print("Report: " + str(output / "report.md"), flush=True)


if __name__ == "__main__":
    main()
