# ai-service — Dự báo nhiệt độ phòng lạnh

Microservice FastAPI dự báo nhiệt độ của phòng lạnh sau 15 phút. Chỉ backend (`app`) gọi service này. Backend gọi ở chế độ nền sau mỗi mẫu telemetry, lưu kết quả vào Redis, và raise/resolve cảnh báo `TEMPERATURE_PREDICTED`. Luồng tích hợp và các quy tắc xem [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) mục 4b.

## API

| Method | Path                    | Mô tả |
| ------ | ----------------------- | ----- |
| `POST` | `/internal/ai/predict`  | Dự báo. Body: `temperature` (bắt buộc), `temp_min`, `temp_max`, `temp_delta`, `temp_moving_avg`, `hour_of_day`, `humidity`, `ambient_temp`. Trả về `predicted_temp_15m`, `will_exceed_threshold`, `violation_type` (`NONE`/`OVERHEAT`/`FREEZING`), `risk_level` (`NORMAL`/`WARNING`/`CRITICAL`), `recommendation` |
| `GET`  | `/health`               | `200 HEALTHY` khi model đã nạp, `503 DEGRADED` khi chưa. `HEALTHCHECK` của Docker dùng endpoint này |
| `GET`  | `/docs`                 | Swagger UI để thử API |

`recommendation` là câu dựng sẵn bằng template trong `generate_recommendation()`, không do model sinh ra.

## Model

| Mục | Giá trị |
| --- | ------- |
| File | `temperature_model_hgb.pkl` (dict `{model, feature_names, metrics}`, lưu bằng joblib) |
| Thuật toán | scikit-learn `HistGradientBoostingRegressor`, loss `squared_error`, `learning_rate=0.1`, `max_iter=100`, `max_leaf_nodes=31`, `max_depth=15` |
| Phiên bản scikit-learn | **1.7.2**. Pickle chỉ chắc chắn load được bằng đúng phiên bản đã ghi nó, nên `requirements.txt` pin cứng |
| Feature (đúng thứ tự) | `hour_of_day`, `temperature`, `humidity`, `temp_delta`, `temp_moving_avg`, `ambient_temp` |
| Nhãn | Nhiệt độ sau 15 phút |
| Dữ liệu train | Dataset chuỗi lạnh Bangkok, dải nhiệt độ khoảng 2–8 °C |
| Metric lúc train (lưu trong file model, xem `/health`) | MAE 0.47 °C, RMSE 0.69 °C, R² 0.955, độ chính xác phân loại vượt ngưỡng 98% |

**Script train và dataset không có trong repo.** Muốn train lại hay tái lập được model thì cần bổ sung chúng.

## Hạn chế đã biết

- **Không ngoại suy được ra ngoài dải đã train.** Dưới khoảng −4 °C, model luôn trả ≈ −4 °C. Vì vậy backend chỉ gọi dự báo cho phòng có ngưỡng nằm trong 0–15 °C (`AI_PREDICTION_SUPPORTED_MIN/MAX_TEMP` trong `server/src/libs/constants/ai-prediction.constant.ts`). Phòng đông lạnh chưa có dự báo.
- **`humidity` và `ambient_temp` không được hệ thống thu thập.** Service tự điền mặc định 65% và 30 °C.
- **`temp_delta` tính theo chu kỳ gửi của thiết bị.** Nếu chu kỳ này khác chu kỳ của dữ liệu train, giá trị delta sẽ lệch thang đo.
- Metric ở trên đo trên dataset train, **chưa đo trên dữ liệu thật của kho**.

## Train lại

Nên train lại trên `telemetry_raw` (MongoDB) của chính hệ thống. Dữ liệu này đủ để dựng feature (`temp_delta` và trung bình trượt tính từ các mẫu trước của cùng thiết bị, `hour_of_day` theo UTC+7) và nhãn (mẫu của cùng thiết bị ở `ts + 15 phút`). Nên thêm `doorOpen` làm feature, và bỏ `humidity`/`ambient_temp`.

Lưu ý: `telemetry_raw` chỉ giữ 30 ngày, nên cần export định kỳ để tích luỹ dữ liệu. Khi đổi model thì đồng thời:

1. Cập nhật `requirements.txt` theo phiên bản scikit-learn dùng để train.
2. Nếu feature thay đổi, sửa `SensorDataRequest` ở đây và `trendFeatures()` ở `server/src/modules/telemetry/telemetry.service.ts`.
3. Nới `AI_PREDICTION_SUPPORTED_MIN/MAX_TEMP` theo dải dữ liệu mới.
4. `./run.sh rebuild ai-service`.

## Chạy

```bash
# trong compose (dev)
docker compose up -d --build ai-service

# trực tiếp (cần Python 3.10)
pip install -r requirements.txt
uvicorn ai_service:app --port 8000
```
