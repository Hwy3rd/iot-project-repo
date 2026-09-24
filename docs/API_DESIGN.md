# Thiết kế API

> Tài liệu tham chiếu API REST + WebSocket của hệ thống giám sát & quản lý kho lạnh, dựa trên các controller/DTO thực tế trong `server/src/`.

---

## 1. Quy ước chung

**Giao thức**: REST qua HTTP + WebSocket (Socket.IO) trên cùng một cổng HTTP server (`app.useWebSocketAdapter`). Không có tiền tố phiên bản (vd `/v1`) hay prefix toàn cục — mọi route bắt đầu thẳng từ `/`.

**Xác thực**: JWT truyền qua **httpOnly cookie**, không dùng header `Authorization`.
- `access_token` (cookie `access_token`, mặc định 15 phút): payload `{ sub, username, email, role, status }`, xác thực không truy vấn DB.
- `refresh_token` (cookie `refresh_token`, chỉ gửi trên path `/auth`, mặc định 7 ngày): xoay vòng mỗi lần refresh, mô hình 1 phiên/user (đăng nhập nơi khác sẽ vô hiệu hoá phiên cũ).
- WebSocket dùng cùng cookie `access_token` khi bắt tay kết nối (client phải bật `withCredentials: true`).

**Phân quyền**: theo role (`admin`/`manager`/`staff`/`technician`) + phạm vi warehouse + điều kiện ca trực (Staff). Chi tiết mô hình xem `docs/RBAC.md`. Trong các bảng endpoint bên dưới:

| Ký hiệu | Ý nghĩa |
|---|---|
| A / M / T / S | Admin / Manager / Technician / Staff — role được phép gọi endpoint |
| **P** | Yêu cầu phạm vi: caller (nếu không phải Admin) phải được gán vào warehouse liên quan tới tài nguyên |
| **C** | Chỉ áp dụng cho Staff: ngoài **P**, còn yêu cầu đang có ca trực đã check-in tại đúng warehouse đó |
| **TT** | "Tự thân" — chỉ chính chủ tài nguyên hoặc Admin mới gọi được |

**Response envelope**: mọi response thành công (kể cả lỗi qua `HttpException`, xem bên dưới) đều được `TransformInterceptor` bọc thống nhất:

```json
{ "success": true, "statusCode": 200, "message": "Success", "data": { } }
```

`data` là `null` cho các endpoint không trả nội dung (vd `DELETE`). Trường trả về trong `data` chỉ gồm các cột được `@Expose()` trong response DTO tương ứng — nhìn chung là bản sao 1:1 các cột entity (xem `docs/DATABASE_DESIGN.md`) **trừ 2 trường không bao giờ lộ ra ngoài dù ở form nào**: `users.password_hash` và `devices.claim_code_hash` (mã kích hoạt dạng plaintext chỉ trả về đúng 1 lần, ngay lúc gọi `POST /devices/:id/claim-code`, qua `ClaimCodeResponseDto` riêng).

**Định dạng lỗi**: mọi lỗi (kể cả lỗi không lường trước, không phải `HttpException`) đi qua `GlobalExceptionFilter` (đăng ký toàn cục qua `APP_FILTER`), trả về dạng thống nhất:

```json
{
  "success": false,
  "statusCode": 400,
  "path": "/users",
  "timestamp": "2026-09-22T12:00:00.000Z",
  "message": "Bad Request",
  "errors": ["username must be longer than or equal to 3 characters"]
}
```

`errors` (mảng chuỗi) chỉ xuất hiện khi lỗi đến từ `ValidationPipe` (nhiều lỗi validate cùng lúc) — khi đó `message` là tên nhóm lỗi chung (thường `"Bad Request"`). Với `HttpException` ném thủ công (`NotFoundException`, `ForbiddenException`, `ConflictException`...), `message` là chuỗi lỗi cụ thể và không có `errors`. Lỗi không phải `HttpException` (exception không lường trước) trả về `500` với `message: "Internal server error"`.

Riêng WebSocket: exception trong handler của `RealtimeGateway` (vd `WsException`) không đi qua định dạng JSON ở trên — được `GlobalExceptionFilter` chuyển tiếp cho `BaseWsExceptionFilter` mặc định của NestJS, phát sự kiện `exception` về lại client.

**Validation**: `ValidationPipe({ whitelist: true, transform: true })` áp dụng toàn cục — field không khai báo trong DTO bị loại bỏ âm thầm, kiểu dữ liệu được ép chuyển (query string → number/boolean...) trước khi vào controller.

**Mã trạng thái HTTP**: theo mặc định của NestJS cho từng decorator method — `@Post()` trả `201` (kể cả các endpoint hành động không tạo tài nguyên mới như `acknowledge`, `claim`, `check-in`...), `@Get()`/`@Patch()`/`@Delete()` trả `200`. Ngoại lệ: `POST /auth/login`, `/auth/refresh`, `/auth/logout` ép về `200` (`@HttpCode`). `DELETE` không dùng `204` — luôn trả `200` với `data: null`, vì interceptor luôn ghi JSON body.

**Upload ảnh**: các endpoint `POST .../:id/images` nhận `multipart/form-data`, field `files` (tối đa 5 file/lần), giới hạn 5MB/file, chỉ nhận mimetype `image/*`; lưu qua MinIO, trả về entity đã cập nhật `imageUrls`. Gỡ ảnh qua `DELETE .../:id/images` với body `{ "url": "<image-url>" }`.

---

## 2. Auth — `/auth`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /auth/login` | công khai | `{ username, password }` | `UserResponseDto`, set cookie `access_token`+`refresh_token` |
| `POST /auth/refresh` | yêu cầu cookie `refresh_token` hợp lệ | — | `null`, xoay cả 2 cookie |
| `POST /auth/logout` | yêu cầu cookie `refresh_token` hợp lệ | — | `null`, xoá cả 2 cookie, thu hồi phiên trong Redis |
| `GET /auth/me` | mọi role đã đăng nhập | — | `UserResponseDto` của chính caller |

---

## 3. Users — `/users`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /users` | A | `{ username, email?, phone?, password, fullName?, role, imageUrls? }` | `UserResponseDto` |
| `GET /users` | A | — | `UserResponseDto[]` (toàn bộ hệ thống) |
| `GET /users/:id` | TT | — | `UserResponseDto` |
| `PATCH /users/:id` | TT | như create, trừ `password` | `UserResponseDto` — chỉ Admin được đổi `role` (người khác gửi `role` khác role hiện tại → `403`) |
| `DELETE /users/:id` | A | — | `null` (soft delete) |
| `POST /users/:id/lock` | A | — | `UserResponseDto` — `status → locked`, xoá phiên refresh (access token đang có hết hạn tự nhiên ≤ `JWT_EXPIRES_IN`); không tự khoá chính mình (`400`) |
| `POST /users/:id/unlock` | A | — | `UserResponseDto` — `status → active` |
| `POST /users/:id/images` | TT | `multipart/form-data` | `UserResponseDto` |
| `DELETE /users/:id/images` | TT | `{ url }` | `UserResponseDto` |

---

## 4. Warehouses — `/warehouses`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /warehouses` | A | `{ name, code, address?, imageUrls? }` | `WarehouseResponseDto` |
| `GET /warehouses` | mọi role | — | `WarehouseResponseDto[]` (chưa lọc theo phạm vi — xem ghi chú bên dưới) |
| `GET /warehouses/:id` | mọi role, **P** | — | `WarehouseResponseDto` |
| `PATCH /warehouses/:id` | A | | `WarehouseResponseDto` |
| `DELETE /warehouses/:id` | A | — | `null` (soft delete) |
| `POST /warehouses/:id/images` | A | `multipart/form-data` | `WarehouseResponseDto` |
| `DELETE /warehouses/:id/images` | A | `{ url }` | `WarehouseResponseDto` |
| `GET /warehouses/:warehouseId/staff` | A, M (**P**) | — | `WarehouseStaffResponseDto[]` (`userId`, `warehouseId`, `role` tại kho, `user { id, username, fullName }`) |
| `PUT /warehouses/:warehouseId/staff/:userId` | A | `{ role: manager \| technician \| staff }` | `WarehouseStaffResponseDto` — upsert: gán mới hoặc đổi role tại kho |
| `DELETE /warehouses/:warehouseId/staff/:userId` | A | — | `null` (`404` nếu user chưa được gán) |

> Các endpoint `GET` liệt kê danh sách (`findAll`) trong toàn bộ tài liệu này trả về **toàn bộ** bản ghi, không tự lọc theo warehouse mà caller được gán — `WarehouseScopeGuard` chỉ áp dụng được cho endpoint thao tác trên 1 tài nguyên cụ thể (`:id`). Lọc theo phạm vi ở endpoint danh sách là việc của tầng service, hiện chưa triển khai.

---

## 5. Cold Rooms — `/cold-rooms`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /cold-rooms` | A, M (**P** theo `warehouseId` trong body) | `{ warehouseId, name, tempMin, tempMax, hysteresis?, doorOpenMaxSeconds?, capacityPallets?, capacityWeightKg?, capacityVolumeM3? }` | `ColdRoomResponseDto` |
| `GET /cold-rooms` | mọi role | — | `ColdRoomResponseDto[]` |
| `GET /cold-rooms/:id` | mọi role, **P** | — | `ColdRoomResponseDto` |
| `PATCH /cold-rooms/:id` | A, M, **P** | các field như create (trừ `warehouseId`) | `ColdRoomResponseDto` |
| `DELETE /cold-rooms/:id` | A | — | `null` (soft delete) |

---

## 6. Product Types — `/product-types`

Master data, chỉ Admin thao tác ghi; các role khác chỉ xem.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /product-types` | A | `{ name, category?, unit, storageTempMin?, storageTempMax?, imageUrls? }` | `ProductTypeResponseDto` |
| `GET /product-types` | mọi role | — | `ProductTypeResponseDto[]` |
| `GET /product-types/:id` | mọi role | — | `ProductTypeResponseDto` |
| `PATCH /product-types/:id` | A | | `ProductTypeResponseDto` |
| `DELETE /product-types/:id` | A | — | `null` (soft delete) |
| `POST /product-types/:id/images` | A | `multipart/form-data` | `ProductTypeResponseDto` |
| `DELETE /product-types/:id/images` | A | `{ url }` | `ProductTypeResponseDto` |

---

## 7. Shifts (mẫu ca) — `/shifts`

Master data (mẫu ca sáng/chiều/tối tĩnh, không gắn ngày/nhân viên) — chỉ Admin thao tác ghi.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /shifts` | A | `{ shiftType, startTime, endTime }` (giờ dạng `HH:mm` hoặc `HH:mm:ss`) | `ShiftResponseDto` |
| `GET /shifts` | mọi role | — | `ShiftResponseDto[]` |
| `GET /shifts/:id` | mọi role | — | `ShiftResponseDto` |
| `PATCH /shifts/:id` | A | | `ShiftResponseDto` |
| `DELETE /shifts/:id` | A | — | `null` (soft delete) |

---

## 8. Work Shifts (lịch ca trực) — `/work-shifts`

Gán 1 mẫu ca cho 1 nhân viên vào 1 ngày, tại 1 warehouse.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /work-shifts` | A, M (**P** theo `warehouseId` trong body) | `{ shiftId, staffId, warehouseId, workDate }` | `WorkShiftResponseDto` |
| `GET /work-shifts` | A, M, S | — | `WorkShiftResponseDto[]` |
| `GET /work-shifts/:id` | A, M, S, **P** | — | `WorkShiftResponseDto` |
| `PATCH /work-shifts/:id` | A, M, **P** | | `WorkShiftResponseDto` |
| `POST /work-shifts/:id/check-in` | S, **P** + chỉ đúng ca của chính mình | — | `WorkShiftResponseDto` |
| `POST /work-shifts/:id/check-out` | S, **P** + chỉ đúng ca của chính mình | — | `WorkShiftResponseDto` |
| `DELETE /work-shifts/:id` | A, M, **P** | — | `null` (hard delete — bảng này không có `deleted_at`) |

---

## 9. Batches (lô hàng) — `/batches`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /batches` | A, M, S (**C** cho Staff, phạm vi theo `coldRoomId` trong body) | `{ coldRoomId, productTypeId, batchCode, quantity, supplier?, receivedAt, expiryDate, notes? }` | `BatchResponseDto` |
| `GET /batches` | A, M, S | — | `BatchResponseDto[]` |
| `GET /batches/:id` | A, M, S, **P** | — | `BatchResponseDto` |
| `PATCH /batches/:id` | A, M, S (**C** cho Staff) | | `BatchResponseDto` |
| `DELETE /batches/:id` | A, M, S (**C** cho Staff) | — | `null` (hard delete — không có `deleted_at`, dùng `status=removed` làm vòng đời riêng) |

Backend validate: khoảng nhiệt độ khuyến nghị của `product_type` (`storageTempMin/Max`) phải nằm trong ngưỡng an toàn của `cold_room` (`tempMin/Max`) khi tạo/gán batch — không thể ép bằng CHECK constraint SQL vì so sánh chéo 2 bảng.

---

## 10. Devices — `/devices`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /devices` | A | `{ uniqueId, firmwareVersion? }` | `DeviceResponseDto` — thiết bị mới ở trạng thái `registered`, `coldRoomId = null` |
| `GET /devices` | A, M, T, S | — | `DeviceResponseDto[]` |
| `GET /devices/:id` | A, M, T, S (**C** cho Staff) | — | `DeviceResponseDto` |
| `PATCH /devices/:id` | A, T, **P** | `{ firmwareVersion? }` | `DeviceResponseDto` |
| `POST /devices/:id/claim-code` | A, T, **P** | — | `ClaimCodeResponseDto { claimCode, claimCodeExpiresAt }` — **mã gốc chỉ trả về đúng lần này**, sau đó chỉ còn hash trong DB |
| `POST /devices/:id/claim` | A, T (phạm vi tính theo `coldRoomId` đích trong body, không phải phòng hiện tại của thiết bị) | `{ claimCode, coldRoomId }` | `DeviceResponseDto` — gán `coldRoomId`, chuyển `status = active` |
| `POST /devices/:id/decommission` | A, T, **P** | — | `DeviceResponseDto` — chuyển `status = decommissioned` (một chiều, không đảo ngược) |
| `DELETE /devices/:id` | A | — | `null` (soft delete — tách biệt với `decommission`, dùng cho xoá bản ghi hẳn) |

---

## 11. Device Channels — `/devices/:deviceId/channels`

Cảm biến/cơ cấu chấp hành gắn trên 1 device.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /devices/:deviceId/channels` | A, T, **P** (theo `deviceId`) | `{ channelType, label? }` | `DeviceChannelResponseDto` — `channelRole` (`sensor`/`actuator`) suy ra tự động từ `channelType`, không nhận từ client |
| `GET /devices/:deviceId/channels` | A, M, T, **P** | — | `DeviceChannelResponseDto[]` |
| `GET /devices/:deviceId/channels/:id` | A, M, T, **P** | — | `DeviceChannelResponseDto` |
| `PATCH /devices/:deviceId/channels/:id` | A, T, **P** | `{ label? }` | `DeviceChannelResponseDto` |
| `DELETE /devices/:deviceId/channels/:id` | A, T, **P** | — | `null` (hard delete) |

---

## 12. Device Status History — `/devices/:deviceId/status-history`

Chỉ đọc — nhật ký đổi trạng thái thiết bị, ghi nội bộ.

| Method & Path | Vai trò | Response |
|---|---|---|
| `GET /devices/:deviceId/status-history` | A, M, T, **P** | `DeviceStatusHistoryResponseDto[]` |

---

## 13. Telemetry — `/devices/:deviceId/telemetry`

Chỉ đọc — dữ liệu lưu ở MongoDB (xem `docs/DATABASE_DESIGN.md` §9).

| Method & Path | Vai trò | Query | Response |
|---|---|---|---|
| `GET /devices/:deviceId/telemetry/hourly` | A, M, T, S (**C** cho Staff) | `from?`, `to?` (ISO date) | `TelemetryHourlyResponseDto[]` |
| `GET /devices/:deviceId/telemetry/raw` | A, M, T | `from?`, `to?`, `limit?` (mặc định/giới hạn theo `TELEMETRY_RAW_*` constant) | `TelemetryRawResponseDto[]` |

---

## 14. Alerts — `/alerts`

Không có `POST /` — alert được hệ thống tự phát sinh nội bộ, không tạo qua API.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /alerts` | A, M, T, S | Query: `status?`, `type?`, `coldRoomId?`, `deviceId?`, `batchId?` | `AlertResponseDto[]` |
| `GET /alerts/:id` | A, M, T, S, **P** | — | `AlertResponseDto` |
| `POST /alerts/:id/acknowledge` | A, M, T, S (**C** cho Staff) | `{ userId? }` (bỏ trống nếu do hệ thống tự acknowledge) | `AlertResponseDto` — `status → acknowledged` |
| `POST /alerts/:id/resolve` | A, M, T, **P** | `{ userId? }` | `AlertResponseDto` — `status → resolved`, `resolution = manual` |

---

## 15. Commands (điều khiển thiết bị) — `/commands`

Không có `DELETE /:id` — lịch sử lệnh là vĩnh viễn, cùng nguyên tắc với `alerts`/`audit-logs`/`device-status-history`.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /commands` | A, T, S (**C** cho Staff, phạm vi theo `channelId` trong body) | `{ channelId, action, payload?, issuedBy? }` | `CommandResponseDto` — `status = pending` |
| `GET /commands` | A, M, T, S | — | `CommandResponseDto[]` |
| `GET /commands/:id` | A, M, T, S, **P** | — | `CommandResponseDto` |
| `POST /commands/:id/sent` | A (nội bộ — do cầu nối thiết bị/broker gọi, chưa có cơ chế service-account riêng) | — | `CommandResponseDto` — `status → sent` |
| `POST /commands/:id/ack` | A (nội bộ) | `{ status: "done" \| "failed" }` | `CommandResponseDto` — set `ackAt` |

---

## 16. Notifications — `/notifications`

Web Push. Các endpoint dưới đây nhận `userId` trực tiếp từ request (body/query) thay vì suy ra từ cookie phiên đăng nhập — client tự khai báo mình là ai, chưa có kiểm tra "tự thân" ở tầng guard cho nhóm này.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /notifications/vapid-public-key` | công khai | — | `{ publicKey: string \| null }` (không qua `@Serialize`, không phải entity) |
| `POST /notifications/subscriptions` | mọi role | `{ userId, endpoint, keys: { p256dh, auth }, userAgent? }` | `PushSubscriptionResponseDto` |
| `DELETE /notifications/subscriptions` | mọi role | `{ endpoint }` | `null` |
| `GET /notifications` | mọi role | `userId` (bắt buộc), `unreadOnly?` (`"true"`/`"false"` dạng chuỗi) | `NotificationResponseDto[]` |
| `POST /notifications/:id/read` | mọi role | `{ userId }` (bắt buộc — dùng để kiểm tra quyền sở hữu thông báo trước khi đánh dấu đã đọc) | `NotificationResponseDto` |

---

## 17. Audit Logs — `/audit-logs`

Append-only và **chỉ đọc qua API** — không có `POST`/`PATCH`/`DELETE`, kể cả với Admin. Bản ghi chỉ được thêm từ bên trong server (các module khác gọi trực tiếp `AuditLogsService.create()`), để không client nào giả mạo hay sửa được nhật ký. Xem: Admin toàn hệ thống; Manager chỉ thấy bản ghi có `warehouse_id` thuộc warehouse mình giữ vai trò Manager (lọc `warehouseId` ngoài phạm vi → `403`, xem 1 bản ghi ngoài phạm vi hoặc không gắn warehouse → `403`).

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /audit-logs` | A, M (**P**) | Query lọc (xem `QueryAuditLogDto`) | `AuditLogResponseDto[]` |
| `GET /audit-logs/:id` | A, M (**P**) | — | `AuditLogResponseDto` |

---

## 18. WebSocket (Realtime)

Cùng HTTP server, xác thực bằng cookie `access_token` lúc bắt tay kết nối (không hit DB, cùng cơ chế với REST). Kết nối không có `access_token` hợp lệ hoặc tài khoản `locked` bị `disconnect` ngay lập tức. CORS origin cấu hình qua `WS_CORS_ORIGIN` (mặc định `http://localhost:5173`), `credentials: true`.

Phòng (room) theo từng warehouse (`warehouse:{id}`) — client phải chủ động `join` mới nhận được sự kiện của warehouse đó, không có kênh broadcast dùng chung cho toàn hệ thống.

| Sự kiện (client → server) | Payload | Ghi chú |
|---|---|---|
| `join:warehouse` | `{ warehouseId }` | Admin join được mọi warehouse; role khác chỉ join được warehouse mình có mặt trong `warehouse_staff` (`WsException` nếu không hợp lệ). Trả về `{ warehouseId }` khi thành công. |
| `leave:warehouse` | `{ warehouseId }` | Rời phòng, trả về `{ warehouseId }`. |

Chiều server → client (`emitToWarehouse(warehouseId, event, payload)`) đã có sẵn hạ tầng nhưng **chưa có module nghiệp vụ nào gọi tới** — tên sự kiện tự do (vd dự kiến `alert:new`), chưa có danh mục sự kiện cố định.

---

## 19. Danh sách roles theo module (tóm tắt)

| Module | Ghi (create/update/delete) | Chỉ xem |
|---|---|---|
| Users | A | TT |
| Warehouses, Product Types, Shifts (mẫu ca) | A | mọi role |
| Cold Rooms | A, M (**P**) | mọi role, **P** khi truy cập 1 phòng cụ thể |
| Work Shifts | A, M (**P**); check-in/out: S (own) | A, M, S |
| Batches | A, M (**P**); S (**C**) | A, M, S |
| Devices — vòng đời kỹ thuật | A, T (**P**); tạo mới/xoá cứng: A | A, M, T, S (xem cơ bản) |
| Device Channels | A, T (**P**) | A, M, T (**P**) |
| Commands — gửi lệnh | A, T (**P**), S (**C**) | A, M, T, S |
| Alerts — acknowledge | A, M, T, S (**C**) | A, M, T, S |
| Alerts — resolve | A, M, T (**P**) | — |
| Audit Logs | Nội bộ (không qua API) | A, M (**P**) |
| Notifications | mọi role (tự khai `userId`) | mọi role |
