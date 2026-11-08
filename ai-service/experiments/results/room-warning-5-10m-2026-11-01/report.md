# Benchmark cảnh báo HGB: 5 phút và 5–10 phút

Dùng dữ liệu Bangkok công khai; chưa phải số đo hiệu quả trên phòng lạnh thật.

- Đầu vào: 13 nhiệt độ trong 60 phút, cách nhau 5 phút; 22 đặc trưng cũ.
- Mục tiêu 5 phút: nhiệt độ quan sát ở t+5 vượt ngưỡng.
- Mục tiêu 10 phút: ít nhất một nhiệt độ quan sát ở t+5 hoặc t+10 vượt ngưỡng.
- Chỉ chấm khi nhiệt độ hiện tại trong ngưỡng. Không quan sát được các phút nằm giữa hai mẫu.
- Mỗi bảng giữ nguyên nhãn và các hàng test cho mọi phương án, kể cả model dự báo phút 15.
- Vì vậy số cảnh báo với mục tiêu 10 phút không được so trực tiếp với benchmark mục tiêu 15 phút cũ.
- FPR = FP/(FP+TN); precision = TP/(TP+FP). Các chỉ số là trung bình đều giữa bốn preset.
- Kết quả đếm thời điểm chồng lặp, không phải số đợt sự cố độc lập hoặc số thông báo gửi cho người dùng.
- Dùng lại đúng model HGB500 tại 5/10/15 phút và test splits đã có; không chọn model/ngưỡng/seed bằng kết quả này.
- Huấn luyện lại cấu hình HGB100 cũ trên đúng phần train tương ứng; không dùng trọng số đã học toàn bộ dữ liệu để chấm test.
- Chia thời gian giữ khoảng cách nhãn 15 phút cũ để có các hàng train/test giống các benchmark trước.
- Các test partitions đã được nghiên cứu nhiều lần, nên kết quả mang tính thăm dò.
- Runtime/API/firmware/production giữ nguyên.

## Nguồn giữ riêng

Số hàng test: 72,700.

### Mục tiêu 5 phút

| Phương án | Recall | FPR | Precision | F1 |
|---|---:|---:|---:|---:|
| HGB 15m legacy (100 iterations) | 84.31% | 8.74% | 44.94% | 58.21% |
| HGB 5m | 68.11% | 1.36% | 78.91% | 72.50% |
| HGB 10m | 85.36% | 5.80% | 55.00% | 66.53% |
| HGB 5 + 10m | 87.47% | 6.01% | 54.33% | 66.60% |
| HGB 15m tuned (500 iterations) | 84.74% | 9.35% | 43.69% | 57.24% |
| HGB 5 + 10 + 15m | 90.73% | 10.00% | 43.27% | 58.10% |

### Mục tiêu 10 phút

| Phương án | Recall | FPR | Precision | F1 |
|---|---:|---:|---:|---:|
| HGB 15m legacy (100 iterations) | 71.56% | 5.05% | 72.34% | 71.28% |
| HGB 5m | 39.35% | 0.77% | 86.29% | 53.59% |
| HGB 10m | 65.62% | 2.41% | 80.08% | 71.65% |
| HGB 5 + 10m | 66.83% | 2.63% | 78.61% | 71.69% |
| HGB 15m tuned (500 iterations) | 72.45% | 5.64% | 70.85% | 70.95% |
| HGB 5 + 10 + 15m | 77.06% | 6.10% | 69.74% | 72.37% |

### Sai số dự báo đúng từng mốc

| Mốc | MAE trung bình preset (°C) |
|---|---:|
| 5 phút | 0.1459 |
| 10 phút | 0.3317 |
| 15 phút | 0.5794 |

### Theo từng preset, mục tiêu 10 phút

| Phương án | Preset | Recall | FPR | Precision |
|---|---|---:|---:|---:|
| HGB 15m legacy (100 iterations) | room_0_4 | 77.86% | 4.57% | 58.26% |
| HGB 15m legacy (100 iterations) | room_2_6 | 59.54% | 1.94% | 68.29% |
| HGB 15m legacy (100 iterations) | room_minus22_minus18 | 76.50% | 12.91% | 73.03% |
| HGB 15m legacy (100 iterations) | room_minus28_minus22 | 72.35% | 0.78% | 89.78% |
| HGB 5m | room_0_4 | 37.65% | 0.90% | 77.38% |
| HGB 5m | room_2_6 | 41.76% | 0.90% | 76.53% |
| HGB 5m | room_minus22_minus18 | 47.41% | 1.15% | 94.96% |
| HGB 5m | room_minus28_minus22 | 30.59% | 0.11% | 96.30% |
| HGB 10m | room_0_4 | 67.46% | 3.00% | 64.82% |
| HGB 10m | room_2_6 | 60.36% | 1.28% | 76.76% |
| HGB 10m | room_minus22_minus18 | 75.24% | 4.79% | 87.77% |
| HGB 10m | room_minus28_minus22 | 59.41% | 0.55% | 90.99% |
| HGB 5 + 10m | room_0_4 | 69.46% | 3.16% | 64.34% |
| HGB 5 + 10m | room_2_6 | 62.23% | 1.71% | 71.91% |
| HGB 5 + 10m | room_minus22_minus18 | 76.22% | 5.11% | 87.20% |
| HGB 5 + 10m | room_minus28_minus22 | 59.41% | 0.55% | 90.99% |

## Theo thời gian

Số hàng test: 72,324.

### Mục tiêu 5 phút

| Phương án | Recall | FPR | Precision | F1 |
|---|---:|---:|---:|---:|
| HGB 15m legacy (100 iterations) | 73.38% | 7.77% | 41.75% | 53.17% |
| HGB 5m | 67.95% | 1.60% | 74.09% | 70.52% |
| HGB 10m | 78.49% | 5.69% | 51.15% | 61.86% |
| HGB 5 + 10m | 83.60% | 6.01% | 51.13% | 63.29% |
| HGB 15m tuned (500 iterations) | 73.98% | 8.55% | 40.12% | 51.92% |
| HGB 5 + 10 + 15m | 85.75% | 9.55% | 40.95% | 55.14% |

### Mục tiêu 10 phút

| Phương án | Recall | FPR | Precision | F1 |
|---|---:|---:|---:|---:|
| HGB 15m legacy (100 iterations) | 64.21% | 4.48% | 67.96% | 66.01% |
| HGB 5m | 41.40% | 1.07% | 83.51% | 55.17% |
| HGB 10m | 66.01% | 2.32% | 80.07% | 72.33% |
| HGB 5 + 10m | 69.00% | 2.62% | 78.54% | 73.35% |
| HGB 15m tuned (500 iterations) | 67.14% | 4.95% | 67.61% | 67.31% |
| HGB 5 + 10 + 15m | 76.25% | 5.57% | 67.63% | 71.40% |

### Sai số dự báo đúng từng mốc

| Mốc | MAE trung bình preset (°C) |
|---|---:|
| 5 phút | 0.1454 |
| 10 phút | 0.2928 |
| 15 phút | 0.4549 |

### Theo từng preset, mục tiêu 10 phút

| Phương án | Preset | Recall | FPR | Precision |
|---|---|---:|---:|---:|
| HGB 15m legacy (100 iterations) | room_0_4 | 58.20% | 4.66% | 58.20% |
| HGB 15m legacy (100 iterations) | room_2_6 | 58.98% | 2.53% | 62.56% |
| HGB 15m legacy (100 iterations) | room_minus22_minus18 | 67.01% | 8.19% | 69.84% |
| HGB 15m legacy (100 iterations) | room_minus28_minus22 | 72.66% | 2.52% | 81.22% |
| HGB 5m | room_0_4 | 43.51% | 1.45% | 76.95% |
| HGB 5m | room_2_6 | 40.53% | 0.95% | 75.30% |
| HGB 5m | room_minus22_minus18 | 44.04% | 1.33% | 90.38% |
| HGB 5m | room_minus28_minus22 | 37.50% | 0.53% | 91.43% |
| HGB 10m | room_0_4 | 63.40% | 2.58% | 73.27% |
| HGB 10m | room_2_6 | 61.08% | 1.51% | 74.39% |
| HGB 10m | room_minus22_minus18 | 70.83% | 3.89% | 83.74% |
| HGB 10m | room_minus28_minus22 | 68.75% | 1.29% | 88.89% |
| HGB 5 + 10m | room_0_4 | 68.18% | 3.18% | 70.51% |
| HGB 5 + 10m | room_2_6 | 63.66% | 1.86% | 71.11% |
| HGB 5 + 10m | room_minus22_minus18 | 74.64% | 4.16% | 83.54% |
| HGB 5 + 10m | room_minus28_minus22 | 69.53% | 1.29% | 89.00% |

## Đối chiếu và tái lập

Model 5 và 10 phút đã được huấn luyện trong thử nghiệm đa mốc trước; lần này là chấm lại đúng mục tiêu ngắn hơn.
`metrics.json` lưu cả mục tiêu 15 phút để đối chiếu chính xác báo cáo cũ; `verification.json` lưu kiểm tra model và nhãn.
Model cũ được lưu thành `source_legacy_hgb15.joblib` và `temporal_legacy_hgb15.joblib`.
`predictions.npz` lưu dự báo, nhãn, mã nguồn và thời điểm; manifest lưu SHA-256 các đầu vào và file runtime.

```powershell
python -B ai-service/experiments/room_short_horizon_warning.py --worktree . --main-repo ../iot-project-repo --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-5-10m-reproduction
```
