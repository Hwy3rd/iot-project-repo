# Message Queue & Messaging

> Hệ thống có hai kênh truyền message bất đồng bộ: **BullMQ trên Redis** cho job nền giữa `app` và `worker`, và **MQTT (Mosquitto)** để nhận telemetry từ thiết bị và gửi lệnh điều khiển xuống thiết bị. Tài liệu này mô tả từng queue, job, lịch chạy, cách hệ thống xử lý lỗi, cách vận hành, và cách thêm queue mới. Chi tiết nghiệp vụ gửi thông báo xem [NOTIFICATION.md](NOTIFICATION.md), còn hạ tầng Redis/Mosquitto xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

---

## 1. Tổng quan

```
                    MQTT (QoS 1)                         BullMQ (Redis)
ESP32 ──devices/{uniqueId}/telemetry──▶ mosquitto ──▶ app ──────────────▶ worker
                                                     │  queue alert-notifications
                                                     │
                                          (producer) │         (consumer)
                                                                  ▲
                                          job scheduler lặp ──────┘
                                          (telemetry-rollup, batch-maintenance,
                                           work-shift-maintenance, command-dispatch)

app ──devices/{uniqueId}/commands──▶ mosquitto ──▶ ESP32     (lệnh điều khiển)
app ◀──devices/{uniqueId}/ack─────── mosquitto ◀── ESP32     (kết quả lệnh)
worker ──(gửi lại lệnh chưa có ack)──▶ mosquitto
```

| Kênh       | Thư viện                                  | Chiều                    | Dùng cho                                                     |
| ---------- | ----------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| BullMQ     | `bullmq` ^6 + `@nestjs/bullmq` ^12 | `app` → Redis → `worker` | Việc chậm hoặc có I/O mạng (Web Push), việc định kỳ (rollup, sweep) |
| MQTT       | `mqtt` ^5, broker `eclipse-mosquitto:2`   | Thiết bị ⇄ `app`, `worker` → thiết bị | Nhận telemetry và ack từ ESP32; gửi lệnh điều khiển |

Hai kênh này độc lập với nhau. MQTT **không** đi qua BullMQ: `app` nhận message MQTT và xử lý ngay trong tiến trình. Chỉ khi quá trình xử lý đó sinh ra alert mới thì `app` mới đẩy một job vào BullMQ.

---

## 2. BullMQ: kết nối & cấu trúc

### Kết nối Redis

Cả `app` (`app.module.ts`) và `worker` (`workers/worker.module.ts`) đều gọi `BullModule.forRoot()` với cùng `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`. Redis bật `requirepass` (cùng giá trị `REDIS_PASSWORD`).

Kết nối BullMQ **tách riêng** khỏi client `ioredis` toàn cục (`REDIS_CLIENT`, dùng lưu refresh token), dù cả hai trỏ tới **cùng một instance Redis**.

### Tên queue

Tên queue được khai báo tập trung ở `server/src/libs/constants/queue.constant.ts` (`QUEUE_NAMES`). Luôn dùng hằng số này, không viết chuỗi trực tiếp.

### Producer và consumer

- **Consumer** là các class `@Processor(...) extends WorkerHost` trong `server/src/workers/processors/`. Chúng chỉ được đăng ký trong `WorkerModule`, nên **chỉ tiến trình `worker` tiêu thụ job**.
- **Producer** là các module của `app` cần enqueue. Module đó tự gọi `BullModule.registerQueue({ name })` rồi `@InjectQueue(name)` (ví dụ `AlertsModule`). `app` **không** đăng ký processor nào.
- **Job định kỳ** do chính processor tự đăng ký lịch trong `onModuleInit()` bằng `queue.upsertJobScheduler(<id cố định>, ...)`. Id cố định giúp mỗi lần `worker` khởi động lại chỉ **ghi đè** lịch cũ chứ không tạo thêm bản mới.

---

## 3. Danh sách queue

| Queue                    | Job name | Producer                                          | Processor                    | Lịch                                  | Trạng thái |
| ------------------------ | -------- | ------------------------------------------------- | ---------------------------- | ------------------------------------- | ---------- |
| `alert-notifications`    | `notify` | `AlertsService.raise()` (`app`)                   | `AlertNotificationProcessor` | Theo sự kiện                          | Hoạt động  |
| `telemetry-rollup`       | `rollup` | Scheduler `telemetry-hourly-rollup`               | `TelemetryRollupProcessor`   | Cron `5 * * * *`, múi giờ UTC         | Hoạt động  |
| `batch-maintenance`      | `sweep`  | Scheduler `batch-expiry-sweep`                    | `BatchExpiryProcessor`       | `every: 1h`                           | **TODO**, chỉ log |
| `work-shift-maintenance` | `sweep`  | Scheduler `work-shift-sweep`                      | `WorkShiftSweepProcessor`    | `every: 5m`                           | Đã có             |
| `command-dispatch`       | `sweep`  | Scheduler `command-retry-sweep`                   | `CommandRetryProcessor`      | `every: 5s`, tự xoá job đã xong       | Hoạt động         |

### 3.1 `alert-notifications`

**Job data:**

```ts
interface AlertNotificationJobData {
  alertId: string; // id của Alert trong MySQL
}
```

**Khi nào được enqueue:** `AlertsService.raise()` chỉ enqueue khi INSERT được một alert **mới**. Nếu alert cho cùng sự cố đang mở (trùng `active_key`), hàm chỉ cập nhật `trigger_value`/`details` của alert cũ và **không** enqueue. Vì vậy mỗi sự cố chỉ được thông báo một lần.

**Enqueue theo kiểu best-effort:** nếu `queue.add()` lỗi (ví dụ Redis tạm không kết nối được), hàm chỉ log warn và alert vẫn được lưu bình thường. Alert trong MySQL là nguồn dữ liệu chính, còn thông báo đẩy chỉ là phần tiện ích đi kèm.

**Processor làm gì:**

1. Tải `Alert` theo `alertId`. Nếu không tìm thấy thì log warn rồi kết thúc, không throw, vì thử lại cũng vô ích.
2. `NotificationsService.notifyNewAlert(alert)` xác định danh sách người nhận và ghi các bản ghi `Notification` vào MySQL.
3. Với từng notification, gửi Web Push tới mọi `PushSubscription` của user đó. Nếu subscription trả về 404/410 thì xoá subscription. Notification được đánh dấu `SENT` nếu ít nhất một subscription nhận được, ngược lại là `FAILED`.

Lỗi push của từng subscription bị bắt ngay bên trong processor nên **không làm job fail**. Job chỉ fail khi có lỗi DB hoặc lỗi không lường trước. Chi tiết người nhận và nội dung thông báo xem [NOTIFICATION.md](NOTIFICATION.md).

### 3.2 `telemetry-rollup`

Job này gom `telemetry_raw` thành `telemetry_hourly` trong MongoDB. Toàn bộ phép tính chạy bằng một aggregation pipeline, kết thúc bằng `$merge` với `whenMatched: 'replace'`.

- **Job định kỳ** (không có data): gọi `rollupRecentHours()`, tính lại **3 giờ đã đóng gần nhất** (`TELEMETRY_ROLLUP_LOOKBACK_HOURS`). Giờ đang chạy dở bị bỏ qua. Job chạy ở phút thứ 5 để kịp nhận các sample đến trễ.
- **Job tính lại một giờ cụ thể:** truyền `{ hour: '<ISO date>' }` để tính lại đúng giờ đó, ví dụ backfill sau khi đã sửa dữ liệu raw. Nếu `hour` không hợp lệ thì job throw lỗi và bị đánh dấu failed.

```ts
interface TelemetryRollupJobData {
  hour?: string; // ví dụ '2026-09-24T08:00:00Z'
}
```

**Idempotent:** mỗi lần chạy, một giờ được tính lại hoàn toàn từ dữ liệu raw rồi *thay thế* bucket cũ, nên chạy trùng hay chạy lại đều không bị cộng dồn. Nhờ cửa sổ 3 giờ chồng lấn, nếu `worker` chết dưới 3 giờ thì lần chạy kế tiếp tự bù phần thiếu. Nếu chết lâu hơn thì phải enqueue job `{ hour }` thủ công cho các giờ bị thiếu (xem mục 6).

Giới hạn: raw có TTL 30 ngày (`TELEMETRY_RAW_TTL_DAYS`). Với giờ mà raw đã hết hạn, lần chạy lại không khớp dòng nào và bucket cũ được giữ nguyên.

### 3.3 `batch-maintenance` và `work-shift-maintenance`

- `BatchExpiryProcessor` (TODO — lịch chạy đã có, `process()` chỉ log debug): chuyển các batch `IN_STOCK` đã quá `expiryDate` sang `EXPIRED`.
- `WorkShiftSweepProcessor`: yêu cầu chấm công `PENDING` mà ca đã kết thúc → `EXPIRED`; ca `APPROVED` quá giờ kết thúc + 5 phút mà chưa check-out → `checkOutAt` = giờ kết thúc + 5 phút. Chỉ là dọn dữ liệu — quyền của Staff đã tính theo đồng hồ, nên job chạy trễ không cho ai làm quá ca. Khi khởi động, nó gỡ scheduler cũ `work-shift-absence-sweep`.

Khi viết logic cho hai job này, cần giữ chúng **idempotent**: dùng `UPDATE ... WHERE status = <cũ> AND <điều kiện thời gian>` để chạy trùng hay chạy chồng lần trước cũng không sai.

### 3.4 `command-dispatch`

`CommandRetryProcessor` đưa mọi lệnh còn mở về trạng thái cuối mà không cần ai can thiệp. Mỗi lần chạy:

1. Lệnh `pending`/`sent` đã quá `expires_at` (tạo lúc + 60 s) → `expired`.
2. Lệnh `pending` (lần publish đầu chưa tới được broker) → publish.
3. Lệnh `sent` chưa có ack sau 10 s → publish lại, tối đa 5 lần tính cả lần đầu. Hết số lần thì để lệnh tự hết hạn.

Lệnh được gửi tuần tự, cũ trước, tối đa 100 lệnh mỗi lần chạy. Hằng số nằm ở `libs/constants/command.constant.ts`.

Gửi lại là an toàn vì firmware nhớ id của 8 lệnh gần nhất: lệnh đã chạy rồi thì thiết bị chỉ gửi lại ack cũ. Phía server, mọi lần chuyển trạng thái đều là `UPDATE ... WHERE status IN ('pending', 'sent')`.

Processor chạy trong `worker`, nên `WorkerModule` import `MqttModule`. Kết nối này chỉ publish, không subscribe; ack do `app` nhận.

Scheduler đặt `removeOnComplete: true, removeOnFail: 100`. Khác với các job chạy theo giờ, job này chạy khoảng 17.000 lần/ngày, nên không thể để job đã xong tích tụ trong Redis.

---

## 4. Xử lý lỗi, retry & độ tin cậy

Hiện **không queue nào đặt job options** (`attempts`, `backoff`, `removeOnComplete`, `removeOnFail`), trừ `command-dispatch` (chỉ đặt `removeOnComplete`/`removeOnFail`, mục 3.4). Cũng không queue nào đặt `concurrency`. Vì vậy các queue đang chạy theo mặc định của BullMQ:

| Hành vi                  | Giá trị hiện tại               | Hệ quả                                                                                                   |
| ------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Số lần thử               | 1 (không retry)                | Job lỗi thì chuyển thẳng sang `failed` và không tự chạy lại                                               |
| Concurrency mỗi processor | 1                             | Job trong cùng một queue xử lý lần lượt. Các queue khác nhau vẫn chạy song song                          |
| Giữ job đã xong/lỗi      | Giữ vĩnh viễn trong Redis      | Redis tăng dần theo thời gian (khoảng 288 job/ngày từ `work-shift-maintenance`, cộng thêm mỗi alert một job) |
| Job bị "stalled"         | Chạy lại tối đa 1 lần          | Xem ghi chú về shutdown bên dưới                                                                          |

**Ai chạy lại được an toàn:**

| Queue                    | Chạy lại có an toàn?                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `telemetry-rollup`       | ✅ Có. `$merge` replace nên kết quả không đổi                                                                                          |
| `alert-notifications`    | ❌ Chưa. `notifyNewAlert()` INSERT notification mà không có ràng buộc unique `(alert_id, user_id)`, nên chạy lại sẽ tạo notification và push trùng |
| `*-maintenance`          | Hiện không làm gì. Khi viết logic cần giữ idempotent (mục 3.3)                                                                        |
| `command-dispatch`       | ✅ Có. Chuyển trạng thái có điều kiện, và firmware bỏ qua lệnh trùng (mục 3.4)                                                         |

**Shutdown:** `workers/main.ts` không gọi `enableShutdownHooks()`, nên khi container nhận SIGTERM (khi deploy hoặc `./run.sh stop`), `worker` không đóng BullMQ worker một cách êm. Job đang chạy dở sẽ bị BullMQ coi là stalled và chạy lại khi `worker` lên lại. Với `alert-notifications`, điều này có thể gây thông báo trùng (xem bảng trên).

**Mất message giữa hai hệ thống:** giữa lúc ghi alert vào MySQL và lúc enqueue vào Redis không có transaction chung (không có outbox). Nếu Redis lỗi đúng lúc đó, alert vẫn tồn tại nhưng không ai được thông báo, và hiện chưa có cơ chế bù.

---

## 5. MQTT: telemetry, lệnh điều khiển và ack

### Topic & payload

| Thuộc tính     | Giá trị                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| Topic publish  | `devices/{uniqueId}/telemetry`, trong đó `uniqueId` là `devices.unique_id` (id phần cứng, không phải UUID nội bộ) |
| Filter server  | `devices/+/telemetry`                                                            |
| QoS            | 1 (at-least-once)                                                                |
| Payload        | JSON                                                                             |

```json
{
  "ts": "2026-09-24T08:15:00Z",
  "temperature": -18.4,
  "doorOpen": false,
  "sensorFault": false
}
```

Tất cả trường đều bắt buộc. Nếu cảm biến lỗi, `temperature` được gửi là `null` chứ không bỏ trường này đi. Schema nằm ở `server/src/modules/mqtt-ingest/dto/telemetry-message.dto.ts`.

### Client phía server

- Toàn tiến trình `app` dùng chung **một** kết nối (`libs/mqtt/mqtt.module.ts`, token `MQTT_CLIENT`) cho cả nhận telemetry, nhận ack và publish lệnh. `worker` có kết nối riêng, chỉ để gửi lại lệnh (mục 3.4). Topic thiết bị được dựng bằng `libs/mqtt/device-topics.ts`.
- `clientId` là `iot-app-<uuid ngẫu nhiên>` và `clean: true`, tức không giữ session qua các lần restart. **Message được publish trong lúc `app` đang offline sẽ không được giao lại.**
- Client tự reconnect mỗi 5 giây, đăng nhập bằng `MQTT_USERNAME`/`MQTT_PASSWORD` (broker không cho anonymous). Theo ACL, tài khoản này đọc `devices/+/telemetry`, `devices/+/ack` và `$SYS/#`, ghi `devices/+/commands` (`mosquitto/entrypoint.sh`).

### Xử lý message (`MqttIngestService`, chạy trong `app`)

Mỗi message được xử lý độc lập: lỗi ở message này không chặn message tiếp theo và không làm rớt subscription. Các trường hợp sau đều **chỉ log warn rồi bỏ qua**, không có dead-letter:

- topic không đúng dạng 3 phần `devices/<id>/telemetry`;
- payload không phải JSON, hoặc không qua được validate DTO;
- không có thiết bị nào có `unique_id` như vậy;
- `TelemetryService.ingest()` từ chối, ví dụ thiết bị chưa được gán vào cold room hoặc đã ngừng hoạt động.

Message hợp lệ được lưu vào `telemetry_raw`, rồi so sánh với ngưỡng của cold room. Nếu vượt ngưỡng thì gọi `AlertsService.raise()` và có thể sinh ra job `alert-notifications` (mục 3.1).

**Chống trùng:** QoS 1 có thể giao lại cùng một message. `telemetry_raw` có khoá `(deviceId, ts)` nên sample trùng không được lưu hai lần. Alert thì đã được chống trùng bằng `active_key`.

### Lệnh điều khiển (server → thiết bị)

| Bước | Ai | Topic | Trạng thái lệnh |
| ---- | -- | ----- | --------------- |
| 1. `POST /commands` | `CommandsService` (`app`) | — | lệnh cũ còn mở của cùng channel → `superseded`; lệnh mới `pending` |
| 2. Publish | `CommandDispatcherService` (`app`, lần sau do `worker`) | `devices/{uniqueId}/commands`, QoS 1 | nhận PUBACK → `sent`, `attempts + 1` |
| 3. Thực thi | firmware | — | — |
| 4. Ack | firmware → `CommandAckService` (`app`) | `devices/{uniqueId}/ack` | `done` hoặc `failed` + `error_reason` |
| — | `CommandRetryProcessor` (`worker`) | — | chưa có ack thì gửi lại; quá `expires_at` → `expired` |

Message lệnh có dạng `{ id, channel, label, action, expiresAt }`, trong đó `channel` là `channel_type`. Ack có dạng `{ id, status: "done" | "failed", error? }`. Chi tiết phía thiết bị xem `firmware/README.md`.

- Broker chưa kết nối hoặc không trả PUBACK trong 3 s: lệnh vẫn `pending`, worker sẽ gửi. `POST /commands` không báo lỗi trong trường hợp này.
- Ack chỉ được chấp nhận khi lệnh thuộc thiết bị có `unique_id` trong topic, và lệnh còn đang mở. Ack đến muộn (lệnh đã `expired`/`superseded`) hoặc ack trùng bị bỏ qua.
- Thiết bị dùng clean session nên không nhận lệnh gửi trong lúc nó offline. Worker gửi lại cho tới khi hết hạn, nên thiết bị kết nối lại trong vòng 60 s vẫn nhận được lệnh.

### Chưa có

- TLS cho broker; thiết bị vẫn dùng chung một tài khoản `MQTT_DEVICE_USERNAME` thay vì mỗi thiết bị một credential (xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md) mục 10).

---

## 6. Vận hành

Hiện chưa có dashboard cho queue (Bull Board...). Có thể kiểm tra trực tiếp bằng `redis-cli`. BullMQ lưu key theo dạng `bull:<queue>:<...>`.

```bash
# Đếm job theo trạng thái
docker exec redis_db redis-cli LLEN bull:alert-notifications:wait
docker exec redis_db redis-cli ZCARD bull:alert-notifications:failed
docker exec redis_db redis-cli ZCARD bull:alert-notifications:completed

# Xem lý do một job fail
docker exec redis_db redis-cli ZRANGE bull:alert-notifications:failed 0 -1
docker exec redis_db redis-cli HGET bull:alert-notifications:<jobId> failedReason

# Log của processor
./run.sh logs worker
```

Xem các job scheduler đã đăng ký và thời điểm chạy kế tiếp (dùng API của BullMQ vì cấu trúc key có thể đổi giữa các phiên bản):

```bash
docker exec -it service_worker node -e "
const { Queue } = require('bullmq');
const q = new Queue('telemetry-rollup', { connection: { host: process.env.REDIS_HOST, port: +process.env.REDIS_PORT, password: process.env.REDIS_PASSWORD } });
q.getJobSchedulers().then(s => { console.log(s); return q.close(); });
"
```

### Tính lại telemetry cho một giờ

Không có endpoint cho việc này. Enqueue thủ công từ bên trong container `worker` (image có sẵn `bullmq`):

```bash
docker exec -it service_worker node -e "
const { Queue } = require('bullmq');
const q = new Queue('telemetry-rollup', { connection: { host: process.env.REDIS_HOST, port: +process.env.REDIS_PORT, password: process.env.REDIS_PASSWORD } });
q.add('rollup', { hour: '2026-09-24T08:00:00Z' }).then(j => { console.log('enqueued', j.id); return q.close(); });
"
```

### Theo dõi MQTT

```bash
# Xem telemetry đang đến broker (tài khoản backend — chỉ nó được đọc)
docker exec mosquitto_broker sh -c 'mosquitto_sub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -t "devices/+/telemetry" -v'

# Xem lệnh server gửi xuống và ack thiết bị gửi lên
docker exec mosquitto_broker sh -c 'mosquitto_sub -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -t "devices/+/ack" -v'

# Giả lập thiết bị nhận lệnh (client ID phải bằng unique_id, theo ACL)
docker exec mosquitto_broker sh -c 'mosquitto_sub -i <uniqueId> -u "$MQTT_DEVICE_USERNAME" -P "$MQTT_DEVICE_PASSWORD" -t "devices/<uniqueId>/commands" -q 1 -v'

# Giả lập thiết bị gửi ack cho một lệnh
docker exec mosquitto_broker sh -c 'mosquitto_pub -i <uniqueId> -u "$MQTT_DEVICE_USERNAME" -P "$MQTT_DEVICE_PASSWORD" -t "devices/<uniqueId>/ack" -q 1 \
  -m "{\"id\":\"<commandId>\",\"status\":\"done\"}"'

# Giả lập một thiết bị gửi telemetry (tài khoản thiết bị)
docker exec mosquitto_broker sh -c 'mosquitto_pub -u "$MQTT_DEVICE_USERNAME" -P "$MQTT_DEVICE_PASSWORD" -t "devices/<uniqueId>/telemetry" -q 1 \
  -m "{\"ts\":\"2026-09-24T08:15:00Z\",\"temperature\":-18.4,\"doorOpen\":false,\"sensorFault\":false}"'
```

---

## 7. Thêm queue mới

1. Thêm tên vào `QUEUE_NAMES` trong `libs/constants/queue.constant.ts`.
2. Tạo processor trong `workers/processors/` (`@Processor(QUEUE_NAMES.X) extends WorkerHost`) và export interface cho job data.
3. Trong `WorkerModule`: thêm tên vào `BullModule.registerQueue(...)`, thêm processor vào `providers`, và thêm các entity/service mà processor cần. **Không** import feature module của `app`, để controller HTTP không bị kéo sang `worker`.
4. Tuỳ loại job:
   - **Job theo sự kiện:** trong module producer của `app`, thêm `BullModule.registerQueue({ name })` và inject bằng `@InjectQueue`.
   - **Job định kỳ:** gọi `upsertJobScheduler('<id cố định>', ...)` trong `onModuleInit()` của processor. Không dùng `queue.add(..., { repeat })` với id sinh ngẫu nhiên, vì mỗi lần restart sẽ sinh thêm một lịch mới.
5. Viết processor **idempotent**. Nếu cần retry thì đặt `attempts`/`backoff` khi `add()`, đồng thời nên đặt `removeOnComplete`/`removeOnFail` để job cũ không tích tụ trong Redis.
6. Viết unit test cho processor, theo mẫu `*.processor.spec.ts` có sẵn.

---

## 8. Hạn chế đã biết

| Hạn chế                                                  | Rủi ro                                                                          | Hướng xử lý                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Không có retry (`attempts`/`backoff`)                    | Lỗi thoáng qua (DB, mạng) làm job fail vĩnh viễn                                | Thêm retry. Riêng `alert-notifications` phải làm idempotent trước                            |
| `alert-notifications` không idempotent                   | Job chạy lại (stalled, retry thủ công) gửi thông báo trùng                     | Thêm unique `(alert_id, user_id)` cho notification và bỏ qua khi đã tồn tại                 |
| Không có `removeOnComplete`/`removeOnFail`               | Redis phình dần theo thời gian                                                  | Đặt giới hạn theo số lượng hoặc theo tuổi job                                                |
| Không có outbox giữa MySQL và Redis                      | Alert được lưu nhưng thông báo bị mất khi enqueue lỗi                           | Outbox pattern, hoặc job quét định kỳ các alert chưa có notification                        |
| `worker` không có graceful shutdown                      | Job đang chạy bị cắt ngang khi deploy                                           | `app.enableShutdownHooks()` trong `workers/main.ts`                                          |
| MQTT `clean: true`, không có dead-letter                 | Mất telemetry được gửi khi `app` offline; message lỗi chỉ nằm trong log          | Session bền (`clean: false` với clientId cố định), hoặc thiết bị tự buffer và gửi lại        |
| Chưa có dashboard hay cảnh báo cho queue                 | Không phát hiện được khi job fail hàng loạt                                     | Bull Board (chỉ cho Admin) hoặc metric số job failed                                         |
| Sweep batch hết hạn chưa có logic                        | Batch hết hạn không được tự cập nhật trạng thái                                 | Hoàn thiện `BatchExpiryProcessor`                                                            |
