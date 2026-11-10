# Trạng thái AI trên màn giám sát

Nhánh `fix/ai-forecast-status-ui` được tạo từ `origin/production` tại `e62b28c`.

## Hành vi giao diện

Khi mở chi tiết một phòng trong Giám sát trực tiếp, thẻ **Dự báo AI (+5 và +10 phút)** luôn hiển thị. Khi chưa có dự báo hợp lệ, thẻ giải thích trạng thái thay vì biến mất.

| Trạng thái | Ý nghĩa |
|---|---|
| `ready` | Có dự báo còn hiệu lực; hiển thị hai mốc, khuyến nghị và thời điểm dữ liệu |
| `collecting_data` | Chưa đủ 13 mốc nhiệt độ hợp lệ trong khoảng 60 phút; hiển thị số mốc đã có |
| `unsupported_range` | Ngưỡng phòng hoặc số đo hiện tại ngoài −28 đến 19,6°C |
| `no_device` | Phòng chưa có thiết bị được gán |
| `no_data` | Chưa có số đo trực tiếp từ các thiết bị hiện đang thuộc phòng |
| `stale_data` | Số đo gần nhất đã quá 5 phút, chưa đủ mới để cập nhật dự báo |
| `sensor_error` | Số đo nhiệt độ không hợp lệ hoặc cảm biến báo lỗi |
| `temperature_out_of_range` | Số đo thực tế đã vượt ngưỡng phòng; ưu tiên xử lý cảnh báo hiện tại |
| `service_unavailable` | Lần gọi AI gần nhất chưa thành công |
| `unavailable` | Tạm thời chưa kiểm tra/đọc được kết quả hoặc trạng thái dự báo |
| `pending` | Lịch sử đủ điều kiện, đang chờ lần đánh giá tiếp theo |
| `prediction_expired` | Giao diện loại bỏ một dự báo đã quá 5 phút trong lúc chờ dữ liệu mới |

Màn hình cũng có trạng thái đang tải và lỗi tải API. Nếu backend cũ chưa có trường chẩn đoán, frontend hiện thông báo tổng quát, không tự đoán nguyên nhân.

Tiến độ được tính theo các mốc thực sự có dữ liệu hợp lệ. Bật node một giờ hoặc có 13 mẫu gửi sát nhau không tự động đủ điều kiện. Dữ liệu có khoảng trống vẫn có thể thiếu mốc sau hơn một giờ.

Kết quả quá hạn không được tiếp tục vẽ trên biểu đồ. Trạng thái AI được cập nhật tối đa mỗi 30 giây khi đang mở phòng, kể cả khi chọn biểu đồ 6 giờ hoặc 24 giờ.

## API

`GET /cold-rooms/:id/telemetry` bổ sung `predictionStatus`, giữ nguyên `prediction` và các trường biểu đồ hiện có:

```json
{
  "prediction": null,
  "predictionStatus": {
    "code": "collecting_data",
    "checkedAt": "2026-11-08T15:26:00.000Z",
    "deviceUniqueId": "ESP32-A103E6",
    "collectedSamples": 1,
    "requiredSamples": 13,
    "requiredHistoryMinutes": 60
  }
}
```

Phân quyền theo phòng/kho trên route được giữ nguyên. Không trả exception, địa chỉ dịch vụ nội bộ hoặc cấu hình nhạy cảm ra frontend.

## Cách kiểm tra trạng thái

- Không gọi mô hình AI từ request lấy biểu đồ.
- Phòng có dự báo hợp lệ dùng kết quả đã lưu; không quét thêm lịch sử chỉ để tính tiến độ.
- Khi chưa có dự báo, kiểm tra thiết bị hiện thuộc phòng và số đo trực tiếp mới nhất.
- Lịch sử được kiểm tra trên cùng một thiết bị và phòng, giới hạn 61 phút và tối đa 5.000 dòng, dùng chung thuật toán lấy mẫu với luồng dự báo.
- Với phòng có nhiều thiết bị, ưu tiên dự báo hợp lệ của phòng như trước. Khi chưa có dự báo, tiến độ chẩn đoán dựa trên thiết bị có số đo trực tiếp mới nhất, ghi rõ mã thiết bị; không trộn lịch sử giữa các cảm biến.
- Trạng thái lỗi dịch vụ dựa trên lần gọi AI gần nhất trong tiến trình API, được xóa khi gọi thành công. Sau khi API khởi động lại, cần có lần đánh giá mới để xác định lỗi dịch vụ; không khẳng định dịch vụ đang hỏng chỉ vì chưa có dự báo.

## Triển khai

Build và cập nhật cả backend lẫn frontend. Không cần migration database hoặc cập nhật firmware. Không thay đổi mô hình, dải nhiệt hỗ trợ, ngưỡng cảnh báo hoặc thời hạn lệnh thiết bị.

## Kiểm chứng local

- 40 test kiểm tra lấy mẫu, tiến độ lịch sử, chẩn đoán AI/cache và trạng thái biểu đồ đạt.
- 85 test hồi quy TelemetryService đạt.
- Backend/frontend build thành công; lint các file nguồn thay đổi đạt.
- Bảy tình huống chạy trên giao diện thật, không giả lập response API ở trình duyệt: chưa có số đo, đang thu thập, ngoài dải hỗ trợ, dữ liệu cũ, lỗi cảm biến, dịch vụ AI gián đoạn và dự báo thành công sau khi AI hoạt động lại.
- Các ngưỡng và dữ liệu mẫu tạm cho kiểm thử được khôi phục/dọn sau kiểm tra. Lượt kiểm thử dự báo thành công sử dụng script demo dữ liệu mẫu trên một thiết bị có sẵn.
- Ảnh và kết quả kiểm tra giao diện được lưu ngoài repo trong `IoT/AI_DEMO_ANH/ai_status_*`.

Máy chủ partner và nhánh production không được sửa trong quá trình kiểm chứng.
