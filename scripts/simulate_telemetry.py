import json
import time
from datetime import datetime
import paho.mqtt.client as mqtt

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="esp32_sim")
client.connect("localhost", 1883, 60)

# Temperature is -16.5°C which exceeds the room's max of -18.0°C
payload = {
    "ts": datetime.utcnow().isoformat() + "Z",
    "temperature": -16.5,
    "doorOpen": True,
    "sensorFault": False
}

topic = "devices/ESP32-A10000/telemetry"
client.publish(topic, json.dumps(payload), qos=1)
print(f"Successfully published to {topic}: {payload}")
time.sleep(1)
client.disconnect()
