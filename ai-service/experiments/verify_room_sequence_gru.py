"""Replay saved GRU/HGB artifacts and verify the offline sequence benchmark."""
import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import torch
from threadpoolctl import threadpool_limits

from room_sequence_gru import (FINAL_SEEDS, SERVICE, TARGETS, TemperatureGRU, compare_models,
                               dump, load_sequence_data, point_warning, predict_gru,
                               set_seed, sha256, temporal_positions, warning_gate)


def verify(output, raw_dir, device):
    result = json.loads((output / "metrics.json").read_text(encoding="utf-8"))
    if "completed_at" not in result:
        raise ValueError("Benchmark is not complete")
    frame, sources = load_sequence_data(raw_dir)
    assert sources == result["dataset"]["sources"]
    for path, before in result["protected_before"].items():
        assert before == result["protected_after"][path] == sha256(path)
    source = result["source"]
    assert not set(source["fit_sources"]) & set(source["validation_sources"])
    assert set(source["fit_sources"]) | set(source["validation_sources"]) == set(source["development_sources"])
    assert not set(source["development_sources"]) & set(source["test_sources"])
    frames = {
        "source": frame.loc[frame.refrigerator.isin(source["test_sources"])].reset_index(drop=True),
        "temporal": frame.iloc[temporal_positions(frame)["test"]],
    }
    data = np.load(output / "predictions.npz", allow_pickle=False)
    verified = {"protected_runtime_unchanged": True, "source_manifest_verified": True, "source_split_disjoint": True}
    for phase, test in frames.items():
        np.testing.assert_array_equal(data[phase + "_actual"], test[TARGETS].to_numpy())
        np.testing.assert_array_equal(data[phase + "_id"], test.refrigerator.to_numpy(dtype=str))
        np.testing.assert_array_equal(data[phase + "_channel"], test.compartment.to_numpy(dtype=str))
        np.testing.assert_array_equal(data[phase + "_time"], test.elapsed_minutes.to_numpy())
        stored_models = joblib.load(output / f"{phase}_hgb.joblib")["models"]
        from room_sequence_gru import FEATURE_NAMES
        hgb = np.column_stack([stored_models[target].predict(test[FEATURE_NAMES]) + test.temperature.to_numpy() for target in TARGETS])
        np.testing.assert_array_equal(hgb, data[phase + "_hgb"])
        seeds = FINAL_SEEDS if phase == "source" else FINAL_SEEDS[:1]
        predictions = {}
        maximum_difference = 0.
        for seed in seeds:
            checkpoint = torch.load(output / f"{phase}_gru_{seed}.pt", map_location="cpu", weights_only=True)
            assert checkpoint["epochs"] == result[phase]["selected_epochs"]
            config = checkpoint["config"]
            set_seed(seed)
            model = TemperatureGRU(config["hidden_size"], config["layers"]).to(device)
            model.load_state_dict(checkpoint["state_dict"])
            replay = predict_gru(model, test, checkpoint["normalizer"], device)
            key = f"source_gru_{seed}" if phase == "source" else "temporal_gru"
            difference = float(np.max(np.abs(replay - data[key])))
            maximum_difference = max(maximum_difference, difference)
            np.testing.assert_allclose(replay, data[key], atol=1e-5, rtol=0)
            predictions[str(seed)] = data[key]
            del model
        recomputed = compare_models(test, hgb, predictions)
        assert json.dumps(recomputed, sort_keys=True, allow_nan=False) == json.dumps(result[phase]["evaluation"], sort_keys=True, allow_nan=False)
        verified[phase] = {
            "samples": len(test), "hgb_predictions_exact": True, "gru_seeds_replayed": seeds,
            "max_gru_replay_absolute_difference": maximum_difference, "metrics_recomputed_exact": True,
            "hgb_multi_warning_vs_hgb_15m": warning_gate(point_warning(recomputed["hgb_15m"]), recomputed["hgb_multi"]["window"]),
        }
    return verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cuda")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    with threadpool_limits(limits=4):
        result = verify(args.output_dir, args.raw_dir, args.device)
    if args.write:
        dump(args.output_dir / "verification.json", result)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
