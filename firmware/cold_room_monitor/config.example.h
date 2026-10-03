// Cau hinh firmware ESP32. Copy file nay thanh `config.h` (cung thu muc, da
// gitignore — chua mat khau, KHONG commit), sua gia tri roi bien dich/nap code.
#pragma once

// WiFi (ESP32 chi bat duoc WiFi 2.4 GHz; can co Internet de dong bo gio NTP)
#define WIFI_SSID         "TEN_WIFI_CUA_BAN"
#define WIFI_PASSWORD     "MAT_KHAU_WIFI"

// IP LAN cua may chay Docker (Windows: `ipconfig`; WSL mirrored: `ip -4 addr show eth0`)
#define MQTT_BROKER_HOST  "192.168.1.100"
#define MQTT_BROKER_PORT  1883

// Tai khoan THIET BI cua broker (broker tu choi ket noi an danh): lay
// MQTT_DEVICE_USERNAME / MQTT_DEVICE_PASSWORD trong file .env goc cua repo
// (dev mac dinh: device / password). KHONG dung tai khoan backend MQTT_USERNAME.
#define MQTT_USERNAME     "device"
#define MQTT_PASSWORD     "password"

// ID thiet bi: DUY NHAT cho moi ESP32, phai KHOP `unique_id` cua thiet bi tren
// server. Chi gom chu, so, '_', '-', '.' (dung lam segment topic MQTT).
// Topic gui du lieu tu ghep: devices/<DEVICE_ID>/telemetry
#define DEVICE_ID         "esp32-coldroom-01"

// May chu NTP lay gio thuc (UTC) cho truong "ts"
#define NTP_SERVER_1      "pool.ntp.org"
#define NTP_SERVER_2      "time.google.com"
