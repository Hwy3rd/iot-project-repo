# Kết nối nhiều kho qua MQTT TLS

> Khi dùng firmware có bộ đệm offline, cấp backend quyền publish
> `devices/+/telemetry-ack` và board quyền subscribe ACK của chính nó.
> Đặt `MQTT_CLIENT_ID` riêng cho mỗi deployment. Xem [OFFLINE_RECOVERY.md](OFFLINE_RECOVERY.md).

## Phạm vi bản cập nhật trên GitHub

Bản cập nhật này gồm backend, cấu hình Docker, CA công khai, script kiểm tra MQTT
và tài liệu. Theo yêu cầu, mã firmware TLS, các mẫu cấu hình cloud của firmware
và script sinh header CA được giữ ở máy local, chưa đưa lên GitHub.
Bản firmware theo dõi trong Git vẫn dùng kết nối LAN; chỉ đổi host/cổng trong
`config.h` của bản đó chưa đủ để kết nối TLS. Phần ESP32 bên dưới áp dụng cho
bản firmware TLS local đã nạp và kiểm thử.

Xem [hướng dẫn chi tiết và kết quả kiểm thử](HUONG_DAN_KET_NOI_EMQX.md).

ESP32 ở mỗi kho và backend cùng kết nối đến cloud broker qua Internet.
Website tiếp tục nhận dữ liệu qua backend; lịch sử được backend lưu vào MongoDB.
Chuyển broker không cung cấp bộ đệm telemetry khi backend hoặc Internet bị ngắt.

## Thông tin broker

- Host: `n0c006e0.ala.asia-southeast1.emqxsl.com`
- MQTT TLS: `8883`
- CA công khai: `certs/mqtt/emqxsl-ca.crt` (DigiCert Global Root G2).
- Backend: tài khoản `iot-backend`.
- ESP32 thử nghiệm: tài khoản và ID tạm `esp32-cold-room-01`.

Mật khẩu nằm trong `.env.cloud-mqtt` và firmware `config.h`, đều được gitignore.

## Chạy backend trong Docker

Cần Docker Compose >= 2.24.4. Tạo `.env` theo `.env.example` cho các dịch vụ
database/Redis/MinIO và `.env.cloud-mqtt` theo `.env.cloud-mqtt.example` cho MQTT.
Giữ credentials datastore hiện có khi cập nhật server đang chạy.

Dev stack:

```bash
docker compose --env-file .env --env-file .env.cloud-mqtt -f docker-compose.yml -f docker-compose.cloud-mqtt.yml up -d --build
```

Với hệ thống đã khởi tạo bằng `init.sh`:

```bash
MQTT_MODE=cloud ./run.sh rebuild app worker
MQTT_MODE=cloud ./run.sh logs app
```

Chỉ chạy `MQTT_MODE=cloud ./init.sh` khi khởi tạo hệ thống mới vì lệnh này chạy seed.
Luôn giữ `MQTT_MODE=cloud` cho các thao tác sau đó.
`docker-compose.cloud-mqtt.yml` gắn CA chỉ đọc vào app/worker, bỏ dependency
Mosquitto của app và đặt Mosquitto vào profile không chạy mặc định.
Các chế độ cloud này không khởi động broker LAN. Container Mosquitto đã chạy
trước đó vẫn cần được xử lý riêng khi chuyển đổi toàn bộ thiết bị.

## Backend chạy trực tiếp trên máy

Điền datastore/secrets hiện có vào `server/.env`, rồi chạy từ `server/`:

```bash
node --env-file=.env --env-file=../.env.cloud-mqtt node_modules/@nestjs/cli/bin/nest.js start --watch
```

`MQTT_CA_FILE` của file cloud là `../certs/mqtt/emqxsl-ca.crt`, tương đối
với thư mục `server/`. Trong Docker, overlay đổi sang
`/app/certs/mqtt/emqxsl-ca.crt`. Backend kiểm tra CA và xác minh hostname,
không có tùy chọn tắt xác minh TLS. Để dùng broker LAN, chạy stack cơ sở
hoặc `MQTT_MODE=local ./run.sh ...` và cấu hình firmware LAN.

## ESP32 (bản firmware TLS giữ ở local)

Các file `config.cloud.example.h`, `mqtt_ca.h` và script
`scripts/generate-mqtt-ca.cjs` trong phần này thuộc bản local, không có trong
bản cập nhật GitHub. Cần có bản firmware TLS đó để thực hiện các bước sau.

1. Copy `firmware/cold_room_monitor/config.cloud.example.h` thành `config.h`.
2. Điền Wi-Fi 2.4 GHz tại kho, username/password MQTT của thiết bị.
3. Đặt `DEVICE_ID` bằng `unique_id` đã đăng ký và gán phòng trong website.
4. Grant quyền MQTT theo ID đó (bảng dưới), compile và nạp firmware.
5. Xem Serial Monitor: Wi-Fi có IP, NTP có giờ thực, MQTT kết nối thành công.

`MQTT_USE_TLS=1` chọn `WiFiClientSecure` và CA trong `mqtt_ca.h`.
Chờ NTP diễn ra không chặn vòng lặp cảm biến/điều khiển. Broker/cloud và
tài khoản MQTT không tự tạo thiết bị hoặc gán phòng trong database.

Khi thay CA, chạy từ thư mục gốc trước khi compile:

```bash
node scripts/generate-mqtt-ca.cjs
```

Header CA công khai được nhúng trong bản firmware TLS local để Arduino IDE build được.
Firmware TLS local giữ khả năng dùng `WiFiClient` khi không bật `MQTT_USE_TLS`.
Firmware trong Git được giữ nguyên theo yêu cầu.

## Quyền EMQX

Trong Access Control > Authorization, dùng tab **Username** để gắn quyền
với tài khoản đăng nhập. Mỗi ESP32 có credentials riêng; username có thể
khác DEVICE_ID nhưng topic phải chứa đúng ID đăng ký.

| Username | Action | Topic | Permission |
| --- | --- | --- | --- |
| iot-backend | Subscribe | devices/+/telemetry | Allow |
| iot-backend | Subscribe | devices/+/ack | Allow |
| iot-backend | Publish | devices/+/commands | Allow |
| iot-backend | Publish | devices/+/config | Allow |
| esp32-cold-room-01 | Publish | devices/esp32-cold-room-01/telemetry | Allow |
| esp32-cold-room-01 | Publish | devices/esp32-cold-room-01/ack | Allow |
| esp32-cold-room-01 | Subscribe | devices/esp32-cold-room-01/commands | Allow |
| esp32-cold-room-01 | Subscribe | devices/esp32-cold-room-01/config | Allow |

Tab **All Users**: topic `#`, Action `Publish and Subscribe`, Permission `Deny`.
EMQX áp dụng rule Username/Client ID trước rule All Users.
Khi cấp thiết bị thật, đổi credentials trong config.h và cấp bốn quyền theo
DEVICE_ID thực tế, rồi cập nhật hoặc xóa tài khoản thử nghiệm.

## Kiểm thử

```bash
node scripts/check-cloud-mqtt.cjs
```

Script dùng MQTT module thật của backend, xác minh TLS, kiểm tra quyền đọc
và việc chặn topic khác, rồi gửi probe không retained trên telemetry/ack.
Probe không phải JSON hợp lệ nên backend không lưu chúng như dữ liệu cảm biến.
Script không gửi lệnh actuator hoặc thay ngưỡng phòng.

Cuối cùng thử phần cứng: ESP32 và backend ở hai mạng Internet khác nhau,
hai thiết bị thuộc hai kho khác nhau, kiểm tra dữ liệu đúng phòng và lệnh/ack
đúng thiết bị. Kiểm thử transport không thay thế việc nạp firmware thực tế.

Tài liệu: [EMQX ESP32](https://docs.emqx.com/en/cloud/latest/connect_to_deployments/esp32.html),
[EMQX Authorization](https://docs.emqx.com/en/cloud/latest/deployments/default_authz.html),
[Docker Compose merge](https://docs.docker.com/reference/compose-file/merge/).
