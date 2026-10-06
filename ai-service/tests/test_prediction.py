import sys
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import joblib
import numpy as np
from fastapi.testclient import TestClient
from pydantic import ValidationError
from threadpoolctl import threadpool_limits

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_service
from temperature_features import build_features, FEATURE_NAMES, FEATURE_SCHEMA


def request(temperatures=None):
    temperatures = temperatures if temperatures is not None else [-18.0] * 13
    start = datetime(2026, 10, 4, 9, tzinfo=timezone.utc)
    return {
        "feature_schema": FEATURE_SCHEMA, "temperature": temperatures[-1],
        "temperature_history": [
            {"ts": (start + timedelta(minutes=5 * i)).isoformat(), "temperature": float(t)}
            for i, t in enumerate(temperatures)
        ], "temp_min": -20, "temp_max": -15,
    }


class FeatureTests(unittest.TestCase):
    def test_features_on_a_linear_ramp(self):
        features = build_features(np.arange(-20, -7)).iloc[0]
        self.assertEqual(list(features.index), FEATURE_NAMES)
        expected = {
            "temperature": -8, "temp_delta": 1, "temp_moving_avg": -9,
            "temp_lag_60m": -20, "temp_lag_45m": -17, "temp_delta_60m": 12,
            "temp_delta_30m": 6, "temp_mean_30m": -10.5,
            "temp_mean_60m": -13.5, "temp_range_30m": 5, "temp_range_60m": 11,
            "temp_std_15m": 0.8165, "temp_std_30m": 1.7078, "temp_std_60m": 3.4521,
        }
        for name, value in expected.items():
            self.assertEqual(features[name], value, name)

    def test_bulk_and_single_features_match(self):
        rng = np.random.default_rng(42)
        windows = rng.uniform(-25, -15, (100, 13))
        bulk = build_features(windows)
        for index, window in enumerate(windows):
            np.testing.assert_array_equal(bulk.iloc[index], build_features(window).iloc[0])

    def test_invalid_or_incomplete_inputs_fail(self):
        for values in [[-18] * 12, [np.nan] * 13, [np.inf] * 13]:
            with self.assertRaises(ValueError):
                build_features(values)


class ContractTests(unittest.TestCase):
    def test_valid_history_and_one_minute_jitter(self):
        payload = request()
        payload["temperature_history"][4]["ts"] = "2026-10-04T09:19:00+00:00"
        ai_service.SensorDataRequest.model_validate(payload)

    def test_missing_stale_future_duplicate_or_unzoned_history_is_rejected(self):
        mutations = [
            lambda p: p["temperature_history"].pop(0),
            lambda p: p["temperature_history"][4].update(ts="2026-10-04T09:18:59+00:00"),
            lambda p: p["temperature_history"][4].update(ts="2026-10-04T09:20:01+00:00"),
            lambda p: p["temperature_history"][4].update(ts=p["temperature_history"][3]["ts"]),
            lambda p: p["temperature_history"][4].update(ts="2026-10-04T09:20:00"),
            lambda p: p.update(temperature=-17),
            lambda p: p.update(temp_min=-15, temp_max=-20),
            lambda p: p.update(feature_schema="legacy-v0"),
            lambda p: p["temperature_history"][4].update(temperature=-40),
            lambda p: p.update(temperature=float("nan")),
        ]
        for mutate in mutations:
            payload = request()
            mutate(payload)
            with self.assertRaises(ValidationError):
                ai_service.SensorDataRequest.model_validate(payload)


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loaded = joblib.load(ai_service.DEFAULT_MODEL)
        cls.pool = threadpool_limits(limits=4)

    @classmethod
    def tearDownClass(cls):
        cls.pool.restore_original_limits()

    def setUp(self):
        self.client = TestClient(ai_service.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_real_model_health_and_absolute_prediction(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["feature_schema"], FEATURE_SCHEMA)
        payload = request([-18 + 0.1 * i for i in range(13)])
        expected = round(float(self.loaded["model"].predict(build_features(
            [reading["temperature"] for reading in payload["temperature_history"]]
        ))[0]) + payload["temperature"], 2)
        response = self.client.post("/internal/ai/predict", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["predicted_temp_15m"], expected)
        self.assertEqual(result["metadata"]["as_of"], payload["temperature_history"][-1]["ts"])
        self.assertTrue(set(["risk_level", "recommendation", "violation_type", "will_exceed_threshold"]).issubset(result))

    def test_change_is_added_back_and_room_thresholds_are_used(self):
        model = Mock()
        model.predict.return_value = np.array([0.4])
        with patch.dict(ai_service.model_artifacts, model=model):
            payload = request()
            response = self.client.post("/internal/ai/predict", json=payload)
            self.assertEqual(response.json()["predicted_temp_15m"], -17.6)
            self.assertFalse(response.json()["will_exceed_threshold"])
            for delta, violation in [(4, "OVERHEAT"), (-4, "FREEZING")]:
                model.predict.return_value = np.array([delta])
                response = self.client.post("/internal/ai/predict", json=payload)
                self.assertEqual(response.json()["violation_type"], violation)
                self.assertTrue(response.json()["will_exceed_threshold"])

    def test_bundled_demo_profiles_work_without_sensor_history(self):
        repo = Path(ai_service.__file__).resolve().parent.parent
        fixture = json.loads((repo / "scripts/fixtures/ai-demo-bangkok.json").read_text(encoding="utf-8"))
        for name, profile in fixture["profiles"].items():
            payload = request(profile["temperatures"][-13:])
            payload.update(temp_min=profile["temp_min"], temp_max=profile["temp_max"])
            response = self.client.post("/internal/ai/predict", json=payload)
            self.assertEqual(response.status_code, 200, f"{name}: {response.text}")
            result = response.json()
            self.assertEqual(result["predicted_temp_15m"], profile["predicted_temp_15m_at_export"], name)
            self.assertEqual(result["will_exceed_threshold"], profile["scenario"] == "warning", name)

    def test_old_or_incomplete_requests_return_422(self):
        self.assertEqual(self.client.post("/internal/ai/predict", json={"temperature": -18}).status_code, 422)
        payload = request()
        payload["temperature_history"].pop(0)
        self.assertEqual(self.client.post("/internal/ai/predict", json=payload).status_code, 422)

    def test_missing_model_and_incompatible_artifact_fail_safely(self):
        with patch.dict(ai_service.model_artifacts, model=None):
            self.assertEqual(self.client.get("/health").status_code, 503)
            self.assertEqual(self.client.post("/internal/ai/predict", json=request()).status_code, 503)
        bad = dict(self.loaded, prediction_mode="absolute_temperature")
        with self.assertRaises(ValueError):
            ai_service.validate_artifact(bad)
        legacy = joblib.load(Path(ai_service.__file__).with_name("temperature_model_hgb.pkl"))
        with self.assertRaises(ValueError):
            ai_service.validate_artifact(legacy)

    def test_non_finite_output_is_not_returned_as_a_forecast(self):
        model = Mock()
        model.predict.return_value = np.array([np.nan])
        with patch.dict(ai_service.model_artifacts, model=model):
            self.assertEqual(self.client.post("/internal/ai/predict", json=request()).status_code, 500)


if __name__ == "__main__":
    unittest.main()
