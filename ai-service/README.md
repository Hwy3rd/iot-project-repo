# AI service — Dự báo nhiệt độ phòng lạnh

FastAPI dùng một model HistGradientBoosting chung cho dữ liệu Bangkok T_MS
(nhiệt độ ngăn mát) và T_FC (ngăn đông hoặc vùng lạnh nhất). Backend gửi lịch sử
của một cảm biến nhiệt độ; model không cần độ ẩm, nhiệt độ ngoài kho hay giờ
trong ngày. Luồng telemetry vẫn có thể thu thập độ ẩm phục vụ chức năng khác.

## Đầu vào và đầu ra

`POST /internal/ai/predict` nhận `feature_schema: "temperature-history-v1"`,
`temperature`, `temperature_history`, `temp_min` và `temp_max`.
Ví dụ đầy đủ, có thể gửi trực tiếp:

```json
{
  "feature_schema": "temperature-history-v1",
  "temperature": -18,
  "temperature_history": [
    {
      "ts": "2026-10-04T09:00:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:05:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:10:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:15:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:20:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:25:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:30:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:35:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:40:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:45:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:50:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T09:55:00.000Z",
      "temperature": -18
    },
    {
      "ts": "2026-10-04T10:00:00.000Z",
      "temperature": -18
    }
  ],
  "temp_min": -20,
  "temp_max": -15
}
```

Lịch sử phải có **13 mẫu theo thứ tự cũ đến mới**, tại t−60, t−55, ..., t phút.
Mỗi mẫu nằm tại hoặc trước mốc tương ứng, được phép cũ tối đa 60 giây.
Timestamp có múi giờ và tăng nghiêm ngặt; mẫu cuối khớp nhiệt độ hiện tại.
Dữ liệu thiếu, quá cũ hoặc sai phiên bản trả HTTP 422.

Backend đọc 61 phút `telemetry_raw` hợp lệ của cùng thiết bị và phòng, rồi chọn
mẫu theo thời gian. Không dùng 13 bản ghi cuối gửi cách nhau 5 giây. Mỗi thiết bị
thử dự báo tối đa một lần/phút, ở chế độ nền. Sau khi khởi động hoặc mất dữ liệu
dài, cần chờ đủ một giờ lịch sử. Ngưỡng phòng và nhiệt độ lịch sử phải nằm trong
**−28 đến 19,6°C**; đầu ra không bị ép vào dải này.

Cấu trúc trả về giữ nguyên: `predicted_temp_15m`, `will_exceed_threshold`,
`violation_type`, `risk_level`, `recommendation` và `metadata`.
Khuyến nghị là câu dựng từ template; model chỉ dự đoán nhiệt độ.
`GET /health` trả 200 khi model tương thích đã nạp, nếu không trả 503.
`/docs` mô tả đầy đủ request.

## Model và kết quả đánh giá

- File mới: `temperature_model_history.pkl`; metadata đọc được tại
  `temperature_model_history.json`. File HGB cũ được giữ lại.
- scikit-learn 1.7.2, loss `absolute_error`, 100 vòng học, learning rate 0.1,
  max depth 15, max leaf nodes 31. Thư viện được pin trong `requirements.txt`.
- Model cuối học 357.684 mẫu của cả hai kênh từ toàn bộ 123 tủ.
- Nhãn học: **nhiệt độ sau 15 phút − nhiệt độ hiện tại**. FastAPI cộng nhiệt độ
  hiện tại vào kết quả trước khi so với ngưỡng phòng.
- `temperature_features.py` tính 22 đặc trưng cho cả train và inference:
  nhiệt độ hiện tại, các độ trễ và chênh lệch đến 60 phút, trung bình,
  độ lệch chuẩn tổng thể (ddof=0) và biên độ gần đây.
- Cửa sổ trượt tính cả mẫu hiện tại, loại mẫu ở đầu dưới: 3/6/12 mẫu cho
  15/30/60 phút. Mẫu thứ 13 được dùng riêng cho độ trễ 60 phút.
  Không dùng nhiệt độ tương lai làm đầu vào.

Đánh giá 5 fold, chia theo tủ; hai ngăn của một tủ luôn cùng nhóm:

| Ngăn | MAE (°C) | Sai lệch không quá 1°C |
| --- | ---: | ---: |
| T_MS | 0,299 | 94,64% |
| T_FC | 0,921 | 72,60% |
| T_FC khi nhiệt độ hiện tại −25..−15°C | 0,751 | 77,30% |

Xem [báo cáo thí nghiệm](experiments/results/history-upgrade-2026-10-04/report.md).
Đây là điểm validation ngoài fold dùng để chọn ứng viên, không phải độ chính xác
đo trên kho thật hoặc trên lần fit cuối với toàn bộ dữ liệu.
T_FC gồm nhiều điều kiện vận hành khác nhau; lịch sử nhiệt độ không dự đoán
hoàn hảo những lần mở cửa trong tương lai.

## Tái lập và kiểm tra

Dữ liệu thô nằm ngoài repo: [Bangkok DOI 10.57745/TMWYBQ](https://doi.org/10.57745/TMWYBQ).
Script ghi và kiểm tra SHA-256 của các file nguồn. Chạy từ thư mục gốc repo:

```powershell
py -3.10 -m venv .venv-ai
.venv-ai/Scripts/python -m pip install -r ai-service/requirements-dev.txt
.venv-ai/Scripts/python -B -m unittest discover -s ai-service/tests -v
.venv-ai/Scripts/python -u -B ai-service/train_history_model.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/temperature_model_hgb.pkl --validation-report ai-service/experiments/results/history-upgrade-2026-10-04/metrics.json --output temperature_model_history_candidate.pkl --threads 4
.venv-ai/Scripts/python -B ai-service/experiments/replay_history_integration.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output ai-service/experiments/results/integration-replay.json
```

Script train không ghi đè file đã có và đối chiếu đặc trưng inference với tất cả
357.684 dòng đã đánh giá trước khi dùng metadata validation.
Replay cần `server/node_modules` (ts-node), dùng hàm lấy mẫu TypeScript thật
và FastAPI HTTP trên localhost, rồi dừng service tạm.
[Kết quả replay đã lưu](experiments/results/integration-replay-2026-10-04.json)
kiểm tra tính đúng của tích hợp, không phải đo thêm độ chính xác của model.

## Chạy và khôi phục phiên bản cũ

```powershell
# Build backend và AI cùng nhau vì hợp đồng đầu vào nội bộ đã thay đổi.
docker compose up -d --build app ai-service

# Chạy Python trực tiếp từ ai-service/, sau khi cài requirements:
$env:OMP_NUM_THREADS = '4'
uvicorn ai_service:app --port 8000
```

Docker đóng gói hàm đặc trưng và model mới, giới hạn OpenMP ở bốn luồng.
`MODEL_PATH` chọn được model khác có cùng hợp đồng đầu vào.
Service từ chối artifact cũ dự đoán nhiệt độ tuyệt đối khi metadata không khớp.
Khôi phục phiên bản cũ cần khôi phục backend, FastAPI và model cùng một revision
Git; không chỉ thay riêng file pkl.

Không cần migration DB hoặc cảm biến mới. Luồng nền, timeout/circuit breaker,
cache Redis và hysteresis của cảnh báo tiếp tục hoạt động.

## Demo không cần lịch sử thật

Với bài tập, không cần tự thu thập một giờ dữ liệu. Script `scripts/demo_ai.js`
dùng các đoạn Bangkok đã đóng gói để gọi API ngay, hoặc nạp lịch sử mẫu vào
MongoDB rồi gửi nhiệt độ hiện tại qua MQTT cho biểu đồ và cảnh báo.
Xem [hướng dẫn demo](../docs/AI_DEMO.md) để chạy từng tình huống.
