"""One-hour forecasts: validated HGB/GRU blending and controlled Huber fine-tuning.

All choices use validation only. Current service artifacts stay unchanged.
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

from room_endpoint_forecast import (EndpointGRU, GRU_COLUMNS, endpoint_targets,
                                    predict_endpoint, sequence_inputs)
from room_sequence_gru import (FEATURE_NAMES, FINAL_SEEDS, SERVICE, TARGETS, dump,
                               forecast_gate, load_sequence_data, room_metrics,
                               set_seed, sha256, temporal_positions)

BETAS = {"huber_0p5": .5, "huber_1": 1., "huber_2": 2.}
WEIGHTS = [i / 20 for i in range(21)]
FINE_EPOCHS = 5
FINE_LR = .0001
FAMILIES = ["l1_blend", "l1_continued", "huber", "huber_blend"]
TEST_COLUMNS = list(dict.fromkeys([*GRU_COLUMNS, *TARGETS, "compartment", "elapsed_minutes"]))


def blend(hgb, gru, weight):
    a, b = np.asarray(hgb, float), np.asarray(gru, float)
    if not 0 <= weight <= 1 or a.shape != b.shape or a.ndim != 1 or not np.isfinite(a).all() or not np.isfinite(b).all():
        raise ValueError("Invalid blend inputs")
    return (1 - weight) * a + weight * b


def tail_gate(before, after):
    b, a = before["macro"], after["macro"]
    checks = {
        "macro_p95_reduction_at_least_3_percent": a["p95_absolute_error"] <= b["p95_absolute_error"] * .97,
        "macro_mae_increase_at_most_1_percent": a["mae"] <= b["mae"] * 1.01,
        "each_room_mae_increase_at_most_5_percent": all(after["rooms"][name]["mae"] <= m["mae"] * 1.05 for name, m in before["rooms"].items()),
        "each_room_p95_increase_at_most_5_percent": all(after["rooms"][name]["p95_absolute_error"] <= m["p95_absolute_error"] * 1.05 for name, m in before["rooms"].items()),
    }
    return {"passed": all(checks.values()), "checks": checks}


def choose_blend(validation, hgb, gru):
    reference = room_metrics(validation, gru)
    rows = []
    for weight in WEIGHTS:
        metric = room_metrics(validation, blend(hgb, gru, weight))
        eligible = (metric["macro"]["p95_absolute_error"] <= reference["macro"]["p95_absolute_error"] * 1.02
                    and all(metric["rooms"][name]["mae"] <= m["mae"] * 1.05 for name, m in reference["rooms"].items()))
        rows.append({"gru_weight": weight, "mae": metric["macro"]["mae"],
                     "p95": metric["macro"]["p95_absolute_error"], "eligible": eligible})
    selected = min((r for r in rows if r["eligible"]), key=lambda r: (r["mae"], -r["gru_weight"]))
    return {"gru_weight": selected["gru_weight"], "validation_grid": rows}


def choose_huber(control, trials):
    eligible = [name for name, m in trials.items()
                if m["macro"]["mae"] <= control["macro"]["mae"] * 1.01
                and all(m["rooms"][room]["mae"] <= values["mae"] * 1.05 for room, values in control["rooms"].items())]
    if eligible:
        chosen = min(eligible, key=lambda name: (trials[name]["macro"]["p95_absolute_error"], trials[name]["macro"]["mae"]))
        return chosen, "lowest validation P95 subject to MAE guard against equal-budget L1 continuation"
    chosen = min(trials, key=lambda name: trials[name]["macro"]["mae"])
    return chosen, "no Huber satisfies validation MAE guard; lowest-MAE Huber retained for an exploratory comparison"


def loss_function(kind, beta=None):
    if kind == "l1":
        return nn.L1Loss()
    if kind != "huber" or beta is None or beta <= 0:
        raise ValueError("Invalid loss")
    # SmoothL1(beta) == Huber(delta=beta)/beta: keep large-error gradient scale 1.
    return nn.SmoothL1Loss(beta=beta)


def load_model(path, device):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint["output_schema"] != "temperature-delta-15min-v1":
        raise ValueError("Expected a single-output GRU checkpoint")
    config = checkpoint["config"]
    model = EndpointGRU(config["hidden_size"], config["layers"]).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    return model, checkpoint


def fine_tune(base, train, kind, beta, seed, output, stem, device):
    checkpoint_path, info_path = output / (stem + ".pt"), output / (stem + ".json")
    signature = {"base_sha256": sha256(base), "loss": kind, "beta": beta, "seed": seed,
                 "extra_epochs": FINE_EPOCHS, "learning_rate": FINE_LR, "samples": len(train)}
    if checkpoint_path.exists() and info_path.exists():
        info = json.loads(info_path.read_text(encoding="utf-8"))
        if info["signature"] != signature or info["checkpoint_sha256"] != sha256(checkpoint_path):
            raise ValueError("Invalid fine-tune cache: " + stem)
        model, checkpoint = load_model(checkpoint_path, device)
        print("Cache: " + stem, flush=True)
        return model, checkpoint, info
    model, checkpoint = load_model(base, device)
    set_seed(seed + 1103)  # Same initial weights and permutation sequence for every loss.
    x = torch.from_numpy(sequence_inputs(train, checkpoint["normalizer"])).to(device)
    y = torch.from_numpy(endpoint_targets(train)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=FINE_LR, weight_decay=.0001)
    criterion = loss_function(kind, beta)
    history = []
    started = time.perf_counter()
    for epoch in range(1, FINE_EPOCHS + 1):
        model.train()
        order = torch.randperm(len(train), device=device)
        total_loss, total_mae = 0., 0.
        for start in range(0, len(train), 1024):
            index = order[start:start + 1024]
            optimizer.zero_grad(set_to_none=True)
            prediction = model(x[index])
            loss = criterion(prediction, y[index])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.)
            optimizer.step()
            total_loss += float(loss.detach()) * len(index)
            total_mae += float((prediction.detach() - y[index]).abs().mean()) * len(index)
        row = {"epoch": epoch, "train_loss": total_loss / len(train), "train_mae": total_mae / len(train)}
        history.append(row)
        print(json.dumps({"training": stem, **row}), flush=True)
    info = {"signature": signature, "history": history, "seconds": time.perf_counter() - started}
    checkpoint = {**checkpoint, "state_dict": {key: value.detach().cpu() for key, value in model.state_dict().items()},
                  "base_epochs": checkpoint["epochs"], "epochs": checkpoint["epochs"] + FINE_EPOCHS,
                  "fine_tune": signature}
    torch.save(checkpoint, checkpoint_path)
    info["checkpoint_sha256"] = sha256(checkpoint_path)
    dump(info_path, info)
    return model, checkpoint, info


def phase_positions(frame, sequence, phase):
    if phase == "temporal":
        return temporal_positions(frame)
    source = sequence["source"]
    positions = lambda key: np.flatnonzero(frame.refrigerator.isin(source[key]).to_numpy())
    return {"fit": positions("fit_sources"), "validation": positions("validation_sources"),
            "final_train": positions("development_sources"), "test": positions("test_sources")}


def validation_hgb(frame, positions, reference, output, phase):
    path = output / f"{phase}_validation_hgb.joblib"
    columns = frame.columns.get_indexer(FEATURE_NAMES)
    if path.exists():
        model = joblib.load(path)["model"]
    else:
        model = clone(reference)
        fit = frame.iloc[positions["fit"], columns]
        target = (frame.future_temp_15m - frame.temperature).iloc[positions["fit"]]
        model.fit(fit, target)
        joblib.dump({"model": model}, path, compress=3)
    values = frame.iloc[positions["validation"], columns]
    current = frame.temperature.iloc[positions["validation"]].to_numpy()
    prediction = model.predict(values) + current
    return prediction


def validation_choices(validation, predictions):
    trials = {name: room_metrics(validation, predictions[name]) for name in BETAS}
    chosen, reason = choose_huber(room_metrics(validation, predictions["l1_continued"]), trials)
    return {"selected_huber": chosen, "beta": BETAS[chosen], "reason": reason,
            "l1_blend": choose_blend(validation, predictions["hgb"], predictions["l1"]),
            "huber_blend": choose_blend(validation, predictions["hgb"], predictions[chosen]),
            "huber_validation": trials,
            "l1_validation": room_metrics(validation, predictions["l1"]),
            "continued_validation": room_metrics(validation, predictions["l1_continued"])}


def compare(test, hgb, baseline, candidates):
    evaluation = {"hgb": room_metrics(test, hgb), "l1": {}, "models": {name: {} for name in FAMILIES}, "gates": {}}
    for seed, prediction in baseline.items():
        before = room_metrics(test, prediction)
        evaluation["l1"][seed] = before
        evaluation["gates"][seed] = {}
        for name in FAMILIES:
            after = room_metrics(test, candidates[name][seed])
            evaluation["models"][name][seed] = after
            evaluation["gates"][seed][name] = {"forecast": forecast_gate(before, after), "tail": tail_gate(before, after)}
        continued = evaluation["models"]["l1_continued"][seed]
        huber = evaluation["models"]["huber"][seed]
        evaluation["gates"][seed]["huber_vs_equal_budget_l1"] = {
            "forecast": forecast_gate(continued, huber), "tail": tail_gate(continued, huber)}
    return evaluation


def aggregate(entries):
    return {key: float(np.mean([m["macro"][key] for m in entries.values()]))
            for key in ["mae", "p95_absolute_error", "within_1c"]}


def render(result):
    lines = ["# One-hour forecast: HGB/GRU blending and Huber fine-tuning", "",
             "Public Bangkok observations; repeatedly researched test partitions, not real cold-room measurements.", "",
             "- Input stays 13 temperatures over one hour. Target stays t+15 minutes.",
             "- Blend: (1-alpha)*HGB + alpha*GRU. Alpha grid 0..1 step .05; chosen on validation MAE with P95 <=102% and each-room MAE <=105% of the GRU component.",
             "- Huber is normalized Huber/delta (SmoothL1), delta candidates .5/1/2 Celsius, fixed 5 extra epochs at LR 1e-4.",
             "- Equal-budget L1 continuation starts from the same weights, with identical optimizer reset, learning rate, epochs and batch-order seed.",
             "- Delta chosen for lowest validation P95 subject to MAE <=101% and each-room MAE <=105% of continued L1. If none qualify, lowest-MAE Huber is retained and marked exploratory.",
             "- Every weight/delta is frozen before test predictions. Three predefined seeds are all reported in each evaluation.",
             "- HGB validation is fitted only on fit sources/time; GRU validation checkpoints never trained on validation rows.",
             "- Test components use their final-training checkpoints. New fine-tuning keeps the baseline training-only normalizer.",
             "- Source grouping, overlapping presets and temporal target gaps match the previous experiments. Identifiers never enter models.",
             "- Forecast gate: MAE >=1% lower, macro P95 <=5% worse, every-room MAE <=5% worse.",
             "- Tail gate: P95 >=3% lower, MAE <=1% worse, every-room MAE and P95 <=5% worse.",
             "- Validation is reused for choices in this exploratory study; it is not a fresh independent calibration dataset. Seeds are not independent test sets.",
             "- Runtime and production artifacts are not changed. Step caches support --resume.", ""]
    for phase in ["source", "temporal"]:
        entry = result.get(phase, {})
        if not entry.get("complete"):
            continue
        choices, e = entry["choices"], entry["evaluation"]
        lines += [f"## {phase.capitalize()} evaluation", "",
                  f"Validation choices: baseline blend GRU weight **{choices['l1_blend']['gru_weight']:.2f}**; Huber delta **{choices['beta']}**; Huber blend GRU weight **{choices['huber_blend']['gru_weight']:.2f}**.", "",
                  "| Model (three-seed mean except HGB) | MAE (C) | P95 (C) | Within 1 C |", "|---|---:|---:|---:|"]
        rows = [("HGB", e["hgb"]["macro"]), ("Current GRU L1", aggregate(e["l1"]))]
        rows += [(name, aggregate(e["models"][name])) for name in FAMILIES]
        for name, m in rows:
            lines.append(f"| {name} | {m['mae']:.6f} | {m['p95_absolute_error']:.6f} | {m['within_1c']:.2%} |")
        lines += ["", "### All seeds", "", "| Model | Seed | MAE | P95 |", "|---|---|---:|---:|"]
        for name, entries in [("l1", e["l1"]), *e["models"].items()]:
            for seed, metric in entries.items():
                m = metric["macro"]
                lines.append(f"| {name} | {seed} | {m['mae']:.6f} | {m['p95_absolute_error']:.6f} |")
        lines += ["", "Full per-room metrics, validation grids and gates are in metrics.json.", ""]
    if "decision" in result:
        lines += ["## Gates across both evaluations and every seed", "", "```json", json.dumps(result["decision"], indent=2), "```", ""]
    lines += ["## Verification", "", "verification.json records component-weight replay, blend equality, metric recomputation and unchanged input/runtime hashes.",
              "Cache files and choices are protected by signatures; --resume rejects a changed manifest. Incomplete runs do not count as benchmark results.", ""]
    return "\n".join(lines)


def check_test_rows(test, saved, phase):
    for name, actual in [("actual", test[TARGETS].to_numpy()), ("current", test.temperature.to_numpy()),
                         ("id", test.refrigerator.to_numpy(dtype=str)), ("channel", test.compartment.to_numpy(dtype=str)),
                         ("time", test.elapsed_minutes.to_numpy())]:
        np.testing.assert_array_equal(saved[phase + "_" + name], actual)


def verify(output, raw_dir, prior_dir, device):
    result = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    if "completed_at" not in result:
        raise ValueError("Incomplete run")
    for path, digest in manifest["protected"].items():
        if sha256(path) != digest:
            raise ValueError("Protected input changed: " + path)
    prior = json.loads((prior_dir / "metrics.json").read_text(encoding="utf-8"))
    sequence = json.loads(Path(prior["prior_metrics"]).read_text(encoding="utf-8"))
    frame, sources = load_sequence_data(raw_dir)
    assert sources == manifest["sources"]
    all_predictions = np.load(output / "predictions.npz", allow_pickle=False)
    checked = {"runtime_and_inputs_unchanged": True, "manifest_verified": True}
    for phase in ["source", "temporal"]:
        positions = phase_positions(frame, sequence, phase)
        validation = frame.iloc[positions["validation"], frame.columns.get_indexer(GRU_COLUMNS)]
        val_saved = np.load(output / f"{phase}_validation_predictions.npz", allow_pickle=False)
        val_preds = {name: val_saved[name] for name in val_saved.files}
        val_hgb = joblib.load(output / f"{phase}_validation_hgb.joblib")["model"]
        val_x = frame.iloc[positions["validation"], frame.columns.get_indexer(FEATURE_NAMES)]
        np.testing.assert_array_equal(val_hgb.predict(val_x) + validation.temperature.to_numpy(), val_preds["hgb"])
        validation_components = {"l1": prior_dir / f"{phase}_{prior[phase]['selected']}_validation.pt",
                                 **{name: output / f"{phase}_validation_{name}.pt" for name in ["l1_continued", *BETAS]}}
        for name, checkpoint_path in validation_components.items():
            model, checkpoint = load_model(checkpoint_path, device)
            values = predict_endpoint(model, validation, checkpoint["normalizer"], device)
            np.testing.assert_allclose(values, val_preds[name], atol=1e-5, rtol=0)
            del model
        choices = validation_choices(validation, val_preds)
        assert json.dumps(choices, sort_keys=True) == json.dumps(result[phase]["choices"], sort_keys=True)
        assert choices == json.loads((output / f"{phase}_choices.json").read_text(encoding="utf-8"))
        test = frame.iloc[positions["test"], frame.columns.get_indexer(TEST_COLUMNS)]
        test_hgb_model = joblib.load(Path(prior["prior_metrics"]).parent / f"{phase}_hgb.joblib")["models"]["future_temp_15m"]
        test_hgb_x = frame.iloc[positions["test"], frame.columns.get_indexer(FEATURE_NAMES)]
        np.testing.assert_array_equal(test_hgb_model.predict(test_hgb_x) + test.temperature.to_numpy(), all_predictions[phase + "_hgb"])
        candidates = {name: {} for name in FAMILIES}
        baseline = {}
        max_difference = 0.
        for seed in FINAL_SEEDS:
            key = str(seed)
            model, checkpoint = load_model(prior_dir / f"{phase}_gru_single_{seed}.pt", device)
            base = predict_endpoint(model, test, checkpoint["normalizer"], device)
            np.testing.assert_allclose(base, all_predictions[f"{phase}_l1_{seed}"], atol=1e-5, rtol=0)
            baseline[key] = all_predictions[f"{phase}_l1_{seed}"]
            del model
            for name in ["l1_continued", "huber"]:
                model, checkpoint = load_model(output / f"{phase}_{name}_{seed}.pt", device)
                replay = predict_endpoint(model, test, checkpoint["normalizer"], device)
                values = all_predictions[f"{phase}_{name}_{seed}"]
                max_difference = max(max_difference, float(np.max(np.abs(replay - values))))
                np.testing.assert_allclose(replay, values, atol=1e-5, rtol=0)
                candidates[name][key] = values
                del model
            hgb = all_predictions[phase + "_hgb"]
            for name, component, choice in [("l1_blend", baseline[key], choices["l1_blend"]),
                                             ("huber_blend", candidates["huber"][key], choices["huber_blend"])]:
                values = blend(hgb, component, choice["gru_weight"])
                np.testing.assert_array_equal(values, all_predictions[f"{phase}_{name}_{seed}"])
                candidates[name][key] = values
        recomputed = compare(test, hgb, baseline, candidates)
        assert json.dumps(recomputed, sort_keys=True) == json.dumps(result[phase]["evaluation"], sort_keys=True)
        checked[phase] = {"samples": len(test), "choices_recomputed_from_validation": True,
                          "validation_component_checkpoints_replayed": True, "hgb_test_checkpoint_replayed": True,
                          "baseline_and_finetuned_seeds_replayed": FINAL_SEEDS,
                          "max_new_gru_replay_absolute_difference": max_difference,
                          "blend_predictions_exact": True, "metrics_recomputed_exact": True}
        del validation, test
        gc.collect()
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--prior-dir", type=Path, default=SERVICE / "experiments/results/room-endpoint-forecast-2026-10-31-cpu")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    device = "cpu"
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    set_seed(FINAL_SEEDS[0])
    output, prior_dir, raw_dir = args.output_dir.resolve(), args.prior_dir.resolve(), args.raw_dir.resolve()
    with threadpool_limits(limits=4):
        if args.verify_only:
            checked = verify(output, raw_dir, prior_dir, device)
            dump(output / "verification.json", checked)
            print(json.dumps(checked, indent=2))
            return
        prior = json.loads((prior_dir / "metrics.json").read_text(encoding="utf-8"))
        if "completed_at" not in prior or not (prior_dir / "verification.json").exists():
            raise ValueError("Baseline experiment must be complete and verified")
        sequence_path = Path(prior["prior_metrics"])
        sequence = json.loads(sequence_path.read_text(encoding="utf-8"))
        frame, sources = load_sequence_data(raw_dir)
        if sources != prior["dataset"]["sources"]:
            raise ValueError("Dataset changed")
        protected_paths = [SERVICE / name for name in ["temperature_model_history.pkl", "temperature_model_history.json", "ai_service.py", "temperature_features.py"]]
        protected_paths += [Path(__file__), Path(__file__).with_name("room_endpoint_forecast.py"), Path(__file__).with_name("room_sequence_gru.py"), Path(__file__).with_name("room_forecast.py"),
                            prior_dir / "metrics.json", prior_dir / "predictions.npz", prior_dir / "verification.json", sequence_path, Path(prior["prior_predictions"])]
        protected_paths += sorted(prior_dir.glob("*.pt"))
        protected_paths += [sequence_path.parent / f"{phase}_hgb.joblib" for phase in ["source", "temporal"]]
        manifest = {"sources": sources, "protected": {str(path): sha256(path) for path in protected_paths},
                    "protocol": {"history_minutes": 60, "fine_epochs": FINE_EPOCHS, "fine_lr": FINE_LR,
                                 "betas": BETAS, "weights": WEIGHTS, "seeds": FINAL_SEEDS, "rng_offset": 1103,
                                 "device": device, "threads": 4, "batch_size": 1024,
                                 "loss": "normalized Huber (SmoothL1); equal large-error gradient scale",
                                 "blend_p95_guard": 1.02, "huber_mae_guard": 1.01},
                    "environment": {"python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__,
                                    "pandas": pd.__version__, "sklearn": sklearn.__version__, "joblib": joblib.__version__}}
        if output.exists():
            if not args.resume or json.loads((output / "manifest.json").read_text(encoding="utf-8")) != manifest:
                raise ValueError("Use a new directory or --resume with an unchanged manifest")
        else:
            output.mkdir(parents=True)
            dump(output / "manifest.json", manifest)
        result = {"created_at": datetime.now(timezone.utc).isoformat(), "protocol": manifest["protocol"], "environment": manifest["environment"]}
        def save():
            dump(output / "metrics.json", result)
            (output / "report.md").write_text(render(result), encoding="utf-8")
        save()
        reference = clone(joblib.load(SERVICE / "temperature_model_history.pkl")["model"])
        prior_predictions = np.load(prior_dir / "predictions.npz", allow_pickle=False)
        sequence_predictions = np.load(prior["prior_predictions"], allow_pickle=False)
        saved_predictions = {}
        for phase in ["source", "temporal"]:
            positions = phase_positions(frame, sequence, phase)
            cols = frame.columns.get_indexer(GRU_COLUMNS)
            fit, validation = frame.iloc[positions["fit"], cols], frame.iloc[positions["validation"], cols]
            selected_width = prior[phase]["selected"]
            validation_base = prior_dir / f"{phase}_{selected_width}_validation.pt"
            print(f"{phase}: fit HGB validation control (no validation training rows)", flush=True)
            val_preds = {"hgb": validation_hgb(frame, positions, reference, output, phase)}
            model, checkpoint = load_model(validation_base, device)
            val_preds["l1"] = predict_endpoint(model, validation, checkpoint["normalizer"], device)
            del model
            trial_info = {}
            for name, kind, beta in [("l1_continued", "l1", None), *[(key, "huber", value) for key, value in BETAS.items()]]:
                model, checkpoint, info = fine_tune(validation_base, fit, kind, beta, FINAL_SEEDS[0], output, f"{phase}_validation_{name}", device)
                val_preds[name] = predict_endpoint(model, validation, checkpoint["normalizer"], device)
                trial_info[name] = info
                del model
            choices = validation_choices(validation, val_preds)
            choice_path = output / f"{phase}_choices.json"
            if choice_path.exists() and json.loads(choice_path.read_text(encoding="utf-8")) != choices:
                raise ValueError("Frozen validation choices changed")
            dump(choice_path, choices)  # Freeze before any test computations.
            np.savez_compressed(output / f"{phase}_validation_predictions.npz", **val_preds)
            result[phase] = {"choices": choices, "validation_training": trial_info, "complete": False}
            save()
            print(json.dumps({"phase": phase, "frozen_beta": choices["beta"], "l1_gru_weight": choices["l1_blend"]["gru_weight"],
                              "huber_gru_weight": choices["huber_blend"]["gru_weight"]}), flush=True)
            del fit, validation, val_preds
            gc.collect()
            train = frame.iloc[positions["final_train"], cols]
            test = frame.iloc[positions["test"], frame.columns.get_indexer(TEST_COLUMNS)]
            check_test_rows(test, sequence_predictions, phase)
            hgb = prior_predictions[phase + "_hgb_control"]
            np.testing.assert_array_equal(hgb, sequence_predictions[phase + "_hgb"][:, 2])
            baseline, candidates, training = {}, {name: {} for name in FAMILIES}, {}
            for seed in FINAL_SEEDS:
                key = str(seed)
                baseline[key] = prior_predictions[f"{phase}_gru_single_{seed}"]
                assert json.dumps(room_metrics(test, baseline[key]), sort_keys=True) == json.dumps(prior[phase]["evaluation"]["gru_single"][key], sort_keys=True)
                base = prior_dir / f"{phase}_gru_single_{seed}.pt"
                training[key] = {}
                for name, kind, beta in [("l1_continued", "l1", None), ("huber", "huber", choices["beta"])]:
                    model, checkpoint, info = fine_tune(base, train, kind, beta, seed, output, f"{phase}_{name}_{seed}", device)
                    candidates[name][key] = predict_endpoint(model, test, checkpoint["normalizer"], device)
                    training[key][name] = info
                    del model
                candidates["l1_blend"][key] = blend(hgb, baseline[key], choices["l1_blend"]["gru_weight"])
                candidates["huber_blend"][key] = blend(hgb, candidates["huber"][key], choices["huber_blend"]["gru_weight"])
                for name in FAMILIES:
                    saved_predictions[f"{phase}_{name}_{seed}"] = candidates[name][key]
                saved_predictions[f"{phase}_l1_{seed}"] = baseline[key]
                saved_predictions[phase + "_hgb"] = hgb
                np.savez_compressed(output / "predictions.npz", **saved_predictions)
            result[phase].update(complete=True, training=training, evaluation=compare(test, hgb, baseline, candidates))
            save()
            del train, test
            gc.collect()
        result["decision"] = {
            name: {kind + "_gate_all_phases_seeds": all(result[p]["evaluation"]["gates"][str(s)][name][kind]["passed"]
                                                       for p in ["source", "temporal"] for s in FINAL_SEEDS)
                   for kind in ["forecast", "tail"]}
            for name in [*FAMILIES, "huber_vs_equal_budget_l1"]}
        for path, digest in manifest["protected"].items():
            if sha256(path) != digest:
                raise RuntimeError("Protected file changed: " + path)
        result["completed_at"] = datetime.now(timezone.utc).isoformat()
        save()
        del frame, saved_predictions
        gc.collect()
        checked = verify(output, raw_dir, prior_dir, device)
        dump(output / "verification.json", checked)
        print(json.dumps({"decision": result["decision"], "verification": checked}), flush=True)
        print("Report: " + str(output / "report.md"), flush=True)


if __name__ == "__main__":
    main()
