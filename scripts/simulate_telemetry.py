"""
Gửi một mẫu telemetry giả lập qua MQTT.

Cách chạy:
    python scripts/simulate_telemetry.py [--device ESP32-A10000] [--temperature -16.5]

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
args = parser.parse_args()

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="esp32_sim")
client.username_pw_set(
    os.getenv("MQTT_DEVICE_USERNAME", "device"),
    os.getenv("MQTT_DEVICE_PASSWORD", "password"),
)
client.connect(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")), 60)
client.loop_start()

# Mặc định -16.5°C: vượt ngưỡng trần -18.0°C của phòng đông lạnh.
payload = {
    "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "temperature": args.temperature,
    "doorOpen": True,
    "sensorFault": False,
}

topic = f"devices/{args.device}/telemetry"
info = client.publish(topic, json.dumps(payload), qos=1)
info.wait_for_publish(timeout=5)
print(f"Published to {topic}: {payload}")
time.sleep(0.5)
client.loop_stop()
client.disconnect()
