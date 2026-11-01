"""Describe saved warning errors without fitting or changing any model.

All ROC comparisons using test labels are descriptive curve diagnostics;
their thresholds must not be used as fitted operating thresholds.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_curve
from threadpoolctl import threadpool_limits

EPS = 1e-8
NAMES = {"point": "Dự báo nhiệt độ", "classifier": "HGB phân loại"}
SEVERITIES = [("0..0.2 C", 0., .2), ("0.2..0.5 C", .2, .5),
              ("0.5..1 C", .5, 1.), ("1..2 C", 1., 2.), (">2 C", 2., np.inf)]


def episodes(temperature, minutes, low, high):
    """Consecutive observed out-of-range samples, not continuous durations."""
    values, minutes = np.asarray(temperature), np.asarray(minutes)
    outside = (values < low) | (values > high)
    starts = np.flatnonzero(outside & ~np.r_[False, outside[:-1]])
    ends = np.flatnonzero(outside & ~np.r_[outside[1:], False])
    result = []
    for start, end in zip(starts, ends):
        result.append({"start_minute": float(minutes[start]), "last_outside_minute": float(minutes[end]),
                       "readings": int(end - start + 1), "observed_span_minutes": float(minutes[end] - minutes[start]),
                       "left_censored": bool(start == 0), "right_censored": bool(end == len(values) - 1),
                       "direction_at_start": "above" if values[start] > high else "below",
                       "maximum_excursion": float(max(np.max(values[start:end+1]) - high, low - np.min(values[start:end+1])) )})
    return result


def self_check():
    result = episodes([3, 5, 6, 3, -1], [0, 5, 10, 15, 20], 0, 4)
    assert [(item["readings"], item["direction_at_start"], item["right_censored"]) for item in result] == [(2, "above", False), (1, "below", True)]
    assert result[0]["observed_span_minutes"] == 5  # Two readings do not prove 10 continuous minutes.
    assert episodes([5, 5, 3], [0, 5, 10], 0, 4)[0]["left_censored"]


def stats(frame, mask=None):
    if mask is not None:
        frame = frame.loc[np.asarray(mask)]
    result = {"samples": len(frame), "sources": int(frame.refrigerator.nunique()), "positives": int(frame.breach.sum()), "models": {}}
    y = frame.breach.to_numpy(bool)
    for name in NAMES:
        alarm = frame["alarm_" + name].to_numpy(bool)
        result["models"][name] = classification(y, alarm)
    return result


def positive_groups(frame):
    positive = frame.breach.to_numpy(bool)
    groups = {"severity": {}, "direction": {}, "future_outside_count": {}, "window_pattern": {}, "recent_history": {}, "first_breach_lead_minutes": {}}
    for name, low, high in SEVERITIES:
        mask = positive & (frame.excursion.to_numpy() > low + EPS) & (frame.excursion.to_numpy() <= high + EPS)
        groups["severity"][name] = stats(frame, mask)
    for name in ["above_only", "below_only", "both"]:
        groups["direction"][name] = stats(frame, positive & (frame.direction.to_numpy() == name))
    for count in [1, 2, 3]:
        groups["future_outside_count"][str(count)] = stats(frame, positive & (frame.outside_count.to_numpy() == count))
    for lead in [5, 10, 15]:
        groups["first_breach_lead_minutes"][str(lead)] = stats(frame, positive & (frame.first_breach_lead_minutes.to_numpy() == lead))
    for pattern in ["100", "010", "110", "001", "011", "101", "111"]:
        groups["window_pattern"][pattern] = stats(frame, positive & (frame.pattern.to_numpy() == pattern))
    groups["recovery"] = {"back_in_range_at_15m": stats(frame, positive & ~frame.endpoint_breach.to_numpy()),
                          "outside_at_15m": stats(frame, positive & frame.endpoint_breach.to_numpy())}
    for name, mask in [("stable_recently", frame.stable_recently.to_numpy()), ("already_changing", ~frame.stable_recently.to_numpy())]:
        groups["recent_history"][name] = stats(frame, positive & mask)
    for key in ["severity", "direction", "future_outside_count", "window_pattern", "recovery", "recent_history", "first_breach_lead_minutes"]:
        assert sum(item["samples"] for item in groups[key].values()) == int(positive.sum()), key
    return groups


def roc_diagnostics(frame, development):
    result = {}
    for room in ROOMS:
        test = frame.loc[frame.room == room]
        dev = development.loc[development.room == room]
        baseline = classification(test.breach.to_numpy(), test.alarm_point.to_numpy())
        entry = {"baseline_test_fpr": baseline["false_positive_rate"], "models": {}, "classifier_score_distribution": {}}
        for name in NAMES:
            fpr, tpr, _ = roc_curve(test.breach, test["score_" + name], drop_intermediate=False)
            entry["models"][name] = {
                "ap": float(average_precision_score(test.breach, test["score_" + name])),
                "test_curve_recall_at_fpr_4pct": float(tpr[fpr <= .04 + EPS].max()),
                "test_curve_recall_at_baseline_fpr": float(tpr[fpr <= baseline["false_positive_rate"] + EPS].max()),
            }
        for label, part in [("development_oof", dev), ("source_holdout", test)]:
            y = part.breach.to_numpy(bool)
            score = part.score_classifier.to_numpy()
            entry["classifier_score_distribution"][label] = {
                "samples": len(part), "sources": int(part.refrigerator.nunique()), "positive_rate": float(y.mean()),
                "negative_p95": float(np.quantile(score[~y], .95)), "negative_p99": float(np.quantile(score[~y], .99)),
                "positive_median": float(np.median(score[y])),
                "brier_score": float(np.mean((score - y) ** 2)),
                "measured_fpr": float(np.mean(part.alarm_classifier.to_numpy()[~y])),
                "measured_recall": float(np.mean(part.alarm_classifier.to_numpy()[y])),
            }
        result[room] = entry
    return result


def source_stats(frame):
    rows = []
    for (room, source), part in frame.groupby(["room", "refrigerator"], sort=True):
        y = part.breach.to_numpy(bool)
        reg, clf = part.alarm_point.to_numpy(bool), part.alarm_classifier.to_numpy(bool)
        cm_reg, cm_clf = classification(y, reg), classification(y, clf)
        rows.append({"room": room, "source": source, "samples": len(part), "positives": int(y.sum()),
                     "point_recall": cm_reg["recall"], "classifier_recall": cm_clf["recall"],
                     "point_fpr": cm_reg["false_positive_rate"], "classifier_fpr": cm_clf["false_positive_rate"],
                     "point_only_detected": int(np.sum(y & reg & ~clf)),
                     "classifier_only_detected": int(np.sum(y & ~reg & clf)),
                     "additional_misses": cm_clf["confusion_matrix"]["fn"] - cm_reg["confusion_matrix"]["fn"]})
    return pd.DataFrame(rows)


def summarize_events(raw_series, frame):
    lookup = {(row.refrigerator, row.compartment, row.room, float(row.elapsed_minutes)): index
              for index, row in frame[["refrigerator", "compartment", "room", "elapsed_minutes"]].iterrows()}
    event_rows, covered_positive_samples = [], set()
    for (source, channel), raw in raw_series.items():
        for room, (low, high) in ROOMS.items():
            for event in episodes(raw[channel], raw.Time, low, high):
                if event["left_censored"]:
                    continue
                eligible = [(lookup[(source, channel, room, event["start_minute"] - lead)], lead)
                            for lead in [5, 10, 15]
                            if (source, channel, room, event["start_minute"] - lead) in lookup]
                if not eligible:
                    continue
                assert all(frame.loc[index, "breach"] for index, _ in eligible)
                covered_positive_samples.update(index for index, _ in eligible)
                record = {"source": source, "channel": channel, "room": room, **event, "eligible_forecasts": len(eligible)}
                record["maximum_available_lead_minutes"] = max(lead for _, lead in eligible)
                for model in NAMES:
                    leads = [lead for index, lead in eligible if frame.loc[index, "alarm_" + model]]
                    record[model + "_detected"] = bool(leads)
                    record[model + "_lead_minutes"] = max(leads) if leads else None
                correct_direction = [lead for index, lead in eligible
                                     if ((frame.loc[index, "predicted_temp_15m"] > high) if event["direction_at_start"] == "above"
                                         else (frame.loc[index, "predicted_temp_15m"] < low))]
                record["point_correct_direction_detected"] = bool(correct_direction)
                event_rows.append(record)
    assert covered_positive_samples == set(frame.index[frame.breach]), "Some positive samples have no matching upcoming episode"
    events = pd.DataFrame(event_rows)
    summary = {"rooms": {}, "by_run_length": {}}
    for room in ROOMS:
        part = events.loc[events.room == room]
        summary["rooms"][room] = event_stats(part)
    for name, mask in [("one_observed_reading", events.readings == 1), ("two_observed_readings", events.readings == 2),
                       ("three_or_more_observed_readings", events.readings >= 3)]:
        summary["by_run_length"][name] = event_stats(events.loc[mask])
    return events, summary


def event_stats(events):
    result = {"events": len(events), "sources": int(events.source.nunique()),
              "right_censored_events": int(events.right_censored.sum()), "models": {}}
    for name in NAMES:
        detected = events[name + "_detected"].to_numpy(bool)
        leads = events.loc[detected, name + "_lead_minutes"]
        result["models"][name] = {"detected": int(detected.sum()), "recall": float(detected.mean()) if len(events) else None,
                                  "median_observed_lead_minutes_when_detected": float(leads.median()) if len(leads) else None}
        for lead in [10, 15]:
            available = events.maximum_available_lead_minutes >= lead
            warned = events[name + "_lead_minutes"] >= lead
            result["models"][name][f"events_with_{lead}m_opportunity"] = int(available.sum())
            result["models"][name][f"recall_at_least_{lead}m_before_among_eligible"] = float(warned[available].mean()) if available.any() else None
    point, classifier = events.point_detected.to_numpy(bool), events.classifier_detected.to_numpy(bool)
    shared = point & classifier
    earlier = events.loc[shared, "classifier_lead_minutes"] - events.loc[shared, "point_lead_minutes"]
    result["paired"] = {"both_detected": int(shared.sum()), "point_only": int(np.sum(point & ~classifier)),
                        "classifier_only": int(np.sum(~point & classifier)), "neither": int(np.sum(~point & ~classifier)),
                        "classifier_later_on_shared_events": int(np.sum(earlier < 0)),
                        "same_lead_on_shared_events": int(np.sum(earlier == 0)),
                        "classifier_earlier_on_shared_events": int(np.sum(earlier > 0))}
    result["point_correct_direction_events_detected"] = int(events.point_correct_direction_detected.sum())
    return result


def pct(value):
    return f"{value:.2%}" if value is not None else "n/a"


def summarize(result):
    groups = result["positive_groups"]
    n = result["pooled"]["positives"]
    missed = {name: result["pooled"]["models"][name]["confusion_matrix"]["fn"] for name in NAMES}
    extra_missed = missed["classifier"] - missed["point"]
    late_extra = sum(groups["first_breach_lead_minutes"][lead]["models"]["classifier"]["confusion_matrix"]["fn"] -
                     groups["first_breach_lead_minutes"][lead]["models"]["point"]["confusion_matrix"]["fn"] for lead in ["10", "15"])
    transient = groups["recovery"]["back_in_range_at_15m"]
    mild = [groups["severity"][key] for key in ["0..0.2 C", "0.2..0.5 C"]]
    mild_n = sum(item["positives"] for item in mild)
    mild_fn = {name: sum(item["models"][name]["confusion_matrix"]["fn"] for item in mild) for name in NAMES}
    room_drop = {room: item["models"]["point"]["recall"] - item["models"]["classifier"]["recall"] for room, item in result["rooms"].items()}
    negative_share = (room_drop["room_minus22_minus18"] + room_drop["room_minus28_minus22"]) / sum(room_drop.values())
    lines = ["# Kết quả phân tích lỗi cảnh báo", "",
             "Đối chiếu đúng hai artifact đã chấm trong phép thử đầu, cùng 98 nguồn fit / 25 nguồn test. Đầu ra được tái tính và khớp với điểm số đã lưu. Model, API và production không thay đổi.", "",
             "## 1. Điểm yếu chính là cảnh báo trước 10–15 phút", "",
             "Bảng sau gộp các mẫu dự báo có nhiệt độ hiện tại còn trong ngưỡng, có chồng lặp giữa các preset; khác cách trung bình đều bốn preset của bảng benchmark ban đầu. Chia theo mốc đầu tiên trong t+5/t+10/t+15 quan sát thấy vượt ngưỡng; không phải thời điểm vượt chính xác giữa các lần đo.", "",
             "| Mốc đầu tiên vượt sau lúc dự báo | Mẫu | Recall model nhiệt độ | Recall classifier |", "|---|---:|---:|---:|"]
    for lead, item in groups["first_breach_lead_minutes"].items():
        lines.append(f"| {lead} phút | {item['positives']} | {pct(item['models']['point']['recall'])} | {pct(item['models']['classifier']['recall'])} |")
    lines += ["", f"Classifier có {extra_missed} mẫu bỏ sót tăng thêm ròng so với model nhiệt độ; {late_extra} mẫu ({pct(late_extra / extra_missed)}) thuộc nhóm cần báo trước 10–15 phút. Ở nhóm sắp vượt sau 5 phút, hai model gần tương đương. Kết quả này áp dụng tại các ngưỡng đã chọn, không chứng minh classifier luôn kém ở mọi mức nhạy.", "",
              "## 2. Phần mục tiêu mới định giải quyết có tỷ trọng nhỏ", "",
              f"Chỉ {transient['positives']}/{n} mẫu vượt ngưỡng ({pct(transient['positives']/n)}) đã trở lại ngưỡng ở phút 15. Classifier bắt {transient['models']['classifier']['confusion_matrix']['tp']} mẫu, model nhiệt độ bắt {transient['models']['point']['confusion_matrix']['tp']} mẫu trong nhóm này.",
              "Tức là việc mở mục tiêu sang vượt giữa chừng có lợi ở một nhóm nhỏ, nhưng chưa bù được phần giảm ở các mẫu vẫn vượt tại phút 15. Đề xuất ban đầu đã quá nhấn mạnh nhóm này trước khi kiểm tra tần suất của nó.", "",
              "## 3. Vượt nhẹ sát ngưỡng là vùng khó chính", "",
              f"Các mẫu vượt tối đa 0,5 C: {mild_n}/{n} ({pct(mild_n/n)}). Chúng chiếm {pct(mild_fn['point']/missed['point'])} số bỏ sót của model nhiệt độ và {pct(mild_fn['classifier']/missed['classifier'])} số bỏ sót của classifier.", "",
              "| Độ vượt lớn nhất trong 15 phút | Recall nhiệt độ | Recall classifier |", "|---|---:|---:|"]
    for key in ["0..0.2 C", "0.2..0.5 C", ">2 C"]:
        item = groups["severity"][key]
        lines.append(f"| {key} | {pct(item['models']['point']['recall'])} | {pct(item['models']['classifier']['recall'])} |")
    lines += ["", "Không thể từ đây tự kết luận các lần vượt nhẹ là vô hại hoặc bỏ nhãn của chúng. Bảng chỉ xác định vùng lỗi của benchmark.", "",
              "## 4. Bỏ sót một thời điểm khác với bỏ sót cả đợt", "",
              "Một đợt trong bảng là chuỗi điểm đo 5 phút liên tiếp ngoài ngưỡng. Đợt được xem là có cảnh báo nếu có ít nhất một dự báo phát cảnh báo trong 15 phút trước khi bắt đầu, khi có lịch sử đầu vào hợp lệ. Bảng tính cảnh báo bất kỳ; số đợt có cảnh báo đúng hướng trên/dưới của model nhiệt độ được ghi riêng trong analysis.json.", "",
              "| Preset | Đợt đủ điều kiện | Có cảnh báo bằng model nhiệt độ | Có cảnh báo bằng classifier |", "|---|---:|---:|---:|"]
    for room, item in result["events"]["rooms"].items():
        lines.append(f"| {room} | {item['events']} | {pct(item['models']['point']['recall'])} | {pct(item['models']['classifier']['recall'])} |")
    frozen = result["events"]["rooms"]["room_minus22_minus18"]
    lines += ["", f"Ở preset -22..-18 C, hai model cùng cảnh báo được {frozen['models']['point']['detected']}/{frozen['events']} đợt, nhưng trung vị thời gian báo trước của các đợt được bắt là {frozen['models']['point']['median_observed_lead_minutes_when_detected']:.0f} phút với model nhiệt độ và {frozen['models']['classifier']['median_observed_lead_minutes_when_detected']:.0f} phút với classifier.",
              "Các tỷ lệ theo đợt không thay thế recall tại từng thời điểm hay mục tiêu báo trước đủ 15 phút. Đây là replay trên dữ liệu công khai theo mẫu 5 phút, chưa mô phỏng đầy đủ lịch chạy, hysteresis và thông báo của backend.", "",
              "## 5. Hai preset nhiệt độ âm ảnh hưởng mạnh đến số trung bình", "",
              f"Hai preset -22..-18 và -28..-22 C tạo ra {pct(negative_share)} phần giảm recall trung bình đều theo preset. Chúng lần lượt chỉ có 9 và 3 nguồn test có mẫu phù hợp.",
              "Preset -28..-22 C có 206/253 mẫu vượt ngưỡng thuộc nguồn 030_2DT. Vì vậy vài nguồn chi phối mạnh kết quả; không suy rộng thành chất lượng cho tất cả phòng lạnh.", "",
              "## 6. Phép thử có khác biệt về dữ liệu dùng học", "",
              f"Model nhiệt độ học {result['training_coverage']['physical_training_windows']:,} cửa sổ lịch sử vật lý; classifier chỉ học {result['training_coverage']['unique_physical_windows_used_by_classifier']:,} cửa sổ vật lý có nhiệt độ hiện tại trong ít nhất một preset. Sau áp các preset chồng nhau, classifier có {result['training_coverage']['classifier_room_examples_including_overlap']:,} hàng huấn luyện.",
              "Hai model giữ cùng phép chia nguồn nhưng chưa dùng đúng cùng tập mẫu để so riêng tác dụng của mục tiêu hồi quy/phân loại. Đây là một yếu tố gây nhiễu cần kiểm chứng; chưa có bằng chứng rằng chỉ yếu tố này gây ra kết quả giảm.", "",
              "## Cách xử lý tiếp theo dựa trên phân tích", "",
              "- Ưu tiên phép thử kiểm soát: cùng tập mẫu và đặc trưng, cùng định nghĩa cảnh báo, cùng ngân sách báo nhầm từng preset. Tách riêng tác dụng của giảm dữ liệu huấn luyện, đổi mục tiêu và đổi ngưỡng.",
              "- Giữ model nhiệt độ hiện tại làm đối chứng. Nếu thử kết hợp, tạo dự báo nhiệt độ ngoài fold làm đặc trưng cho classifier để dùng lại tín hiệu liên tục mà bộ hồi quy đã học; không dùng dự báo từ model đã fit chính mẫu đó làm dữ liệu train cho tầng sau.",
              "- Báo cáo đồng thời recall từng mẫu, tỷ lệ bắt được đợt và thời gian báo trước. Không gộp tất cả thành một con số độ chính xác.",
              "- Chưa xác định được nguyên nhân vật lý của các lần tăng/giảm nhiệt. Không quy chúng cho mở cửa hoặc lỗi máy nén khi dữ liệu không có nhãn tương ứng.", "",
              "[Bảng và phương pháp đầy đủ](report.md) · [Số liệu](analysis.json) · [Các ví dụ](sample_cases.csv)", ""]
    return "\n".join(lines)


def table_groups(title, groups):
    lines = ["## " + title, "", "| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |", "|---|---:|---:|---:|---:|"]
    for name, entry in groups.items():
        a, b = entry["models"]["point"], entry["models"]["classifier"]
        lines.append(f"| {name} | {entry['positives']} | {pct(a['recall'])} | {pct(b['recall'])} | {a['confusion_matrix']['fn']} / {b['confusion_matrix']['fn']} |")
    return lines + [""]


def render(result):
    lines = ["# Phân tích lỗi cảnh báo theo mẫu và nguồn", "",
             "Phân tích các dự báo đã lưu của phép thử đầu: HGBRegressor 500 vòng và HGBClassifier 300 vòng cùng fit trên 98 nguồn, chấm trên cùng 25 nguồn giữ riêng. Không huấn luyện lại hoặc đổi ngưỡng model.", "",
             "Dữ liệu công khai đã được dùng trong các thử nghiệm trước. Nhãn cảnh báo là có ít nhất một nhiệt độ quan sát vượt ngưỡng ở t+5/t+10/t+15 trong khi nhiệt độ hiện tại còn trong ngưỡng. Không có nhãn sự cố kho thật hoặc nguyên nhân vật lý của lần tăng/giảm nhiệt.", "",
             "T_MS/T_FC chỉ là nhãn kênh của dữ liệu ngoài, không dùng để chia loại phòng hay chọn model.", "",
             "## Theo preset phòng", "", "| Preset | Nguồn test có mẫu | Mẫu vượt ngưỡng | Recall nhiệt độ | Recall classifier | FPR nhiệt độ | FPR classifier |", "|---|---:|---:|---:|---:|---:|---:|"]
    for room, entry in result["rooms"].items():
        a, b = entry["models"]["point"], entry["models"]["classifier"]
        lines.append(f"| {room} | {entry['sources']} | {entry['positives']} | {pct(a['recall'])} | {pct(b['recall'])} | {pct(a['false_positive_rate'])} | {pct(b['false_positive_rate'])} |")
    lines += ["", "## Cách gộp chỉ số", "", "| Cách tính | Recall nhiệt độ | Recall classifier | FPR nhiệt độ | FPR classifier |", "|---|---:|---:|---:|---:|"]
    for mode, entries in [("Trung bình đều bốn preset", result["macro"]), ("Gộp các mẫu đánh giá có chồng lặp giữa preset", result["pooled"]["models"])]:
        a, b = entries["point"], entries["classifier"]
        lines.append(f"| {mode} | {pct(a['recall'])} | {pct(b['recall'])} | {pct(a['false_positive_rate'])} | {pct(b['false_positive_rate'])} |")
    lines += ["", "Các mẫu liên tiếp và mẫu được áp nhiều preset không độc lập. Số dự báo sai không đồng nghĩa số thông báo thật mà backend sẽ gửi.", ""]
    groups = result["positive_groups"]
    for key, title in [("first_breach_lead_minutes", "Khoảng cách từ lúc dự báo đến điểm đo đầu tiên vượt ngưỡng (phút)"),
                       ("direction", "Lỗi theo hướng vượt ngưỡng"), ("severity", "Lỗi theo độ vượt ngưỡng lớn nhất trong 15 phút"),
                       ("recovery", "Vượt thoáng qua và còn vượt tại phút 15"), ("future_outside_count", "Số điểm đo tương lai vượt ngưỡng"),
                       ("recent_history", "Mức biến động trước thời điểm dự báo")]:
        lines += table_groups(title, groups[key])
    lines += ["stable_recently: biến động 5 phút không quá 0,2 C và 15 phút không quá 0,3 C. Đây là mô tả dữ liệu, không chứng minh có mở cửa hay có sự cố máy nén.", "",
              "Một điểm đo vượt ngưỡng tại phút 15 có thể là khởi đầu một đợt kéo dài; không được tự coi mọi mẫu chỉ vượt một mốc là thoáng qua.", "",
              "## Các đợt có mẫu vượt ngưỡng liên tiếp", "",
              "Một đợt là một chuỗi các điểm đo liên tiếp ngoài ngưỡng trong dữ liệu 5 phút. Chỉ tính đợt có ít nhất một mẫu dự báo hợp lệ trong 15 phút trước khi bắt đầu. Bắt được đợt nếu có ít nhất một cảnh báo ở các mẫu hợp lệ đó.", "",
              "Thời gian giữa hai điểm đo không được quan sát liên tục; hai điểm ngoài ngưỡng cách nhau 5 phút không chứng minh nhiệt độ liên tục ngoài ngưỡng cả 10 phút. Lead time trong bảng là thời gian theo mẫu lịch sử, chưa phải hiệu năng vận hành backend.", "",
              "| Preset | Đợt đủ điều kiện | Nguồn | Bắt được bằng nhiệt độ | Bắt được bằng classifier |", "|---|---:|---:|---:|---:|"]
    for room, entry in result["events"]["rooms"].items():
        lines.append(f"| {room} | {entry['events']} | {entry['sources']} | {pct(entry['models']['point']['recall'])} | {pct(entry['models']['classifier']['recall'])} |")
    lines += ["", "| Độ dài theo số điểm ngoài ngưỡng liên tiếp | Đợt | Recall nhiệt độ | Recall classifier |", "|---|---:|---:|---:|"]
    for name, entry in result["events"]["by_run_length"].items():
        lines.append(f"| {name} | {entry['events']} | {pct(entry['models']['point']['recall'])} | {pct(entry['models']['classifier']['recall'])} |")
    lines += ["", "## Kiểm tra ngưỡng và khả năng xếp hạng", "",
              "Các giá trị trên đường ROC sau đây dùng nhãn test để mô tả đường cong. Chúng không phải ngưỡng được hiệu chỉnh độc lập, không dùng để đổi cấu hình hoặc tuyên bố model đã cải thiện khi triển khai.", "",
              "| Preset | Recall nhiệt độ trên ROC tại FPR 4% | Recall classifier trên ROC tại FPR 4% | Recall nhiệt độ / classifier tại FPR gốc của nhiệt độ |", "|---|---:|---:|---:|"]
    for room, entry in result["roc_diagnostics"].items():
        a, b = entry["models"]["point"], entry["models"]["classifier"]
        lines.append(f"| {room} | {pct(a['test_curve_recall_at_fpr_4pct'])} | {pct(b['test_curve_recall_at_fpr_4pct'])} | {pct(a['test_curve_recall_at_baseline_fpr'])} / {pct(b['test_curve_recall_at_baseline_fpr'])} |")
    lines += ["", "| Preset | Ngưỡng classifier đã chọn | FPR classifier OOF | FPR classifier test | Trung vị điểm nguy cơ của mẫu dương OOF → test |", "|---|---:|---:|---:|---:|"]
    for room, entry in result["roc_diagnostics"].items():
        a, b = entry["classifier_score_distribution"]["development_oof"], entry["classifier_score_distribution"]["source_holdout"]
        lines.append(f"| {room} | {result['classifier_thresholds'][room]:.4f} | {pct(a['measured_fpr'])} | {pct(b['measured_fpr'])} | {a['positive_median']:.3f} → {b['positive_median']:.3f} |")
    lines += ["", "Điểm số thay đổi giữa OOF và test là quan sát thực tế. Phân tích này chưa tách được ảnh hưởng của thay nguồn dữ liệu với thay số nguồn dùng để fit model.", "",
              "## Các đối chứng đơn giản", "", "| Cách dự báo | MAE sau 15 phút trên cùng các mẫu vật lý test | Recall trung bình theo preset | FPR trung bình theo preset |", "|---|---:|---:|---:|"]
    for name, entry in result["simple_controls"].items():
        lines.append(f"| {name} | {entry['endpoint_mae']:.4f} C | {pct(entry['macro_recall'])} | {pct(entry['macro_fpr'])} |")
    lines += ["", "Hai ngoại suy tuyến tính chỉ là đối chứng phân tích, không được chọn hoặc tích hợp làm model mới.", "",
              "## Nguồn tập trung phần bỏ sót tăng thêm", "", "| Preset | Nguồn | Mẫu dương | Chỉ nhiệt độ bắt được | Chỉ classifier bắt được | Classifier bỏ sót tăng thêm |", "|---|---|---:|---:|---:|---:|"]
    for entry in result["top_sources_additional_misses"]:
        lines.append(f"| {entry['room']} | {entry['source']} | {entry['positives']} | {entry['point_only_detected']} | {entry['classifier_only_detected']} | {entry['additional_misses']} |")
    lines += ["", "## Kiểm tra phép thử tuning sau", "", json.dumps(result["later_tuning_aggregation_check"], indent=2, ensure_ascii=False), "",
              "Phần này thuộc phép thử 73 nguồn fit khác với phép so sánh chính 98 nguồn ở trên. Không trộn hai lượt để tính mức cải thiện.", "",
              "## File đi kèm và kiểm tra", "",
              "- `analysis.json`: số liệu đầy đủ, từng nhóm lỗi, từng nguồn, ngưỡng và đường cong chẩn đoán.",
              "- `source_errors.csv`: thống kê từng nguồn/preset, không dùng để loại nguồn xấu khỏi benchmark.",
              "- `event_errors.csv`: từng đợt đủ điều kiện với số điểm đo và cảnh báo trước đợt.",
              "- `sample_cases.csv`: các ví dụ đối chiếu lịch sử, tương lai, dự báo và quyết định.",
              "- Kiểm tra hash dữ liệu, tái tính đầu ra artifact, so khớp điểm số đã lưu và tái lập recall/FPR của báo cáo gốc.",
              "- Model runtime, API và production không thay đổi.", "",
              "## Chạy lại phân tích", "", "Từ thư mục gốc worktree AI:", "", "```powershell",
              "$env:OMP_NUM_THREADS='4'", "$env:OPENBLAS_NUM_THREADS='4'",
              ".venv-ai/Scripts/python.exe -B ai-service/experiments/room_warning_error_analysis.py --project-root . --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-error-analysis-reproduction", "```", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.project_root / "ai-service/experiments"))
    global ROOMS, classification
    from room_warning import FEATURE_NAMES, ROOMS, WARNING_FEATURES, classification, decisions, evaluate, load_room_data, make_examples
    self_check()
    run = args.project_root / "ai-service/experiments/results/room-warning-2026-10-17"
    metadata = json.loads((run / "metrics.json").read_text(encoding="utf-8"))
    runtime_path = args.project_root / "ai-service/temperature_model_history.pkl"
    runtime_hash = hashlib.sha256(runtime_path.read_bytes()).hexdigest()
    frame, sources = load_room_data(args.raw_dir)
    assert sources == metadata["dataset"]["sources"], "Raw source manifest changed"
    auxiliary, raw_series = [], {}
    test_sources = set(metadata["split"]["holdout_sources"])
    for source in sources:
        raw = pd.read_csv(args.raw_dir / source["file"], sep="\t", usecols=["Time", "T_MS", "T_FC"])
        source_id = Path(source["file"]).stem
        for channel in ["T_MS", "T_FC"]:
            auxiliary.append(pd.DataFrame({"refrigerator": source_id, "compartment": channel, "elapsed_minutes": raw.Time,
                                           "future_5m": raw[channel].shift(-1), "future_10m": raw[channel].shift(-2)}))
            if source_id in test_sources:
                raw_series[(source_id, channel)] = raw
    frame = frame.merge(pd.concat(auxiliary, ignore_index=True), on=["refrigerator", "compartment", "elapsed_minutes"], how="left", validate="one_to_one", sort=False)
    assert len(frame) == metadata["dataset"]["rows"]
    assert np.isfinite(frame[["future_5m", "future_10m", "future_temp_15m"]]).all().all()
    assert np.allclose(frame[["future_5m", "future_10m", "future_temp_15m"]].min(axis=1), frame.future_min_15m)
    assert np.allclose(frame[["future_5m", "future_10m", "future_temp_15m"]].max(axis=1), frame.future_max_15m)
    holdout = frame.loc[frame.refrigerator.isin(test_sources)].reset_index(drop=True)
    development = frame.loc[frame.refrigerator.isin(metadata["split"]["development_sources"])].reset_index(drop=True)
    examples, dev_examples = make_examples(holdout), make_examples(development)
    thresholds = metadata["development"]["thresholds"]["hist_gradient_boosting"]
    with np.load(run / "holdout_scores.npz") as stored:
        examples["score_point"], examples["score_classifier"] = stored["point"], stored["hist_gradient_boosting"]
    with np.load(run / "development_scores.npz") as stored:
        dev_examples["score_point"], dev_examples["score_classifier"] = stored["point"], stored["hist_gradient_boosting"]
    for data in [examples, dev_examples]:
        data["alarm_point"] = data.score_point > 0
        data["alarm_classifier"] = decisions(data, data.score_classifier.to_numpy(), thresholds)
    with threadpool_limits(limits=4):
        artifact = joblib.load(run / "evaluated_warning_models.pkl")
        prediction = artifact["models"]["point"].predict(holdout[FEATURE_NAMES]) + holdout.temperature.to_numpy()
        examples["predicted_temp_15m"] = prediction[examples.row_position.to_numpy()]
        expected_point_score = np.maximum(examples.room_min - examples.predicted_temp_15m, examples.predicted_temp_15m - examples.room_max)
        assert np.allclose(expected_point_score, examples.score_point, rtol=0, atol=1e-12)
        assert np.allclose(artifact["models"]["hist_gradient_boosting"].predict_proba(examples[WARNING_FEATURES])[:, 1], examples.score_classifier, rtol=0, atol=1e-12)
    a = examples[["future_5m", "future_10m", "future_temp_15m"]].to_numpy()
    low, high = examples.room_min.to_numpy()[:, None], examples.room_max.to_numpy()[:, None]
    out = (a < low) | (a > high)
    assert np.array_equal(out.any(axis=1), examples.breach)
    examples["outside_count"] = out.sum(axis=1)
    examples["first_breach_lead_minutes"] = np.where(out.any(axis=1), (out.argmax(axis=1) + 1) * 5, 0)
    examples["pattern"] = ["".join(str(int(bit)) for bit in row) for row in out]
    examples["endpoint_breach"] = out[:, -1]
    above, below = (a > high).any(axis=1), (a < low).any(axis=1)
    examples["direction"] = np.select([above & below, above, below], ["both", "above_only", "below_only"], default="none")
    examples["excursion"] = np.maximum(np.maximum((a - high).max(axis=1), (low - a).max(axis=1)), 0).round(6)
    examples["stable_recently"] = (examples.temp_delta.abs() <= .2 + EPS) & ((examples.temperature - examples.temp_lag_15m).abs() <= .3 + EPS)
    examples["nearest_boundary"] = np.minimum(examples.distance_to_min, examples.distance_to_max).round(6)
    result = {"created_at": datetime.now(timezone.utc).isoformat(), "reference_run": str(run), "runtime_sha256": runtime_hash,
              "classifier_thresholds": thresholds, "rooms": {}, "macro": {}, "pooled": stats(examples),
              "positive_groups": positive_groups(examples), "positive_groups_by_room": {}, "false_alarms_by_boundary_distance": {}}
    result["training_coverage"] = {"physical_training_windows": len(development),
                                    "classifier_room_examples_including_overlap": len(dev_examples),
                                    "unique_physical_windows_used_by_classifier": int(dev_examples.row_position.nunique()),
                                    "point_training_sources": int(development.refrigerator.nunique()),
                                    "classifier_sources_with_eligible_examples": int(dev_examples.refrigerator.nunique())}
    result["wrong_direction_point_warnings_on_positive_samples"] = int(np.sum(
        examples.breach & examples.alarm_point &
        ~(((examples.predicted_temp_15m > examples.room_max) & above) | ((examples.predicted_temp_15m < examples.room_min) & below))))
    for name in NAMES:
        model_key = "point_default" if name == "point" else "hist_gradient_boosting"
        metrics = evaluate(examples, examples.breach.to_numpy(), examples["alarm_" + name].to_numpy(), examples["score_" + name].to_numpy())
        result["macro"][name] = metrics["macro"]
        expected = metadata["holdout"]["evaluations"][model_key]["macro"]
        for key in ["recall", "false_positive_rate", "precision", "average_precision"]:
            assert abs(metrics["macro"][key] - expected[key]) < 1e-12
        development_metrics = evaluate(dev_examples, dev_examples.breach.to_numpy(), dev_examples["alarm_" + name].to_numpy(), dev_examples["score_" + name].to_numpy())
        for key in ["recall", "false_positive_rate", "precision", "average_precision"]:
            assert abs(development_metrics["macro"][key] - metadata["development"]["evaluations"][model_key]["macro"][key]) < 1e-12
    for room in ROOMS:
        part = examples.loc[examples.room == room]
        result["rooms"][room] = stats(part)
        result["positive_groups_by_room"][room] = positive_groups(part)
    for name, lower, upper in [("0..0.2 C", -2 * EPS, .2), ("0.2..0.5 C", .2, .5), ("0.5..1 C", .5, 1.), (">1 C", 1., np.inf)]:
        result["false_alarms_by_boundary_distance"][name] = stats(examples, ~examples.breach & (examples.nearest_boundary > lower + EPS) & (examples.nearest_boundary <= upper + EPS))
    result["roc_diagnostics"] = roc_diagnostics(examples, dev_examples)
    source_table = source_stats(examples)
    result["top_sources_additional_misses"] = source_table.sort_values("additional_misses", ascending=False).head(12).to_dict(orient="records")
    events, result["events"] = summarize_events(raw_series, examples)
    result["simple_controls"] = {}
    predictions = {"persistence": holdout.temperature.to_numpy(),
                   "linear_last_5m": holdout.temperature.to_numpy() + 3 * holdout.temp_delta.to_numpy(),
                   "linear_last_15m": 2 * holdout.temperature.to_numpy() - holdout.temp_lag_15m.to_numpy(),
                   "hgb_regressor": prediction}
    for name, values in predictions.items():
        point = values[examples.row_position.to_numpy()]
        alarms = (point < examples.room_min) | (point > examples.room_max)
        metrics = evaluate(examples, examples.breach.to_numpy(), np.asarray(alarms))
        result["simple_controls"][name] = {"endpoint_mae": float(np.mean(np.abs(values - holdout.future_temp_15m.to_numpy()))),
                                            "macro_recall": metrics["macro"]["recall"], "macro_fpr": metrics["macro"]["false_positive_rate"]}
    tuning = json.loads((args.project_root / "ai-service/experiments/results/room-warning-tuning-2026-10-17/metrics.json").read_text(encoding="utf-8"))
    primary = tuning["source_runs"][0]
    result["later_tuning_aggregation_check"] = {}
    for name, item in [("point_default", primary["point_default"]),
                       ("classifier_oof_threshold", primary["oof_threshold_test"]["hgb_base_300"]["0.04"])]:
        cm = {key: sum(room["confusion_matrix"][key] for room in item["rooms"].values()) for key in ["tp", "fn", "fp", "tn"]}
        result["later_tuning_aggregation_check"][name] = {"macro_recall": item["macro"]["recall"], "macro_fpr": item["macro"]["false_positive_rate"],
            "pooled_false_positives": cm["fp"], "pooled_fpr": cm["fp"] / (cm["fp"] + cm["tn"]), "note": "Forecast samples can overlap between presets; these are not production notifications."}
    sample_parts = []
    masks = {"point_detected_classifier_missed": examples.breach & examples.alarm_point & ~examples.alarm_classifier,
             "classifier_detected_point_missed": examples.breach & ~examples.alarm_point & examples.alarm_classifier,
             "both_missed_with_stable_history": examples.breach & ~examples.alarm_point & ~examples.alarm_classifier & examples.stable_recently,
             "point_false_alarm_classifier_suppressed": ~examples.breach & examples.alarm_point & ~examples.alarm_classifier,
             "classifier_false_alarm_only": ~examples.breach & ~examples.alarm_point & examples.alarm_classifier}
    for role, mask in masks.items():
        part = examples.loc[mask].sort_values(["excursion", "nearest_boundary"], ascending=[False, True]).drop_duplicates(["room", "refrigerator"]).head(8).copy()
        part["example_role"] = role
        part["classifier_threshold"] = part.room.map(thresholds)
        sample_parts.append(part)
    cases = pd.concat(sample_parts, ignore_index=True)
    case_columns = ["example_role", "room", "refrigerator", "compartment", "elapsed_minutes", "temperature", "temp_lag_5m", "temp_lag_15m",
                    "future_5m", "future_10m", "future_temp_15m", "predicted_temp_15m", "score_classifier", "classifier_threshold", "alarm_point", "alarm_classifier", "excursion", "pattern"]
    assert hashlib.sha256(runtime_path.read_bytes()).hexdigest() == runtime_hash
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "analysis.json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    (args.output_dir / "report.md").write_text(render(result), encoding="utf-8")
    (args.output_dir / "summary.md").write_text(summarize(result), encoding="utf-8")
    source_table.to_csv(args.output_dir / "source_errors.csv", index=False)
    events.to_csv(args.output_dir / "event_errors.csv", index=False)
    cases[case_columns].to_csv(args.output_dir / "sample_cases.csv", index=False)
    print(json.dumps({"output": str(args.output_dir), "validation": "raw hashes, targets, saved predictions and original metrics match",
                      "physical_training_windows": result["training_coverage"],
                      "first_breach_recall": {lead: {"point": item["models"]["point"]["recall"], "classifier": item["models"]["classifier"]["recall"]}
                                              for lead, item in result["positive_groups"]["first_breach_lead_minutes"].items()},
                      "runtime_unchanged": True}, indent=2))


if __name__ == "__main__":
    main()
