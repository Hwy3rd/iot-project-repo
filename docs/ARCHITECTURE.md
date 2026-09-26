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

Hai tiến trình Node độc lập, cùng build từ `server/`, chạy từ 2 entrypoint khác nhau:

| Tiến trình | Entrypoint                                     | Vai trò                                                                               |
| ---------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `app`      | `dist/main.js` (`src/main.ts`)                 | Phục vụ REST API + WebSocket gateway trên cùng 1 cổng HTTP                            |
| `worker`   | `dist/workers/main.js` (`src/workers/main.ts`) | Không mở cổng HTTP — chỉ tiêu thụ job BullMQ (`NestFactory.createApplicationContext`) |

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
- **Redis** — 2 vai trò tách biệt, không dùng chung kết nối (xem `server/CLAUDE.md`): client `ioredis` toàn cục (`REDIS_CLIENT`, dùng cho refresh-token session, single-session/user) và kết nối riêng của `BullModule.forRoot()` cho BullMQ.
- **MinIO** — lưu ảnh upload (user, warehouse, product-type...), publish `MINIO_PUBLIC_URL` riêng cho browser vì `MINIO_ENDPOINT` chỉ resolve được trong mạng Docker.

---

## 4. Luồng telemetry → alert → notification

```
ESP32 ──MQTT──▶ mosquitto ──▶ MqttIngestService ──▶ TelemetryService.ingest()
 (publish        (broker,       (subscribe             │
  devices/        docker-       "devices/+/            ├─▶ lưu telemetry_raw (Mongo)
  {uniqueId}/     compose       telemetry",             ├─▶ so ngưỡng temp_min/temp_max của cold room
  telemetry)      service)      tra uniqueId            └─▶ nếu vượt ngưỡng: AlertsService.raise()
                                → device.id)                       │
                                                          ├─▶ ghi bản ghi Alert (MySQL)
                                                          └─▶ enqueue job 'notify' → queue alert-notifications
                                                                    │
                                                          (worker) AlertNotificationProcessor
                                                                    │
                                                          ├─▶ NotificationsService.notifyNewAlert() — ghi Notification (MySQL)
                                                          └─▶ WebPushService — gửi Web Push tới từng PushSubscription (VAPID)
```

`MqttIngestService` (`server/src/modules/mqtt-ingest/`) chạy trong tiến trình `app` (không phải `worker`) vì cần dùng thẳng `TelemetryModule`/`AlertsModule` đã wire sẵn ở đó. Kết nối MQTT dùng client `mqtt` toàn cục (`libs/mqtt/mqtt.module.ts`, `MQTT_URL`), subscribe filter `devices/+/telemetry` (QoS 1). Mỗi message được validate (`class-validator`) khớp đúng `TelemetrySample`, tra `Device` theo `unique_id` (không phải `id` nội bộ) — payload sai định dạng, thiết bị không tồn tại, hoặc bị `TelemetryService.ingest()` từ chối (chưa claim vào cold room, đã decommission...) chỉ log cảnh báo rồi bỏ qua, không làm rớt kết nối chung.

Broker là Eclipse Mosquitto (`mosquitto/mosquitto.conf`), thêm vào cả `docker-compose.yml` và `docker-compose.production.yml`. Cấu hình hiện tại cho phép kết nối anonymous (`allow_anonymous true`), không có TLS — đủ dùng khi broker chỉ nằm trong mạng docker-compose nội bộ; khoá lại bằng `password_file`/TLS là bước cứng hoá cần làm riêng trước khi mở broker ra mạng không tin cậy (xem comment trong `.env.example`).

**Gap đã biết, quan trọng khi phát triển tiếp:**

- **Điều khiển thiết bị (chiều ngược lại) chưa nối MQTT** — `CommandsService.create()` mới chỉ ghi `Command` vào MySQL, chưa publish gì lên broker để ESP32 nhận lệnh bật/tắt actuator; `POST /commands/:id/sent`/`:id/ack` vẫn tạm giới hạn Admin vì chưa có cơ chế service-account cho broker bridge gọi 2 route này thay ESP32 (xem `docs/RBAC.md`).
- **Không cập nhật `devices.last_heartbeat_at`/`status` khi nhận được telemetry** — `MqttIngestService` chỉ gọi `TelemetryService.ingest()` (lưu mẫu đo + đánh giá cảnh báo nhiệt độ) đúng như hợp đồng có sẵn của hàm này; việc coi "vừa nhận được message" là tín hiệu thiết bị đang `active`/còn sống chưa được cài đặt ở đâu — cột `last_heartbeat_at` tồn tại trên entity nhưng chưa có chỗ nào ghi vào nó.
- `RealtimeGateway` (WebSocket) có phòng theo warehouse (`join:warehouse`/`leave:warehouse`, `emitToWarehouse()`). Ai được phân công vào kho thì join được, kể cả Staff không trong ca. Tên sự kiện nằm ở `libs/constants/realtime.constant.ts`:
  - `coldroom:reading`: `TelemetryService.ingest()` phát sau mỗi mẫu telemetry được lưu (mẫu gửi lại trùng thì không phát).
  - `alerts:changed`: `AlertsService` phát khi cảnh báo được tạo mới, tự đóng, tiếp nhận hoặc xử lý thủ công. Client nhận sự kiện này rồi tự tải lại dữ liệu.
  - Việc phát là best effort: lỗi socket chỉ được ghi log, không làm hỏng thao tác chính, và giao diện vẫn polling để dự phòng. Hiện chỉ tiến trình `app` phát sự kiện. Nếu sau này `worker` cần phát (ví dụ job lô hết hạn tạo cảnh báo), phải thêm `@socket.io/redis-emitter`.

---

## 5. Background jobs (BullMQ)

4 queue (`src/libs/constants/queue.constant.ts`), tất cả được consume trong tiến trình `worker`, producer (nơi enqueue) nằm trong `app`:

| Queue                    | Producer                                                 | Processor                                             | Lịch chạy                            | Trạng thái                                                                                      |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `alert-notifications`    | `AlertsService.raise()` (khi ghi alert mới)              | `AlertNotificationProcessor`                          | Theo sự kiện (không lịch cố định)    | Đã hoạt động — ghi Notification + gửi Web Push                                                  |
| `telemetry-rollup`       | Tự lên lịch (`upsertJobScheduler`, cron `5 * * * *` UTC) | `TelemetryRollupProcessor` → `TelemetryRollupService` | Mỗi giờ, phút thứ 5 (chờ sample trễ) | Đã hoạt động — gom `telemetry_raw` → `telemetry_hourly`                                         |
| `batch-maintenance`      | Tự lên lịch (`every: 1h`)                                | `BatchExpiryProcessor`                                | Mỗi giờ                              | **TODO** — job chạy nhưng thân xử lý chỉ log, chưa sweep batch hết hạn (`IN_STOCK` → `EXPIRED`) |
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

- `docker-compose.yml` — dev: publish port datastore ra `localhost`, credential có giá trị mặc định (khớp `server/.env.example`), `.env` ở root là tuỳ chọn — dùng cho `docker compose up -d redis mysql mongo minio mosquitto` khi chạy backend trên host bằng `pnpm start:dev`.
- `docker-compose.production.yml` — production, dùng bởi [init.sh](../init.sh)/[run.sh](../run.sh): `.env` và credential datastore bắt buộc, API/datastore chỉ publish trên `127.0.0.1` (cho client trên máy chủ), chỉ MQTT `1883` publish ra ngoài, có thêm `cloudflared`.

---

## 7. Tổng hợp các gap đã biết

Để không lặp lại công sức tìm hiểu, các phần sau **có hạ tầng nhưng chưa hoàn thiện logic**, ghi nhận trực tiếp bằng comment trong code:

- **MQTT — chỉ mới chiều thiết bị → server** — `MqttIngestService` đã subscribe `devices/+/telemetry` và gọi `TelemetryService.ingest()` (mục 4), nhưng chiều ngược lại (publish `Command` xuống thiết bị, nhận ack) chưa làm; broker cũng chưa khoá bằng auth/TLS.
- **Realtime broadcast** — `RealtimeGateway.emitToWarehouse()` chưa được service nào gọi; alert mới không tự đẩy qua WebSocket.
- **Batch expiry sweep** (`BatchExpiryProcessor`) — job chạy đúng lịch nhưng chưa đánh dấu batch hết hạn.
- **Frontend** (`frontend/`) — thư mục rỗng, chưa scaffold.
