# AI service — Dự báo nhiệt độ phòng lạnh

FastAPI dùng hai HistGradientBoostingRegressor chung cho các phòng, dự báo nhiệt độ tại mốc +5 và +10 phút. T_MS/T_FC là nhãn nguồn dữ liệu Bangkok; không dùng để chọn model theo loại phòng. Backend gửi lịch sử nhiệt độ của một cảm biến và ngưỡng cấu hình của phòng.

## Đầu vào và đầu ra

`POST /internal/ai/predict` nhận `feature_schema: "temperature-history-v1"`,
`temperature`, `temperature_history`, `temp_min` và `temp_max`.
Ví dụ đầy đủ, có thể gửi trực tiếp:

```json
{
  "feature_schema": "temperature-history-v1",
  "temperature": -18,
  "temperature_history": [
    {
      "ts": "2026-10-04T09:00:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:05:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:10:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:15:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:20:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:25:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:30:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:35:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:40:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:45:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:50:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:55:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T10:00:00.000Z",
      "temperature": -18
    }
  ],
  "temp_min": -20,
  "temp_max": -15
}
```

Lịch sử phải có **13 mẫu theo thứ tự cũ đến mới**, tại t−60, t−55, ..., t phút.
Mỗi mẫu nằm tại hoặc trước mốc tương ứng, được phép cũ tối đa 60 giây.
Timestamp có múi giờ và tăng nghiêm ngặt; mẫu cuối khớp nhiệt độ hiện tại.
Dữ liệu thiếu, quá cũ hoặc sai phiên bản trả HTTP 422.

Backend đọc 61 phút `telemetry_raw` hợp lệ của cùng thiết bị và phòng, rồi chọn
mẫu theo thời gian. Không dùng 13 bản ghi cuối gửi cách nhau 5 giây. Mỗi thiết bị
thử dự báo tối đa một lần/phút, ở chế độ nền. Sau khi khởi động hoặc mất dữ liệu
dài, cần chờ đủ một giờ lịch sử. Ngưỡng phòng và nhiệt độ lịch sử phải nằm trong
**−28 đến 19,6°C**; đầu ra không bị ép vào dải này.

Cấu trúc trả về của bản 5–10 phút:

```json
{
  "forecast_schema": "temperature-warning-5-10-v1",
  "as_of": "2026-11-01T10:00:00Z",
  "forecasts": [
    {"horizon_minutes": 5, "predicted_temp": -17.7, "will_exceed_threshold": false, "violation_type": "NONE"},
    {"horizon_minutes": 10, "predicted_temp": -17.4, "will_exceed_threshold": false, "violation_type": "NONE"}
  ],
  "will_exceed_threshold": false,
  "first_violation_minutes": null,
  "violation_type": "NONE",
  "risk_level": "NORMAL",
  "recommendation": "Dự báo ở mốc +5 và +10 phút nằm trong ngưỡng cấu hình.",
  "metadata": {"horizons_minutes": [5, 10], "history_samples": 13}
}
```

Hai giá trị là nhiệt độ tại đúng t+5 và t+10. Dataset không quan sát được mọi
dao động giữa các mốc. Bất kỳ dự báo nào vượt ngưỡng sẽ bật `will_exceed_threshold`.
`first_violation_minutes` và `violation_type` tóm tắt mốc vi phạm đầu tiên;
`forecasts` giữ cả hai hướng nếu hai mốc vi phạm khác nhau.

Giá trị trả về giữ đủ độ chính xác để so ngưỡng như benchmark; giao diện tự
định dạng số hiển thị. Cảnh báo AI có mức `WARNING` để nhân viên kiểm tra,
không gửi lệnh tự động đến quạt/còi. Backend vẫn lưu `temperature_predicted`,
có xác nhận tiếp nhận, thông báo và lịch sử theo phòng. Chỉ tự đóng cảnh báo
AI khi cả hai dự báo đã nằm trong vùng hồi phục hysteresis. Cảnh báo từ số đo
thực tế `temperature_out_of_range` tiếp tục hoạt động độc lập.

`GET /health` trả 200 khi model đã nạp đúng schema; nếu thiếu hoặc dùng artifact
15 phút cũ sẽ trả 503. Response health ghi `horizons_minutes: [5,10]`.

## Model và benchmark

- Artifact mặc định: `temperature_model_warning_5_10.pkl`, metadata cùng tên `.json`.
- Hai HistGradientBoostingRegressor học thay đổi nhiệt độ ở 5 và 10 phút.
- Cấu hình đã benchmark: loss `absolute_error`, tối đa 500 vòng, learning rate
  0.03, tối đa 63 lá; early stopping `auto`, scikit-learn 1.7.2.
- Model phục vụ được fit lại trên 357.684 hàng từ toàn bộ 123 nguồn. Các chỉ số
  bên dưới thuộc model kiểm thử đã fit trên đúng phần train, không chấm artifact
  phục vụ trên dữ liệu mà nó đã học.
- Artifact 15 phút cũ được giữ để đối chiếu nghiên cứu; API mới yêu cầu đúng
  schema 5–10 phút và không dùng trường `predicted_temp_15m`.

| Phép kiểm tra, mục tiêu 10 phút | Recall | FPR | Precision |
|---|---:|---:|---:|
| Nguồn giữ riêng | 66,83% | 2,63% | 78,61% |
| Theo thời gian | 69,00% | 2,62% | 78,54% |

Mục tiêu 10 phút là có vượt ngưỡng ở ít nhất một quan sát t+5 hoặc t+10, chỉ
khi nhiệt độ hiện tại trong ngưỡng. Các điểm số tính theo thời điểm chồng lặp,
trung bình đều giữa bốn preset. FPR khác tỷ lệ cảnh báo sai trong số cảnh báo
đã phát. So với cấu hình cũ trên cùng mục tiêu 10 phút, FPR giảm ở cả hai phép
kiểm tra, recall giảm ở nguồn giữ riêng và tăng ở phép kiểm tra thời gian.

Dataset Bangkok công khai đã được nghiên cứu nhiều lần. Đây là kết quả thăm
dò, không phải hiệu quả đã đo tại kho thật hoặc chứng nhận bảo quản thực phẩm.

[Báo cáo 5–10 phút](experiments/results/room-warning-5-10m-2026-11-01/report.md)
· [Chi tiết tích hợp](../docs/AI_SHORT_HORIZON.md)
· [Benchmark HGB 15 phút trước đây](experiments/results/room-forecast-2026-10-17/report.md)

## Tái lập và kiểm tra

Chạy từ gốc repo với Python 3.10 và các phiên bản trong `requirements-dev.txt`:

```powershell
python -B -m unittest discover -s ai-service/tests -p test_prediction.py -v
python -u -B ai-service/train_short_horizon_model.py --worktree . --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output ai-service/temperature_model_warning_5_10_reproduction.pkl
```

Script không ghi đè output đã có. Nó kiểm tra toàn bộ 22 đặc trưng khớp hàm
serving, dùng đúng cấu hình đã benchmark, lưu nguồn dữ liệu và kiểm tra nạp lại
checkpoint. Không cần MQTT, database hoặc ESP32 để kiểm thử API bằng TestClient.
