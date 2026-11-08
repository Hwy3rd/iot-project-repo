"""Matched 15-minute forecast ablation: all temperature lags and single-head GRU.

Public Bangkok data and previously researched test partitions. Offline only.
"""
from __future__ import annotations

import argparse
import gc
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
import torch
from sklearn.base import clone
from threadpoolctl import threadpool_limits
from torch import nn

from room_sequence_gru import (FEATURE_NAMES, FINAL_SEEDS, GRU_CONFIGS, HISTORY,
                               SERVICE, TARGETS, dump, fit_normalizer, forecast_gate,
                               load_sequence_data, room_metrics, sequence_inputs,
                               set_seed, sha256, temporal_positions)

EXTRA_LAGS = [f"history_{minutes}m" for minutes in [25, 35, 40, 50, 55]]
EXTENDED_FEATURES = [*FEATURE_NAMES, *EXTRA_LAGS]
GRU_COLUMNS = [*HISTORY, "temperature", "future_temp_15m", "future_min_15m", "future_max_15m", "refrigerator"]


def hgb_inputs(frame):
    """The 22 original features plus the 5 missing raw lags; no duplicate lags."""
    inputs = frame[EXTENDED_FEATURES]
    if inputs.columns.duplicated().any() or not np.isfinite(inputs.to_numpy()).all():
        raise ValueError("Invalid extended HGB features")
    return inputs


def endpoint_targets(frame):
    return (frame.future_temp_15m.to_numpy() - frame.temperature.to_numpy()).astype(np.float32).reshape(-1, 1)


class EndpointGRU(nn.Module):
    """Same input/hidden architecture as the previous GRU, one output only."""
    def __init__(self, hidden_size=32, layers=1):
        super().__init__()
        self.gru = nn.GRU(2, hidden_size, num_layers=layers, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden_size + 1, hidden_size), nn.SiLU(), nn.Linear(hidden_size, 1))

    def forward(self, x):
        sequence, _ = self.gru(x)
        return self.head(torch.cat([sequence[:, -1, :], x[:, -1, 0:1]], dim=1))


def predict_endpoint(model, frame, normalizer, device, batch_size=4096):
    values = sequence_inputs(frame, normalizer)
    return predict_values(model, values, frame.temperature.to_numpy(), device, batch_size)


def predict_values(model, values, current, device, batch_size=4096):
    predictions = []
    model.eval()
    with torch.inference_mode():
        for start in range(0, len(values), batch_size):
            x = torch.from_numpy(values[start:start + batch_size]).to(device)
            predictions.append(model(x).cpu().numpy()[:, 0])
    return np.concatenate(predictions).astype(np.float64) + current


def train_endpoint(train, validation, config, seed, args, checkpoint, fixed_epochs=None):
    set_seed(seed)
    normalizer = fit_normalizer(train)
    validation_values = None if validation is None else sequence_inputs(validation, normalizer)
    validation_current = None if validation is None else validation.temperature.to_numpy()
    inputs = torch.from_numpy(sequence_inputs(train, normalizer)).to(args.device)
    targets = torch.from_numpy(endpoint_targets(train)).to(args.device)
    model = EndpointGRU(config["hidden_size"], config["layers"]).to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=config["learning_rate"], weight_decay=.0001)
    loss_fn = nn.L1Loss()
    best, best_epoch, best_state, stale = float("inf"), 0, None, 0
    history = []
    started = time.perf_counter()
    for epoch in range(1, (fixed_epochs or args.max_epochs) + 1):
        model.train()
        order = torch.randperm(len(train), device=args.device)
        train_loss = 0.
        for start in range(0, len(train), args.batch_size):
            index = order[start:start + args.batch_size]
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(inputs[index]), targets[index])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            optimizer.step()
            train_loss += float(loss.detach()) * len(index)
        entry = {"epoch": epoch, "train_mae_15m": train_loss / len(train)}
        if validation is not None:
            prediction = predict_values(model, validation_values, validation_current, args.device)
            score = room_metrics(validation, prediction)["macro"]["mae"]
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
        best_epoch = fixed_epochs
    info = {"seed": seed, "config": config, "normalizer": normalizer, "history": history,
            "best_epoch": best_epoch, "epochs_run": len(history), "train_samples": len(train),
            "seconds": time.perf_counter() - started,
            "parameters": sum(parameter.numel() for parameter in model.parameters())}
    torch.save({"state_dict": {key: value.detach().cpu() for key, value in model.state_dict().items()},
                "config": config, "normalizer": normalizer, "seed": seed, "epochs": best_epoch,
                "input_schema": "13-temperature-readings-5min-v1",
                "output_schema": "temperature-delta-15min-v1"}, checkpoint)
    return model, info


def select_gru(fit, validation, args, output, phase):
    trials = {}
    for name, config in GRU_CONFIGS.items():
        model, timing = train_endpoint(fit, validation, config, FINAL_SEEDS[0], args,
                                       output / f"{phase}_{name}_validation.pt")
        prediction = predict_endpoint(model, validation, timing["normalizer"], args.device)
        trials[name] = {"training": timing, "evaluation": room_metrics(validation, prediction)}
        del model
        if args.device == "cuda":
            torch.cuda.empty_cache()
    chosen = min(trials, key=lambda name: trials[name]["evaluation"]["macro"]["mae"])
    return chosen, trials


def summarize(metrics):
    result = {}
    for key in ["mae", "p95_absolute_error", "within_1c"]:
        values = [entry["macro"][key] for entry in metrics.values()]
        result[key] = {"mean": float(np.mean(values)), "std": float(np.std(values)),
                       "min": float(min(values)), "max": float(max(values))}
    return result


def old_controls(prior, saved, phase, test):
    for field, actual in [("actual", test[TARGETS].to_numpy()), ("current", test.temperature.to_numpy()),
                          ("id", test.refrigerator.to_numpy(dtype=str)), ("channel", test.compartment.to_numpy(dtype=str)),
                          ("time", test.elapsed_minutes.to_numpy())]:
        np.testing.assert_array_equal(saved[phase + "_" + field], actual)
    baseline = saved[phase + "_hgb"][:, 2]
    metric = room_metrics(test, baseline)
    if json.dumps(metric, sort_keys=True) != json.dumps(prior[phase]["evaluation"]["hgb_15m"], sort_keys=True):
        raise ValueError("Cached HGB control did not reproduce")
    seeds = FINAL_SEEDS if phase == "source" else FINAL_SEEDS[:1]
    gru = {str(seed): saved[f"source_gru_{seed}" if phase == "source" else "temporal_gru"][:, 2]
           for seed in seeds}
    return baseline, gru


def render_report(result):
    lines = ["# Forecast ablation: complete temperature lags and single-target GRU", "",
             "Offline public Bangkok observations, not measured cold-room performance.", "",
             "- Primary objective: temperature at t+15 minutes. Every model is scored on the same rows.",
             "- HGB extension: append only raw lags 25/35/40/50/55 minutes to the 22 original features (27 total).",
             "- GRU extension: one temperature-change output and L1 at 15 minutes; other input, optimizer and search settings match the previous trial.",
             "- GRU width 32/64 and epoch count use only validation. All three predefined seeds are reported in BOTH evaluations.",
             "- Source partitions, validation source lists and temporal boundaries match the previous experiment.",
             "- HGB control and multi-head GRU predictions are reused only after checking labels and source/channel/time keys.",
             "- HGB hyperparameters remain fixed, including its existing internal early_stopping='auto'.",
             "- Normalization uses training data only. Future labels cannot cross temporal split boundaries.",
             "- Both channels of one physical source stay together. Channel/source identifiers are never model inputs.",
             "- Previous multi-head GRU is scored at its 15-minute output here; its three-horizon warning union is not reused.",
             "- MAE/P95/within-1C are macro averages over four overlapping room presets while current temperature is in range.",
             "- Improvement gate: MAE at least 1% lower, macro P95 at most 5% worse and each preset MAE at most 5% worse.",
             "- Source test data have been researched repeatedly; this is exploratory evaluation, not a fresh independent test.",
             "- Temporal replay uses later data of known sources. Seeds are not independent test sets.",
             "- No runtime/API/production model is replaced.", ""]
    for phase in ["source", "temporal"]:
        entry = result.get(phase, {})
        if "evaluation" not in entry:
            continue
        evaluation = entry["evaluation"]
        lines += [f"## {phase.capitalize()} evaluation", "",
                  f"GRU chosen on validation: **{entry['selected']}**, **{entry['selected_epochs']} epochs**.", "",
                  "| Model | MAE 15m (C) | P95 (C) | Within 1 C |", "|---|---:|---:|---:|"]
        rows = [("HGB original 22 features", evaluation["hgb_control"]),
                ("HGB complete lags, 27 features", evaluation["hgb_full_lags"])]
        rows += [(f"Previous multi-head GRU seed {seed}", metric)
                 for seed, metric in evaluation["gru_multi_control"].items()]
        rows += [(f"Single-target GRU seed {seed}", metric)
                 for seed, metric in evaluation["gru_single"].items()]
        for name, metric in rows:
            m = metric["macro"]
            lines.append(f"| {name} | {m['mae']:.6f} | {m['p95_absolute_error']:.6f} | {m['within_1c']:.2%} |")
        summary = evaluation["gru_single_summary"]
        lines += [f"| Single-target GRU mean (3 seeds) | {summary['mae']['mean']:.6f} | {summary['p95_absolute_error']['mean']:.6f} | {summary['within_1c']['mean']:.2%} |", "",
                  "### Per-room MAE", "", "| Model | " + " | ".join(evaluation["hgb_control"]["rooms"]) + " |",
                  "|---|" + "|".join(["---:"] * 4) + "|"]
        for name, metric in rows:
            lines.append("| " + name + " | " + " | ".join(f"{room['mae']:.6f}" for room in metric["rooms"].values()) + " |")
        lines += ["", "### Gates against the original HGB point control", "", "```json", json.dumps(evaluation["gates"], indent=2), "```", ""]
    if "decision" in result:
        lines += ["## Combined decision", "", "```json", json.dumps(result["decision"], indent=2), "```", ""]
    lines += ["## Reproducibility", "",
              "metrics.json includes raw source hashes, exact split lists, runtime/input hashes, seed histories and environment versions.",
              "predictions.npz and saved model weights permit replay using --verify-only. verification.json records the checks.",
              "Threshold-alert metrics in metrics.json are secondary diagnostics of each 15-minute output; this experiment selects models for regression.", ""]
    return "\n".join(lines)


def verify_result(output, raw_dir, device):
    result = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    if "completed_at" not in result:
        raise ValueError("Incomplete experiment")
    frame, sources = load_sequence_data(raw_dir)
    assert sources == result["dataset"]["sources"]
    assert result["protected_before"] == result["protected_after"]
    for path, digest in result["protected_before"].items():
        assert sha256(path) == digest
    prior = json.loads(Path(result["prior_metrics"]).read_text(encoding="utf-8"))
    previous_predictions = np.load(result["prior_predictions"], allow_pickle=False)
    saved = np.load(output / "predictions.npz", allow_pickle=False)
    verified = {"runtime_and_prior_artifacts_unchanged": True, "source_manifest_verified": True}
    for phase in ["source", "temporal"]:
        if phase == "source":
            test = frame.loc[frame.refrigerator.isin(prior["source"]["test_sources"])]
        else:
            test = frame.iloc[temporal_positions(frame)["test"]]
        control, _ = old_controls(prior, previous_predictions, phase, test)
        np.testing.assert_array_equal(control, saved[phase + "_hgb_control"])
        artifact = joblib.load(output / f"{phase}_hgb_full_lags.joblib")
        assert list(artifact["model"].feature_names_in_) == EXTENDED_FEATURES
        replay_hgb = artifact["model"].predict(hgb_inputs(test)) + test.temperature.to_numpy()
        np.testing.assert_array_equal(replay_hgb, saved[phase + "_hgb_full_lags"])
        evaluation = result[phase]["evaluation"]
        assert json.dumps(room_metrics(test, replay_hgb), sort_keys=True) == json.dumps(evaluation["hgb_full_lags"], sort_keys=True)
        max_difference = 0.
        for seed in FINAL_SEEDS:
            checkpoint = torch.load(output / f"{phase}_gru_single_{seed}.pt", map_location="cpu", weights_only=True)
            assert checkpoint["epochs"] == result[phase]["selected_epochs"]
            assert checkpoint["output_schema"] == "temperature-delta-15min-v1"
            set_seed(seed)
            model = EndpointGRU(checkpoint["config"]["hidden_size"], checkpoint["config"]["layers"]).to(device)
            model.load_state_dict(checkpoint["state_dict"])
            replay = predict_endpoint(model, test, checkpoint["normalizer"], device)
            prediction = saved[f"{phase}_gru_single_{seed}"]
            max_difference = max(max_difference, float(np.max(np.abs(replay - prediction))))
            np.testing.assert_allclose(replay, prediction, atol=1e-5, rtol=0)
            assert json.dumps(room_metrics(test, prediction), sort_keys=True) == json.dumps(evaluation["gru_single"][str(seed)], sort_keys=True)
            del model
        verified[phase] = {"samples": len(test), "hgb_replay_exact": True,
                           "gru_seeds_replayed": FINAL_SEEDS,
                           "max_gru_replay_absolute_difference": max_difference, "metrics_recomputed_exact": True}
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prior-dir", type=Path, default=SERVICE / "experiments/results/room-sequence-gru-2026-10-31")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    parser.add_argument("--max-epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if min(args.max_epochs, args.patience, args.batch_size, args.threads) < 1:
        parser.error("Training arguments must be positive")
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    output = args.output_dir.resolve()
    with threadpool_limits(limits=args.threads):
        if args.verify_only:
            verification = verify_result(output, args.raw_dir.resolve(), args.device)
            dump(output / "verification.json", verification)
            print(json.dumps(verification, indent=2))
            return
        if output.exists():
            parser.error("Use a new output directory")
        prior_metrics = (args.prior_dir / "metrics.json").resolve()
        prior_predictions = (args.prior_dir / "predictions.npz").resolve()
        prior = json.loads(prior_metrics.read_text(encoding="utf-8"))
        if "completed_at" not in prior:
            raise ValueError("Previous experiment incomplete")
        frame, sources = load_sequence_data(args.raw_dir.resolve())
        if sources != prior["dataset"]["sources"]:
            raise ValueError("Dataset differs from the controls")
        reference_path = SERVICE / "temperature_model_history.pkl"
        protected = [reference_path, SERVICE / "temperature_model_history.json", SERVICE / "ai_service.py",
                     SERVICE / "temperature_features.py", Path(__file__), Path(__file__).with_name("room_sequence_gru.py"),
                     Path(__file__).with_name("room_forecast.py"), prior_metrics, prior_predictions]
        before = {str(path): sha256(path) for path in protected}
        if before[str(reference_path)] != prior["protected_before"][str(reference_path)]:
            raise ValueError("Runtime reference changed since the matched control experiment")
        reference = clone(joblib.load(reference_path)["model"])
        previous_predictions = np.load(prior_predictions, allow_pickle=False)
        assert not set(prior["source"]["fit_sources"]) & set(prior["source"]["validation_sources"])
        assert not set(prior["source"]["development_sources"]) & set(prior["source"]["test_sources"])
        phases = ["source", "temporal"]
        result = {
            "created_at": datetime.now(timezone.utc).isoformat(), "prior_metrics": str(prior_metrics),
            "prior_predictions": str(prior_predictions), "dataset": {"sources": sources, "rows": len(frame)},
            "protected_before": before,
            "environment": {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.version.cuda, "device": args.device,
                            "gpu": torch.cuda.get_device_name(0) if args.device == "cuda" else None,
                            "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "joblib": joblib.__version__},
            "protocol": {"objective": "15-minute point forecast", "hgb_features": EXTENDED_FEATURES,
                         "added_lags": EXTRA_LAGS, "hgb_parameters": reference.get_params(),
                         "gru_configs": GRU_CONFIGS, "seeds_each_phase": FINAL_SEEDS, "max_epochs": args.max_epochs,
                         "patience": args.patience, "batch_size": args.batch_size, "loss": "L1 at 15 minutes only",
                         "selection": "lowest validation macro room MAE", "source_split": prior["source"]["development_sources"],
                         "source_validation": prior["source"]["validation_sources"], "source_test": prior["source"]["test_sources"]},
        }
        output.mkdir(parents=True)
        def save():
            dump(output / "metrics.json", result)
            (output / "report.md").write_text(render_report(result), encoding="utf-8")
        save()
        predictions = {}
        for phase in phases:
            # Materialize one evaluation at a time; fit/validation need no HGB columns.
            if phase == "source":
                fit = frame.loc[frame.refrigerator.isin(prior["source"]["fit_sources"]), GRU_COLUMNS]
                validation = frame.loc[frame.refrigerator.isin(prior["source"]["validation_sources"]), GRU_COLUMNS]
                train = frame.loc[frame.refrigerator.isin(prior["source"]["development_sources"])]
                test = frame.loc[frame.refrigerator.isin(prior["source"]["test_sources"])]
            else:
                positions = temporal_positions(frame)
                columns = frame.columns.get_indexer(GRU_COLUMNS)
                fit = frame.iloc[positions["fit"], columns]
                validation = frame.iloc[positions["validation"], columns]
                train = frame.iloc[positions["final_train"]]
                test = frame.iloc[positions["test"]]
            print(f"{phase}: GRU single-target validation", flush=True)
            chosen, trials = select_gru(fit, validation, args, output, phase)
            epochs = trials[chosen]["training"]["best_epoch"]
            result[phase] = {"selected": chosen, "selected_epochs": epochs, "validation_trials": trials,
                             "fit_samples": len(fit), "validation_samples": len(validation),
                             "train_samples": len(train), "test_samples": len(test)}
            save()
            del fit, validation
            gc.collect()
            control, old_gru = old_controls(prior, previous_predictions, phase, test)
            print(f"{phase}: HGB with five additional lags", flush=True)
            started = time.perf_counter()
            hgb = clone(reference)
            hgb.fit(hgb_inputs(train), train.future_temp_15m - train.temperature)
            extended = hgb.predict(hgb_inputs(test)) + test.temperature.to_numpy()
            result[phase]["hgb_training"] = {"seconds": time.perf_counter() - started,
                                             "iterations": int(hgb.n_iter_), "features": EXTENDED_FEATURES}
            joblib.dump({"model": hgb, "features": EXTENDED_FEATURES}, output / f"{phase}_hgb_full_lags.joblib", compress=3)
            evaluation = {"hgb_control": room_metrics(test, control), "hgb_full_lags": room_metrics(test, extended),
                          "gru_multi_control": {seed: room_metrics(test, prediction) for seed, prediction in old_gru.items()},
                          "gru_single": {}}
            gru_training = {}
            for seed in FINAL_SEEDS:
                model, info = train_endpoint(train, None, GRU_CONFIGS[chosen], seed, args,
                                              output / f"{phase}_gru_single_{seed}.pt", fixed_epochs=epochs)
                prediction = predict_endpoint(model, test, info["normalizer"], args.device)
                evaluation["gru_single"][str(seed)] = room_metrics(test, prediction)
                gru_training[str(seed)] = info
                predictions[f"{phase}_gru_single_{seed}"] = prediction
                del model
            evaluation["gru_single_summary"] = summarize(evaluation["gru_single"])
            evaluation["gates"] = {"hgb_full_lags": forecast_gate(evaluation["hgb_control"], evaluation["hgb_full_lags"]),
                                   "gru_single": {seed: forecast_gate(evaluation["hgb_control"], metric)
                                                  for seed, metric in evaluation["gru_single"].items()}}
            result[phase].update(evaluation=evaluation, gru_training=gru_training)
            predictions.update({f"{phase}_hgb_control": control, f"{phase}_hgb_full_lags": extended})
            save()
            np.savez_compressed(output / "predictions.npz", **predictions)
            del train, test, hgb, extended, control, old_gru
            gc.collect()
        result["decision"] = {
            "hgb_full_lags_passes_both_evaluations": all(result[p]["evaluation"]["gates"]["hgb_full_lags"]["passed"] for p in phases),
            "gru_single_all_seeds_pass_both_evaluations": all(gate["passed"] for p in phases for gate in result[p]["evaluation"]["gates"]["gru_single"].values()),
        }
        result["protected_after"] = {str(path): sha256(path) for path in protected}
        if result["protected_after"] != before:
            raise RuntimeError("A protected runtime or prior artifact changed")
        result["completed_at"] = datetime.now(timezone.utc).isoformat()
        save()
        del frame, predictions
        gc.collect()
        verification = verify_result(output, args.raw_dir.resolve(), args.device)
        dump(output / "verification.json", verification)
        print(json.dumps({"decision": result["decision"], "verification": verification}), flush=True)
        print("Report: " + str(output / "report.md"), flush=True)


if __name__ == "__main__":
    main()
