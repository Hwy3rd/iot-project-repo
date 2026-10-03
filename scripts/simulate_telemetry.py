"""
Gửi một mẫu telemetry giả lập qua MQTT.

Cách chạy:
    python scripts/simulate_telemetry.py [--device ESP32-A10000] [--temperature -16.5]
        [--humidity 85] [--door-closed] [--fan-fault]

Gửi đủ các trường như firmware ESP32 v1.1 (độ ẩm, trạng thái quạt, điện áp
nguồn quạt, còi), xem firmware/README.md. --fan-fault: quạt bật nhưng mất
nguồn -> server mở cảnh báo DEVICE_FAULT.

Broker không cho kết nối ẩn danh (mosquitto/entrypoint.sh): dùng tài khoản
thiết bị MQTT_DEVICE_USERNAME / MQTT_DEVICE_PASSWORD — mặc định khớp với
docker-compose.yml.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

parser = argparse.ArgumentParser()
parser.add_argument("--device", default="ESP32-A10000")
parser.add_argument("--temperature", type=float, default=-16.5)
parser.add_argument("--humidity", type=float, default=85.0)
parser.add_argument("--door-closed", action="store_true", help="mặc định cửa mở")
parser.add_argument("--fan-fault", action="store_true", help="quạt bật nhưng mất nguồn")
args = parser.parse_args()

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="esp32_sim")
client.username_pw_set(
    os.getenv("MQTT_DEVICE_USERNAME", "device"),
    os.getenv("MQTT_DEVICE_PASSWORD", "password"),
)
client.connect(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")), 60)
client.loop_start()

# Mặc định -16.5°C: vượt ngưỡng trần -18.0°C của phòng đông lạnh.
door_open = not args.door_closed
# Như firmware: quạt tắt khi cửa mở, và quạt tắt thì 0 V là bình thường.
if args.fan_fault and door_open:
    parser.error("--fan-fault cần --door-closed (cửa mở thì quạt tắt)")
fan_on = not door_open
fan_power_fault = args.fan_fault
payload = {
    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "temperature": args.temperature,
    "humidity": args.humidity,
    "doorOpen": door_open,
    "sensorFault": False,
    "fanOn": fan_on,
    "fanVoltage": 0.0 if not fan_on else (0.4 if fan_power_fault else 11.9),
    "fanPowerFault": fan_power_fault,
    "alarmActive": door_open or fan_power_fault,
}

topic = f"devices/{args.device}/telemetry"
info = client.publish(topic, json.dumps(payload), qos=1)
info.wait_for_publish(timeout=5)
print(f"Published to {topic}: {payload}")
time.sleep(0.5)
client.loop_stop()
client.disconnect()
