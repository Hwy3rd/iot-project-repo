"""Rescore cached HGB 5/10-minute forecasts on matched warning targets.

Cached split models are replayed, never retrained on their test data. Only
the legacy 15-minute HGB configuration is refitted as a fair control.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from threadpoolctl import threadpool_limits

HORIZONS = (5, 10, 15)
POLICIES = {
    "legacy_hgb_15m": None,
    "hgb_5m": (0,),
    "hgb_10m": (1,),
    "hgb_5_10m": (0, 1),
    "tuned_hgb_15m": (2,),
    "hgb_5_10_15m": (0, 1, 2),
}
LABELS = {
    "legacy_hgb_15m": "HGB 15m legacy (100 iterations)",
    "hgb_5m": "HGB 5m",
    "hgb_10m": "HGB 10m",
    "hgb_5_10m": "HGB 5 + 10m",
    "tuned_hgb_15m": "HGB 15m tuned (500 iterations)",
    "hgb_5_10_15m": "HGB 5 + 10 + 15m",
}
SCORING_KEYS = ("recall", "precision", "false_positive_rate", "false_negative_rate", "f1")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def confusion(observed, predicted):
    observed, predicted = np.asarray(observed, bool), np.asarray(predicted, bool)
    if observed.shape != predicted.shape or observed.ndim != 1:
        raise ValueError("One observed and predicted boolean per evaluated row required")
    tp, fn = int(np.sum(observed & predicted)), int(np.sum(observed & ~predicted))
    fp, tn = int(np.sum(~observed & predicted)), int(np.sum(~observed & ~predicted))
    ratio = lambda a, b: a / b if b else None
    return {"samples": len(observed), "positives": tp + fn,
            "recall": ratio(tp, tp + fn), "precision": ratio(tp, tp + fp),
            "false_positive_rate": ratio(fp, fp + tn),
            "false_negative_rate": ratio(fn, fn + tp), "f1": ratio(2 * tp, 2 * tp + fp + fn),
            "confusion_matrix": {"tp": tp, "fn": fn, "fp": fp, "tn": tn}}


def score_window(current, actual, prediction, window, rooms):
    current = np.asarray(current, float)
    actual, prediction = np.asarray(actual, float), np.asarray(prediction, float)
    if window not in HORIZONS or actual.shape != (len(current), 3):
        raise ValueError("Expected aligned labels at 5, 10 and 15 minutes")
    if prediction.ndim != 2 or prediction.shape[0] != len(current) or prediction.shape[1] < 1:
        raise ValueError("Expected at least one prediction per row")
    if not all(np.isfinite(value).all() for value in (current, actual, prediction)):
        raise ValueError("Non-finite input")
    result = {"rooms": {}}
    for name, (low, high) in rooms.items():
        mask = (current >= low) & (current <= high)
        observed = np.any((actual[mask, :window // 5] < low) | (actual[mask, :window // 5] > high), axis=1)
        alarm = np.any((prediction[mask] < low) | (prediction[mask] > high), axis=1)
        result["rooms"][name] = {"temp_min": low, "temp_max": high, **confusion(observed, alarm)}
    result["macro"] = {}
    for key in SCORING_KEYS:
        values = [entry[key] for entry in result["rooms"].values() if entry[key] is not None]
        result["macro"][key] = float(np.mean(values)) if values else None
    return result


def score_all(current, actual, hgb, legacy, rooms):
    result = {}
    for window in HORIZONS:
        entries = {}
        for name, columns in POLICIES.items():
            prediction = legacy[:, None] if columns is None else hgb[:, list(columns)]
            entries[name] = score_window(current, actual, prediction, window, rooms)
        # All policies must be scored against exactly the same positives/negatives.
        for room in rooms:
            counts = {(item["rooms"][room]["samples"], item["rooms"][room]["positives"]) for item in entries.values()}
            if len(counts) != 1:
                raise AssertionError("Policies were scored against different labels")
        result[str(window)] = entries
    return result


def render(result):
    lines = ["# Benchmark cảnh báo HGB: 5 phút và 5–10 phút", "",
             "Dùng dữ liệu Bangkok công khai; chưa phải số đo hiệu quả trên phòng lạnh thật.", "",
             "- Đầu vào: 13 nhiệt độ trong 60 phút, cách nhau 5 phút; 22 đặc trưng cũ.",
             "- Mục tiêu 5 phút: nhiệt độ quan sát ở t+5 vượt ngưỡng.",
             "- Mục tiêu 10 phút: ít nhất một nhiệt độ quan sát ở t+5 hoặc t+10 vượt ngưỡng.",
             "- Chỉ chấm khi nhiệt độ hiện tại trong ngưỡng. Không quan sát được các phút nằm giữa hai mẫu.",
             "- Mỗi bảng giữ nguyên nhãn và các hàng test cho mọi phương án, kể cả model dự báo phút 15.",
             "- Vì vậy số cảnh báo với mục tiêu 10 phút không được so trực tiếp với benchmark mục tiêu 15 phút cũ.",
             "- FPR = FP/(FP+TN); precision = TP/(TP+FP). Các chỉ số là trung bình đều giữa bốn preset.",
             "- Kết quả đếm thời điểm chồng lặp, không phải số đợt sự cố độc lập hoặc số thông báo gửi cho người dùng.",
             "- Dùng lại đúng model HGB500 tại 5/10/15 phút và test splits đã có; không chọn model/ngưỡng/seed bằng kết quả này.",
             "- Huấn luyện lại cấu hình HGB100 cũ trên đúng phần train tương ứng; không dùng trọng số đã học toàn bộ dữ liệu để chấm test.",
             "- Chia thời gian giữ khoảng cách nhãn 15 phút cũ để có các hàng train/test giống các benchmark trước.",
             "- Các test partitions đã được nghiên cứu nhiều lần, nên kết quả mang tính thăm dò.",
             "- Runtime/API/firmware/production giữ nguyên.", ""]
    for phase, phase_label in (("source", "Nguồn giữ riêng"), ("temporal", "Theo thời gian")):
        entry = result[phase]
        lines += [f"## {phase_label}", "", f"Số hàng test: {entry['test_rows']:,}.", ""]
        for window in (5, 10):
            lines += [f"### Mục tiêu {window} phút", "",
                      "| Phương án | Recall | FPR | Precision | F1 |", "|---|---:|---:|---:|---:|"]
            for name in POLICIES:
                m = entry["evaluation"][str(window)][name]["macro"]
                lines.append(f"| {LABELS[name]} | {m['recall']:.2%} | {m['false_positive_rate']:.2%} | {m['precision']:.2%} | {m['f1']:.2%} |")
            lines += [""]
        lines += ["### Sai số dự báo đúng từng mốc", "", "| Mốc | MAE trung bình preset (°C) |", "|---|---:|"]
        for horizon, metrics in entry["regression"].items():
            lines.append(f"| {horizon} phút | {metrics['macro_mae']:.4f} |")
        lines += ["", "### Theo từng preset, mục tiêu 10 phút", "",
                  "| Phương án | Preset | Recall | FPR | Precision |", "|---|---|---:|---:|---:|"]
        for name in ("legacy_hgb_15m", "hgb_5m", "hgb_10m", "hgb_5_10m"):
            for room, metrics in entry["evaluation"]["10"][name]["rooms"].items():
                fmt = lambda value: "undefined" if value is None else f"{value:.2%}"
                lines.append(f"| {LABELS[name]} | {room} | {fmt(metrics['recall'])} | {fmt(metrics['false_positive_rate'])} | {fmt(metrics['precision'])} |")
        lines += [""]
    lines += ["## Đối chiếu và tái lập", "",
              "Model 5 và 10 phút đã được huấn luyện trong thử nghiệm đa mốc trước; lần này là chấm lại đúng mục tiêu ngắn hơn.",
              "`metrics.json` lưu cả mục tiêu 15 phút để đối chiếu chính xác báo cáo cũ; `verification.json` lưu kiểm tra model và nhãn.",
              "Model cũ được lưu thành `source_legacy_hgb15.joblib` và `temporal_legacy_hgb15.joblib`.",
              "`predictions.npz` lưu dự báo, nhãn, mã nguồn và thời điểm; manifest lưu SHA-256 các đầu vào và file runtime.", "",
              "```powershell",
              "python -B ai-service/experiments/room_short_horizon_warning.py --worktree . --main-repo ../iot-project-repo --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-5-10m-reproduction",
              "```", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", type=Path, required=True)
    parser.add_argument("--main-repo", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    root, main_repo, raw, output = [path.resolve() for path in (args.worktree, args.main_repo, args.raw_dir, args.output_dir)]
    if output.exists():
        parser.error("Use a new output directory; existing results will not be overwritten")
    service = root / "ai-service"
    sys.path.insert(0, str(service / "experiments"))
    from room_forecast import ROOMS, load_room_data, room_metrics
    from temperature_features import FEATURE_NAMES
    cached_dir = service / "experiments/results/room-sequence-gru-2026-10-31"
    old_dir = service / "experiments/results/room-forecast-2026-10-17"
    cached = json.loads((cached_dir / "metrics.json").read_text(encoding="utf-8"))
    old = json.loads((old_dir / "metrics.json").read_text(encoding="utf-8"))
    data = np.load(cached_dir / "predictions.npz", allow_pickle=False)
    protected = [repo / "ai-service" / name for repo in (root, main_repo)
                 for name in ("temperature_model_history.pkl", "temperature_model_history.json", "ai_service.py")]
    dependencies = [cached_dir / name for name in ("metrics.json", "predictions.npz", "source_hgb.joblib", "temporal_hgb.joblib")]
    dependencies += [old_dir / "reference_model.pkl", old_dir / "metrics.json", Path(__file__).resolve(),
                     service / "experiments/room_forecast.py", service / "experiments/freezer_history.py", service / "temperature_features.py"]
    fingerprints = {str(path): digest(path) for path in protected + dependencies}
    print("Loading and validating raw series and cached labels", flush=True)
    frame, sources = load_room_data(raw)
    if sources != cached["dataset"]["sources"] or sources != old["dataset"]["sources"]:
        raise AssertionError("Raw source manifest differs from previous benchmark")
    future_parts = []
    for source in sources:
        df = pd.read_csv(raw / source["file"], sep="\t", usecols=["Time", "T_MS", "T_FC"])
        for channel in ("T_MS", "T_FC"):
            future_parts.append(pd.DataFrame({"refrigerator": Path(source["file"]).stem,
                "compartment": channel, "elapsed_minutes": df.Time,
                "future_temp_5m": df[channel].shift(-1), "future_temp_10m": df[channel].shift(-2)}))
    frame = frame.merge(pd.concat(future_parts, ignore_index=True),
                        on=["refrigerator", "compartment", "elapsed_minutes"], how="left", validate="one_to_one", sort=False)
    development_sources, test_sources = cached["source"]["development_sources"], cached["source"]["test_sources"]
    assert not set(development_sources) & set(test_sources)
    assert set(frame.refrigerator.unique()) == set(development_sources) | set(test_sources)
    limits = frame.groupby(["refrigerator", "compartment"]).elapsed_minutes.transform("max") * .8
    splits = {
        "source": (frame.loc[frame.refrigerator.isin(development_sources)], frame.loc[frame.refrigerator.isin(test_sources)]),
        "temporal": (frame.loc[frame.elapsed_minutes + 15 < limits], frame.loc[frame.elapsed_minutes >= limits]),
    }
    legacy_reference = joblib.load(old_dir / "reference_model.pkl")["model"]
    legacy_metadata = json.loads((main_repo / "ai-service/temperature_model_history.json").read_text(encoding="utf-8"))
    if legacy_reference.get_params() != legacy_metadata["hyperparameters"]:
        raise AssertionError("Main-repo model configuration differs from the legacy reference")
    output.mkdir(parents=True)
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "input_sha256": fingerprints,
                "sources": sources, "rooms": ROOMS, "horizons": HORIZONS, "policies": POLICIES,
                "source_test_sources": test_sources, "source_development_sources": development_sources,
                "legacy_parameters": legacy_reference.get_params(), "tuned_parameters": cached["protocol"]["hgb_parameters"],
                "selection": "No tuning; rescore frozen previously trained models on fixed 5/10/15 minute targets"}
    dump(output / "manifest.json", manifest)
    result = {"created_at": manifest["created_at"], "protocol": manifest["selection"],
              "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
                              "scikit_learn": sklearn.__version__, "joblib": joblib.__version__}}
    verification = {"raw_manifest_matches": True, "source_split_disjoint": True, "phases": {}}
    saved_predictions = {}
    with threadpool_limits(limits=4):
        for phase, (train, test) in splits.items():
            assert len(train) == (cached["source"]["development_rows"] if phase == "source" else cached["temporal"]["final_train_rows"])
            actual = test[[f"future_temp_{m}m" for m in HORIZONS]].to_numpy()
            for field, values in (("actual", actual), ("current", test.temperature.to_numpy()),
                                  ("id", test.refrigerator.to_numpy(dtype=str)), ("channel", test.compartment.to_numpy(dtype=str)),
                                  ("time", test.elapsed_minutes.to_numpy())):
                np.testing.assert_array_equal(values, data[f"{phase}_{field}"])
                saved_predictions[f"{phase}_{field}"] = values
            model_bundle = joblib.load(cached_dir / f"{phase}_hgb.joblib")
            assert model_bundle["feature_names"] == FEATURE_NAMES
            hgb = np.column_stack([model_bundle["models"][f"future_temp_{m}m"].predict(test[FEATURE_NAMES]) + test.temperature.to_numpy()
                                   for m in HORIZONS])
            np.testing.assert_array_equal(hgb, data[f"{phase}_hgb"])
            print(f"{phase}: cached HGB predictions match exactly; fitting legacy HGB on {len(train):,} training rows", flush=True)
            started = time.perf_counter()
            baseline = clone(legacy_reference)
            baseline.fit(train[FEATURE_NAMES], train.future_temp_15m - train.temperature)
            legacy_prediction = baseline.predict(test[FEATURE_NAMES]) + test.temperature.to_numpy()
            model_path = output / f"{phase}_legacy_hgb15.joblib"
            joblib.dump({"model": baseline, "feature_names": FEATURE_NAMES, "horizon_minutes": 15}, model_path, compress=3)
            legacy_replay = joblib.load(model_path)["model"].predict(test[FEATURE_NAMES]) + test.temperature.to_numpy()
            np.testing.assert_array_equal(legacy_replay, legacy_prediction)
            old_metrics = old["holdout" if phase == "source" else "temporal"]["evaluations"]["current"]
            reproduced = room_metrics(test, legacy_prediction)
            np.testing.assert_allclose(reproduced["macro"]["mae"], old_metrics["macro"]["mae"], atol=1e-12, rtol=0)
            for key in SCORING_KEYS:
                np.testing.assert_allclose(reproduced["macro"]["window_alerts"][key], old_metrics["macro"]["window_alerts"][key], atol=1e-12, rtol=0)
            evaluation = score_all(test.temperature.to_numpy(), actual, hgb, legacy_prediction, ROOMS)
            # Independently compare our new aggregation against the old 15-minute scorer.
            for policy, expected in (("legacy_hgb_15m", old_metrics["macro"]["window_alerts"]),
                                     ("tuned_hgb_15m", cached[phase]["evaluation"]["hgb_15m"]["macro"]["window_alerts"]),
                                     ("hgb_5_10_15m", cached[phase]["evaluation"]["hgb_multi"]["window"]["macro"])):
                for key in ("recall", "precision", "false_positive_rate", "f1"):
                    np.testing.assert_allclose(evaluation["15"][policy]["macro"][key], expected[key], atol=1e-12, rtol=0)
            regression = {}
            for index, horizon in enumerate(HORIZONS):
                maes = {name: float(np.abs(hgb[:, index] - actual[:, index])[(test.temperature.to_numpy() >= low) & (test.temperature.to_numpy() <= high)].mean())
                        for name, (low, high) in ROOMS.items()}
                regression[str(horizon)] = {"rooms": maes, "macro_mae": float(np.mean(list(maes.values())))}
            result[phase] = {"train_rows": len(train), "test_rows": len(test), "legacy_fit_seconds": time.perf_counter() - started,
                             "evaluation": evaluation, "regression": regression}
            verification["phases"][phase] = {"labels_and_ids_exact": True, "cached_hgb_predictions_exact": True,
                "legacy_checkpoint_replay_exact": True, "legacy_old_metrics_reproduced": True,
                "old_15m_metrics_reproduced": True, "same_window_labels_for_every_policy": True}
            saved_predictions[f"{phase}_hgb"] = hgb
            saved_predictions[f"{phase}_legacy_hgb15"] = legacy_prediction
            print(json.dumps({"phase": phase, "target_10m": {name: item["macro"] for name, item in evaluation["10"].items()}}), flush=True)
    np.savez_compressed(output / "predictions.npz", **saved_predictions)
    # Recompute every new score from the serialized predictions as a separate pass.
    reloaded = np.load(output / "predictions.npz", allow_pickle=False)
    for phase in splits:
        recomputed = score_all(reloaded[f"{phase}_current"], reloaded[f"{phase}_actual"],
                               reloaded[f"{phase}_hgb"], reloaded[f"{phase}_legacy_hgb15"], ROOMS)
        assert json.dumps(recomputed, sort_keys=True) == json.dumps(result[phase]["evaluation"], sort_keys=True)
    assert {str(path): digest(path) for path in protected + dependencies} == fingerprints
    verification.update(runtime_and_dependencies_unchanged=True, serialized_metrics_recomputed_exact=True)
    result["completed_at"] = datetime.now(timezone.utc).isoformat()
    dump(output / "metrics.json", result)
    dump(output / "verification.json", verification)
    (output / "report.md").write_text(render(result), encoding="utf-8")
    print("COMPLETED " + str(output / "report.md"), flush=True)


if __name__ == "__main__":
    main()
