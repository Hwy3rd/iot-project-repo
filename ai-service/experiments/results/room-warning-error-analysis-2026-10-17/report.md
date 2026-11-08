# Phân tích lỗi cảnh báo theo mẫu và nguồn

Phân tích các dự báo đã lưu của phép thử đầu: HGBRegressor 500 vòng và HGBClassifier 300 vòng cùng fit trên 98 nguồn, chấm trên cùng 25 nguồn giữ riêng. Không huấn luyện lại hoặc đổi ngưỡng model.

Dữ liệu công khai đã được dùng trong các thử nghiệm trước. Nhãn cảnh báo là có ít nhất một nhiệt độ quan sát vượt ngưỡng ở t+5/t+10/t+15 trong khi nhiệt độ hiện tại còn trong ngưỡng. Không có nhãn sự cố kho thật hoặc nguyên nhân vật lý của lần tăng/giảm nhiệt.

T_MS/T_FC chỉ là nhãn kênh của dữ liệu ngoài, không dùng để chia loại phòng hay chọn model.

## Theo preset phòng

| Preset | Nguồn test có mẫu | Mẫu vượt ngưỡng | Recall nhiệt độ | Recall classifier | FPR nhiệt độ | FPR classifier |
|---|---:|---:|---:|---:|---:|---:|
| room_0_4 | 22 | 2326 | 68.66% | 65.69% | 3.41% | 3.15% |
| room_2_6 | 23 | 1738 | 50.17% | 45.22% | 1.54% | 1.46% |
| room_minus22_minus18 | 9 | 999 | 64.96% | 54.15% | 10.46% | 2.97% |
| room_minus28_minus22 | 3 | 253 | 50.20% | 30.04% | 0.64% | 0.35% |

## Cách gộp chỉ số

| Cách tính | Recall nhiệt độ | Recall classifier | FPR nhiệt độ | FPR classifier |
|---|---:|---:|---:|---:|
| Trung bình đều bốn preset | 58.50% | 48.78% | 4.01% | 1.98% |
| Gộp các mẫu đánh giá có chồng lặp giữa preset | 61.04% | 55.14% | 2.71% | 2.29% |

Các mẫu liên tiếp và mẫu được áp nhiều preset không độc lập. Số dự báo sai không đồng nghĩa số thông báo thật mà backend sẽ gửi.

## Khoảng cách từ lúc dự báo đến điểm đo đầu tiên vượt ngưỡng (phút)

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| 5 | 1974 | 81.71% | 81.31% | 361 / 369 |
| 10 | 1781 | 62.77% | 53.34% | 663 / 831 |
| 15 | 1561 | 32.93% | 24.09% | 1047 / 1185 |

## Lỗi theo hướng vượt ngưỡng

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| above_only | 2500 | 54.24% | 46.16% | 1144 / 1346 |
| below_only | 2806 | 66.96% | 62.97% | 927 / 1039 |
| both | 10 | 100.00% | 100.00% | 0 / 0 |

## Lỗi theo độ vượt ngưỡng lớn nhất trong 15 phút

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| 0..0.2 C | 1285 | 31.52% | 21.48% | 880 / 1009 |
| 0.2..0.5 C | 1087 | 50.69% | 42.41% | 536 / 626 |
| 0.5..1 C | 1199 | 71.73% | 68.14% | 339 / 382 |
| 1..2 C | 702 | 74.07% | 67.52% | 182 / 228 |
| >2 C | 1043 | 87.15% | 86.58% | 134 / 140 |

## Vượt thoáng qua và còn vượt tại phút 15

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| back_in_range_at_15m | 251 | 44.22% | 51.39% | 140 / 122 |
| outside_at_15m | 5065 | 61.88% | 55.32% | 1931 / 2263 |

## Số điểm đo tương lai vượt ngưỡng

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| 1 | 1722 | 33.45% | 26.13% | 1146 / 1272 |
| 2 | 1802 | 63.60% | 54.77% | 656 / 815 |
| 3 | 1792 | 84.99% | 83.37% | 269 / 298 |

## Mức biến động trước thời điểm dự báo

| Nhóm | Mẫu vượt ngưỡng | Recall dự báo nhiệt độ | Recall classifier | Bỏ sót dự báo / classifier |
|---|---:|---:|---:|---:|
| stable_recently | 806 | 35.61% | 22.83% | 519 / 622 |
| already_changing | 4510 | 65.59% | 60.91% | 1552 / 1763 |

stable_recently: biến động 5 phút không quá 0,2 C và 15 phút không quá 0,3 C. Đây là mô tả dữ liệu, không chứng minh có mở cửa hay có sự cố máy nén.

Một điểm đo vượt ngưỡng tại phút 15 có thể là khởi đầu một đợt kéo dài; không được tự coi mọi mẫu chỉ vượt một mốc là thoáng qua.

## Các đợt có mẫu vượt ngưỡng liên tiếp

Một đợt là một chuỗi các điểm đo liên tiếp ngoài ngưỡng trong dữ liệu 5 phút. Chỉ tính đợt có ít nhất một mẫu dự báo hợp lệ trong 15 phút trước khi bắt đầu. Bắt được đợt nếu có ít nhất một cảnh báo ở các mẫu hợp lệ đó.

Thời gian giữa hai điểm đo không được quan sát liên tục; hai điểm ngoài ngưỡng cách nhau 5 phút không chứng minh nhiệt độ liên tục ngoài ngưỡng cả 10 phút. Lead time trong bảng là thời gian theo mẫu lịch sử, chưa phải hiệu năng vận hành backend.

| Preset | Đợt đủ điều kiện | Nguồn | Bắt được bằng nhiệt độ | Bắt được bằng classifier |
|---|---:|---:|---:|---:|
| room_0_4 | 853 | 21 | 89.80% | 89.92% |
| room_2_6 | 652 | 22 | 79.14% | 73.01% |
| room_minus22_minus18 | 386 | 9 | 90.93% | 90.93% |
| room_minus28_minus22 | 85 | 3 | 92.94% | 71.76% |

| Độ dài theo số điểm ngoài ngưỡng liên tiếp | Đợt | Recall nhiệt độ | Recall classifier |
|---|---:|---:|---:|
| one_observed_reading | 92 | 63.04% | 64.13% |
| two_observed_readings | 92 | 70.65% | 66.30% |
| three_or_more_observed_readings | 1792 | 88.67% | 85.66% |

## Kiểm tra ngưỡng và khả năng xếp hạng

Các giá trị trên đường ROC sau đây dùng nhãn test để mô tả đường cong. Chúng không phải ngưỡng được hiệu chỉnh độc lập, không dùng để đổi cấu hình hoặc tuyên bố model đã cải thiện khi triển khai.

| Preset | Recall nhiệt độ trên ROC tại FPR 4% | Recall classifier trên ROC tại FPR 4% | Recall nhiệt độ / classifier tại FPR gốc của nhiệt độ |
|---|---:|---:|---:|
| room_0_4 | 71.20% | 71.88% | 68.66% / 68.53% |
| room_2_6 | 63.87% | 60.18% | 50.17% / 46.20% |
| room_minus22_minus18 | 47.05% | 57.46% | 64.96% / 67.97% |
| room_minus28_minus22 | 59.29% | 61.66% | 52.57% / 41.11% |

| Preset | Ngưỡng classifier đã chọn | FPR classifier OOF | FPR classifier test | Trung vị điểm nguy cơ của mẫu dương OOF → test |
|---|---:|---:|---:|---:|
| room_0_4 | 0.5000 | 2.58% | 3.15% | 0.441 → 0.650 |
| room_2_6 | 0.5416 | 1.71% | 1.46% | 0.412 → 0.495 |
| room_minus22_minus18 | 0.6401 | 6.91% | 2.97% | 0.615 → 0.676 |
| room_minus28_minus22 | 0.7089 | 3.25% | 0.35% | 0.567 → 0.427 |

Điểm số thay đổi giữa OOF và test là quan sát thực tế. Phân tích này chưa tách được ảnh hưởng của thay nguồn dữ liệu với thay số nguồn dùng để fit model.

## Các đối chứng đơn giản

| Cách dự báo | MAE sau 15 phút trên cùng các mẫu vật lý test | Recall trung bình theo preset | FPR trung bình theo preset |
|---|---:|---:|---:|
| persistence | 1.0910 C | 0.00% | 0.00% |
| linear_last_5m | 1.1245 C | 52.40% | 7.06% |
| linear_last_15m | 1.3746 C | 34.12% | 9.24% |
| hgb_regressor | 0.5582 C | 58.50% | 4.01% |

Hai ngoại suy tuyến tính chỉ là đối chứng phân tích, không được chọn hoặc tích hợp làm model mới.

## Nguồn tập trung phần bỏ sót tăng thêm

| Preset | Nguồn | Mẫu dương | Chỉ nhiệt độ bắt được | Chỉ classifier bắt được | Classifier bỏ sót tăng thêm |
|---|---|---:|---:|---:|---:|
| room_minus22_minus18 | 102_2DT | 296 | 61 | 12 | 49 |
| room_0_4 | 114_2DT | 422 | 51 | 3 | 48 |
| room_minus28_minus22 | 030_2DT | 206 | 49 | 2 | 47 |
| room_minus22_minus18 | 030_2DT | 238 | 48 | 11 | 37 |
| room_2_6 | 105_2DT | 170 | 25 | 3 | 22 |
| room_2_6 | 014_2DT | 108 | 21 | 1 | 20 |
| room_2_6 | 034_1D | 66 | 19 | 2 | 17 |
| room_0_4 | 028_1D | 103 | 17 | 1 | 16 |
| room_0_4 | 071_1D | 63 | 16 | 0 | 16 |
| room_minus22_minus18 | 016_2DT | 59 | 13 | 0 | 13 |
| room_0_4 | 086_1D | 283 | 14 | 1 | 13 |
| room_2_6 | 075_1D | 47 | 12 | 1 | 11 |

## Kiểm tra phép thử tuning sau

{
  "point_default": {
    "macro_recall": 0.5690277226822305,
    "macro_fpr": 0.0341249540736245,
    "pooled_false_positives": 1006,
    "pooled_fpr": 0.025586896253529008,
    "note": "Forecast samples can overlap between presets; these are not production notifications."
  },
  "classifier_oof_threshold": {
    "macro_recall": 0.5935879426997751,
    "macro_fpr": 0.03205058376079604,
    "pooled_false_positives": 1868,
    "pooled_fpr": 0.047511254673550884,
    "note": "Forecast samples can overlap between presets; these are not production notifications."
  }
}

Phần này thuộc phép thử 73 nguồn fit khác với phép so sánh chính 98 nguồn ở trên. Không trộn hai lượt để tính mức cải thiện.

## File đi kèm và kiểm tra

- `analysis.json`: số liệu đầy đủ, từng nhóm lỗi, từng nguồn, ngưỡng và đường cong chẩn đoán.
- `source_errors.csv`: thống kê từng nguồn/preset, không dùng để loại nguồn xấu khỏi benchmark.
- `event_errors.csv`: từng đợt đủ điều kiện với số điểm đo và cảnh báo trước đợt.
- `sample_cases.csv`: các ví dụ đối chiếu lịch sử, tương lai, dự báo và quyết định.
- Kiểm tra hash dữ liệu, tái tính đầu ra artifact, so khớp điểm số đã lưu và tái lập recall/FPR của báo cáo gốc.
- Model runtime, API và production không thay đổi.

## Chạy lại phân tích

Từ thư mục gốc worktree AI:

```powershell
$env:OMP_NUM_THREADS='4'
$env:OPENBLAS_NUM_THREADS='4'
.venv-ai/Scripts/python.exe -B ai-service/experiments/room_warning_error_analysis.py --project-root . --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-error-analysis-reproduction
```
