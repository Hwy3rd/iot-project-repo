const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { historicalRows, getProfile, predictionPayload } = require("./demo_ai");
const {
  samplePredictionHistory,
} = require("../server/dist/modules/telemetry/prediction-history");
const fixture = require("./fixtures/ai-demo-bangkok.json");
const now = Date.parse("2026-10-04T10:00:00Z");

test("instant demo history is accepted by the actual backend sampler with startup delay", () => {
  for (const profile of Object.values(fixture.profiles)) {
    const device = {
      id: "demo-device",
      coldRoomId: "demo-room",
      tempMin: profile.temp_min,
      tempMax: profile.temp_max,
    };
    const past = historicalRows(profile, device, now);
    assert.equal(past.length, 780);
    for (const startupDelay of [0, 15_750, 120_000]) {
      const asOf = new Date(now + startupDelay);
      const current = profile.temperatures.at(-1);
      const selected = samplePredictionHistory(
        [...past, { ts: asOf, temperature: current }],
        asOf,
        current,
      );
      assert.ok(
        selected,
        "65 minutes of simulated history covers the full model window",
      );
      assert.deepEqual(
        selected.map((r) => r.temperature),
        profile.temperatures.slice(-13),
      );
    }
    assert.ok(
      past.every(
        (r) => r.deviceId === device.id && r.coldRoomId === device.coldRoomId,
      ),
    );
    assert.ok(
      past.every(
        (r) =>
          r.ts.getTime() < now && r.demoSource.type === "bangkok-coursework",
      ),
    );
  }
});

test("demo API inputs use only current/past observations and match each exported scenario", () => {
  for (const profile of Object.values(fixture.profiles)) {
    const payload = predictionPayload(profile, now);
    assert.equal(payload.temperature_history.length, 13);
    assert.equal(Date.parse(payload.temperature_history.at(-1).ts), now);
    assert.equal(
      Date.parse(payload.temperature_history[0].ts),
      now - 3_600_000,
    );
    assert.equal(payload.temperature, profile.temperatures.at(-1));
    assert.ok(
      payload.temperature >= profile.temp_min &&
        payload.temperature <= profile.temp_max,
    );
    const breach =
      profile.predicted_temp_15m_at_export > profile.temp_max ||
      profile.predicted_temp_15m_at_export < profile.temp_min;
    assert.equal(breach, profile.scenario === "warning");
  }
});

test("dry run needs no Docker, database, MQTT or raw Bangkok files", () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "demo_ai.js"),
      "--dry-run",
      "--profile",
      "freezer-normal",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.history_rows, 780);
  assert.equal(plan.request.feature_schema, "temperature-history-v1");
});

test("normal demo can recover a previous alert through the room hysteresis band", () => {
  const { selectProfile } = require("./demo_ai");
  const room = { tempMin: -20, tempMax: -15, hysteresis: 1 };
  assert.equal(selectProfile(room, "normal")[0], "freezer-warm-normal");
  assert.equal(selectProfile(room, "warning")[0], "freezer-warm-warning");
  assert.equal(selectProfile(room, "normal", "freezer-normal"), undefined);
});
