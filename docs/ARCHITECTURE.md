# Kiến trúc hệ thống

> Tổng quan kiến trúc backend của hệ thống giám sát & quản lý kho lạnh — các tiến trình, luồng dữ liệu, và cách chúng khớp với `server/src/`. Không lặp lại chi tiết API/schema/RBAC đã có ở [API_DESIGN.md](API_DESIGN.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [RBAC.md](RBAC.md) — tài liệu này tập trung vào bức tranh tổng thể: các tiến trình chạy gì, dữ liệu đi qua đâu, và các phần đã/chưa hoàn thiện.

---

## 1. Sơ đồ thành phần

```
                 ┌────────────────────┐        ┌────────────────────┐
  Browser  ───▶  │   app (NestJS)     │        │  worker (NestJS)   │
  (REST +        │   HTTP + WebSocket │        │  BullMQ consumer   │
   WebSocket)    │   node dist/main   │        │  dist/workers/main │
                 └─────────┬──────────┘        └─────────┬──────────┘
                           │                              │
              ┌────────────┼──────────────────────────────┼────────────┐
              │            │                              │            │
          ┌───▼───┐    ┌───▼────┐    ┌────────┐      ┌────▼───┐   ┌────▼────┐
          │ MySQL │    │ Mongo  │    │ MinIO  │      │ Redis  │   │  (VAPID │
          │ (core │    │(teleme-│    │(ảnh:   │      │(BullMQ │   │  push → │
          │entities│   │try raw/│    │users,  │      │queues +│   │ browser)│
          │+RBAC) │    │hourly) │    │devices…)│     │REDIS_  │   └─────────┘
          └───────┘    └────────┘    └────────┘      │CLIENT) │
                                                       └────────┘
```

Hai tiến trình Node độc lập, cùng build từ `server/`, chạy từ 2 entrypoint khác nhau, cộng một service Python riêng cho dự báo nhiệt độ:

| Tiến trình   | Entrypoint                                     | Vai trò                                                                               |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `app`        | `dist/main.js` (`src/main.ts`)                 | Phục vụ REST API + WebSocket gateway trên cùng 1 cổng HTTP                            |
| `worker`     | `dist/workers/main.js` (`src/workers/main.ts`) | Không mở cổng HTTP — chỉ tiêu thụ job BullMQ (`NestFactory.createApplicationContext`) |
| `ai-service` | `uvicorn ai_service:app` (`ai-service/`)       | FastAPI, dự báo nhiệt độ 15 phút tới. Chỉ `app` gọi nó, qua HTTP nội bộ (mục 4b)       |

`app` và `worker` dùng chung `dataSourceOptions` (MySQL) và cùng kết nối Mongo/Redis, nhưng **không chung 1 Nest module** — `WorkerModule` (`src/workers/worker.module.ts`) khai báo lại trực tiếp entity/service cần dùng thay vì import các feature module của `app` (`AlertsModule`, `NotificationsModule`...), để tránh kéo theo controller HTTP không cần thiết vào tiến trình worker.

---

## 2. Vòng đời một request HTTP

`main.ts` gắn 3 thứ toàn cục trước khi `listen()`: `cookie-parser`, `ValidationPipe({ whitelist: true, transform: true })`, và `IoAdapter` (WebSocket dùng chung server HTTP).

Mọi request đi qua pipeline theo đúng thứ tự sau (đăng ký ở `RbacModule` + `AppModule`, xem `server/CLAUDE.md` để biết chi tiết từng phần):

1. **`JwtAuthGuard`** — bắt buộc có `access_token` hợp lệ trong cookie, trừ route đánh dấu `@Public()`.
2. **`RolesGuard`** — role của caller (từ JWT payload) phải nằm trong `@Roles(...)` của route.
3. **`WarehouseScopeGuard`** — nếu route có `@WarehouseScope(...)`, kiểm tra caller có được gán vào warehouse liên quan (qua `WarehouseStaff`), và nếu là Staff + `requireShift: true`, kiểm tra thêm đang có `WorkShift` đã được duyệt và chưa quá giờ kết thúc + 5 phút. Admin luôn bỏ qua bước này.
4. Controller/service xử lý nghiệp vụ.
5. **`TransformInterceptor`** (response thành công) bọc `{ success, statusCode, message, data }`, áp `@Serialize(dto)` nếu có.
6. **`GlobalExceptionFilter`** (mọi lỗi, kể cả lỗi không lường trước) chuẩn hoá về `{ success: false, statusCode, path, timestamp, message, errors? }`.

Chi tiết ký hiệu quyền theo từng endpoint (A/M/T/S, **P**, **C**, **TT**) xem [API_DESIGN.md](API_DESIGN.md) và mô hình phân quyền đầy đủ xem [RBAC.md](RBAC.md).

---

## 3. Dữ liệu — 2 datastore chính, mỗi cái một vai trò

- **MySQL (TypeORM, có migration)** — toàn bộ dữ liệu nghiệp vụ cốt lõi: user, warehouse, cold room, batch, device, alert, command, audit log, notification... (schema đầy đủ xem [DATABASE_DESIGN.md](DATABASE_DESIGN.md)). Không dùng `synchronize` — mọi thay đổi schema đi qua migration trong `src/database/migrations/`.
- **MongoDB (Mongoose)** — chỉ dùng cho dữ liệu telemetry tần suất cao, 2 collection (`src/modules/telemetry/schemas/`):
  - `telemetry_raw` — mỗi sample thô từ thiết bị (nhiệt độ, trạng thái cửa, lỗi cảm biến), khoá theo `(deviceId, ts)` để chống trùng khi MQTT redeliver (QoS 1).
  - `telemetry_hourly` — bucket theo giờ, do job rollup trong `worker` tổng hợp từ raw (mục 5).
- **Redis** — 2 vai trò tách biệt, không dùng chung kết nối (xem `server/CLAUDE.md`): client `ioredis` toàn cục (`REDIS_CLIENT`, dùng cho refresh-token session, single-session/user, giới hạn đăng nhập, và dự báo AI mới nhất của từng phòng — mục 4b) và kết nối riêng của `BullModule.forRoot()` cho BullMQ.
- **MinIO** — lưu ảnh upload (user, warehouse, product-type...), publish `MINIO_PUBLIC_URL` riêng cho browser vì `MINIO_ENDPOINT` chỉ resolve được trong mạng Docker.

---

## 4. Luồng telemetry → alert → notification

```
ESP32 ──MQTT──▶ mosquitto ──▶ MqttIngestService ──▶ TelemetryService.ingest()
 (publish        (broker,       (subscribe             │
  devices/        docker-       "devices/+/            ├─▶ lưu telemetry_raw (Mongo)
  {uniqueId}/     compose       telemetry",             ├─▶ so ngưỡng temp_min/temp_max của cold room
  telemetry)      service)      tra uniqueId            ├─▶ (nền, không chờ) dự báo AI — mục 4b
                                → device.id)            └─▶ nếu vượt ngưỡng: AlertsService.raise()
                                                                   │
                                                          ├─▶ ghi bản ghi Alert (MySQL)
                                                          └─▶ enqueue job 'notify' → queue alert-notifications
                                                                    │
                                                          (worker) AlertNotificationProcessor
                                                                    │
                                                          ├─▶ NotificationsService.notifyNewAlert() — ghi Notification (MySQL)
                                                          └─▶ WebPushService — gửi Web Push tới từng PushSubscription (VAPID)
```

`MqttIngestService` (`server/src/modules/mqtt-ingest/`) chạy trong tiến trình `app` (không phải `worker`) vì cần dùng thẳng `TelemetryModule`/`AlertsModule` đã wire sẵn ở đó. Kết nối MQTT dùng client `mqtt` toàn cục (`libs/mqtt/mqtt.module.ts`, `MQTT_URL`), subscribe filter `devices/+/telemetry` (QoS 1). Mỗi message được validate (`class-validator`) khớp đúng `TelemetrySample`, tra `Device` theo `unique_id` (không phải `id` nội bộ) — payload sai định dạng, thiết bị không tồn tại, hoặc bị `TelemetryService.ingest()` từ chối (chưa claim vào cold room, đã decommission...) chỉ log cảnh báo rồi bỏ qua, không làm rớt kết nối chung.

Broker là Eclipse Mosquitto (`mosquitto/mosquitto.conf`), thêm vào cả `docker-compose.yml` và `docker-compose.production.yml`. Broker không cho kết nối anonymous: `mosquitto/entrypoint.sh` sinh password file + ACL từ env mỗi lần container khởi động, gồm tài khoản backend (`MQTT_USERNAME`: đọc telemetry và ack, ghi lệnh) và một tài khoản dùng chung cho thiết bị (`MQTT_DEVICE_USERNAME`: publish `devices/+/telemetry`, đọc lệnh và gửi ack chỉ trên topic có client ID của chính nó). Chưa có TLS — đủ dùng trong LAN tin cậy, cần listener TLS 8883 trước khi mở broker ra mạng không tin cậy.

**Gap đã biết, quan trọng khi phát triển tiếp:**

- **Điều khiển thiết bị (chiều ngược lại)** — `CommandsService.create()` ghi `Command`, chuyển các lệnh còn mở của cùng channel sang `superseded`, rồi `CommandDispatcherService` publish lên `devices/{uniqueId}/commands` (QoS 1). ESP32 gửi kết quả lên `devices/{uniqueId}/ack`, `CommandAckService` (trong `app`) đóng lệnh thành `done`/`failed`. `CommandRetryProcessor` (trong `worker`, có kết nối MQTT riêng) gửi lại lệnh chưa có ack và cho hết hạn lệnh quá `expires_at`. Chi tiết xem [MESSAGE_QUEUE.md](MESSAGE_QUEUE.md) mục 3.4 và 5. Lệnh từ server ghi đè logic tự động của firmware trong 10 phút (xem `firmware/README.md`).
- **Heartbeat**: sau mỗi mẫu telemetry được nhận, `MqttIngestService` ghi `devices.last_heartbeat_at`; nếu thiết bị đang `offline` thì chuyển về `active` (ghi `device_status_history` trigger `automated`, cùng transaction) và tự đóng cảnh báo `OFFLINE`. `fault`/`maintenance` không bị tự đổi. **Chưa có** chiều ngược lại: job quét thiết bị im lặng quá lâu để đặt `offline` và raise cảnh báo `OFFLINE` (worker chưa có `AlertsService`).
- `RealtimeGateway` (WebSocket) có phòng theo warehouse (`join:warehouse`/`leave:warehouse`, `emitToWarehouse()`). Ai được phân công vào kho thì join được, kể cả Staff không trong ca. Tên sự kiện nằm ở `libs/constants/realtime.constant.ts`:
  - `coldroom:reading`: `TelemetryService.ingest()` phát sau mỗi mẫu telemetry được lưu (mẫu gửi lại trùng thì không phát).
  - `alerts:changed`: `AlertsService` phát khi cảnh báo được tạo mới, tự đóng, tiếp nhận hoặc xử lý thủ công. Client nhận sự kiện này rồi tự tải lại dữ liệu.
  - Việc phát là best effort: lỗi socket chỉ được ghi log, không làm hỏng thao tác chính, và giao diện vẫn polling để dự phòng. Hiện chỉ tiến trình `app` phát sự kiện. Nếu sau này `worker` cần phát (ví dụ job lô hết hạn tạo cảnh báo), phải thêm `@socket.io/redis-emitter`.

---

## 4b. Dự báo nhiệt độ (AI)

`ai-service` (`ai-service/`, Python FastAPI) giữ một model HistGradientBoosting (scikit-learn) đã train sẵn và trả về nhiệt độ dự báo sau 15 phút, kèm mức rủi ro và một câu khuyến nghị dựng từ template. Nó chỉ dự báo, không điều khiển thiết bị và không đọc DB. Thông tin về model xem [ai-service/README.md](../ai-service/README.md).

```
TelemetryService.ingest()  ── trả về ngay, không chờ AI ──▶ realtime push, heartbeat
        │
        └─ nền (schedulePrediction), chỉ khi: mẫu hợp lệ, chưa vượt ngưỡng,
           phòng nằm trong vùng model hỗ trợ, thiết bị không có dự báo đang chạy
              │
              ├─▶ trendFeatures(): ≤5 mẫu gần nhất của thiết bị trong 15 phút (telemetry_raw)
              │      → temperature, temp_delta, temp_moving_avg   (<2 mẫu thì bỏ qua)
              ├─▶ AiPredictionService.predict()  ── HTTP POST ai-service:8000/internal/ai/predict
              ├─▶ saveLatest(): Redis hash ai:prediction:<coldRoomId>, field = deviceId, TTL 15 phút
              └─▶ will_exceed_threshold → AlertsService.raise(TEMPERATURE_PREDICTED)
                  dự báo đã an toàn hẳn (qua hysteresis) → resolveAuto(TEMPERATURE_PREDICTED)

GET /cold-rooms/:id/telemetry  ── đọc Redis (không gọi AI) ──▶ prediction trên biểu đồ phòng
```

Các quy tắc chính (code ở `TelemetryService` và `AiPredictionService`, hằng số ở `libs/constants/ai-prediction.constant.ts`):

- **Không chặn luồng chính.** Ingest không chờ AI, nên realtime push và heartbeat thiết bị không bị trễ. API biểu đồ chỉ đọc kết quả đã lưu trong Redis. AI chậm hay chết thì chỉ mất phần dự báo.
- **Circuit breaker.** Lỗi 3 lần liên tiếp (timeout 1.5 giây, mã lỗi HTTP, mất kết nối) thì ngừng gọi AI 30 giây. Trạng thái này nằm trong bộ nhớ của tiến trình `app`.
- **Mỗi thiết bị tối đa một dự báo đang chạy.** Mẫu đến trong lúc đó bị bỏ qua, mẫu sau sẽ dự báo lại.
- **Không dự báo khi đã vượt ngưỡng thực tế.** Lúc đó `TEMPERATURE_OUT_OF_RANGE` đã mở, dự báo thêm chỉ làm thông báo trùng.
- **Chỉ dự báo phòng có ngưỡng nằm trong 0–15 °C** (`AI_PREDICTION_SUPPORTED_MIN/MAX_TEMP`). Model hiện tại được train trên dữ liệu 2–8 °C và không ngoại suy được: dưới khoảng −4 °C nó luôn trả ≈ −4 °C. Không chặn thì mọi phòng đông lạnh sẽ bị báo quá nhiệt liên tục.
- **Tự đóng có hysteresis**, giống `TEMPERATURE_OUT_OF_RANGE`: chỉ đóng khi nhiệt độ dự báo nằm trong `[temp_min + hysteresis, temp_max − hysteresis]`.
- **Giờ trong ngày theo UTC+7** (`businessHour()`), không theo timezone của container.
- **Phòng nhiều thiết bị:** mỗi thiết bị có một field riêng trong hash. Biểu đồ hiện dự báo có rủi ro cao nhất trong số các dự báo còn mới, nên dự báo an toàn của thiết bị này không che cảnh báo của thiết bị khác. Alert thì vẫn tính theo từng thiết bị.

`AI_SERVICE_URL` (mặc định `http://localhost:8000`) trỏ tới service này: compose đặt `http://ai-service:8000` cho container `app`, còn backend chạy trên host dùng giá trị trong `server/.env`.

---

## 5. Background jobs (BullMQ)

4 queue (`src/libs/constants/queue.constant.ts`), tất cả được consume trong tiến trình `worker`, producer (nơi enqueue) nằm trong `app`:

| Queue                    | Producer                                                 | Processor                                             | Lịch chạy                            | Trạng thái                                                                                      |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `alert-notifications`    | `AlertsService.raise()` (khi ghi alert mới)              | `AlertNotificationProcessor`                          | Theo sự kiện (không lịch cố định)    | Đã hoạt động — ghi Notification + gửi Web Push                                                  |
| `telemetry-rollup`       | Tự lên lịch (`upsertJobScheduler`, cron `5 * * * *` UTC) | `TelemetryRollupProcessor` → `TelemetryRollupService` | Mỗi giờ, phút thứ 5 (chờ sample trễ) | Đã hoạt động — gom `telemetry_raw` → `telemetry_hourly`                                         |
| `batch-maintenance`      | Tự lên lịch (`every: 1h`)                                | `BatchExpiryProcessor`                                | Mỗi giờ                              | Đã hoạt động — `IN_STOCK` có `expiryDate` < hôm nay (UTC+7) → `EXPIRED`. Chưa raise cảnh báo `BATCH_EXPIRING_SOON` |
| `work-shift-maintenance` | Tự lên lịch (`every: 5m`)                                | `WorkShiftSweepProcessor`                             | Mỗi 5 phút                           | Yêu cầu `pending` hết ca → `expired`; ca `approved` quá hết ca + 5 phút chưa check-out → điền `check_out_at` |

`upsertJobScheduler` với id cố định nghĩa là job lặp được **upsert, không nhân bản**, mỗi lần `worker` restart — an toàn khi deploy lại.

---

## 6. Triển khai (Docker)

Dockerfile multi-stage (`server/Dockerfile`):

- **`builder`** — cài đủ `dependencies` + `devDependencies`, copy toàn bộ `src/`, build ra `dist/`.
- **`runner`** (image chạy `app`/`worker` thật) — chỉ `pnpm install --prod`, chỉ copy `dist/`. Cố tình **không có** `ts-node`/`typescript`/`src/` để image production gọn.

**Migration chạy ngay trong container `app`, không cần container riêng.** `command` của `app` là `node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js && node dist/main.js` — dùng CLI `typeorm` thuần (khác `typeorm-ts-node-commonjs`) trỏ vào file **đã compile** (`dist/database/data-source.js`, `dist/database/migrations/*.js`), nên chỉ cần package `typeorm` (vốn đã là `dependencies` runtime) chứ không cần `ts-node`/`src/` — chạy được ngay trên image `runner` gọn, không cần stage `builder` riêng cho việc này.

`app` có thêm `healthcheck` kiểm tra TCP port 3000 (không dùng `wget`/`curl` vì mọi route hiện tại trả `404` ở `/`, khiến healthcheck theo status code luôn fail dù app chạy bình thường) — vì lệnh `node dist/main.js` chỉ chạy **sau khi** migration xong (nối bằng `&&`), nên "connect được cổng 3000" tương đương "migration đã chạy xong". `worker` khai báo `depends_on: app: condition: service_healthy` để đảm bảo không đọc schema trước khi migration hoàn tất.

**Đánh đổi cần biết:** cách này chỉ an toàn khi chạy đúng 1 container `app` (không có `deploy.replicas`/orchestrator scale) — vì mỗi lần `app` khởi động lại đều tự chạy `migration:run`. Nếu sau này scale `app` lên nhiều replica, cần tách migration ra container one-off riêng (build từ stage `builder`, chạy 1 lần, `app` phụ thuộc vào container đó bằng `condition: service_completed_successfully`) để tránh nhiều replica cùng chạy DDL đồng thời lên 1 DB.

2 file compose **độc lập** (mỗi file tự đầy đủ, chạy riêng bằng `-f`), cùng tập service và cùng build/healthcheck/`depends_on`/volume — phần chung này phải sửa **cả 2 file** khi thay đổi:

- `docker-compose.yml` — dev: publish port datastore ra `localhost`, credential có giá trị mặc định (khớp `server/.env.example`), `.env` ở root là tuỳ chọn — dùng cho `docker compose up -d redis mysql mongo minio mosquitto` (thêm `ai-service` nếu cần dự báo) khi chạy backend trên host bằng `pnpm start:dev`.
- `docker-compose.production.yml` — production, dùng bởi [init.sh](../init.sh)/[run.sh](../run.sh): `.env` và credential datastore bắt buộc, API/datastore chỉ publish trên `127.0.0.1` (cho client trên máy chủ), chỉ MQTT `1883` publish ra ngoài, có thêm `cloudflared`.

`ai-service` build từ `ai-service/Dockerfile` (Python 3.10, chạy bằng user không phải root). Image có `HEALTHCHECK` gọi `/health`, trả 503 khi model không nạp được. `app` **không** `depends_on` nó, vì dự báo là tính năng phụ. Phiên bản thư viện trong `requirements.txt` được pin cứng, vì file model là pickle của scikit-learn 1.7.2.

---

## 7. Tổng hợp các gap đã biết

Để không lặp lại công sức tìm hiểu, các phần sau **có hạ tầng nhưng chưa hoàn thiện logic**, ghi nhận trực tiếp bằng comment trong code:

- **MQTT chưa có TLS** — broker đã bắt đăng nhập và có ACL, nhưng chưa có listener TLS.
- **Lệnh tự động theo rule** — các rule hiện chỉ sinh alert. Chưa có rule nào tạo `Command` (`issuedBy = null`), dù luồng gửi lệnh đã sẵn sàng.
- **Phát hiện thiết bị offline** — chưa có job đặt `offline` khi mất heartbeat và raise `OFFLINE`.
- **Các loại alert chưa có nơi sinh** — `DOOR_OPEN_TOO_LONG`, `BATCH_EXPIRING_SOON`, `BATCH_TEMPERATURE_OUT_OF_RANGE`. `DEVICE_FAULT` mới chỉ sinh cho lỗi nguồn quạt (`fanPowerFault` từ thiết bị, `details.kind = "fan_power"`, xem `TelemetryService.evaluateFanPowerAlert`); lỗi cảm biến (`sensorFault`) chưa raise alert.
- **Model dự báo chưa train trên dữ liệu của hệ thống** (mục 4b) — model được train trên dataset chuỗi lạnh 2–8 °C, nên phòng đông lạnh chưa có dự báo, và độ chính xác trên kho thật chưa được đo. Hướng làm: dựng dataset từ `telemetry_raw` (đủ feature và nhãn +15 phút, nên thêm `doorOpen`), nhưng raw chỉ giữ 30 ngày, nên cần export định kỳ để tích luỹ dữ liệu.
- **Resolve thủ công** — chưa chặn resolve khi điều kiện lỗi còn (TODO ở `AlertsService.resolveManual`).
