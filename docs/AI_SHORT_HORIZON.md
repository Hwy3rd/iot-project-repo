# Tích hợp HGB dự báo 5 và 10 phút trên nhánh AI local

Bản cập nhật ngày 01/11/2026 nằm trong `feat/ai-room-forecast-tuning`.
Phần code này thay dự báo một mốc 15 phút bằng hai dự báo tại đúng +5 và +10
phút. Dữ liệu đầu vào giữ 13 nhiệt độ của một giờ, cách nhau 5 phút.

## Luồng xử lý

1. Backend chọn lịch sử cùng thiết bị và phòng, thử AI tối đa mỗi phút.
2. FastAPI trả hai dự báo và mốc vi phạm đầu tiên; nếu có nguy cơ thì mức AI
   là `WARNING`, kèm khuyến nghị kiểm tra và điều khiển thủ công.
3. Backend lưu bản dự báo theo thiết bị trong cache của phòng. Khi có nguy cơ,
   vẫn tạo `temperature_predicted` trong bảng alerts và gửi thông báo qua luồng
   hiện có. Người dùng có thể xác nhận tiếp nhận theo quyền kho/ca làm việc.
4. Một dự báo +10 an toàn không che khuất nguy cơ tại +5. Chỉ tự đóng cảnh báo
   khi cả hai mốc đã trở lại vùng hysteresis bên trong ngưỡng.
5. Cảm biến thực sự vượt ngưỡng vẫn tạo `temperature_out_of_range` độc lập.
   Model AI không tự gửi lệnh bật/tắt quạt hoặc còi.
6. Giao diện hiển thị hai nhiệt độ và hai điểm trên chart, tính thời điểm từ
   mẫu cảm biến cuối dùng làm đầu vào (`as_of`), không từ lúc HTTP hoàn tất.

Bản dự báo hết hiệu lực sau 5 phút để không giữ cảnh báo dựa trên mốc +5 đã
trôi qua. Cache 15 phút kiểu cũ hoặc dữ liệu cache không hợp lệ được bỏ qua.
Thông báo vẫn gắn đúng kho, phòng và thiết bị; xác nhận tiếp nhận không đồng
nghĩa sự cố đã hết hoặc model đã dự báo đúng.

## Artifact và hợp đồng

- Mặc định `ai-service/temperature_model_warning_5_10.pkl`; metadata `.json`.
- Request giữ `feature_schema: temperature-history-v1`.
- Response dùng `forecast_schema: temperature-warning-5-10-v1`, `as_of`,
  `forecasts`, `first_violation_minutes` và các trường đánh giá tổng hợp.
- Mỗi forecast có `horizon_minutes`, `predicted_temp`,
  `will_exceed_threshold`, `violation_type`.
- API và frontend chuyển cùng hợp đồng; không gán giá trị +10 vào trường +15.
- Dockerfile đóng gói artifact mới. Không cần migration database.

Model phục vụ fit trên toàn bộ 123 nguồn (357.684 hàng) bằng cấu hình HGB đã
benchmark. Điểm kiểm thử dùng các model riêng theo phép chia train/test; chúng
không được tính từ model phục vụ đã học toàn bộ dữ liệu.

## Kết quả và giới hạn

Với mục tiêu có vượt ở t+5 hoặc t+10, trung bình bốn preset:

| Phép kiểm tra | Recall | FPR | Precision |
|---|---:|---:|---:|
| Nguồn giữ riêng | 66,83% | 2,63% | 78,61% |
| Theo thời gian | 69,00% | 2,62% | 78,54% |

FPR giảm ở cả hai phép so với cấu hình cũ chấm lại trên cùng mục tiêu. Recall
chưa tốt hơn ổn định: giảm ở nhóm nguồn giữ riêng, tăng ở phép chia thời gian.
Dataset đã được dùng nghiên cứu nhiều lần và chỉ quan sát mỗi 5 phút. Bản tích
hợp không bảo đảm bắt mọi dao động giữa hai mẫu hoặc hiệu quả tại kho thật.

[Báo cáo benchmark](../ai-service/experiments/results/room-warning-5-10m-2026-11-01/report.md)

## Kiểm tra local

```powershell
# Python đã cài requirements-dev.txt
python -B -m unittest discover -s ai-service/tests -p test_prediction.py -v
# Backend
cd server
npm test -- --runInBand ai-prediction.service.spec.ts telemetry.service.spec.ts cold-room-status.service.spec.ts
npm run build
cd ..
# Node 24, kiểm thử dữ liệu chart không cần trình duyệt
node --test frontend/tests/forecast-series.test.mjs
node --test scripts/demo_ai.test.js
cd frontend
npm run build
```

Các unit test dùng model local, mock dịch vụ và fixture. Lệnh demo `--dry-run`
chỉ in kế hoạch; không chạy kịch bản ghi database/MQTT trên server đối tác khi
kiểm tra code local.

API, worker và frontend cần chạy bản mới đồng bộ khi dùng trên local. Bản cập
nhật code local này không tự thay đổi tiến trình đang chạy hoặc website máy chủ.
