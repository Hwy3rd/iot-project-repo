"""Grouped HGB tuning followed by calibration of the exact fitted estimator.

All classifier and threshold choices precede held-out scoring. The previously
examined public sources are reused for an exploratory, paired comparison.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import GroupKFold, GroupShuffleSplit
from threadpoolctl import threadpool_limits

from room_warning import (FEATURE_NAMES, ROOMS, SEED, SERVICE, WARNING_FEATURES,
                          calibrate, decisions, evaluate, load_room_data,
                          make_examples, paired_source_bootstrap, point_scores, predict)

BUDGETS = (.02, .04, .06)
PRIMARY_BUDGET = .04
CALIBRATION_SEEDS = (20261018, 20261019, 20261020)
CONFIGS = {
    "hgb_base_300": dict(max_iter=300, learning_rate=.05, max_leaf_nodes=31,
                         min_samples_leaf=50, l2_regularization=1.),
    "hgb_matched_500": dict(max_iter=500, learning_rate=.03, max_leaf_nodes=63,
                            max_depth=15, min_samples_leaf=20, l2_regularization=0.),
    "hgb_regularized_500": dict(max_iter=500, learning_rate=.03, max_leaf_nodes=63,
                                max_depth=15, min_samples_leaf=50, l2_regularization=3.),
    "hgb_balanced_500": dict(max_iter=500, learning_rate=.03, max_leaf_nodes=63,
                             max_depth=15, min_samples_leaf=20, l2_regularization=1.,
                             class_weight="balanced"),
}
PRIMARY_KEY = f"{PRIMARY_BUDGET:.2f}"


def source_parts(frame, calibration_seed):
    dev_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=SEED).split(frame, groups=frame.refrigerator))
    development = frame.iloc[dev_idx]
    fit_idx, calibration_idx = next(GroupShuffleSplit(n_splits=1, test_size=.25, random_state=calibration_seed).split(development, groups=development.refrigerator))
    parts = {"fit": development.iloc[fit_idx].reset_index(drop=True),
             "calibration": development.iloc[calibration_idx].reset_index(drop=True),
             "test": frame.iloc[test_idx].reset_index(drop=True)}
    groups = {name: set(part.refrigerator) for name, part in parts.items()}
    if groups["fit"] & groups["calibration"] or groups["fit"] & groups["test"] or groups["calibration"] & groups["test"]:
        raise ValueError("Source split leakage")
    return parts


def temporal_parts(frame):
    end = frame.groupby(["refrigerator", "compartment"]).elapsed_minutes.transform("max")
    return {"fit": frame.loc[frame.elapsed_minutes + 15 < end * .6].reset_index(drop=True),
            "calibration": frame.loc[(frame.elapsed_minutes >= end * .6) & (frame.elapsed_minutes + 15 < end * .8)].reset_index(drop=True),
            "test": frame.loc[frame.elapsed_minutes >= end * .8].reset_index(drop=True)}


def make_model(name, reference):
    if name == "point":
        return clone(reference)
    return HistGradientBoostingClassifier(**CONFIGS[name], early_stopping=False, random_state=SEED)


def get_fit(cache, name, train, score_frames, reference):
    """Cache expensive fits. The enclosing manifest validates all inputs first."""
    if cache.exists():
        value = joblib.load(cache)
        print("Reused " + cache.stem, flush=True)
        return value
    started = time.perf_counter()
    model = make_model(name, reference)
    if name == "point":
        model.fit(train[FEATURE_NAMES], train.future_temp_15m - train.temperature)
        scores = {key: point_scores(part, predict(model, part)) for key, part in score_frames.items()}
        fit_samples = len(train)
    else:
        examples = make_examples(train)
        model.fit(examples[WARNING_FEATURES], examples.breach)
        scores = {key: model.predict_proba(make_examples(part)[WARNING_FEATURES])[:, 1] for key, part in score_frames.items()}
        fit_samples = len(examples)
    if any(not np.isfinite(score).all() for score in scores.values()):
        raise ValueError("Non-finite scores")
    value = {"model": model, "scores": scores, "seconds": time.perf_counter() - started,
             "fit_samples": fit_samples, "fit_sources": sorted(train.refrigerator.unique())}
    joblib.dump(value, cache, compress=3)
    print(json.dumps({"fit": cache.stem, "seconds": round(value["seconds"], 2), "samples": fit_samples}), flush=True)
    return value


def score_at_budgets(examples, scores):
    return {f"{budget:.2f}": evaluate(examples, examples.breach.to_numpy(),
                                     decisions(examples, scores, calibrate(examples, scores, {room: budget for room in ROOMS})), scores)
            for budget in BUDGETS}


def tune(frame, reference, cache_dir):
    examples = make_examples(frame)
    oof = {name: np.full(len(examples), np.nan) for name in ["point", *CONFIGS]}
    folds = []
    splits = GroupKFold(n_splits=3, shuffle=True, random_state=SEED).split(frame, groups=frame.refrigerator)
    for fold, (fit_idx, valid_idx) in enumerate(splits, 1):
        train, validation = frame.iloc[fit_idx], frame.iloc[valid_idx]
        validation_examples = make_examples(validation)
        mask = examples.refrigerator.isin(validation.refrigerator.unique()).to_numpy()
        keys = ["room", "refrigerator", "compartment", "elapsed_minutes"]
        if not np.array_equal(examples.loc[mask, keys].to_numpy(), validation_examples[keys].to_numpy()):
            raise ValueError("OOF alignment failed")
        entry = {"fold": fold, "fit_sources": sorted(train.refrigerator.unique()),
                 "validation_sources": sorted(validation.refrigerator.unique()), "seconds": {}}
        for name in oof:
            print(f"Tuning fold {fold}/3: {name}", flush=True)
            fitted = get_fit(cache_dir / f"tuning_{fold}_{name}.pkl", name, train, {"validation": validation}, reference)
            oof[name][mask] = fitted["scores"]["validation"]
            entry["seconds"][name] = fitted["seconds"]
        folds.append(entry)
    if any(not np.isfinite(score).all() for score in oof.values()):
        raise ValueError("Incomplete OOF scores")
    evaluations = {name: score_at_budgets(examples, scores) for name, scores in oof.items()}
    thresholds = {name: {f"{budget:.2f}": calibrate(examples, scores, {room: budget for room in ROOMS})
                         for budget in BUDGETS} for name, scores in oof.items()}
    selected = max(CONFIGS, key=lambda name: (evaluations[name][PRIMARY_KEY]["macro"]["recall"],
                                             evaluations[name][PRIMARY_KEY]["macro"]["average_precision"]))
    return {"folds": folds, "evaluations": evaluations, "thresholds": thresholds, "selected": selected}


def run_protocol(parts, reference, selected, cache_dir, label, keep_models=False, oof_thresholds=None):
    cal_examples, test_examples = make_examples(parts["calibration"]), make_examples(parts["test"])
    result = {"sources": {key: sorted(value.refrigerator.unique()) for key, value in parts.items()},
              "rows": {key: len(value) for key, value in parts.items()},
              "calibration": {}, "test": {}, "thresholds": {}, "seconds": {}}
    models, test_scores = {}, {}
    for name in dict.fromkeys(["point", "hgb_base_300", selected]):
        print(label + ": " + name, flush=True)
        fitted = get_fit(cache_dir / f"{label}_{name}.pkl", name, parts["fit"],
                         {"calibration": parts["calibration"], "test": parts["test"]}, reference)
        models[name] = fitted["model"]
        cal_score, test_score = fitted["scores"]["calibration"], fitted["scores"]["test"]
        test_scores[name] = test_score
        result["seconds"][name] = fitted["seconds"]
        result["calibration"][name], result["test"][name], result["thresholds"][name] = {}, {}, {}
        for budget in BUDGETS:
            key = f"{budget:.2f}"
            thresholds = calibrate(cal_examples, cal_score, {room: budget for room in ROOMS})
            # The exact same fitted estimator supplies calibration and test scores.
            result["thresholds"][name][key] = thresholds
            result["calibration"][name][key] = evaluate(cal_examples, cal_examples.breach.to_numpy(), decisions(cal_examples, cal_score, thresholds), cal_score)
            result["test"][name][key] = evaluate(test_examples, test_examples.breach.to_numpy(), decisions(test_examples, test_score, thresholds), test_score)
    result["point_default"] = evaluate(test_examples, test_examples.breach.to_numpy(), test_scores["point"] > 0, test_scores["point"])
    if oof_thresholds is not None:
        # Isolate the calibration method: identical fitted estimator and test
        # scores; only the thresholds' allowed source of labels differs.
        result["oof_threshold_test"] = {
            name: {key: evaluate(test_examples, test_examples.breach.to_numpy(),
                                  decisions(test_examples, scores, thresholds), scores)
                   for key, thresholds in oof_thresholds[name].items()}
            for name, scores in test_scores.items()}
    result["assessment"] = assess(result, selected)
    if keep_models:
        thresholds = result["thresholds"][selected][PRIMARY_KEY]
        alarm = decisions(test_examples, test_scores[selected], thresholds)
        result["paired_source_bootstrap"] = {
            "point_default": paired_source_bootstrap(test_examples, test_scores["point"] > 0, alarm),
            "point_calibrated": paired_source_bootstrap(test_examples,
                decisions(test_examples, test_scores["point"], result["thresholds"]["point"][PRIMARY_KEY]), alarm),
        }
    print(json.dumps({"phase": label, "point_default": result["point_default"]["macro"],
                      "test_at_4_percent_calibration_budget": {name: item[PRIMARY_KEY]["macro"] for name, item in result["test"].items()}}), flush=True)
    return result, models if keep_models else None


def compare(before, after):
    checks = {"recall_gain_at_least_2_points": after["macro"]["recall"] >= before["macro"]["recall"] + .02,
              "macro_fpr_increase_at_most_half_point": after["macro"]["false_positive_rate"] <= before["macro"]["false_positive_rate"] + .005,
              "each_room_fpr_increase_at_most_1_point": all(
                  after["rooms"][room]["false_positive_rate"] <= before["rooms"][room]["false_positive_rate"] + .01 for room in ROOMS)}
    return {"passed": all(checks.values()), "checks": checks}


def assess(result, selected):
    after = result["test"][selected][PRIMARY_KEY]
    comparison = {"point_default": compare(result["point_default"], after),
                  "point_calibrated": compare(result["test"]["point"][PRIMARY_KEY], after),
                  "base_classifier_calibrated": compare(result["test"]["hgb_base_300"][PRIMARY_KEY], after)}
    return {"comparisons": comparison, "better_than_both_point_controls": comparison["point_default"]["passed"] and comparison["point_calibrated"]["passed"]}


def pct(value):
    return f"{value:.2%}" if value is not None else "n/a"


def render(result):
    lines = ["# Tối ưu HGB và hiệu chỉnh ngưỡng trên tập riêng", "",
             "Mục tiêu: phát hiện vượt ngưỡng tại t+5, t+10 hoặc t+15 khi nhiệt độ hiện tại còn trong ngưỡng phòng.", "",
             "## Quy trình cố định trước khi chấm", "",
             "- Dữ liệu công khai Bangkok, bốn preset phòng hiện có. Nhãn kênh nguồn không phải đầu vào model hoặc cách phân chia phòng.",
             "- Dùng lại 25 nguồn test cũ; dữ liệu này đã được nghiên cứu, nên đây là thử nghiệm thăm dò, không phải test hoàn toàn mới.",
             "- 98 nguồn còn lại chia thành 73 nguồn fit/chọn model và 25 nguồn hiệu chỉnh ngưỡng. Cả hai kênh và các preset chồng nhau của cùng nguồn luôn cùng nhóm.",
             "- Ba fold theo nguồn trong 73 nguồn fit chọn cấu hình bằng recall trung bình tại ngân sách FPR 4%; AP dùng khi hòa điểm. Các điểm này chỉ dùng chọn cấu hình.",
             "- Hiệu chỉnh ngưỡng trên tập riêng bằng chính bản model đã fit, giữ nguyên trọng số khi chấm test. Không fit lại model sau hiệu chỉnh.",
             "- Các ngân sách hiệu chỉnh là FPR 2%, 4%, 6% cho từng preset. 4% là mức đánh giá chính, được chọn trước khi xem test. FPR trên test được đo thực tế và có thể khác ngân sách.",
             "- So với cả model nhiệt độ nguyên ngưỡng, model nhiệt độ được hiệu chỉnh và HGB300 được hiệu chỉnh theo cùng quy trình. Các đối chứng đều fit lại trên cùng dữ liệu được phép.",
             "- Lặp ba seed chia fit/hiệu chỉnh, giữ chung 25 nguồn test. Các lượt này đo độ nhạy với phép chia, không phải ba bộ test độc lập; không chọn seed tốt nhất.",
             "- Kiểm tra thời gian: fit 60% đầu, hiệu chỉnh khoảng 60..80%, test 20% cuối. Nhãn tương lai của fit/hiệu chỉnh không được đi qua ranh giới phần sau.",
             "- Cấu hình classifier được chọn trên các chuỗi đầy đủ của nhóm fit theo nguồn. Phần kiểm tra thời gian là replay bổ sung, chưa độc lập với bước chọn cấu hình; không xem nó là một test hoàn toàn mới.",
             "- Điểm số tính theo mẫu thời gian, trung bình đều bốn preset có thể chồng nhau; không phải tỷ lệ sự cố độc lập hoặc phép đo an toàn thực phẩm.",
             "- Đầu vào giữ 22 đặc trưng lịch sử và 5 đặc trưng ngưỡng phòng, không thêm dữ liệu tương lai, định danh nguồn hoặc kênh.", ""]
    if "tuning" in result:
        lines += ["## Chọn cấu hình trên nhóm fit", "", "| Cấu hình | Recall chọn cấu hình | FPR chọn cấu hình | AP |", "|---|---:|---:|---:|"]
        for name, values in result["tuning"]["evaluations"].items():
            m = values[PRIMARY_KEY]["macro"]
            lines.append(f"| {name} | {pct(m['recall'])} | {pct(m['false_positive_rate'])} | {m['average_precision']:.4f} |")
        lines += ["", f"Cấu hình được chọn trước khi chấm: **{result['tuning']['selected']}**.", ""]
    for index, run in enumerate(result.get("source_runs", []), 1):
        lines += [f"## Test theo nguồn, lượt {index}, seed {run['calibration_seed']}", "",
                  "| Model | Ngân sách hiệu chỉnh | Recall test | FPR test | Precision test |", "|---|---:|---:|---:|---:|"]
        m = run["point_default"]["macro"]
        lines.append(f"| point_default | Ngưỡng gốc | {pct(m['recall'])} | {pct(m['false_positive_rate'])} | {pct(m['precision'])} |")
        for name, budgets in run["test"].items():
            for budget, entry in budgets.items():
                m = entry["macro"]
                lines.append(f"| {name} | {float(budget):.0%} | {pct(m['recall'])} | {pct(m['false_positive_rate'])} | {pct(m['precision'])} |")
        lines.append("")
        if "oof_threshold_test" in run:
            lines += ["### Tách tác dụng của cách hiệu chỉnh, cùng model và cùng mẫu test", "",
                      "Cả hai cách đều dùng ngân sách hiệu chỉnh 4%; ngưỡng OOF chỉ dùng nhãn của nhóm fit, ngưỡng tập riêng chỉ dùng nhãn của nhóm hiệu chỉnh. Không cách nào dùng nhãn test để chọn ngưỡng.", "",
                      "| Model | Nguồn chọn ngưỡng | Recall test | FPR test |", "|---|---|---:|---:|"]
            for name in run["test"]:
                for method, entry in [("OOF nhóm fit", run["oof_threshold_test"][name][PRIMARY_KEY]),
                                      ("Tập hiệu chỉnh riêng", run["test"][name][PRIMARY_KEY])]:
                    m = entry["macro"]
                    lines.append(f"| {name} | {method} | {pct(m['recall'])} | {pct(m['false_positive_rate'])} |")
            lines += ["", "### Từng preset, mức hiệu chỉnh chính 4%", "",
                      "| Preset | Model | Nguồn có mẫu test | Mẫu vượt ngưỡng | Recall | FPR |", "|---|---|---:|---:|---:|---:|"]
            for room in ROOMS:
                entries = [("point_default", run["point_default"]["rooms"][room])]
                entries += [(name, values[PRIMARY_KEY]["rooms"][room]) for name, values in run["test"].items()]
                for name, item in entries:
                    lines.append(f"| {room} | {name} | {item['sources']} | {item['positives']} | {pct(item['recall'])} | {pct(item['false_positive_rate'])} |")
            lines.append("")
    if "temporal" in result:
        run = result["temporal"]
        lines += ["## Test theo thời gian, mức hiệu chỉnh chính 4%", "", "| Model | Recall | FPR | Precision |", "|---|---:|---:|---:|"]
        for name, entry in [("point_default", run["point_default"]), *[(name, budgets[PRIMARY_KEY]) for name, budgets in run["test"].items()]]:
            m = entry["macro"]
            lines.append(f"| {name} | {pct(m['recall'])} | {pct(m['false_positive_rate'])} | {pct(m['precision'])} |")
        lines.append("")
    if "assessment" in result:
        lines += ["## Đánh giá theo tiêu chí đặt trước", "",
                  "Để xem là tốt hơn: recall tăng ít nhất 2 điểm %, FPR trung bình tăng tối đa 0,5 điểm %, và FPR từng preset tăng tối đa 1 điểm % so với đối chứng. Các tiêu chí này phục vụ so sánh bài tập.",
                  "", "```json", json.dumps(result["assessment"], indent=2, ensure_ascii=False), "```", "",
                  "Model runtime, API và production giữ nguyên. `evaluated_models.pkl` chỉ chứa model của lượt chia chính, fit trên 73 nguồn, kèm ngưỡng hiệu chỉnh từ 25 nguồn khác; không phải artifact đã fit toàn bộ dữ liệu hoặc tương thích thay trực tiếp API nhiệt độ.", ""]
    lines += ["## Chạy lại", "", "Từ thư mục gốc worktree AI, dùng môi trường .venv-ai đã cài requirements:", "", "```powershell",
              "$env:OMP_NUM_THREADS='4'", "$env:OPENBLAS_NUM_THREADS='4'",
              ".venv-ai/Scripts/python.exe -B -u ai-service/experiments/room_warning_tuning.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-tuning-reproduction --threads 4", "```", "",
              "Dùng output mới hoặc thêm `--resume` để tiếp tục một lần chạy bị gián đoạn có manifest trùng khớp. Cache model nằm trong `cache/` được gitignore; `metrics.json` ghi đầy đủ cấu hình, hash nguồn, nguồn fit/hiệu chỉnh/test, ngưỡng và số liệu từng phòng.", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--reference-model", type=Path, default=SERVICE / "temperature_model_history.pkl")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if args.threads < 1 or (args.output_dir.exists() != args.resume):
        parser.error("Use positive threads and a new output directory, or --resume for an existing run")
    reference_hash = hashlib.sha256(args.reference_model.read_bytes()).hexdigest()
    artifact = joblib.load(args.reference_model)
    if artifact["feature_names"] != FEATURE_NAMES:
        raise ValueError("Incompatible reference features")
    frame, sources = load_room_data(args.raw_dir.resolve())
    parts = source_parts(frame, CALIBRATION_SEEDS[0])
    manifest = {"version": 1, "reference_sha256": reference_hash, "sources": sources,
                "features": WARNING_FEATURES, "rooms": ROOMS, "candidates": CONFIGS,
                "budgets": BUDGETS, "primary_budget": PRIMARY_BUDGET, "calibration_seeds": CALIBRATION_SEEDS,
                "test_split_seed": SEED,
                "environment": {"python": platform.python_version(), "sklearn": sklearn.__version__, "numpy": np.__version__, "pandas": pd.__version__, "threads": args.threads}}
    manifest = json.loads(json.dumps(manifest))
    if args.resume:
        saved = json.loads((args.output_dir / "manifest.json").read_text(encoding="utf-8"))
        if manifest != saved:
            raise ValueError("Resume manifest mismatch")
    args.output_dir.mkdir(parents=True, exist_ok=args.resume)
    cache_dir = args.output_dir / "cache"
    cache_dir.mkdir(exist_ok=True)
    (args.output_dir / ".gitignore").write_text("cache/\n", encoding="utf-8")
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8")
    result = {"created_at": datetime.now(timezone.utc).isoformat(), "manifest": manifest,
              "physical_rows": len(frame), "source_runs": []}
    def save():
        (args.output_dir / "metrics.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
        (args.output_dir / "report.md").write_text(render(result), encoding="utf-8")
    save()
    with threadpool_limits(limits=args.threads):
        result["tuning"] = tune(parts["fit"], artifact["model"], cache_dir)
        selected = result["tuning"]["selected"]
        print("Selected on fitting sources only: " + selected, flush=True)
        save()
        for number, seed in enumerate(CALIBRATION_SEEDS):
            parts = source_parts(frame, seed)
            run, models = run_protocol(parts, artifact["model"], selected, cache_dir, f"source_{seed}",
                                       keep_models=number == 0,
                                       oof_thresholds=result["tuning"]["thresholds"] if number == 0 else None)
            run["calibration_seed"] = seed
            result["source_runs"].append(run)
            if number == 0:
                joblib.dump({"models": models, "thresholds": run["thresholds"], "selected": selected,
                             "features": WARNING_FEATURES, "source_groups": run["sources"],
                             "runtime_compatible": False, "trained_on": "fit sources only; no refit after calibration"},
                            args.output_dir / "evaluated_models.pkl", compress=3)
            save()
        result["temporal"], _ = run_protocol(temporal_parts(frame), artifact["model"], selected, cache_dir, "temporal")
        wins = sum(run["assessment"]["better_than_both_point_controls"] for run in result["source_runs"])
        result["assessment"] = {"source_runs_passing_both_point_controls": wins,
                                "source_runs_total": len(CALIBRATION_SEEDS),
                                "primary_source": result["source_runs"][0]["assessment"],
                                "temporal": result["temporal"]["assessment"],
                                "stable_improvement": wins == len(CALIBRATION_SEEDS) and result["temporal"]["assessment"]["better_than_both_point_controls"],
                                "runtime_changed": False}
        if hashlib.sha256(args.reference_model.read_bytes()).hexdigest() != reference_hash:
            raise RuntimeError("Reference runtime artifact changed")
        save()
        print(json.dumps({"selected": selected, "assessment": result["assessment"]}), flush=True)


if __name__ == "__main__":
    main()
