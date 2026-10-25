// Connect using the actual backend MQTT module, then check device ACLs.
// Probes are non-retained, non-JSON messages on telemetry/ack only.
// They cannot be interpreted as actuator commands or valid sensor readings.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dep = (name) => require(path.join(root, "server/node_modules", name));
dep("reflect-metadata");
dep("ts-node").register({
  project: path.join(root, "server/tsconfig.json"),
  transpileOnly: true,
});
const { ConfigService } = dep("@nestjs/config");
const { Test } = dep("@nestjs/testing");
const mqtt = dep("mqtt");
const { randomUUID } = require("node:crypto");
const { MqttModule } = require("../server/src/libs/mqtt/mqtt.module");
const { MQTT_CLIENT } = require("../server/src/libs/mqtt/mqtt.constant");
const {
  createMqttConnection,
} = require("../server/src/libs/mqtt/mqtt-options");
// The root .env keeps the cloud settings under MQTT_CLOUD_*; map them onto
// the names createMqttConnection() reads. Same CA the cloud overlay mounts.
const env = dep("dotenv").parse(fs.readFileSync(path.join(root, ".env")));
const values = {
  MQTT_URL: env.MQTT_CLOUD_URL,
  MQTT_USERNAME: env.MQTT_CLOUD_USERNAME,
  MQTT_PASSWORD: env.MQTT_CLOUD_PASSWORD,
  MQTT_DEVICE_USERNAME: env.MQTT_CLOUD_DEVICE_USERNAME,
  MQTT_DEVICE_PASSWORD: env.MQTT_CLOUD_DEVICE_PASSWORD,
  MQTT_DEVICE_ID: env.MQTT_CLOUD_DEVICE_ID,
  MQTT_CA_FILE: path.join(root, "certs/mqtt/emqxsl-ca.crt"),
};
if (!values.MQTT_URL?.startsWith("mqtts://"))
  throw new Error("Expected a mqtts URL in MQTT_CLOUD_URL");
const deviceId = values.MQTT_DEVICE_ID;
if (!deviceId || !/^[A-Za-z0-9_.-]+$/.test(deviceId))
  throw new Error("Invalid MQTT_CLOUD_DEVICE_ID");
for (const key of [
  "MQTT_USERNAME",
  "MQTT_PASSWORD",
  "MQTT_DEVICE_USERNAME",
  "MQTT_DEVICE_PASSWORD",
]) {
  if (!values[key] || values[key].startsWith("<"))
    throw new Error("Missing " + key.replace("MQTT_", "MQTT_CLOUD_"));
}

async function connected(client) {
  if (!client.connected) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MQTT connection timed out")),
        15000,
      );
      client.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      client.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  if (!client.stream.authorized)
    throw new Error("TLS certificate was not verified");
}

async function subscription(client, topic, allowed) {
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SUBACK timed out")), 8000);
    client.subscribe(topic, { qos: 1 }, (error, grants, packet) => {
      clearTimeout(timer);
      const result = packet?.granted?.[0] ?? grants?.[0]?.qos;
      if (typeof result !== "number") {
        reject(error || new Error("Missing SUBACK"));
        return;
      }
      resolve(result);
    });
  });
  if (code < 128 !== allowed)
    throw new Error("Unexpected subscription permission: " + topic);
  return { topic, action: "Subscribe", result: allowed ? "ALLOW" : "DENY" };
}

async function probe(sender, receiver, topic) {
  const payload = "mqtt-transport-probe:" + randomUUID();
  let timer;
  let receive;
  const received = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Probe was not delivered: " + topic)),
      10000,
    );
    receive = (incomingTopic, message) => {
      if (incomingTopic === topic && message.toString() === payload) resolve();
    };
    receiver.on("message", receive);
  });
  // Attach a handler before publishing so early timeout/rejection is observed.
  const settled = received.then(
    () => null,
    (error) => error,
  );
  try {
    await sender.publishAsync(topic, payload, { qos: 1, retain: false });
    const error = await settled;
    if (error) throw error;
  } finally {
    clearTimeout(timer);
    receiver.removeListener("message", receive);
  }
  return { topic, action: "Publish", result: "DELIVERED" };
}

(async () => {
  const timeout = setTimeout(() => {
    console.error("Cloud MQTT check timed out");
    process.exit(2);
  }, 60000);
  let module;
  let backend;
  let device;
  try {
    module = await Test.createTestingModule({ imports: [MqttModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(values))
      .compile();
    backend = module.get(MQTT_CLIENT);
    await connected(backend);
    const connection = createMqttConnection(
      new ConfigService({
        ...values,
        MQTT_USERNAME: values.MQTT_DEVICE_USERNAME,
        MQTT_PASSWORD: values.MQTT_DEVICE_PASSWORD,
      }),
    );
    device = mqtt.connect(connection.url, connection.options);
    device.on("error", () => {});
    await connected(device);
    const own = "devices/" + deviceId;
    const other = "devices/mqtt-other-" + randomUUID();
    const checks = [];
    checks.push(await subscription(backend, "devices/+/telemetry", true));
    checks.push(await subscription(backend, "devices/+/ack", true));
    checks.push(await subscription(backend, own + "/commands", false));
    checks.push(await subscription(device, own + "/commands", true));
    checks.push(await subscription(device, own + "/config", true));
    checks.push(await subscription(device, other + "/commands", false));
    checks.push(await subscription(device, own + "/telemetry", false));
    checks.push(await subscription(device, "devices/+/commands", false));
    checks.push(await probe(device, backend, own + "/telemetry"));
    checks.push(await probe(device, backend, own + "/ack"));
    console.log(
      JSON.stringify({ passed: true, tlsVerified: true, checks }, null, 2),
    );
  } catch (error) {
    let message = String(error.message);
    for (const secret of [values.MQTT_PASSWORD, values.MQTT_DEVICE_PASSWORD]) {
      if (secret) message = message.split(secret).join("[REDACTED]");
    }
    console.error(message);
    process.exitCode = 1;
  } finally {
    if (device) await device.endAsync(true);
    if (backend) await backend.endAsync(true);
    if (module) await module.close();
    clearTimeout(timeout);
  }
})().catch(() => {
  console.error("Cloud MQTT check failed");
  process.exitCode = 1;
});
