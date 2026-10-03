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

Cấu hình (WiFi, broker, tài khoản thiết bị, ID thiết bị, NTP) **không nằm trong `.ino`** mà trong `cold_room_monitor/config.h`. File này được gitignore nên mật khẩu không vào git. Repo chỉ chứa file mẫu `config.example.h`:

```bash
cp firmware/cold_room_monitor/config.example.h firmware/cold_room_monitor/config.h   # rồi sửa giá trị
```

Nếu thiếu `config.h`, biên dịch sẽ báo lỗi kèm hướng dẫn.

| Hằng số | Mô tả |
|---------|-------|
| `WIFI_SSID` / `WIFI_PASSWORD` | WiFi **2.4 GHz**, cần có Internet để đồng bộ giờ NTP |
| `MQTT_BROKER_HOST` / `MQTT_BROKER_PORT` | IP LAN của máy chạy Docker (Windows: `ipconfig`) và cổng `1883` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Tài khoản **thiết bị** của broker: `MQTT_DEVICE_USERNAME` / `MQTT_DEVICE_PASSWORD` trong `.env` gốc của repo (không dùng tài khoản backend) |
| `DEVICE_ID` | ID duy nhất của ESP32, phải khớp `unique_id` trên server. Dùng làm MQTT client ID và topic `devices/<DEVICE_ID>/telemetry` |
| `NTP_SERVER_1` / `NTP_SERVER_2` | Máy chủ NTP (mặc định `pool.ntp.org`, `time.google.com`) |

> **Lưu ý:** Thiết bị phải được đăng ký trên server với `unique_id` = `DEVICE_ID` và claim vào một kho lạnh, nếu không server sẽ bỏ qua dữ liệu.

## Giao thức MQTT

| Thông số | Giá trị |
|----------|---------|
| Broker | Eclipse Mosquitto chạy trong Docker |
| Host | IP máy tính chạy Docker (cùng mạng LAN) |
| Port | `1883` |
| Topic gửi dữ liệu | `devices/{unique_id}/telemetry` |
| Xác thực | Bắt buộc username/password (`allow_anonymous false`) — dùng tài khoản thiết bị `MQTT_DEVICE_*`, **không** dùng tài khoản backend |
| Chu kỳ gửi | Mỗi 5 giây (`REPORT_INTERVAL_MS`) |

## Định dạng JSON payload

Mỗi 5 giây, ESP32 gửi một gói JSON lên broker theo định dạng:

```json
{
  "ts":            "2026-10-03T04:10:17.115Z",
  "temperature":   25.5,
  "humidity":      70.0,
  "doorOpen":      false,
  "sensorFault":   false,
  "fanOn":         true,
  "fanVoltage":    11.82,
  "fanPowerFault": false,
  "alarmActive":   false
}
```

| Trường | Kiểu dữ liệu | Mô tả |
|--------|-------------|-------|
| `ts` | Chuỗi ISO 8601 UTC | Thời điểm đo, lấy từ NTP. Server lưu đúng giá trị này và chống trùng theo `(thiết bị, ts)`, nên phải là giờ thật — chưa đồng bộ NTP thì firmware chưa gửi |
| `temperature` | number hoặc `null` | Nhiệt độ (°C); `null` nếu cảm biến bị lỗi |
| `humidity` | number hoặc `null` | Độ ẩm (%) từ DHT11; `null` nếu cảm biến bị lỗi |
| `doorOpen` | boolean | `true` = cửa đang mở (cảnh báo) |
| `sensorFault` | boolean | `true` = DHT11 không đọc được dữ liệu |
| `fanOn` | boolean | Relay quạt đang bật (quạt tắt khi cửa mở) |
| `fanVoltage` | number | Điện áp nguồn quạt (V) đo ở GPIO 34 |
| `fanPowerFault` | boolean | `true` = quạt đang bật nhưng nguồn mất hoặc biến động. Quạt tắt (0 V) thì không tính là lỗi |
| `alarmActive` | boolean | `true` = còi đang báo động tại chỗ (cửa mở / quá nhiệt / nguồn quạt bất thường) |

Từ `humidity` trở xuống là tùy chọn với server (firmware v1.1+): thiết bị cũ hoặc simulator không gửi thì server lưu `null`. Payload khoảng 180 byte, nên firmware tăng bộ đệm PubSubClient lên 512 byte (`setBufferSize`).

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