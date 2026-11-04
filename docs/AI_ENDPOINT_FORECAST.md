# Thử bổ sung lịch sử cho HGB và GRU chuyên dự báo phút 15

Thí nghiệm offline tiếp sau `AI_SEQUENCE_GRU.md`, trên cùng bộ Bangkok và nhóm
nguồn test. Mục tiêu lần này là sai số dự báo nhiệt độ sau 15 phút.

## Hai thay đổi

1. HGB giữ cấu hình đã chọn, thêm đúng các mốc trễ 25/35/40/50/55 phút vào
   22 đặc trưng cũ. Tổng 27 đặc trưng bao phủ đầy đủ 13 điểm nhiệt độ một giờ,
   đồng thời giữ các thống kê tổng hợp. Không thêm định danh nguồn hoặc dữ liệu tương lai.
2. GRU giữ đầu vào, optimizer và hai cấu hình 32/64 units của lượt trước;
   chỉ có một đầu ra và loss L1 cho nhiệt độ sau 15 phút. Chọn số epoch/cấu hình
   bằng validation, không dùng test. Báo đủ ba seed ở cả hai phép đánh giá.

Giữ nguyên 98 nguồn phát triển/25 nguồn test và danh sách nguồn validation của
lượt trước. Kiểm tra thời gian dùng 60% đầu để fit, 60–80% để validation và
20% cuối để test; nhãn tương lai không đi qua ranh giới. Sau chọn epoch, model
được fit lại trên phần train cuối cho đúng số epoch đã cố định.

Đối chứng HGB và GRU ba mốc được tái sử dụng từ file dự báo của lượt trước,
sau khi kiểm tra đúng nguồn, kênh, thời điểm, nhãn và hash artifact. GRU ba mốc
được chấm riêng đầu ra phút 15; không dùng cảnh báo hợp của ba mốc để so sai số.

## Chạy và kiểm chứng

Dùng môi trường Python có `ai-service/requirements-sequence.txt`. Lượt hoàn
thành dùng PyTorch 2.5.1+cpu tại `../ai-sequence-cpu-env`; các gói NumPy,
scikit-learn và pandas được đọc từ `.venv-ai` qua file `.pth` trong môi trường CPU.
Các phiên bản thực chạy được ghi trong metadata. Môi trường GPU cũ không bị sửa.

```powershell
$python='../ai-sequence-cpu-env/Scripts/python.exe'
& $python -B -m unittest discover -s ai-service/tests -p test_room_endpoint_forecast.py -v
& $python -u -B ai-service/experiments/room_endpoint_forecast.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-endpoint-forecast-2026-10-31-cpu --device cpu
```

Mỗi lượt cần thư mục output mới. Script lưu metadata, báo cáo, dự báo và trọng số
riêng; cuối lượt tự nạp lại trọng số và kiểm chứng. Có thể chạy lại kiểm chứng
bằng cùng lệnh với `--verify-only`, không huấn luyện lại.

Tiêu chí so với HGB đối chứng: MAE trung bình bốn preset giảm ít nhất 1%,
P95 tăng tối đa 5%, MAE từng preset tăng tối đa 5%. Một ứng viên cần đạt trên
cả nhóm nguồn giữ riêng lẫn kiểm tra thời gian; với GRU báo đủ kết quả mọi seed.

Dataset và nhóm test đã được nghiên cứu trước, nên kết quả có tính thăm dò,
không phải kiểm định trên phòng lạnh thật. Các mẫu liên tiếp/preset chồng lặp
không phải các sự cố độc lập. T_MS/T_FC chỉ là nhãn nguồn, không chia loại phòng.

Model runtime, API và production giữ nguyên trong lượt thử này. Hash được đối
chiếu trước/sau; PyTorch vẫn là phụ thuộc tùy chọn, ngoài môi trường runtime.

## Giới hạn vận hành của lượt chạy

Các lần khởi chạy CUDA trước đó dừng trước khi có kết quả test vì máy gần chạm
giới hạn bộ nhớ cấp phát Windows (khoảng 38/39 GB). Bản script cuối chỉ giữ một
phép đánh giá tại một thời điểm, thu gọn dữ liệu fit/validation và tính đầu vào
validation một lần. Các thay đổi này không đổi dữ liệu, loss hay cấu hình học.

Lượt hợp lệ nằm trong thư mục có hậu tố `-cpu` và có `completed_at` cùng
`verification.json`. Những thư mục khởi chạy chưa hoàn thành không dùng làm điểm
benchmark. GRU ba mốc đối chứng chạy GPU ở lượt trước; GRU một mốc mới chạy CPU,
nên không xem cùng seed là cùng toàn bộ quá trình số học. HGB là đối chứng chính.

## Kết quả ngày 31/10/2026

### 25 nguồn giữ riêng

Validation chọn `gru_64`, 15 epoch. GRU một đầu ra báo trung bình ba seed.

| Model | MAE phút 15 (°C) | P95 (°C) | Sai số không quá 1°C |
|---|---:|---:|---:|
| HGB 22 đặc trưng | 0.579421 | 2.366543 | 85.55% |
| HGB đủ mốc, 27 đặc trưng | 0.580617 | 2.377871 | 85.72% |
| GRU ba mốc trước, chấm đầu ra phút 15 (3 seed) | 0.582301 | 2.280382 | 85.69% |
| GRU chỉ phút 15, trung bình 3 seed | 0.554455 | 2.227185 | 86.02% |

Thay đổi MAE so với HGB đối chứng: HGB đủ mốc tăng 0.21%; GRU một đầu ra giảm 4.31%.
MAE GRU một đầu ra giữa các seed: 0.551524–0.556947°C.

### 20% thời gian cuối

Validation chọn `gru_64`, 30 epoch. GRU một đầu ra báo trung bình ba seed.

| Model | MAE phút 15 (°C) | P95 (°C) | Sai số không quá 1°C |
|---|---:|---:|---:|
| HGB 22 đặc trưng | 0.454884 | 1.721889 | 88.60% |
| HGB đủ mốc, 27 đặc trưng | 0.450529 | 1.748426 | 88.59% |
| GRU ba mốc trước, chấm đầu ra phút 15 (1 seed) | 0.444023 | 1.751040 | 88.91% |
| GRU chỉ phút 15, trung bình 3 seed | 0.435074 | 1.750606 | 89.09% |

Thay đổi MAE so với HGB đối chứng: HGB đủ mốc giảm 0.96%; GRU một đầu ra giảm 4.35%.
MAE GRU một đầu ra giữa các seed: 0.433558–0.437146°C.

### Điều kiện đặt trước

```json
{
  "hgb_full_lags_passes_both_evaluations": false,
  "gru_single_all_seeds_pass_both_evaluations": true
}
```

Các điều kiện này áp dụng cho so sánh dự báo; không phải xác nhận an toàn thực phẩm. Xem từng preset và từng seed trong báo cáo đầy đủ.

[Báo cáo](../ai-service/experiments/results/room-endpoint-forecast-2026-10-31-cpu/report.md) · [Số liệu](../ai-service/experiments/results/room-endpoint-forecast-2026-10-31-cpu/metrics.json) · [Kiểm chứng trọng số](../ai-service/experiments/results/room-endpoint-forecast-2026-10-31-cpu/verification.json)
