# Firmware - ESP32 Giám Sát Kho Lạnh

## Mô tả
Code nhúng cho vi điều khiển **ESP32** thực hiện giám sát kho lạnh theo thời gian thực. Thiết bị đọc dữ liệu từ các cảm biến, điều khiển quạt làm lạnh, kích hoạt còi cảnh báo và gửi dữ liệu telemetry lên server thông qua giao thức **MQTT**.

## Thiết bị & Cảm biến

| GPIO | Thiết bị | Mô tả |
|------|----------|-------|
| 4  | DHT11 | Cảm biến nhiệt độ và độ ẩm |
| 18 | Công tắc hành trình | Phát hiện cửa kho bị hở |
| 19 | Còi báo động (Buzzer) | Phát cảnh báo khi có sự cố |
| 23 | Relay | Điều khiển bật/tắt quạt làm lạnh |
| 34 | Cảm biến điện áp DC | Giám sát nguồn điện cấp cho quạt |

## Thư viện cần cài đặt

Mở Arduino IDE → **Tools > Manage Libraries**, tìm và cài các thư viện sau:

| Thư viện | Tác giả | Chức năng |
|----------|---------|-----------|
| DHT sensor library | Adafruit | Đọc dữ liệu DHT11 |
| Adafruit Unified Sensor | Adafruit | Phụ thuộc của DHT |
| PubSubClient | Nick O'Leary | Giao thức MQTT |
| ArduinoJson | Benoit Blanchon | Tạo JSON payload |

## Cấu hình trước khi nạp code

Mở file `cold_room_monitor.ino` và chỉnh sửa các dòng sau:

```cpp
// Tên và mật khẩu WiFi của bạn
#define WIFI_SSID     "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD "MAT_KHAU_WIFI"

// IP máy tính đang chạy Docker (chạy lệnh `ipconfig` trên Windows để tìm)
#define MQTT_BROKER_HOST "192.168.1.100"

// ID thiết bị — phải khớp với trường `unique_id` trong cơ sở dữ liệu của server
#define MQTT_CLIENT_ID       "esp32-coldroom-01"
#define MQTT_TOPIC_TELEMETRY "devices/esp32-coldroom-01/telemetry"
```

> **Lưu ý:** Nhớ thông báo cho team backend để họ tạo thiết bị trong database với `unique_id = "esp32-coldroom-01"`.

## Giao thức MQTT

| Thông số | Giá trị |
|----------|---------|
| Broker | Eclipse Mosquitto chạy trong Docker |
| Host | IP máy tính chạy Docker (cùng mạng LAN) |
| Port | `1883` |
| Topic gửi dữ liệu | `devices/{unique_id}/telemetry` |
| Xác thực | Không cần (allow_anonymous = true) |
| Chu kỳ gửi | Mỗi 2 giây |

## Định dạng JSON payload

Mỗi 2 giây, ESP32 gửi một gói JSON lên broker theo định dạng:

```json
{
  "ts":          "2024-01-15T10:30:00.000Z",
  "temperature": 25.5,
  "doorOpen":    false,
  "sensorFault": false
}
```

| Trường | Kiểu dữ liệu | Mô tả |
|--------|-------------|-------|
| `ts` | Chuỗi ISO 8601 | Thời điểm đo |
| `temperature` | number hoặc `null` | Nhiệt độ (°C); `null` nếu cảm biến bị lỗi |
| `doorOpen` | boolean | `true` = cửa đang mở (cảnh báo) |
| `sensorFault` | boolean | `true` = DHT11 không đọc được dữ liệu |

## Luồng dữ liệu

```
ESP32 (publish)
    │
    ▼
Mosquitto Broker  (Docker, port 1883)
    │
    ▼
NestJS Server  (subscribe topic: devices/+/telemetry)
    │
    ▼
MongoDB  (lưu trữ dữ liệu telemetry)
    │
    ▼
Frontend Dashboard  (hiển thị biểu đồ & cảnh báo)
```

## Logic cảnh báo

| Điều kiện | Hành động |
|-----------|-----------|
| Cửa kho bị hở | Tắt quạt + kích hoạt còi |
| Nhiệt độ ≥ 40°C | Kích hoạt còi cảnh báo |
| Điện áp quạt bất thường | Kích hoạt còi cảnh báo |
| Tất cả bình thường | Quạt chạy, còi tắt |