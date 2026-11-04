# Kết hợp HGB–GRU và thử Huber, giữ lịch sử một giờ

Thử nghiệm offline tiếp sau `AI_ENDPOINT_FORECAST.md`, trên cùng bộ Bangkok,
cùng 25 nguồn giữ riêng và cùng kiểm tra thời gian. Đầu vào vẫn 13 nhiệt độ
cách 5 phút, kéo dài một giờ; đầu ra vẫn nhiệt độ sau 15 phút.

## Hai hướng thử

- **Kết hợp:** `(1-alpha)*HGB + alpha*GRU`. Chọn alpha trên validation từ
  0 đến 1, bước 0,05, ưu tiên MAE thấp nhất với P95 không tăng quá 2% và MAE
  từng preset không tăng quá 5% so với thành phần GRU. Không chọn bằng test.
- **Loss:** tận dụng trọng số L1 đã có, học thêm 5 epoch ở learning rate 1e-4
  bằng Huber chuẩn hóa (Huber/delta, tương đương SmoothL1), delta 0,5; 1; 2°C.
  Chọn delta bằng P95 validation, với MAE tăng tối đa 1% và MAE từng preset
  tăng tối đa 5% so với bản L1 cũng được học thêm cùng ngân sách.

Đối chứng L1 học thêm bắt đầu từ đúng cùng trọng số, giữ nguyên normalizer,
reset optimizer như nhau và dùng cùng thứ tự batch. Nhờ đó không gán lợi ích
của việc học thêm cho riêng Huber. Nếu không delta nào đạt guard validation,
bản Huber có MAE thấp nhất vẫn được báo cáo như một so sánh thăm dò.

HGB validation chỉ fit phần train của validation. Model test dùng các bản fit
trên nhóm train cuối tương ứng. Cả alpha và delta được lưu cố định trước khi
chấm test. Có thêm kết hợp HGB với Huber đã chọn để kiểm tra hai thay đổi cùng nhau.

## Chạy

Từ gốc worktree AI, dùng môi trường CPU đã có trên ổ D:

```powershell
$python='../ai-sequence-cpu-env/Scripts/python.exe'
& $python -B -m unittest discover -s ai-service/tests -p test_room_ensemble_huber.py -v
& $python -u -B ai-service/experiments/room_ensemble_huber.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-ensemble-huber-2026-10-31
```

Thêm `--resume` để dùng lại các bước đã hoàn tất khi input và manifest còn
nguyên. Thêm `--verify-only` để nạp lại trọng số, tính lại lựa chọn validation,
công thức kết hợp và chỉ số. Không cần huấn luyện lại để kiểm chứng.

Tiêu chí dự báo: MAE giảm ít nhất 1%, P95 tăng tối đa 5%, MAE từng preset tăng
tối đa 5%. Tiêu chí giảm lỗi lớn: P95 giảm ít nhất 3%, MAE tăng tối đa 1%,
MAE/P95 từng preset tăng tối đa 5%. Báo đủ ba seed trên cả hai phép đánh giá.

Dataset và test đã được nghiên cứu trước, validation được tái sử dụng để chọn
cấu hình nên đây là thử nghiệm thăm dò; không phải độ chính xác ở phòng thật.
Các preset có chồng lặp và các seed không phải những tập test độc lập.
Không thay model runtime, API hay production.

[Báo cáo và kết quả](../ai-service/experiments/results/room-ensemble-huber-2026-10-31/report.md)
