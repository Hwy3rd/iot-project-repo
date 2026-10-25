// Integration test against an isolated Mosquitto. Does not use live env files,
// Cloudflare, the application database, production topics or physical devices.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dep = (name) => require(path.join(root, "server/node_modules", name));
dep("reflect-metadata");
dep("ts-node").register({
  project: path.join(root, "server/tsconfig.json"),
  transpileOnly: true,
});
const mqtt = dep("mqtt");
const { ConfigService } = dep("@nestjs/config");
const {
  createMqttConnection,
} = require("../server/src/libs/mqtt/mqtt-options");
const name = "iot-mqtt-tunnel-test-" + randomUUID().slice(0, 12);
const marker = randomUUID();
const label = "io.iot-project.mqtt-tunnel-test";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "iot-mqtt-tunnel-test-"));
const backendUser = "test-backend";
const first = {
  id: "test-room-01",
  user: "test-device-01",
  password: randomUUID(),
};
const second = {
  id: "test-room-02",
  user: "test-device-02",
  password: randomUUID() + "| with spaces",
};
const backendPassword = randomUUID();
const sensitive = [first.password, second.password, backendPassword];
const clients = [];
let containerId;
const checks = [];
function docker(args) {
  try {
    return execFileSync("docker", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error(redact(error.stderr?.toString() || error.message));
  }
}
function redact(value) {
  let text = String(value);
  for (const secret of sensitive) text = text.split(secret).join("[REDACTED]");
  return text;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function check(name) {
  checks.push(name);
  console.log("PASS " + name);
}
async function mappedUrl(port, scheme, suffix = "") {
  const deadline = Date.now() + 15000;
  do {
    const details = JSON.parse(docker(["inspect", containerId]))[0];
    const binding = details.NetworkSettings.Ports?.[port + "/tcp"]?.[0];
    if (binding?.HostPort)
      return scheme + "://127.0.0.1:" + binding.HostPort + suffix;
    if (details.State.Status === "exited")
      throw new Error("Isolated broker exited before port mapping was ready");
    await sleep(100);
  } while (Date.now() < deadline);
  throw new Error("Docker did not publish the isolated test port in time");
}
async function connect(
  url,
  user,
  password,
  clientId = randomUUID(),
  protocolVersion = 4,
) {
  const connection = createMqttConnection(
    new ConfigService({
      MQTT_URL: url,
      MQTT_USERNAME: user,
      MQTT_PASSWORD: password,
      MQTT_CA_FILE: "",
    }),
  );
  const client = mqtt.connect(connection.url, {
    ...connection.options,
    clientId,
    protocolVersion,
    reconnectPeriod: 0,
    connectTimeout: 3000,
  });
  clients.push(client);
  client.on("error", () => {});
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => fail(new Error("MQTT connection timed out")),
      4000,
    );
    const fail = (error) => {
      clearTimeout(timer);
      client.removeListener("connect", ready);
      client.removeListener("error", fail);
      client.end(true);
      reject(error);
    };
    const ready = () => {
      clearTimeout(timer);
      client.removeListener("error", fail);
      resolve(client);
    };
    client.once("error", fail);
    client.once("connect", ready);
  });
}
function received(client, topic, payload) {
  let listener, timer;
  const promise = new Promise((resolve, reject) => {
    listener = (t, bytes) => {
      if (t === topic && bytes.toString() === payload) {
        clearTimeout(timer);
        client.removeListener("message", listener);
        resolve();
      }
    };
    timer = setTimeout(() => {
      client.removeListener("message", listener);
      reject(new Error("Expected message was not delivered on " + topic));
    }, 4000);
    client.on("message", listener);
  });
  // Observe rejection immediately, including when the publisher rejects first.
  promise.catch(() => {});
  return promise;
}
async function delivered(sender, receiver, topic) {
  const payload = "isolated-test:" + randomUUID();
  const waiting = received(receiver, topic, payload);
  await sender.publishAsync(topic, payload, { qos: 1, retain: false });
  await waiting;
}
async function blocked(sender, receiver, topic) {
  const payload = "isolated-deny-test:" + randomUUID();
  let leaked = false;
  const listener = (t, bytes) => {
    if (t === topic && bytes.toString() === payload) leaked = true;
  };
  receiver.on("message", listener);
  try {
    try {
      await sender.publishAsync(topic, payload, { qos: 1, retain: false });
    } catch (error) {
      if (!/not authori[sz]ed/i.test(error.message)) throw error;
    }
    await sleep(700);
    assert.equal(
      leaked,
      false,
      "Unauthorized message was delivered on " + topic,
    );
  } finally {
    receiver.removeListener("message", listener);
  }
}
(async () => {
  fs.writeFileSync(
    path.join(temp, "broker.env"),
    [
      "MQTT_USERNAME=" + backendUser,
      "MQTT_PASSWORD=" + backendPassword,
      "MQTT_DEVICE_USERNAME=" + first.user,
      "MQTT_DEVICE_PASSWORD=" + first.password,
      "MQTT_DEVICE_ID=" + first.id,
    ].join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(temp, "devices.txt"),
    second.id + "|" + second.user + "|" + second.password + "\n",
  );
  console.log(
    "Starting isolated broker; no running application containers will be changed.",
  );
  containerId = docker([
    "run",
    "-d",
    "--name",
    name,
    "--label",
    label + "=" + marker,
    "--env-file",
    path.join(temp, "broker.env"),
    "-p",
    "127.0.0.1::1883",
    "-p",
    "127.0.0.1::8083",
    "--mount",
    "type=bind,source=" +
      path.join(root, "mosquitto/mosquitto.websocket.conf") +
      ",target=/mosquitto/config/mosquitto.conf,readonly",
    "--mount",
    "type=bind,source=" +
      path.join(root, "mosquitto/tunnel-entrypoint.sh") +
      ",target=/mosquitto-tunnel-entrypoint.sh,readonly",
    "--mount",
    "type=bind,source=" + temp + ",target=/mosquitto/tunnel-auth,readonly",
    "--entrypoint",
    "/bin/sh",
    "eclipse-mosquitto:2",
    "/mosquitto-tunnel-entrypoint.sh",
    "/usr/sbin/mosquitto",
    "-c",
    "/mosquitto/config/mosquitto.conf",
  ]);
  const tcp = await mappedUrl(1883, "mqtt");
  const ws = await mappedUrl(8083, "ws", "/mqtt");
  let backend;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      backend = await connect(
        tcp,
        backendUser,
        backendPassword,
        "test-backend-client",
        5,
      );
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await sleep(250);
    }
  }
  const device = await connect(ws, first.user, first.password, first.id);
  const other = await connect(
    ws,
    second.user,
    second.password,
    "secondary-client",
  );
  check(
    "backend factory connects over TCP; both provisioned devices connect over WebSocket",
  );
  await backend.subscribeAsync(["devices/+/telemetry", "devices/+/ack"], {
    qos: 1,
  });
  await device.subscribeAsync(
    [
      "devices/" + first.id + "/commands",
      "devices/" + first.id + "/config",
      "devices/" + first.id + "/telemetry-ack",
      "devices/" + second.id + "/telemetry-ack",
      "devices/" + second.id + "/commands",
    ],
    { qos: 1 },
  );
  await other.subscribeAsync(
    [
      "devices/" + second.id + "/commands",
      "devices/" + second.id + "/telemetry-ack",
    ],
    { qos: 1 },
  );
  await delivered(device, backend, "devices/" + first.id + "/telemetry");
  await delivered(other, backend, "devices/" + second.id + "/telemetry");
  check(
    "telemetry from separate device accounts reaches backend over native MQTT",
  );
  await delivered(backend, device, "devices/" + first.id + "/config");
  await delivered(device, backend, "devices/" + first.id + "/ack");
  check("backend config and device ack cross TCP/WebSocket in both directions");
  await delivered(backend, device, "devices/" + first.id + "/telemetry-ack");
  await delivered(backend, other, "devices/" + second.id + "/telemetry-ack");
  await blocked(device, device, "devices/" + first.id + "/telemetry-ack");
  await blocked(device, other, "devices/" + second.id + "/telemetry-ack");
  check(
    "backend telemetry acknowledgements reach each device; devices cannot forge acknowledgements",
  );
  // The valid recipient must receive the very message hidden from the other one.
  const payload = "cross-account:" + randomUUID();
  let leaked = false;
  const leakListener = (topic, bytes) => {
    if (
      topic === "devices/" + second.id + "/commands" &&
      bytes.toString() === payload
    )
      leaked = true;
  };
  device.on("message", leakListener);
  const ownDelivery = received(
    other,
    "devices/" + second.id + "/commands",
    payload,
  );
  await backend.publishAsync("devices/" + second.id + "/commands", payload, {
    qos: 1,
  });
  await ownDelivery;
  await sleep(700);
  device.removeListener("message", leakListener);
  assert.equal(
    leaked,
    false,
    "A device received another device account's command",
  );
  check("device subscription cannot read another account's commands");
  await blocked(device, backend, "devices/" + second.id + "/telemetry");
  check("device cannot publish telemetry for a different registered ID");
  await blocked(device, device, "devices/" + first.id + "/config");
  await blocked(device, device, "devices/" + first.id + "/commands");
  check("device cannot impersonate backend config or commands");
  const spoof = await connect(ws, first.user, first.password, second.id);
  await spoof.subscribeAsync("devices/" + second.id + "/commands", { qos: 1 });
  await blocked(backend, spoof, "devices/" + second.id + "/commands");
  await spoof.subscribeAsync("devices/" + second.id + "/telemetry-ack", {
    qos: 1,
  });
  await blocked(backend, spoof, "devices/" + second.id + "/telemetry-ack");
  await blocked(spoof, backend, "devices/" + second.id + "/telemetry");
  check(
    "spoofing MQTT clientId does not change per-username topic permissions",
  );
  await assert.rejects(
    connect(ws, first.user, "wrong-password-" + randomUUID()),
    /not authori[sz]ed|bad user name|bad username/i,
  );
  check("WebSocket listener refuses an incorrect password");
  await Promise.all(clients.map((client) => client.endAsync(true)));
  docker(["restart", containerId]);
  // Docker may allocate a different ephemeral host port on restart. Inspect
  // the new mapping instead of retrying the pre-restart endpoint.
  let restarted;
  const restartDeadline = Date.now() + 30000;
  while (!restarted) {
    try {
      const restartedWs = await mappedUrl(8083, "ws", "/mqtt");
      restarted = await connect(
        restartedWs,
        second.user,
        second.password,
        "restart-client",
      );
    } catch (error) {
      if (Date.now() >= restartDeadline) throw error;
      await sleep(500);
    }
  }
  assert.ok(restarted.connected);
  check(
    "broker restart regenerates auth files and preserves provisioned login",
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: checks.length,
      testedPublicCloudflare: false,
      testedPhysicalFirmware: false,
    }),
  );
})()
  .catch((error) => {
    console.error(redact(error.message));
    if (containerId) {
      try {
        console.error(redact(docker(["logs", "--tail", "35", containerId])));
      } catch {}
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled(clients.map((client) => client.endAsync(true)));
    if (containerId) {
      try {
        const current = JSON.parse(docker(["inspect", containerId]))[0];
        if (
          current.Id !== containerId ||
          current.Config.Labels?.[label] !== marker
        )
          throw new Error(
            "Refusing to remove a container without the expected test label.",
          );
        docker(["rm", "-f", containerId]);
        console.log("Isolated broker removed.");
      } catch (error) {
        console.error(redact(error.message));
        process.exitCode = 1;
      }
    }
    const base = path.resolve(os.tmpdir()) + path.sep;
    if (path.resolve(temp).startsWith(base + "iot-mqtt-tunnel-test-")) {
      for (const file of ["broker.env", "devices.txt"])
        fs.unlinkSync(path.join(temp, file));
      fs.rmdirSync(temp);
    }
  });
