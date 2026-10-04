"""Replay Bangkok through the real TS sampler and HTTP API; check integration, not accuracy."""
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import joblib
import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

SERVICE = Path(__file__).resolve().parents[1]
REPO = SERVICE.parent
sys.path.insert(0, str(SERVICE))
from temperature_features import build_features, FEATURE_SCHEMA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    cases, source_windows = [], []
    start = datetime(2026, 10, 4, tzinfo=timezone.utc)
    for path in sorted(args.raw_dir.glob("*.txt"))[-25:]:
        raw = pd.read_csv(path, sep="\t", usecols=["T_MS", "T_FC"])
        for compartment in ["T_MS", "T_FC"]:
            source = raw[compartment].to_numpy(dtype=float)
            for index in [12, 150, 1450]:
                as_of = start + timedelta(minutes=5 * index)
                # Simulate 5s telemetry with a hold of the last known 5m value.
                # All chosen checkpoints are original observations, not interpolated data.
                rows = [
                    {"ts": (as_of - timedelta(seconds=5 * i)).isoformat(),
                     "temperature": float(source[index - (i + 59) // 60])}
                    for i in range(721)
                ]
                cases.append({"asOf": as_of.isoformat(), "temperature": float(source[index]),
                              "rows": rows, "source": path.name, "compartment": compartment})
                source_windows.append(source[index - 12:index + 1])
    node_script = """
const fs = require('fs');
const { samplePredictionHistory } = require('./src/modules/telemetry/prediction-history');
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
const histories = cases.map(c => samplePredictionHistory(
  c.rows.map(r => ({ ...r, ts: new Date(r.ts) })), new Date(c.asOf), c.temperature
));
process.stdout.write(JSON.stringify(histories));
"""
    histories = json.loads(subprocess.run(
        ["node", "-r", "ts-node/register", "-e", node_script], cwd=REPO / "server",
        input=json.dumps(cases), text=True, encoding="utf-8", capture_output=True,
        check=True, timeout=60,
    ).stdout)
    for history, window in zip(histories, source_windows):
        if history is None:
            raise AssertionError("Backend rejected complete Bangkok history")
        np.testing.assert_array_equal([r["temperature"] for r in history], window)
    artifact = joblib.load(SERVICE / "temperature_model_history.pkl")
    with threadpool_limits(limits=4):
        expected = np.round(artifact["model"].predict(build_features(source_windows))
                            + np.array(source_windows)[:, -1], 2)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", OMP_NUM_THREADS="4",
               MODEL_PATH=str(SERVICE / "temperature_model_history.pkl"))
    durations = []
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as logs:
        process = subprocess.Popen(
            [sys.executable, "-B", "-m", "uvicorn", "ai_service:app", "--host", "127.0.0.1", "--port", str(port),
             "--log-level", "error", "--no-access-log"], cwd=SERVICE, env=env, stdout=logs, stderr=logs,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=1.5, trust_env=False) as client:
                for attempt in range(100):
                    if process.poll() is not None:
                        logs.seek(0)
                        raise RuntimeError(logs.read())
                    try:
                        if client.get("/health").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.1)
                else:
                    raise RuntimeError("AI server did not become healthy")
                for case, history, target in zip(cases, histories, expected):
                    payload = {"feature_schema": FEATURE_SCHEMA, "temperature": case["temperature"],
                               "temperature_history": history,
                               "temp_min": -25 if case["compartment"] == "T_FC" else 0,
                               "temp_max": -15 if case["compartment"] == "T_FC" else 8}
                    begin = time.perf_counter()
                    response = client.post("/internal/ai/predict", json=payload)
                    durations.append((time.perf_counter() - begin) * 1000)
                    response.raise_for_status()
                    result = response.json()
                    if result["predicted_temp_15m"] != float(target):
                        raise AssertionError(f"Forecast mismatch: {case['source']}")
                    breach = target < payload["temp_min"] or target > payload["temp_max"]
                    if result["will_exceed_threshold"] != bool(breach):
                        raise AssertionError("Room threshold mismatch")
                payload["temperature_history"] = history[:-1]
                if client.post("/internal/ai/predict", json=payload).status_code != 422:
                    raise AssertionError("Incomplete history should return 422")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
    result = {
        "purpose": "Integration parity, not model accuracy (final artifact trains on all 123 refrigerators)",
        "created_at": datetime.now(timezone.utc).isoformat(), "refrigerators": 25,
        "cases": len(cases), "compartments": {d: sum(c["compartment"] == d for c in cases) for d in ["T_MS", "T_FC"]},
        "path": "simulated 5s readings -> actual TypeScript sampler -> real FastAPI HTTP -> final model",
        "exact_forecast_matches": len(cases), "threshold_checks": len(cases),
        "incomplete_history_status": 422, "http_timeout_ms": 1500,
        "http_latency_ms": {"max": max(durations), "median": float(np.median(durations)),
                            "p95": float(np.percentile(durations, 95))},
        "feature_schema": FEATURE_SCHEMA, "omp_num_threads": 4,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
