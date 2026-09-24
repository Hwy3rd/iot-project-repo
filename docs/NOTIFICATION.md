# Notification — Thông báo đẩy (Web Push)

> Tài liệu thiết kế cơ chế thông báo: khi nào hệ thống gửi thông báo, gửi cho ai, đi qua những thành phần nào, trạng thái của một thông báo, và những việc frontend cần làm để nhận được. Schema chi tiết xem [DATABASE_DESIGN.md](DATABASE_DESIGN.md) (`notifications`, `push_subscriptions`), danh sách endpoint xem [API_DESIGN.md](API_DESIGN.md) mục 16.

---

## 1. Tổng quan

Hệ thống chỉ có **một kênh** thông báo: **Web Push** (chuẩn W3C Push API, xác thực server bằng VAPID) qua thư viện [`web-push`](https://github.com/web-push-libs/web-push). Chưa có email, SMS hay thông báo realtime qua WebSocket.

Tách biệt 2 khái niệm:

| Khái niệm | Bảng | Ý nghĩa |
|---|---|---|
| **Alert** | `alerts` | *Sự cố* — ví dụ nhiệt độ cold room vượt ngưỡng. Một sự cố là một dòng, dù thiết bị báo lại nhiều lần. |
| **Notification** | `notifications` | *Bản ghi phát tán* tới **một người nhận**. Một alert mới sinh ra N notification, mỗi user một dòng. |
| **Push subscription** | `push_subscriptions` | Một trình duyệt/thiết bị mà user đã cho phép nhận push. Một user có thể có nhiều. |

Hiện tại notification **chỉ được sinh từ alert mới**. Cột `notifications.alert_id` nullable để sau này thêm loại thông báo không gắn alert (vd "tài khoản bị khoá") mà không cần đổi schema, nhưng chưa có loại nào như vậy.

---

## 2. Luồng xử lý

```
(app)  AlertsService.raise()
         │
         ├─ INSERT alert mới thành công ──▶ enqueue job 'notify' { alertId } → queue alert-notifications
         └─ trùng active_key (alert đang mở) ──▶ chỉ refresh trigger_value, KHÔNG enqueue
                                                        │
(worker) AlertNotificationProcessor.process()  ◀────────┘
         │
         ├─ 1. NotificationsService.notifyNewAlert(alert)
         │       cold room → warehouse → mọi user trong warehouse_staff
         │       INSERT 1 notification / user, status = pending
         │
         └─ 2. deliver(notification) — tuần tự từng notification
                 lấy mọi push_subscriptions của user
                 ├─ không có subscription nào ──▶ status = failed
                 └─ gửi tới từng subscription:
                      ├─ thành công ──▶ subscription.last_used_at = now
                      ├─ 404 / 410  ──▶ DELETE subscription (endpoint đã chết)
                      └─ lỗi khác   ──▶ log warn, giữ subscription
                 ≥ 1 subscription thành công ──▶ status = sent, sent_at = now
                 ngược lại                   ──▶ status = failed
```

Mã nguồn chính:

| Thành phần | File | Tiến trình |
|---|---|---|
| Enqueue job | `server/src/modules/alerts/alerts.service.ts` (`raise()`, `enqueueNotification()`) | `app` |
| Xử lý job | `server/src/workers/processors/alert-notification.processor.ts` | `worker` |
| Chọn người nhận, soạn nội dung, API | `server/src/modules/notifications/notifications.service.ts`, `notifications.controller.ts` | `app` + `worker` |
| Gửi push | `server/src/libs/web-push/web-push.service.ts`, `web-push.module.ts` | `worker` |

Việc gửi push nằm trong `worker` chứ không trong request/luồng MQTT, để một push service chậm hay lỗi mạng không làm chậm việc ingest telemetry.

---

## 3. Khi nào gửi, gửi cho ai

**Khi nào:** chỉ khi `AlertsService.raise()` **tạo mới** một alert. Nếu sự cố cùng loại trên cùng thiết bị/lô hàng vẫn đang `open`/`acknowledged` (trùng `active_key`), lần raise sau chỉ cập nhật giá trị mới nhất và **không gửi lại**. Nhờ vậy người dùng nhận một thông báo cho mỗi sự cố, không phải mỗi sample telemetry. Khi alert đó được resolve và sự cố xảy ra lại, alert mới được tạo và thông báo được gửi lại.

Hiện chỉ có `TEMPERATURE_OUT_OF_RANGE` thực sự được raise (từ `TelemetryService.ingest()`). Các `AlertType` khác đã có nhãn tiếng Việt sẵn (mục 4) nhưng chưa có code nào sinh ra chúng.

**Cho ai:** mọi user có dòng trong `warehouse_staff` của warehouse chứa cold room phát sinh alert, **không phân biệt role tại warehouse** (Manager, Technician, Staff đều nhận).

Hệ quả cần biết:
- **Admin không được gán vào warehouse thì không nhận** — dù Admin có quyền xem mọi alert qua API.
- **Staff nhận cả khi không trong ca trực.** Việc chọn người nhận không xét ca trực, khác với quyền thao tác (xem [RBAC.md](RBAC.md)).
- User gán vào warehouse nhưng chưa bật push trên trình duyệt nào vẫn có notification, với `status = failed`. Họ vẫn thấy nó qua `GET /notifications`.

---

## 4. Nội dung thông báo

`title`/`body` được soạn **một lần khi phát** và lưu vào `notifications` dạng snapshot, không suy ra lại từ alert. Bản ghi vì vậy vẫn đúng với nội dung người dùng đã nhận, kể cả khi alert đã đổi trạng thái sau đó.

`title` theo `alert.type`:

| `AlertType` | Tiêu đề |
|---|---|
| `TEMPERATURE_OUT_OF_RANGE` | Nhiệt độ vượt ngưỡng |
| `TEMPERATURE_PREDICTED` | Dự báo nguy cơ vượt ngưỡng nhiệt độ |
| `DEVICE_FAULT` | Thiết bị gặp lỗi |
| `OFFLINE` | Thiết bị mất kết nối |
| `DOOR_OPEN_TOO_LONG` | Cửa kho mở quá lâu |
| `BATCH_TEMPERATURE_OUT_OF_RANGE` | Lô hàng ngoài khoảng nhiệt độ cho phép |
| `BATCH_EXPIRING_SOON` | Lô hàng sắp hết hạn |

`body`:
- Có `trigger_value`: `Giá trị: <trigger_value>`, thêm ` (cao hơn ngưỡng)` / ` (thấp hơn ngưỡng)` nếu `alert.details.direction` là `high` / `low`.
- Không có `trigger_value`: `Xem chi tiết trong ứng dụng.`

Nội dung chưa có tên cold room/warehouse. Người dùng thuộc nhiều warehouse cần mở app để biết alert ở kho nào.

**Payload Web Push** (JSON, service worker nhận qua `event.data.json()`):

```json
{
  "title": "Nhiệt độ vượt ngưỡng",
  "body": "Giá trị: 9.5 (cao hơn ngưỡng)",
  "notificationId": "0192...",
  "alertId": "0192..."
}
```

---

## 5. Trạng thái một notification

```
pending ──▶ sent     (≥ 1 subscription nhận thành công, sent_at được set)
   │
   └─────▶ failed    (user không có subscription nào, hoặc mọi lần gửi đều lỗi)
```

- `status`/`sent_at` mô tả **cả notification**, không phải từng subscription. Không có bảng ghi kết quả gửi theo từng thiết bị.
- `sent` nghĩa là push service (FCM, Mozilla autopush, APNs...) **đã nhận**, không đảm bảo thông báo đã hiện trên máy người dùng.
- `read_at` độc lập với `status`: do client set qua `POST /notifications/:id/read`. Một notification `failed` vẫn có thể được đánh dấu đã đọc từ danh sách trong app.

---

## 6. Vòng đời push subscription

| Sự kiện | Xử lý |
|---|---|
| User bật thông báo trên trình duyệt | `POST /notifications/subscriptions` với nguyên `PushSubscription.toJSON()`. Upsert theo `endpoint`: cùng trình duyệt subscribe lại thì **cập nhật** dòng cũ, không tạo thêm. |
| Người khác đăng nhập trên cùng trình duyệt rồi subscribe | Dòng có `endpoint` đó được **chuyển sang user mới**. Một trình duyệt chỉ nhận push cho một user tại một thời điểm. |
| User tắt thông báo / đăng xuất | `DELETE /notifications/subscriptions` với `{ endpoint }`. Chỉ xoá được subscription của chính mình; endpoint không tồn tại thì bỏ qua (idempotent). |
| Push service trả 404/410 khi gửi | Worker **xoá hẳn** subscription (không soft-delete). |
| Push service lỗi khác (mạng, 5xx, 413...) | Giữ nguyên, lần alert sau thử lại. |
| User bị xoá cứng | `ON DELETE CASCADE` xoá cả `push_subscriptions` và `notifications`. Soft delete (`UsersService.remove()`) không xoá subscription, nhưng có xoá các dòng `warehouse_staff` của user, nên user đó không còn là người nhận (mục 3). Subscription chỉ còn là dữ liệu thừa. |

`p256dh_key`/`auth_key` không bao giờ trả về qua API (`PushSubscriptionResponseDto` không expose).

---

## 7. Tích hợp frontend

Thư mục `frontend/` chưa có code, nên phần này là **hợp đồng** backend đang giả định:

1. **Đăng ký service worker** và xin quyền `Notification.requestPermission()`, chỉ sau một thao tác của người dùng (bấm nút), không tự hỏi khi vừa tải trang.
2. Lấy khoá: `GET /notifications/vapid-public-key` → `{ publicKey }`. Nếu `publicKey === null`, server chưa cấu hình VAPID: ẩn tính năng.
3. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <publicKey dạng Uint8Array> })`.
4. `POST /notifications/subscriptions` với `subscription.toJSON()` và `userAgent` (tuỳ chọn, chỉ để hiển thị).
5. Trong service worker:
   - `push`: đọc payload (mục 4), gọi `showNotification(title, { body, data: { notificationId, alertId } })`.
   - `notificationclick`: mở trang chi tiết alert và gọi `POST /notifications/:id/read`. Web Push không có "đã đọc" tự động, không gọi thì `read_at` luôn `null`.
6. Khi đăng xuất: gọi `DELETE /notifications/subscriptions` **trước** khi xoá cookie (endpoint cần đăng nhập), rồi `subscription.unsubscribe()`.
7. Danh sách trong app: `GET /notifications?unreadOnly=true` cho badge chưa đọc.

Yêu cầu môi trường: Push API chỉ chạy trên **HTTPS** (hoặc `localhost`). Trên iOS/iPadOS, Web Push chỉ hoạt động khi web app đã được "Thêm vào Màn hình chính" (iOS 16.4+).

---

## 8. Cấu hình

Biến môi trường (`.env` ở root repo, dùng chung cho `app` và `worker`, xem [.env.example](../.env.example)):

| Biến | Dùng ở | Ghi chú |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `app` (trả cho client), `worker` (ký) | |
| `VAPID_PRIVATE_KEY` | `worker` | Bí mật. Không commit, không dùng lại cặp khoá dev. |
| `VAPID_SUBJECT` | `worker` | `mailto:` hoặc URL liên hệ. Mặc định `mailto:admin@example.com`, nên đổi. |

Sinh cặp khoá: `npx web-push generate-vapid-keys`.

Thiếu cặp khoá, server **vẫn khởi động bình thường**, chỉ log cảnh báo `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set`. Mọi lần gửi sau đó sẽ lỗi, nên notification sẽ `failed`.

**Đổi cặp khoá VAPID làm mọi subscription hiện có mất hiệu lực** (subscription gắn với public key lúc đăng ký). Sau khi đổi, client phải subscribe lại.

---

## 9. Hạn chế đã biết

Những điểm dưới đây là hành vi hiện tại của code, cần xử lý nếu độ tin cậy của thông báo trở nên quan trọng:

| Vấn đề | Hệ quả | Hướng xử lý |
|---|---|---|
| Enqueue lỗi (Redis không truy cập được) chỉ log warn, không ném lỗi | Alert vẫn được lưu nhưng **không ai được báo**, và không có cơ chế bù | Outbox pattern, hoặc job quét định kỳ alert mới chưa có notification |
| Job được add không có `attempts`/`backoff` (mặc định BullMQ: 1 lần) | Worker lỗi giữa chừng (DB, crash) thì job fail luôn, không thử lại | Thêm retry, **nhưng** phải làm `notifyNewAlert` idempotent trước (unique `(alert_id, user_id)`), nếu không retry sẽ tạo notification trùng |
| Worker chết giữa lúc gửi | Notification kẹt ở `pending` mãi | Job dọn dẹp chuyển `pending` quá hạn sang `failed` |
| Không retry push riêng từng subscription | Lỗi mạng thoáng qua thì user đó mất thông báo của alert này | Retry có backoff cho lỗi 429/5xx |
| Gửi tuần tự từng user, từng thiết bị | Warehouse nhiều người thì người cuối nhận chậm | Gửi song song có giới hạn concurrency |
| Không đặt `TTL`/`urgency` khi gửi | Dùng mặc định của thư viện, thiết bị offline có thể nhận thông báo cũ hoặc chậm | Đặt `urgency: 'high'` cho alert nhiệt độ, `TTL` hợp lý |
| Không có realtime qua WebSocket | App đang mở không tự cập nhật danh sách alert/notification | `RealtimeGateway.emitToWarehouse()` đã có sẵn, chưa được gọi |
| `GET /notifications` không phân trang | Danh sách lớn dần theo thời gian | Thêm phân trang theo `created_at` |
| Không có endpoint xem danh sách thiết bị đã đăng ký | Cột `user_agent` được lưu nhưng chưa dùng | `GET /notifications/subscriptions` cho màn "quản lý thiết bị" |
| Chọn người nhận bỏ qua Admin không gán warehouse và bỏ qua ca trực | Xem mục 3 | Tuỳ yêu cầu nghiệp vụ |
