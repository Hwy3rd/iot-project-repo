/** Coursework demo: install Bangkok history instantly, then use normal MQTT ingest. */
const path = require("node:path");
const { parseArgs } = require("node:util");
const fixture = require("./fixtures/ai-demo-bangkok.json");

function getProfile(name) {
  const profile = fixture.profiles[name];
  if (!profile)
    throw new Error(
      `Unknown profile. Choose: ${Object.keys(fixture.profiles).join(", ")}`,
    );
  return profile;
}

function predictionPayload(
  profile,
  now = Date.now(),
  min = profile.temp_min,
  max = profile.temp_max,
) {
  return {
    feature_schema: fixture.feature_schema,
    temperature: profile.temperatures.at(-1),
    temperature_history: profile.temperatures
      .slice(-13)
      .map((temperature, i) => ({
        ts: new Date(now - (12 - i) * 300_000).toISOString(),
        temperature,
      })),
    temp_min: min,
    temp_max: max,
  };
}

function historicalRows(profile, device, now = Date.now()) {
  // Hold each original five-minute observation until the next observation.
  // These intermediate rows are simulated, not extra physical measurements.
  return Array.from({ length: 780 }, (_, i) => {
    const temperature = profile.temperatures[Math.floor(i / 60)];
    return {
      deviceId: device.id,
      coldRoomId: device.coldRoomId,
      ts: new Date(now - 65 * 60_000 + i * 5000),
      temperature,
      sensorFault: false,
      doorOpen: false,
      outOfRange: temperature < device.tempMin || temperature > device.tempMax,
      humidity: null,
      fanOn: null,
      fanVoltage: null,
      fanPowerFault: null,
      alarmActive: null,
      demoSource: {
        type: "bangkok-coursework",
        sourceFile: profile.source_file,
        sourceDoi: fixture.source_doi,
      },
    };
  });
}

function selectProfile(device, scenario, profileName) {
  const candidates = profileName
    ? [[profileName, getProfile(profileName)]]
    : Object.entries(fixture.profiles);
  const margin = Number(device.hysteresis || 0);
  return candidates.find(([, p]) => {
    const current = p.temperatures.at(-1);
    const predicted = p.predicted_temp_15m_at_export;
    return (
      p.scenario === scenario &&
      current >= device.tempMin &&
      current <= device.tempMax &&
      (scenario === "warning"
        ? predicted > device.tempMax
        : current >= device.tempMin + margin &&
          current <= device.tempMax - margin &&
          predicted >= device.tempMin + margin &&
          predicted <= device.tempMax - margin)
    );
  });
}

async function predict(profile, now, min, max) {
  const response = await fetch(
    `${process.env.AI_SERVICE_URL || "http://localhost:8000"}/internal/ai/predict`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(predictionPayload(profile, now, min, max)),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok)
    throw new Error(
      `AI request returned HTTP ${response.status}; check /health and rebuild ai-service.`,
    );
  return response.json();
}

async function run(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      device: { type: "string" },
      profile: { type: "string" },
      scenario: { type: "string" },
      "api-only": { type: "boolean" },
      "dry-run": { type: "boolean" },
      "list-devices": { type: "boolean" },
      duration: { type: "string", default: "120" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(`Coursework demo (no ESP32, no one-hour wait):
  node scripts/demo_ai.js --api-only --profile freezer-normal
  node scripts/demo_ai.js --api-only --profile freezer-warning
  node scripts/demo_ai.js --list-devices
  node scripts/demo_ai.js --device <uniqueId> --scenario normal
  node scripts/demo_ai.js --device <uniqueId> --scenario warning
  node scripts/demo_ai.js --dry-run --profile chill-normal
Profiles: ${Object.keys(fixture.profiles).join(", ")}
--device installs simulated history in MongoDB and publishes MQTT telemetry for --duration seconds (default 120).
Configuration: server/.env, overridden by environment variables. Use a demo device assigned to a room.`);
    return;
  }
  const scenario =
    values.scenario ||
    (values.profile && getProfile(values.profile).scenario) ||
    "normal";
  if (!["normal", "warning"].includes(scenario))
    throw new Error("--scenario must be normal or warning");
  const duration = Number(values.duration);
  if (!Number.isFinite(duration) || duration < 0 || duration > 3600)
    throw new Error("--duration must be 0..3600 seconds");
  const profileName = values.profile || `freezer-${scenario}`;
  if (values["dry-run"]) {
    const profile = getProfile(profileName);
    console.log(
      JSON.stringify(
        {
          purpose: fixture.purpose,
          profile: profileName,
          history_rows: 780,
          source: profile.source_file,
          request: predictionPayload(profile),
          expected_forecast_at_export: profile.predicted_temp_15m_at_export,
        },
        null,
        2,
      ),
    );
    return;
  }
  require("../server/node_modules/dotenv").config({
    path: path.join(__dirname, "../server/.env"),
    quiet: true,
  });
  if (values["api-only"]) {
    const profile = getProfile(profileName);
    console.log(
      JSON.stringify(
        {
          demo: true,
          source: fixture.source_doi,
          profile: profileName,
          result: await predict(
            profile,
            Date.now(),
            profile.temp_min,
            profile.temp_max,
          ),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.device && !values["list-devices"])
    throw new Error(
      "Choose --api-only or --device <uniqueId>. Use --list-devices to find a demo device.",
    );
  const mysql = require("../server/node_modules/mysql2/promise");
  const sql = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "user",
    password: process.env.MYSQL_PASSWORD || "password",
    database: process.env.MYSQL_DATABASE || "iot_database",
    connectTimeout: 5000,
  });
  let device;
  try {
    const [devices] = await sql.execute(
      `SELECT d.id, d.unique_id AS uniqueId, d.cold_room_id AS coldRoomId,
      cr.name AS roomName, cr.temp_min AS tempMin, cr.temp_max AS tempMax, cr.hysteresis AS hysteresis
      FROM devices d JOIN cold_rooms cr ON cr.id = d.cold_room_id
      WHERE d.deleted_at IS NULL AND cr.deleted_at IS NULL AND d.status <> 'decommissioned'
      ${values["list-devices"] ? "" : "AND d.unique_id = ?"} ORDER BY d.unique_id`,
      values["list-devices"] ? [] : [values.device],
    );
    if (values["list-devices"]) {
      console.table(
        devices.map(({ uniqueId, roomName, tempMin, tempMax }) => ({
          uniqueId,
          roomName,
          tempMin,
          tempMax,
        })),
      );
      return;
    }
    if (!devices.length)
      throw new Error(
        "Device was not found or is not assigned to a room. Check --list-devices.",
      );
    device = {
      ...devices[0],
      tempMin: Number(devices[0].tempMin),
      tempMax: Number(devices[0].tempMax),
      hysteresis: Number(devices[0].hysteresis),
    };
  } finally {
    await sql.end();
  }
  const selected = selectProfile(device, scenario, values.profile);
  if (!selected)
    throw new Error(
      "No demo profile matches this room and scenario. Choose another demo device/profile; room thresholds are kept as configured.",
    );
  const [selectedName, profile] = selected;
  const now = Date.now();
  // Verify the AI is available before installing any demo observations.
  const preview = await predict(profile, now, device.tempMin, device.tempMax);
  if ((scenario === "warning") !== preview.will_exceed_threshold) {
    throw new Error(
      "The loaded AI model does not match this demo scenario. Check the model or use --api-only to inspect its output.",
    );
  }
  const mongoose = require("../server/node_modules/mongoose");
  const mongo = mongoose.createConnection(
    process.env.MONGO_URI ||
      "mongodb://root:password@localhost:27017/iot?authSource=admin",
    { serverSelectionTimeoutMS: 5000 },
  );
  try {
    await mongo.asPromise();
    const rows = historicalRows(profile, device, now);
    const outcome = await mongo.collection("telemetry_raw").bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { deviceId: device.id, ts: row.ts },
          update: { $setOnInsert: row },
          upsert: true,
        },
      })),
      { ordered: true },
    );
    console.log(
      `DEMO: installed ${outcome.upsertedCount} Bangkok history rows for ${device.uniqueId} / ${device.roomName}.`,
    );
    console.log(
      `Profile ${selectedName}; current ${profile.temperatures.at(-1)} C; forecast ${preview.predicted_temp_15m} C (${preview.risk_level}).`,
    );
  } finally {
    await mongo.close();
  }
  const mqtt = require("../server/node_modules/mqtt");
  const client = await mqtt.connectAsync(
    process.env.MQTT_URL || "mqtt://localhost:1883",
    {
      username: process.env.MQTT_DEVICE_USERNAME || "device",
      password: process.env.MQTT_DEVICE_PASSWORD || "password",
      reconnectPeriod: 0,
      connectTimeout: 5000,
    },
  );
  // Attach a listener so a broker disconnect fails cleanly during the demo.
  let mqttError;
  client.on("error", (error) => {
    mqttError = error;
  });
  const endAt = Date.now() + duration * 1000;
  try {
    do {
      if (mqttError) throw mqttError;
      await client.publishAsync(
        `devices/${device.uniqueId}/telemetry`,
        JSON.stringify({
          ts: new Date().toISOString(),
          temperature: profile.temperatures.at(-1),
          doorOpen: false,
          sensorFault: false,
        }),
        { qos: 1 },
      );
      if (Date.now() >= endAt) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, endAt - Date.now())),
      );
    } while (Date.now() < endAt);
    console.log(
      "Demo telemetry sent. Open this room in Monitoring to see the normal backend forecast and alerts.",
    );
  } finally {
    await client.endAsync();
  }
}

module.exports = {
  getProfile,
  predictionPayload,
  historicalRows,
  selectProfile,
  run,
};
if (require.main === module) {
  run().catch((error) => {
    console.error(`Demo failed: ${error.message}`);
    process.exitCode = 1;
  });
}
