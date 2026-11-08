# Tối ưu HGB và hiệu chỉnh ngưỡng trên tập riêng

Mục tiêu: phát hiện vượt ngưỡng tại t+5, t+10 hoặc t+15 khi nhiệt độ hiện tại còn trong ngưỡng phòng.

## Quy trình cố định trước khi chấm

- Dữ liệu công khai Bangkok, bốn preset phòng hiện có. Nhãn kênh nguồn không phải đầu vào model hoặc cách phân chia phòng.
- Dùng lại 25 nguồn test cũ; dữ liệu này đã được nghiên cứu, nên đây là thử nghiệm thăm dò, không phải test hoàn toàn mới.
- 98 nguồn còn lại chia thành 73 nguồn fit/chọn model và 25 nguồn hiệu chỉnh ngưỡng. Cả hai kênh và các preset chồng nhau của cùng nguồn luôn cùng nhóm.
- Ba fold theo nguồn trong 73 nguồn fit chọn cấu hình bằng recall trung bình tại ngân sách FPR 4%; AP dùng khi hòa điểm. Các điểm này chỉ dùng chọn cấu hình.
- Hiệu chỉnh ngưỡng trên tập riêng bằng chính bản model đã fit, giữ nguyên trọng số khi chấm test. Không fit lại model sau hiệu chỉnh.
- Các ngân sách hiệu chỉnh là FPR 2%, 4%, 6% cho từng preset. 4% là mức đánh giá chính, được chọn trước khi xem test. FPR trên test được đo thực tế và có thể khác ngân sách.
- So với cả model nhiệt độ nguyên ngưỡng, model nhiệt độ được hiệu chỉnh và HGB300 được hiệu chỉnh theo cùng quy trình. Các đối chứng đều fit lại trên cùng dữ liệu được phép.
- Lặp ba seed chia fit/hiệu chỉnh, giữ chung 25 nguồn test. Các lượt này đo độ nhạy với phép chia, không phải ba bộ test độc lập; không chọn seed tốt nhất.
- Kiểm tra thời gian: fit 60% đầu, hiệu chỉnh khoảng 60..80%, test 20% cuối. Nhãn tương lai của fit/hiệu chỉnh không được đi qua ranh giới phần sau.
- Cấu hình classifier được chọn trên các chuỗi đầy đủ của nhóm fit theo nguồn. Phần kiểm tra thời gian là replay bổ sung, chưa độc lập với bước chọn cấu hình; không xem nó là một test hoàn toàn mới.
- Điểm số tính theo mẫu thời gian, trung bình đều bốn preset có thể chồng nhau; không phải tỷ lệ sự cố độc lập hoặc phép đo an toàn thực phẩm.
- Đầu vào giữ 22 đặc trưng lịch sử và 5 đặc trưng ngưỡng phòng, không thêm dữ liệu tương lai, định danh nguồn hoặc kênh.

## Chọn cấu hình trên nhóm fit

| Cấu hình | Recall chọn cấu hình | FPR chọn cấu hình | AP |
|---|---:|---:|---:|
| point | 56.01% | 3.99% | 0.6818 |
| hgb_base_300 | 52.12% | 3.98% | 0.6711 |
| hgb_matched_500 | 50.58% | 3.99% | 0.6648 |
| hgb_regularized_500 | 51.27% | 3.99% | 0.6671 |
| hgb_balanced_500 | 50.44% | 3.99% | 0.6671 |

Cấu hình được chọn trước khi chấm: **hgb_base_300**.

## Test theo nguồn, lượt 1, seed 20261018

| Model | Ngân sách hiệu chỉnh | Recall test | FPR test | Precision test |
|---|---:|---:|---:|---:|
| point_default | Ngưỡng gốc | 56.90% | 3.41% | 81.37% |
| point | 2% | 37.50% | 1.33% | 88.17% |
| point | 4% | 52.98% | 2.76% | 81.62% |
| point | 6% | 59.67% | 4.06% | 77.23% |
| hgb_base_300 | 2% | 36.64% | 1.02% | 85.13% |
| hgb_base_300 | 4% | 46.05% | 2.19% | 79.69% |
| hgb_base_300 | 6% | 52.11% | 2.95% | 77.00% |

### Tách tác dụng của cách hiệu chỉnh, cùng model và cùng mẫu test

Cả hai cách đều dùng ngân sách hiệu chỉnh 4%; ngưỡng OOF chỉ dùng nhãn của nhóm fit, ngưỡng tập riêng chỉ dùng nhãn của nhóm hiệu chỉnh. Không cách nào dùng nhãn test để chọn ngưỡng.

| Model | Nguồn chọn ngưỡng | Recall test | FPR test |
|---|---|---:|---:|
| point | OOF nhóm fit | 63.48% | 4.44% |
| point | Tập hiệu chỉnh riêng | 52.98% | 2.76% |
| hgb_base_300 | OOF nhóm fit | 59.36% | 3.21% |
| hgb_base_300 | Tập hiệu chỉnh riêng | 46.05% | 2.19% |

### Từng preset, mức hiệu chỉnh chính 4%

| Preset | Model | Nguồn có mẫu test | Mẫu vượt ngưỡng | Recall | FPR |
|---|---|---:|---:|---:|---:|
| room_0_4 | point_default | 22 | 2326 | 65.78% | 3.42% |
| room_0_4 | point | 22 | 2326 | 63.24% | 3.03% |
| room_0_4 | hgb_base_300 | 22 | 2326 | 43.59% | 2.36% |
| room_2_6 | point_default | 23 | 1738 | 47.07% | 1.33% |
| room_2_6 | point | 23 | 1738 | 53.74% | 2.27% |
| room_2_6 | hgb_base_300 | 23 | 1738 | 52.36% | 3.38% |
| room_minus22_minus18 | point_default | 9 | 999 | 64.96% | 8.20% |
| room_minus22_minus18 | point | 9 | 999 | 58.56% | 5.46% |
| room_minus22_minus18 | hgb_base_300 | 9 | 999 | 53.45% | 2.73% |
| room_minus28_minus22 | point_default | 3 | 253 | 49.80% | 0.70% |
| room_minus28_minus22 | point | 3 | 253 | 36.36% | 0.29% |
| room_minus28_minus22 | hgb_base_300 | 3 | 253 | 34.78% | 0.29% |

## Test theo nguồn, lượt 2, seed 20261019

| Model | Ngân sách hiệu chỉnh | Recall test | FPR test | Precision test |
|---|---:|---:|---:|---:|
| point_default | Ngưỡng gốc | 60.69% | 4.85% | 80.69% |
| point | 2% | 53.05% | 2.37% | 81.88% |
| point | 4% | 63.84% | 5.07% | 73.66% |
| point | 6% | 68.70% | 6.96% | 68.27% |
| hgb_base_300 | 2% | 47.30% | 2.02% | 79.20% |
| hgb_base_300 | 4% | 57.14% | 3.63% | 73.03% |
| hgb_base_300 | 6% | 63.11% | 4.83% | 70.01% |

## Test theo nguồn, lượt 3, seed 20261020

| Model | Ngân sách hiệu chỉnh | Recall test | FPR test | Precision test |
|---|---:|---:|---:|---:|
| point_default | Ngưỡng gốc | 60.50% | 4.83% | 80.17% |
| point | 2% | 53.61% | 4.27% | 81.04% |
| point | 4% | 64.02% | 5.93% | 75.51% |
| point | 6% | 67.12% | 7.17% | 72.31% |
| hgb_base_300 | 2% | 46.25% | 1.84% | 82.22% |
| hgb_base_300 | 4% | 58.21% | 5.30% | 72.90% |
| hgb_base_300 | 6% | 65.82% | 7.52% | 69.28% |

## Test theo thời gian, mức hiệu chỉnh chính 4%

| Model | Recall | FPR | Precision |
|---|---:|---:|---:|
| point_default | 57.75% | 2.65% | 82.91% |
| point | 62.66% | 3.75% | 76.45% |
| hgb_base_300 | 68.41% | 4.85% | 73.03% |

## Đánh giá theo tiêu chí đặt trước

Để xem là tốt hơn: recall tăng ít nhất 2 điểm %, FPR trung bình tăng tối đa 0,5 điểm %, và FPR từng preset tăng tối đa 1 điểm % so với đối chứng. Các tiêu chí này phục vụ so sánh bài tập.

```json
{
  "source_runs_passing_both_point_controls": 0,
  "source_runs_total": 3,
  "primary_source": {
    "comparisons": {
      "point_default": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": false,
          "macro_fpr_increase_at_most_half_point": true,
          "each_room_fpr_increase_at_most_1_point": false
        }
      },
      "point_calibrated": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": false,
          "macro_fpr_increase_at_most_half_point": true,
          "each_room_fpr_increase_at_most_1_point": false
        }
      },
      "base_classifier_calibrated": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": false,
          "macro_fpr_increase_at_most_half_point": true,
          "each_room_fpr_increase_at_most_1_point": true
        }
      }
    },
    "better_than_both_point_controls": false
  },
  "temporal": {
    "comparisons": {
      "point_default": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": true,
          "macro_fpr_increase_at_most_half_point": false,
          "each_room_fpr_increase_at_most_1_point": false
        }
      },
      "point_calibrated": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": true,
          "macro_fpr_increase_at_most_half_point": false,
          "each_room_fpr_increase_at_most_1_point": false
        }
      },
      "base_classifier_calibrated": {
        "passed": false,
        "checks": {
          "recall_gain_at_least_2_points": false,
          "macro_fpr_increase_at_most_half_point": true,
          "each_room_fpr_increase_at_most_1_point": true
        }
      }
    },
    "better_than_both_point_controls": false
  },
  "stable_improvement": false,
  "runtime_changed": false
}
```

Model runtime, API và production giữ nguyên. `evaluated_models.pkl` chỉ chứa model của lượt chia chính, fit trên 73 nguồn, kèm ngưỡng hiệu chỉnh từ 25 nguồn khác; không phải artifact đã fit toàn bộ dữ liệu hoặc tương thích thay trực tiếp API nhiệt độ.

## Chạy lại

Từ thư mục gốc worktree AI, dùng môi trường .venv-ai đã cài requirements:

```powershell
$env:OMP_NUM_THREADS='4'
$env:OPENBLAS_NUM_THREADS='4'
.venv-ai/Scripts/python.exe -B -u ai-service/experiments/room_warning_tuning.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-tuning-reproduction --threads 4
```

Dùng output mới hoặc thêm `--resume` để tiếp tục một lần chạy bị gián đoạn có manifest trùng khớp. Cache model nằm trong `cache/` được gitignore; `metrics.json` ghi đầy đủ cấu hình, hash nguồn, nguồn fit/hiệu chỉnh/test, ngưỡng và số liệu từng phòng.
