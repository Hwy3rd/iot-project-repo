// Cau hinh firmware ESP32. Copy file nay thanh `config.h` (cung thu muc, da
// gitignore — chua mat khau, KHONG commit), sua gia tri roi bien dich/nap code.
#pragma once

// WiFi (ESP32 chi bat duoc WiFi 2.4 GHz; can co Internet de dong bo gio NTP)
#define WIFI_SSID         "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD     "MAT_KHAU_WIFI"

// Broker MQTT, chon 1 dong theo che do server (MQTT_MODE):
//   local  - cung LAN voi may chay Docker (Windows: `ipconfig`; WSL mirrored:
//            `ip -4 addr show eth0`)
//   tunnel - qua Cloudflare Tunnel, ESP32 o WiFi nao cung duoc
//   cloud  - EMQX Cloud (TLS)
#define MQTT_URI          "mqtt://192.168.1.100:1883"
// #define MQTT_URI       "wss://mqtt.hwyrd-dev.id.vn:443/mqtt"
// #define MQTT_URI       "mqtts://n0c006e0.ala.asia-southeast1.emqxsl.com:8883"

// Tai khoan THIET BI cua broker (broker tu choi ket noi an danh):
//   local/tunnel, cach khuyen dung - tai khoan RIENG cua board, cap tren web
//            (Dang ky thiet bi / nut "Mat khau MQTT"): username = DEVICE_ID,
//            mat khau chi hien 1 lan, giao dien co san 3 dong de dan vao day
//   local  - hoac tai khoan dung chung MQTT_DEVICE_USERNAME / MQTT_DEVICE_PASSWORD
//            trong .env goc (dev mac dinh: device / password)
//   tunnel - hoac tai khoan rieng khai bao trong
//            mosquitto/tunnel-auth/devices.txt (deviceId|username|password)
//   cloud  - tai khoan rieng cua board tren EMQX
// KHONG dung tai khoan backend MQTT_USERNAME.
#define MQTT_USERNAME     "device"
#define MQTT_PASSWORD     "password"

// mqtts:// va wss:// kiem tra chung chi broker bang bo CA co san trong core.
// Chi khi can ghim mot CA rieng moi bo comment (chuoi PEM day du):
// #define MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"

// ID thiet bi: DUY NHAT cho moi ESP32, phai KHOP `unique_id` cua thiet bi tren
// server (che do tunnel: khop ca deviceId trong devices.txt). Chi gom chu, so, '_',
// '-', '.' (dung lam segment topic MQTT).
// Topic tu ghep: devices/<DEVICE_ID>/telemetry, /telemetry-ack, /commands, /ack, /config
#define DEVICE_ID         "esp32-coldroom-01"

// May chu NTP lay gio thuc (UTC) cho truong "ts"
#define NTP_SERVER_1      "pool.ntp.org"
#define NTP_SERVER_2      "time.google.com"
