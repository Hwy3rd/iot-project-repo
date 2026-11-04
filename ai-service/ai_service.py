"""Internal HGB temperature forecasts at the next 5- and 10-minute checkpoints."""
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sklearn.ensemble import HistGradientBoostingRegressor

from temperature_features import (
    FEATURE_NAMES, FEATURE_SCHEMA, HISTORY_SAMPLES, MAX_SAMPLE_AGE_SECONDS,
    SAMPLING_SECONDS, SUPPORTED_MAX_TEMP, SUPPORTED_MIN_TEMP, build_features,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("ai_service")
HORIZONS = (5, 10)
FORECAST_SCHEMA = "temperature-warning-5-10-v1"
DEFAULT_MODEL = Path(__file__).with_name("temperature_model_warning_5_10.pkl")
MODEL_PATH = os.getenv("MODEL_PATH", str(DEFAULT_MODEL))
DEFAULT_TEMP_MIN, DEFAULT_TEMP_MAX = 2.0, 8.0
model_artifacts = {"models": None, "metrics": None, "loaded_at": None}


def validate_artifact(loaded):
    expected = {
        "algorithm": "hgb", "feature_schema": FEATURE_SCHEMA, "feature_names": FEATURE_NAMES,
        "forecast_schema": FORECAST_SCHEMA, "prediction_mode": "temperature_change",
        "horizons_minutes": list(HORIZONS),
        "target_names": {str(m): f"temp_change_{m}m" for m in HORIZONS},
        "history_samples": HISTORY_SAMPLES, "sampling_seconds": SAMPLING_SECONDS,
        "max_sample_age_seconds": MAX_SAMPLE_AGE_SECONDS,
        "supported_temperature_range": [SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP],
    }
    if not isinstance(loaded, dict) or any(loaded.get(k) != value for k, value in expected.items()):
        raise ValueError("Incompatible artifact: temperature-warning-5-10-v1 required")
    models = loaded.get("models")
    if not isinstance(models, dict) or set(models) != {str(m) for m in HORIZONS}:
        raise ValueError("Separate models at 5 and 10 minutes required")
    for model in models.values():
        if (not isinstance(model, HistGradientBoostingRegressor)
                or list(getattr(model, "feature_names_in_", [])) != FEATURE_NAMES):
            raise ValueError("HGB model feature order does not match temperature-history-v1")
    return models


@asynccontextmanager
async def lifespan(app: FastAPI):
    model_artifacts.update(models=None, metrics=None, loaded_at=None)
    try:
        loaded = joblib.load(MODEL_PATH)
        models = validate_artifact(loaded)
        model_artifacts.update(models=models, metrics=loaded.get("metrics"),
                               loaded_at=datetime.now(timezone.utc).isoformat())
        logger.info("Loaded HGB forecasts at 5 and 10 minutes from %s", MODEL_PATH)
    except Exception:
        logger.exception("AI model unavailable or incompatible: %s", MODEL_PATH)
    yield
    model_artifacts["models"] = None


app = FastAPI(title="Cold Chain Temperature Forecasting Microservice", version="3.0.0",
              description="Dự báo nhiệt độ tại mốc 5 và 10 phút, kèm cảnh báo sớm để kiểm tra thủ công.",
              lifespan=lifespan)


class HistoryReading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ts: AwareDatetime
    temperature: float = Field(ge=SUPPORTED_MIN_TEMP, le=SUPPORTED_MAX_TEMP, allow_inf_nan=False)


class SensorDataRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feature_schema: Literal["temperature-history-v1"]
    temperature: float = Field(ge=SUPPORTED_MIN_TEMP, le=SUPPORTED_MAX_TEMP, allow_inf_nan=False)
    temperature_history: list[HistoryReading] = Field(min_length=HISTORY_SAMPLES, max_length=HISTORY_SAMPLES)
    temp_min: float = Field(default=DEFAULT_TEMP_MIN, ge=-40, le=50, allow_inf_nan=False)
    temp_max: float = Field(default=DEFAULT_TEMP_MAX, ge=-30, le=60, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_history(self):
        if self.temp_min >= self.temp_max:
            raise ValueError("temp_min must be less than temp_max")
        history = self.temperature_history
        if abs(history[-1].temperature - self.temperature) > 1e-9:
            raise ValueError("Current temperature must match the latest history reading")
        latest = history[-1].ts
        for index, reading in enumerate(history):
            if index and reading.ts <= history[index - 1].ts:
                raise ValueError("History timestamps must be strictly increasing")
            age = (latest - reading.ts).total_seconds() - (HISTORY_SAMPLES - 1 - index) * SAMPLING_SECONDS
            if age < 0 or age > MAX_SAMPLE_AGE_SECONDS:
                raise ValueError("History must cover 60 minutes at five-minute checkpoints (up to 60s old)")
        return self


class ForecastPoint(BaseModel):
    horizon_minutes: Literal[5, 10]
    predicted_temp: float = Field(allow_inf_nan=False)
    will_exceed_threshold: bool
    violation_type: Literal["NONE", "OVERHEAT", "FREEZING"]


class PredictionResponse(BaseModel):
    forecast_schema: Literal["temperature-warning-5-10-v1"] = FORECAST_SCHEMA
    as_of: AwareDatetime
    forecasts: list[ForecastPoint] = Field(min_length=2, max_length=2)
    will_exceed_threshold: bool
    first_violation_minutes: Literal[5, 10] | None
    violation_type: Literal["NONE", "OVERHEAT", "FREEZING"]
    risk_level: Literal["NORMAL", "WARNING"]
    recommendation: str
    metadata: dict = Field(default_factory=dict)


def violation(temperature, low, high):
    return "OVERHEAT" if temperature > high else "FREEZING" if temperature < low else "NONE"


def summarize_forecasts(points, low, high):
    first = next((point for point in points if point.will_exceed_threshold), None)
    if first:
        direction = "vượt ngưỡng trên" if first.violation_type == "OVERHEAT" else "dưới ngưỡng dưới"
        recommendation = (
            f"Dự báo có nguy cơ {direction} tại mốc +{first.horizon_minutes} phút "
            f"({first.predicted_temp:.2f}°C). Kiểm tra cửa, nguồn quạt và hệ thống làm lạnh; "
            "điều chỉnh thủ công khi phù hợp. Đây là cảnh báo sớm từ AI; cần theo dõi số đo thực tế."
        )
        return "WARNING", first.violation_type, first.horizon_minutes, recommendation
    near = any(point.predicted_temp < low + 1 or point.predicted_temp > high - 1 for point in points)
    recommendation = (
        "Dự báo ở mốc +5 và +10 phút còn trong ngưỡng nhưng gần giới hạn. Theo dõi nhiệt độ và kiểm tra cửa phòng."
        if near else "Dự báo ở mốc +5 và +10 phút nằm trong ngưỡng cấu hình. Tiếp tục theo dõi số đo thực tế."
    )
    return "WARNING" if near else "NORMAL", "NONE", None, recommendation


@app.get("/", tags=["General"])
async def root():
    return {"service": "Cold Chain AI Forecasting Service", "status": "running", "docs_url": "/docs",
            "predict_endpoint": "/internal/ai/predict", "model_loaded": model_artifacts["models"] is not None,
            "forecast_schema": FORECAST_SCHEMA, "horizons_minutes": HORIZONS}


@app.get("/health", tags=["Monitoring"])
async def health_check(response: Response):
    loaded = model_artifacts["models"] is not None
    if not loaded:
        response.status_code = 503
    return {"status": "HEALTHY" if loaded else "DEGRADED", "timestamp": datetime.now(timezone.utc).isoformat(),
            "model_path": MODEL_PATH, "model_loaded": loaded, "loaded_at": model_artifacts["loaded_at"],
            "metrics": model_artifacts["metrics"], "feature_schema": FEATURE_SCHEMA,
            "forecast_schema": FORECAST_SCHEMA, "horizons_minutes": HORIZONS}


@app.post("/internal/ai/predict", response_model=PredictionResponse, tags=["Prediction"],
          summary="Dự báo nhiệt độ tại mốc 5 và 10 phút")
def predict_temperature(payload: SensorDataRequest):
    # Synchronous CPU inference runs in FastAPI's thread pool.
    models = model_artifacts["models"]
    if models is None:
        raise HTTPException(status_code=503, detail="AI Model chưa sẵn sàng. Vui lòng kiểm tra lại file mô hình.")
    try:
        features = build_features([reading.temperature for reading in payload.temperature_history])
        points = []
        for minutes in HORIZONS:
            predicted = float(models[str(minutes)].predict(features)[0]) + payload.temperature
            if not np.isfinite(predicted):
                raise ValueError("Non-finite model output")
            kind = violation(predicted, payload.temp_min, payload.temp_max)
            # Keep full precision for threshold decisions, exactly like the offline benchmark.
            points.append(ForecastPoint(horizon_minutes=minutes, predicted_temp=predicted,
                                        will_exceed_threshold=kind != "NONE", violation_type=kind))
        risk, kind, first_minutes, recommendation = summarize_forecasts(points, payload.temp_min, payload.temp_max)
        return PredictionResponse(as_of=payload.temperature_history[-1].ts, forecasts=points,
            will_exceed_threshold=first_minutes is not None, first_violation_minutes=first_minutes,
            violation_type=kind, risk_level=risk, recommendation=recommendation,
            metadata={"inferred_at": datetime.now(timezone.utc).isoformat(), "feature_schema": FEATURE_SCHEMA,
                      "prediction_mode": "temperature_change", "history_samples": HISTORY_SAMPLES,
                      "horizons_minutes": HORIZONS, "temp_min_used": payload.temp_min,
                      "temp_max_used": payload.temp_max})
    except Exception:
        logger.exception("AI inference failed")
        raise HTTPException(status_code=500, detail="Lỗi nội bộ khi dự báo.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ai_service:app", host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", 8000)))
