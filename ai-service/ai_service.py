#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
==============================================================================
AI PREDICTION MICROSERVICE (FASTAPI)
Dự án: Hệ thống giám sát và quản lý kho lạnh thông minh (Cold Chain Monitoring)
Tác giả: Senior Machine Learning & IoT Engineer
==============================================================================

Chức năng:
- Tải mô hình máy học đã huấn luyện `temperature_model_history.pkl` lên bộ nhớ RAM khi khởi động (Lifespan).
- Cung cấp API nội bộ:
    POST /internal/ai/predict : Dự báo nhiệt độ sau 15 phút từ dữ liệu cảm biến
    GET  /health              : Kiểm tra trạng thái hoạt động của service và thông tin mô hình
    GET  /                    : Trang thông tin tổng quan của AI Service
- Xử lý xác thực dữ liệu đầu vào (Pydantic), dự báo độ trễ thấp (< 10ms) và sinh khuyến nghị vận hành.
"""

import os
import sys
import io
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal

# Đảm bảo in tiếng Việt không bị lỗi encoding trên Windows Console
if sys.platform == "win32":
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        else:
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")
    except Exception:
        pass

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException, Response, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from temperature_features import (
    FEATURE_NAMES, FEATURE_SCHEMA, HISTORY_SAMPLES, SAMPLING_SECONDS,
    MAX_SAMPLE_AGE_SECONDS, SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP, build_features,
)

# Cấu hình logging chuyên nghiệp
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("ai_service")

# Resolve independently of the process working directory.
DEFAULT_MODEL = Path(__file__).with_name("temperature_model_history.pkl")
MODEL_PATH = os.getenv("MODEL_PATH", str(DEFAULT_MODEL))
DEFAULT_TEMP_MIN = 2.0     # Ngưỡng sàn an toàn mặc định (°C)
DEFAULT_TEMP_MAX = 8.0     # Ngưỡng trần an toàn mặc định (°C)
CRITICAL_THRESHOLD = DEFAULT_TEMP_MAX  # Giữ tương thích ngược
WARNING_THRESHOLD = 7.0                # Giữ tương thích ngược

# Biến toàn cục lưu trữ mô hình và metadata
model_artifacts = {"model": None, "metrics": None, "loaded_at": None}


def validate_artifact(loaded):
    expected = {
        "feature_schema": FEATURE_SCHEMA, "feature_names": FEATURE_NAMES,
        "prediction_mode": "temperature_change", "target_name": "temp_change_15m",
        "horizon_minutes": 15, "history_samples": HISTORY_SAMPLES,
        "sampling_seconds": SAMPLING_SECONDS, "max_sample_age_seconds": MAX_SAMPLE_AGE_SECONDS,
        "supported_temperature_range": [SUPPORTED_MIN_TEMP, SUPPORTED_MAX_TEMP],
    }
    if not isinstance(loaded, dict) or any(loaded.get(k) != v for k, v in expected.items()):
        raise ValueError("Incompatible model artifact: temperature-history-v1 required")
    model = loaded.get("model")
    if model is None or list(getattr(model, "feature_names_in_", [])) != FEATURE_NAMES:
        raise ValueError("Model feature order does not match temperature-history-v1")
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    model_artifacts.update(model=None, metrics=None, loaded_at=None)
    try:
        loaded = joblib.load(MODEL_PATH)
        model = validate_artifact(loaded)
        model_artifacts.update(model=model, metrics=loaded.get("metrics"),
                               loaded_at=datetime.now().isoformat())
        logger.info("Loaded temperature-history-v1 model from %s", MODEL_PATH)
    except Exception:
        logger.exception("AI model unavailable or incompatible: %s", MODEL_PATH)
    yield
    model_artifacts["model"] = None


app = FastAPI(
    title="Cold Chain Temperature Forecasting Microservice",
    description="Microservice AI dự báo nhiệt độ chuỗi lạnh 15 phút tới từ dữ liệu cảm biến IoT",
    version="2.0.0",
    lifespan=lifespan,
)

# Không bật CORS: chỉ backend (server-to-server, trong network nội bộ của
# docker compose) gọi service này, không có trình duyệt nào gọi trực tiếp.


# ==============================================================================
# SCHEMAS (PYDANTIC MODELS)
# ==============================================================================

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


class PredictionResponse(BaseModel):
    """
    Kết quả dự báo nhiệt độ và khuyến nghị hành động từ AI Microservice.
    """
    predicted_temp_15m: float = Field(
        ...,
        description="Nhiệt độ dự báo sau 15 phút (°C)",
        examples=[8.35],
    )
    will_exceed_threshold: bool = Field(
        ...,
        description="Cờ báo động: True nếu nhiệt độ dự báo vi phạm ngưỡng an toàn [temp_min, temp_max]",
        examples=[True],
    )
    violation_type: str = Field(
        ...,
        description="Loại vi phạm: 'NONE' (an toàn), 'OVERHEAT' (quá nhiệt), 'FREEZING' (đóng băng/quá lạnh)",
        examples=["OVERHEAT"],
    )
    risk_level: str = Field(
        ...,
        description="Mức độ rủi ro: 'NORMAL', 'WARNING' hoặc 'CRITICAL'",
        examples=["CRITICAL"],
    )
    recommendation: str = Field(
        ...,
        description="Khuyến nghị vận hành cụ thể cho nhân viên kho / hệ thống điều khiển",
        examples=[
            "CẢNH BÁO NGUY HIỂM: Nhiệt độ dự báo đạt 8.35°C (vượt ngưỡng trần 8.0°C)..."
        ],
    )
    metadata: dict = Field(
        default_factory=dict,
        description="Thông tin bổ sung về thời điểm dự báo và đặc trưng sử dụng",
    )


# ==============================================================================
# HÀM BỔ TRỢ LOGIC (BUSINESS / RECOMMENDATION LOGIC)
# ==============================================================================

def generate_recommendation(
    predicted_temp: float,
    temp_delta: float,
    current_temp: float,
    temp_min: float = DEFAULT_TEMP_MIN,
    temp_max: float = DEFAULT_TEMP_MAX,
) -> tuple[str, str, str]:
    """
    Sinh phân loại rủi ro (risk_level), loại vi phạm (violation_type)
    và khuyến nghị hành động (recommendation) cho cả 2 chiều:
    - Vượt ngưỡng trên (Quá nhiệt: predicted_temp > temp_max)
    - Vượt ngưỡng dưới (Đóng băng/Quá lạnh: predicted_temp < temp_min)
    - Tiệm cận ngưỡng (Cảnh giác)
    - Nằm trong ngưỡng an toàn (Ổn định)
    """
    # 1. Vi phạm ngưỡng trên: Quá nhiệt (Overheat)
    if predicted_temp > temp_max:
        violation_type = "OVERHEAT"
        risk_level = "CRITICAL"
        if temp_delta > 0.1:
            recommendation = (
                f"CẢNH BÁO QUÁ NHIỆT NGUY CẤP: Nhiệt độ dự báo đạt {predicted_temp:.2f}°C "
                f"(vượt ngưỡng trần {temp_max:.1f}°C) và đang tăng nhanh (+{temp_delta:.2f}°C/5 phút). "
                f"Hành động khẩn cấp: Kiểm tra ngay cửa phòng lạnh, kích hoạt quạt làm lạnh tăng cường (Super Cool) "
                f"hoặc chuyển hàng sang kho dự phòng nếu không thể hạ nhiệt!"
            )
        else:
            recommendation = (
                f"CẢNH BÁO QUÁ NHIỆT: Nhiệt độ dự báo sau 15 phút là {predicted_temp:.2f}°C "
                f"(vượt ngưỡng trần an toàn {temp_max:.1f}°C). "
                f"Yêu cầu nhân viên kiểm tra quạt đối lưu và theo dõi liên tục cho đến khi nhiệt độ giảm về dưới {temp_max:.1f}°C."
            )

    # 2. Vi phạm ngưỡng dưới: Đóng băng / Quá lạnh (Freezing)
    elif predicted_temp < temp_min:
        violation_type = "FREEZING"
        risk_level = "CRITICAL"
        if temp_delta < -0.1:
            recommendation = (
                f"CẢNH BÁO QUÁ LẠNH NGUY CẤP: Nhiệt độ dự báo tụt xuống {predicted_temp:.2f}°C "
                f"(dưới ngưỡng sàn an toàn {temp_min:.1f}°C) và đang giảm nhanh ({temp_delta:.2f}°C/5 phút). "
                f"Nhiệt độ thấp hơn mức vận hành cho phép của phòng. "
                f"Hành động khẩn cấp: Ngắt ngay lốc làm lạnh phụ trợ, kiểm tra van tiết lưu và điều chỉnh nhiệt độ máy nén!"
            )
        else:
            recommendation = (
                f"CẢNH BÁO QUÁ LẠNH: Nhiệt độ dự báo sau 15 phút là {predicted_temp:.2f}°C "
                f"(dưới ngưỡng sàn an toàn {temp_min:.1f}°C). Cần đưa nhiệt độ trở lại dải vận hành. "
                f"Yêu cầu nhân viên kiểm tra cài đặt rơ-le nhiệt độ (Thermostat)."
            )

    # 3. Tiệm cận ngưỡng trên (Warning High: trong khoảng cách 1°C tới temp_max)
    elif predicted_temp > (temp_max - 1.0):
        violation_type = "NONE"
        risk_level = "WARNING"
        recommendation = (
            f"CẢNH GIÁC: Nhiệt độ dự báo {predicted_temp:.2f}°C đang tiệm cận ngưỡng trần ({temp_max:.1f}°C). "
            f"Hạn chế mở cửa phòng lạnh và chuẩn bị kích hoạt quạt phụ trợ nếu xu hướng tiếp tục tăng."
        )

    # 4. Tiệm cận ngưỡng dưới (Warning Low: trong khoảng cách 1°C tới temp_min)
    elif predicted_temp < (temp_min + 1.0):
        violation_type = "NONE"
        risk_level = "WARNING"
        recommendation = (
            f"CẢNH GIÁC: Nhiệt độ dự báo {predicted_temp:.2f}°C đang tiệm cận ngưỡng sàn ({temp_min:.1f}°C). "
            f"Theo dõi sát máy nén để tránh nhiệt độ tụt dưới ngưỡng vận hành."
        )

    # 5. Hoạt động an toàn tối ưu
    else:
        violation_type = "NONE"
        risk_level = "NORMAL"
        recommendation = (
            f"Hệ thống chuỗi lạnh hoạt động ổn định. "
            f"Nhiệt độ dự báo 15 phút tới là {predicted_temp:.2f}°C, nằm trong ngưỡng an toàn [{temp_min:.1f}°C, {temp_max:.1f}°C]."
        )

    return risk_level, violation_type, recommendation


# ==============================================================================
# ENDPOINTS
# ==============================================================================

@app.get("/", tags=["General"])
async def root():
    """Trang chủ hiển thị thông tin microservice."""
    return {
        "service": "Cold Chain AI Forecasting Service",
        "status": "running",
        "docs_url": "/docs",
        "predict_endpoint": "/internal/ai/predict",
        "model_loaded": model_artifacts["model"] is not None,
    }


@app.get("/health", tags=["Monitoring"])
async def health_check(response: Response):
    """
    Kiểm tra sức khỏe hệ thống và trạng thái mô hình.
    Trả 503 khi mô hình chưa nạp được (ví dụ pickle không khớp phiên bản
    scikit-learn) để HEALTHCHECK của Docker đánh dấu container unhealthy,
    thay vì service vẫn "chạy" nhưng mọi lần dự báo đều lỗi.
    """
    model_loaded = model_artifacts["model"] is not None
    if not model_loaded:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "HEALTHY" if model_loaded else "DEGRADED",
        "timestamp": datetime.now().isoformat(),
        "model_path": MODEL_PATH,
        "model_loaded": model_loaded,
        "loaded_at": model_artifacts["loaded_at"],
        "metrics": model_artifacts["metrics"],
        "feature_schema": FEATURE_SCHEMA,
    }


@app.post(
    "/internal/ai/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_200_OK,
    tags=["Prediction"],
    summary="Dự báo nhiệt độ sau 15 phút từ thông số cảm biến",
)
def predict_temperature(payload: SensorDataRequest):
    """
    Nhận dữ liệu cảm biến hiện tại từ Backend / IoT Broker, dự báo nhiệt độ
    chuỗi lạnh sau 15 phút và trả về đánh giá rủi ro kèm khuyến nghị.

    Cố ý là `def` (không phải `async def`): model.predict() là tác vụ CPU
    đồng bộ, FastAPI chạy hàm `def` trong threadpool nên một lần dự báo
    không chặn event loop (và các request khác như /health).
    """
    model = model_artifacts["model"]
    if model is None:
        logger.error("Yêu cầu dự báo thất bại: Mô hình chưa được nạp vào bộ nhớ.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI Model chưa sẵn sàng. Vui lòng kiểm tra lại file mô hình.",
        )

    try:
        X_infer = build_features([reading.temperature for reading in payload.temperature_history])
        # The regressor predicts a change, so restore the absolute temperature.
        raw_pred = float(model.predict(X_infer)[0]) + payload.temperature
        if not np.isfinite(raw_pred):
            raise ValueError("Non-finite model output")
        predicted_temp = float(np.round(raw_pred, 2))
        temp_delta = float(X_infer.iloc[0]["temp_delta"])
        temp_moving_avg = float(X_infer.iloc[0]["temp_moving_avg"])
        temp_min, temp_max = payload.temp_min, payload.temp_max

        # 4. Xác định cảnh báo và mức độ rủi ro (kiểm tra cả 2 đầu: temp_min và temp_max)
        will_exceed = bool(predicted_temp > temp_max or predicted_temp < temp_min)
        risk_level, violation_type, recommendation = generate_recommendation(
            predicted_temp=predicted_temp,
            temp_delta=temp_delta,
            current_temp=payload.temperature,
            temp_min=temp_min,
            temp_max=temp_max,
        )

        logger.info(
            f"Dự báo: T_hiện_tại={payload.temperature}°C -> T_15m={predicted_temp}°C "
            f"| Ngưỡng=[{temp_min}, {temp_max}]°C | Vi phạm={violation_type} | Risk={risk_level}"
        )

        return PredictionResponse(
            predicted_temp_15m=predicted_temp,
            will_exceed_threshold=will_exceed,
            violation_type=violation_type,
            risk_level=risk_level,
            recommendation=recommendation,
            metadata={
                "inferred_at": datetime.now().isoformat(),
                "feature_schema": FEATURE_SCHEMA,
                "prediction_mode": "temperature_change",
                "history_samples": HISTORY_SAMPLES,
                "as_of": payload.temperature_history[-1].ts.isoformat(),
                "horizon_minutes": 15,
                "temp_delta_used": temp_delta,
                "temp_moving_avg_used": temp_moving_avg,
                "temp_min_used": temp_min,
                "temp_max_used": temp_max,
            }
        )

    except Exception as e:
        # Chi tiết lỗi chỉ ghi log phía server, không trả về cho client.
        logger.error(f"Lỗi trong quá trình inference: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Lỗi nội bộ khi dự báo.",
        )


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    logger.info(f"Khởi chạy server FastAPI tại http://{host}:{port}")
    uvicorn.run("ai_service:app", host=host, port=port, reload=False)
