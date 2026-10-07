# Firmware - ESP32 Giám Sát Kho Lạnh

## Mô tả
Code nhúng cho vi điều khiển **ESP32** thực hiện giám sát kho lạnh theo thời gian thực. Thiết bị đọc dữ liệu từ các cảm biến, điều khiển quạt làm lạnh, kích hoạt còi cảnh báo, gửi dữ liệu telemetry lên server và nhận lệnh điều khiển từ server thông qua giao thức **MQTT**.

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
| `DEVICE_ID` | ID duy nhất của ESP32, phải khớp `unique_id` trên server. Dùng làm MQTT client ID và các topic `devices/<DEVICE_ID>/...`. Broker chỉ cho thiết bị đọc lệnh, đọc ngưỡng phòng và gửi ack trên topic có đúng client ID của nó |
| `NTP_SERVER_1` / `NTP_SERVER_2` | Máy chủ NTP (mặc định `pool.ntp.org`, `time.google.com`) |

> **Lưu ý:** Thiết bị phải được đăng ký trên server với `unique_id` = `DEVICE_ID` và claim vào một kho lạnh, nếu không server sẽ bỏ qua dữ liệu.

## Giao thức MQTT

| Thông số | Giá trị |
|----------|---------|
| Broker | Eclipse Mosquitto chạy trong Docker |
| Host | IP máy tính chạy Docker (cùng mạng LAN) |
| Port | `1883` |
| Topic gửi dữ liệu | `devices/{unique_id}/telemetry` |
| Topic nhận lệnh | `devices/{unique_id}/commands` (subscribe QoS 1, đăng ký lại sau mỗi lần kết nối lại) |
| Topic gửi ack | `devices/{unique_id}/ack` |
| Topic nhận ngưỡng phòng | `devices/{unique_id}/config` (retained, subscribe QoS 1; xem mục Ngưỡng cảnh báo của phòng) |
| Xác thực | Bắt buộc username/password (`allow_anonymous false`) — dùng tài khoản thiết bị `MQTT_DEVICE_*`, **không** dùng tài khoản backend |
| Chu kỳ gửi | Mỗi 5 giây (`REPORT_INTERVAL_MS`), và gửi ngay khi cửa, quạt, còi hoặc lỗi nguồn quạt đổi trạng thái (cách nhau tối thiểu `EVENT_MIN_GAP_MS` = 300 ms) |

## Định dạng JSON payload

Mỗi 5 giây, và ngay khi cửa/quạt/còi đổi trạng thái, ESP32 gửi một gói JSON lên broker theo định dạng:

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
  "alarmActive":   false,
  "fanManualSec":    0,
  "buzzerManualSec": 420,
  "configVersion":   "2026-10-07T08:00:00.000Z"
}
```

| Trường | Kiểu dữ liệu | Mô tả |
|--------|-------------|-------|
| `ts` | Chuỗi ISO 8601 UTC | Thời điểm đo, lấy từ NTP. Server lưu đúng giá trị này và chống trùng theo `(thiết bị, ts)`, nên phải là giờ thật — chưa đồng bộ NTP thì firmware chưa gửi |
| `temperature` | number hoặc `null` | Nhiệt độ (°C); `null` nếu cảm biến bị lỗi |
| `humidity` | number hoặc `null` | Độ ẩm (%) từ DHT11; `null` nếu cảm biến bị lỗi |
| `doorOpen` | boolean | `true` = cửa đang mở (cảnh báo) |
| `sensorFault` | boolean | `true` = DHT11 không đọc được dữ liệu |
| `fanOn` | boolean | Quạt **thật sự có điện** (điện áp đo được ≥ `MIN_FAN_RUN_VOLTAGE` = 1 V), không phải trạng thái lệnh |
| `fanRelayOn` | boolean | Relay quạt đang được bật. Chế độ tự động: luôn bật; chỉ lệnh bật/tắt từ giao diện mới đổi. Lệch với `fanOn` = quạt đang khởi động/dừng hoặc có lỗi |
| `fanVoltage` | number | Điện áp nguồn quạt (V) đo ở GPIO 34 |
| `fanPowerFault` | boolean | `true` = có lỗi nguồn quạt (xem `fanFault`) |
| `fanFault` | string hoặc `null` | `no_power` (relay bật mà không có điện), `low_voltage` (dưới 80% mức chuẩn), `high_voltage` (cao hơn mức chuẩn ≥ 0.5 V), `stuck_on` (relay tắt quá 10 giây mà vẫn có điện) |
| `alarmActive` | boolean | `true` = còi đang báo động tại chỗ (nhiệt độ ngoài ngưỡng / cửa mở quá lâu / nguồn quạt bất thường, hoặc do lệnh bật còi) |
| `fanManualSec` | integer | Số giây còn lại của lệnh bật/tắt quạt đang ghi đè chế độ tự động; `0` = đang tự động |
| `buzzerManualSec` | integer | Như trên, cho còi |
| `configVersion` | string hoặc `null` | `version` của ngưỡng phòng thiết bị đang dùng; `null` = đang dùng ngưỡng dự phòng. Server so với phòng hiện tại và lưu `configSynced` |

Từ `humidity` trở xuống là tùy chọn với server (firmware v1.1+; `fanRelayOn`, `fanFault`, `fanManualSec`, `buzzerManualSec`, `configVersion` từ v1.3): thiết bị cũ hoặc simulator không gửi thì server lưu `null`. Payload khoảng 340 byte, nên firmware tăng bộ đệm PubSubClient lên 768 byte (`setBufferSize`).

## Lệnh điều khiển

Server gửi lệnh xuống `devices/{unique_id}/commands`:

```json
{
  "id":        "0199a1b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b",
  "channel":   "fan_motor",
  "label":     null,
  "action":    "on",
  "expiresAt": "2026-10-03T08:01:00.000Z"
}
```

| Trường | Mô tả |
|--------|-------|
| `id` | Mã lệnh. Dùng để gửi ack và chống chạy trùng |
| `channel` | Loại kênh: `fan_motor` (relay GPIO 23) hoặc `buzzer` (GPIO 19). Loại khác bị từ chối với lỗi `unsupported_channel` |
| `action` | `on`, `off` hoặc `auto` (bỏ ghi đè, trả kênh về chế độ tự động ngay) |
| `expiresAt` | Quá thời điểm này thì thiết bị từ chối lệnh (`expired`), để không bật/tắt muộn. Chưa đồng bộ NTP thì bỏ qua bước kiểm tra này |

Sau khi xử lý, thiết bị gửi ack lên `devices/{unique_id}/ack`:

```json
{"id": "0199a1b2-...", "status": "done"}
{"id": "0199a1b2-...", "status": "failed", "error": "unsupported_channel"}
```

**Ghi đè logic tự động.** Lệnh `on`/`off` thực hiện xong sẽ ghi đè logic tự động của actuator đó trong `MANUAL_OVERRIDE_MS` (mặc định 10 phút), sau đó thiết bị tự quay lại chế độ tự động. Lệnh `auto` kết thúc ghi đè ngay. Ví dụ: lệnh `buzzer off` tắt còi trong 10 phút khi đang xử lý sự cố, lệnh `fan_motor off` tắt quạt trong 10 phút (ví dụ khi bảo trì). Không có chế độ thủ công vĩnh viễn: nếu có thì người tắt còi rồi quên sẽ làm kho mất cảnh báo tại chỗ. Ghi đè chỉ nằm trong RAM, ESP32 khởi động lại là về tự động. Telemetry (`fanOn`, `alarmActive`) luôn báo trạng thái thật của relay và còi, `fanManualSec`/`buzzerManualSec` báo chế độ.

## Ngưỡng cảnh báo của phòng

Còi tại chỗ báo theo ngưỡng của phòng mà thiết bị được gắn vào, không theo hằng số trong firmware. Server gửi ngưỡng xuống `devices/{unique_id}/config` dưới dạng tin **retained**, mỗi khi phòng được sửa hoặc xoá, khi thiết bị được claim, ngừng dùng hoặc xoá, và mỗi lần backend kết nối lại broker:

```json
{
  "version":            "2026-10-07T08:00:00.000Z",
  "tempMin":            28,
  "tempMax":            30,
  "hysteresis":         0.5,
  "doorOpenMaxSeconds": 30
}
```

- Broker giữ tin cuối cùng của topic và gửi ngay khi thiết bị subscribe, nên thiết bị offline lúc đổi ngưỡng vẫn nhận được khi kết nối lại.
- Thiết bị lưu ngưỡng vào NVS (`Preferences`), nên mất mạng hoặc khởi động lại vẫn báo đúng ngưỡng. Chỉ ghi flash khi `version` đổi.
- Payload rỗng nghĩa là thiết bị không còn gắn phòng nào: thiết bị xoá ngưỡng đã lưu và quay về ngưỡng dự phòng.
- Chưa từng nhận ngưỡng thì dùng ngưỡng dự phòng: nhiệt độ ≥ `DEFAULT_TEMP_MAX` (40°C), cửa mở quá `DEFAULT_DOOR_OPEN_MAX_S` (15 giây).

**Chống chạy trùng.** Nếu chưa nhận được ack, server sẽ gửi lại lệnh (tối đa 5 lần, cách nhau 10 giây, trong vòng 60 giây). Thiết bị nhớ 8 lệnh gần nhất (`RECENT_COMMANDS`). Lệnh đã chạy rồi thì thiết bị chỉ gửi lại ack cũ, không chạy lại.

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

Chiều ngược lại: Frontend → NestJS (`POST /commands`) → `devices/{unique_id}/commands` → ESP32 → `devices/{unique_id}/ack` → NestJS cập nhật trạng thái lệnh.

## Logic cảnh báo

| Điều kiện | Hành động |
|-----------|-----------|
| Chế độ tự động của quạt | Quạt luôn chạy, cửa đóng hay mở không ảnh hưởng. Chỉ lệnh bật/tắt từ giao diện mới đổi trạng thái quạt (trong 10 phút) |
| Cửa mở quá `doorOpenMaxSeconds` của phòng | Kích hoạt còi |
| Nhiệt độ > `tempMax` hoặc < `tempMin` của phòng | Kích hoạt còi; chỉ tắt khi nhiệt độ vào lại trong ngưỡng thêm `hysteresis` độ, để còi không bật tắt liên tục quanh ngưỡng |
| Lỗi nguồn quạt (`fanFault`) kéo dài ≥ `FAN_FAULT_CONFIRM_MS` (2 giây) | Kích hoạt còi, server mở cảnh báo "Thiết bị gặp lỗi" kèm loại lỗi. Không xét trong 25 giây khởi động (`FAN_SPINUP_GRACE_MS`) và 10 giây sau khi tắt (`FAN_SPINDOWN_GRACE_MS`). Mức chuẩn = mức **ổn định** (±0.1 V trong 3 giây) **cao nhất** đo được trong 60 giây sau khởi động (`FAN_LEARN_MS`), nên quạt lên điện áp chậm không bị chốt nhầm giá trị trung gian; trong 60 giây này chưa xét điện áp vọt |
| Điện áp quạt thấp (dưới `FAN_LOW_VOLTAGE_RATIO` = 80% mức chuẩn) | Lỗi `low_voltage`: quạt vẫn chạy nhưng yếu, làm lạnh kém |
| Công tắc cửa rung tiếp điểm | Bỏ qua: trạng thái cửa phải giữ nguyên `DOOR_DEBOUNCE_MS` (200 ms) mới tính là đổi |
| Tất cả bình thường | Còi tắt |
| Có lệnh từ server | Lệnh ghi đè quạt hoặc còi trong 10 phút (xem mục Lệnh điều khiển) |
## ESP32 tự khởi động lại khi quạt chạy (sụt áp)

Lúc khởi động, firmware in `Ly do khoi dong: ...`. Nếu là `BROWNOUT (sut ap nguon!)` thì điện áp nguồn của ESP32 đã tụt dưới ngưỡng an toàn và chip tự reset. Nguyên nhân thường gặp: motor quạt kéo dòng lớn lúc khởi động (cộng với cuộn hút relay) trên cùng nguồn với ESP32, nhất là khi cấp qua cổng USB máy tính.

Firmware đã giảm rủi ro bằng cách chỉ bật quạt sau khi khởi động xong 3 giây (`FAN_START_DELAY_MS`), để dòng khởi động của quạt không trùng lúc WiFi đang kết nối. Cách xử lý dứt điểm là phần cứng:

- Cấp nguồn **riêng** cho quạt (nối chung GND với ESP32), không lấy từ chân 5V/3V3 của board.
- Dùng module relay có opto, cấp nguồn cuộn hút (JD-VCC) riêng nếu module hỗ trợ.
- Gắn **diode chống ngược** (vd 1N4007) song song với quạt nếu là motor DC.
- Gắn tụ 470–1000 µF giữa 5V và GND gần ESP32; dùng nguồn 5V ≥ 2 A và cáp USB ngắn, tốt.

Không nên tắt mạch phát hiện sụt áp (brownout detector) trong code: ESP32 chạy ở điện áp thấp có thể treo hoặc ghi hỏng flash (ngưỡng phòng lưu trong NVS).
