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

**Phân trang**: các endpoint danh sách có thể tăng không giới hạn (đánh dấu `Paginated<…>` bên dưới) nhận thêm query `page` (≥ 1, mặc định 1) và `limit` (1–100, mặc định 20). Khi đó `data` không còn là mảng mà có dạng:

```json
{ "items": [ ], "meta": { "page": 1, "limit": 20, "total": 45, "totalPages": 3 } }
```

Kết quả sắp xếp mới nhất trước. Riêng `shifts` xếp theo `startTime` tăng dần, `work-shifts` theo `scheduledStartAt` giảm dần, staff của warehouse theo thời điểm gán. Chỉ `GET /devices/:deviceId/channels` vẫn trả mảng (mỗi thiết bị chỉ có vài kênh). Dropdown cần toàn bộ danh sách thì gọi `limit=100` và lấy tiếp các trang theo `meta.totalPages`.

**Tìm kiếm và lọc** (dùng chung `common/query/`): các bộ lọc ghép với nhau bằng AND, và luôn nằm trong phạm vi warehouse của caller.

- `search`: tìm chuỗi con, không phân biệt hoa thường, khớp **một trong** các trường ghi ở từng endpoint. Tự trim, tối đa 100 ký tự; `%`/`_` được hiểu theo nghĩa đen.
- `…From`/`…To`: `YYYY-MM-DD`, tính cả hai đầu, có thể bỏ một đầu. Với cột thời điểm (`createdFrom`/`createdTo`) thì tính theo **ngày UTC**; với cột ngày (`expiry…`, `received…`, `workDate…`) thì so thẳng ngày.
- Cờ boolean (`hasAddress`, `unassigned`, `unreadOnly`): chuỗi `"true"`/`"false"`.
- `warehouseId` ngoài phạm vi của caller không bị lỗi 403 mà chỉ trả về danh sách rỗng, giống như khi caller không có kho nào.
- Enum (`status`, `type`, `unit`, `role`, `action`…): sai giá trị trả về 400.

**Xoá hàng loạt**: `POST /<resource>/bulk-delete` với body `{ "ids": ["…"] }` (1–100 id, không trùng), có ở `warehouses`, `cold-rooms`, `product-types`, `devices`, `users`, `batches`, `work-shifts`. Vai trò được phép giống hệt `DELETE /<resource>/:id` tương ứng. Trả về `200` với:

```json
{ "deleted": ["…"], "failed": [{ "id": "…", "statusCode": 404, "message": "…" }] }
```

- **Best effort, không phải all-or-nothing**: mỗi id đi qua đúng logic của `DELETE /:id` (transaction riêng, quy tắc nghiệp vụ riêng). Một id lỗi không ảnh hưởng các id khác. `statusCode` là mã mà `DELETE /:id` sẽ trả cho id đó (404 không tồn tại, 403 ngoài phạm vi, 409 sai trạng thái…).
- **Phạm vi kho** (`batches`, `work-shifts`): kiểm tra từng id như `@WarehouseScope` của route đơn. Staff thao tác trên lô hàng vẫn phải đang trong ca trực tại kho của lô đó.
- **`users`**: id của chính người gọi bị từ chối (400), để Admin không tự khoá mình.
- **Nhật ký**: mỗi id xoá thành công có một bản ghi `audit_logs` riêng, cùng `action` với route đơn (ví dụ `warehouse.delete`, `batch.remove`). Id thất bại không được ghi.

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
| `GET /users` | A | `search?` (`username`/`fullName`/`email`/`phone`), `role?`, `status?`, `page?`, `limit?` | `Paginated<UserResponseDto>` (toàn bộ hệ thống) |
| `GET /users/:id` | TT | — | `UserResponseDto` |
| `PATCH /users/:id` | TT | như create, trừ `password` | `UserResponseDto` — chỉ Admin được đổi `role` (người khác gửi `role` khác role hiện tại → `403`) |
| `DELETE /users/:id` | A | — | `null` (soft delete) |
| `POST /users/:id/lock` | A | — | `UserResponseDto` — `status → locked`, có hiệu lực ngay: xoá phiên refresh, access token đang có bị từ chối (key `blocked:<id>` trong Redis), WebSocket bị ngắt; không tự khoá chính mình (`400`). `DELETE /users/:id` cũng thu hồi quyền truy cập ngay theo cách này |
| `POST /users/:id/unlock` | A | — | `UserResponseDto` — `status → active` |
| `POST /users/me/password` | mọi role (tài khoản của chính mình) | `{ currentPassword, newPassword }` (`newPassword` ≥ 6 ký tự) | `UserResponseDto`; `400` nếu mật khẩu hiện tại sai hoặc mật khẩu mới trùng mật khẩu cũ. Phiên đăng nhập hiện tại được giữ. Audit `user.password_change` |
| `POST /users/:id/password` | A (tài khoản khác) | `{ newPassword }` (≥ 6 ký tự) | `UserResponseDto` — đặt lại mật khẩu (vd. người dùng quên mật khẩu): xoá phiên refresh và ngắt WebSocket của người đó (access token đã cấp còn dùng được tới khi hết hạn, mặc định 15 phút); không dùng cho chính mình (`400`). Audit `user.password_reset` |
| `POST /users/:id/images` | TT | `multipart/form-data` | `UserResponseDto` |
| `DELETE /users/:id/images` | TT | `{ url }` | `UserResponseDto` |

---

## 4. Warehouses — `/warehouses`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /warehouses` | A | `{ name, code, address?, imageUrls? }` | `WarehouseResponseDto` |
| `GET /warehouses` | mọi role | `search?` (`name`/`code`/`address`), `createdFrom?`/`createdTo?`, `hasAddress?` (địa chỉ rỗng tính là không có), `page?`, `limit?` | `Paginated<WarehouseResponseDto>` (chưa lọc theo phạm vi — xem ghi chú bên dưới) |
| `GET /warehouses/:id` | mọi role, **P** | — | `WarehouseResponseDto` |
| `PATCH /warehouses/:id` | A | | `WarehouseResponseDto` |
| `DELETE /warehouses/:id` | A | — | `null` (soft delete) |
| `POST /warehouses/:id/images` | A | `multipart/form-data` | `WarehouseResponseDto` |
| `DELETE /warehouses/:id/images` | A | `{ url }` | `WarehouseResponseDto` |
| `GET /warehouses/:warehouseId/staff` | A, M (**P**) | `page?`, `limit?` | `Paginated<WarehouseStaffResponseDto>` (`userId`, `warehouseId`, `createdAt`, `user { id, username, fullName, email, phone, imageUrls, role }` — thông tin liên hệ để Manager liên lạc với nhân viên, ví dụ khi duyệt chấm công) |
| `PUT /warehouses/:warehouseId/staff/:userId` | A | — | `WarehouseStaffResponseDto` — gán vào kho; gán lại người đã có trong kho thì trả về bản ghi cũ. User làm việc với role của tài khoản. `400` nếu là tài khoản Admin |
| `DELETE /warehouses/:warehouseId/staff/:userId` | A | — | `null` (`404` nếu user chưa được gán) |

> Các endpoint `GET` liệt kê danh sách của tài nguyên gắn warehouse (`/warehouses`, `/cold-rooms`, `/devices`, `/batches`, `/work-shifts`, `/commands`, `/alerts`, `/audit-logs`) chỉ trả về bản ghi thuộc các warehouse caller được đọc, xét theo phân công (`warehouse_staff`) và role của tài khoản — Admin thấy toàn bộ. Chi tiết mô hình: `docs/RBAC.md` §1, §3.

---

## 5. Cold Rooms — `/cold-rooms`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /cold-rooms` | A, M (**P** theo `warehouseId` trong body) | `{ warehouseId, name, tempMin, tempMax, hysteresis?, doorOpenMaxSeconds?, capacityPallets?, capacityWeightKg?, capacityVolumeM3? }` | `ColdRoomResponseDto` |
| `GET /cold-rooms` | mọi role | `search?` (`name`), `warehouseId?`, `createdFrom?`/`createdTo?`, `page?`, `limit?` | `Paginated<ColdRoomResponseDto>` |
| `GET /cold-rooms/status` | A, M, T, S | `coldRoomIds?` hoặc `warehouseIds?` (danh sách id cách nhau bằng dấu phẩy, ≤ 100, bắt buộc có một trong hai) | `ColdRoomStatus[]`: mỗi phòng có `latest` (mẫu telemetry mới nhất: `ts`, `temperature`, `doorOpen`, `sensorFault`, `outOfRange`; `null` nếu chưa có), `devices` (`total` + số thiết bị theo từng trạng thái), `activeAlerts` (cảnh báo `open`/`acknowledged`). Phòng ngoài phạm vi của caller bị bỏ qua, không báo lỗi. Staff xem được **kể cả khi không trong ca**. Cập nhật trực tiếp qua WebSocket: sự kiện `coldroom:reading` và `alerts:changed` trong room `warehouse:{id}` |
| `GET /cold-rooms/:id/telemetry` | A, M, T, S (**P**) | `range?` = `1h` \| `6h` (mặc định) \| `24h` | `{ coldRoomId, from, to, bucketMinutes, tempMin, tempMax, points[] }`: nhiệt độ của phòng (gộp mẫu của mọi thiết bị trong phòng) theo từng khoảng 1, 5 hoặc 15 phút, mỗi điểm có `t`, `avg`/`min`/`max` (bỏ qua mẫu lỗi cảm biến), `samples`, và số mẫu `outOfRange`/`doorOpen`/`sensorFault`. Khoảng thời gian không có mẫu thì không có điểm. Staff xem được kể cả khi không trong ca. Dùng cho biểu đồ của màn Giám sát trực tiếp |
| `GET /cold-rooms/:id/inventory` | A, M, S (**P**) | — | `{ coldRoomId, asOf, expiringSoonDays, totalBatches, items[] }`: hàng đang lưu trong phòng (mọi lô chưa xuất kho, kể cả lô đã hết hạn) gộp theo loại sản phẩm. Mỗi item có `productTypeId`, `productTypeName`, `category`, `unit`, `storageTempMin`/`storageTempMax`, `batchCount`, `totalQuantity`, `nearestExpiry`, `expiredBatchCount` (status `expired` hoặc `expiryDate` < `asOf`), `expiringSoonBatchCount` (hết hạn trong `expiringSoonDays` = 7 ngày tới). `asOf` là ngày hôm nay theo giờ Việt Nam (UTC+7). Sắp xếp theo `nearestExpiry` tăng dần. Staff xem được kể cả khi không trong ca (giống `GET /batches`). Dùng cho màn chi tiết phòng lạnh |
| `GET /cold-rooms/:id` | mọi role, **P** | — | `ColdRoomResponseDto` |
| `PATCH /cold-rooms/:id` | A, M, **P** | các field như create (trừ `warehouseId`) | `ColdRoomResponseDto` |
| `DELETE /cold-rooms/:id` | A | — | `null` (soft delete) |

---

## 6. Product Types — `/product-types`

Master data, chỉ Admin thao tác ghi; các role khác chỉ xem.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /product-types` | A | `{ name, category?, unit, storageTempMin?, storageTempMax?, imageUrls? }` | `ProductTypeResponseDto` |
| `GET /product-types` | mọi role | `search?` (`name`/`category`), `unit?`, `page?`, `limit?` | `Paginated<ProductTypeResponseDto>` |
| `GET /product-types/:id` | mọi role | — | `ProductTypeResponseDto` |
| `PATCH /product-types/:id` | A | | `ProductTypeResponseDto` |
| `DELETE /product-types/:id` | A | — | `null` (soft delete) |
| `POST /product-types/:id/images` | A | `multipart/form-data` | `ProductTypeResponseDto` |
| `DELETE /product-types/:id/images` | A | `{ url }` | `ProductTypeResponseDto` |

---

## 7. Shifts (mẫu ca) — `/shifts`

Master data (mẫu ca có tên tự đặt, không gắn ngày/nhân viên) — chỉ Admin thao tác ghi. Tạo bao nhiêu cũng được, nhưng **khung giờ các mẫu ca đang hoạt động không được chồng nhau** trong ngày (ca qua đêm tính cả phần sau 0h; hai ca nối tiếp 14:00/14:00 không tính là chồng) và **tên không trùng** (không phân biệt hoa thường). Vi phạm → `409`; giờ bắt đầu = giờ kết thúc → `400`.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /shifts` | A | `{ name, startTime, endTime }` (tên ≤ 100 ký tự; giờ Việt Nam dạng `HH:mm` hoặc `HH:mm:ss`, kết thúc ≤ bắt đầu = ca qua đêm) | `ShiftResponseDto` |
| `GET /shifts` | mọi role | `page?`, `limit?` | `Paginated<ShiftResponseDto>` |
| `GET /shifts/:id` | mọi role | — | `ShiftResponseDto` |
| `PATCH /shifts/:id` | A | các field như create (đều tuỳ chọn) | `ShiftResponseDto` |
| `DELETE /shifts/:id` | A | — | `null` (soft delete — các lượt chấm công cũ vẫn giữ; tên và khung giờ được giải phóng) |

---

## 8. Work Shifts (chấm công ca trực) — `/work-shifts`

Mỗi bản ghi là một lượt chấm công: Staff tự gửi yêu cầu vào ca, Manager của kho (hoặc Admin) duyệt/từ chối. Không còn xếp lịch trước.

- **Ca được hệ thống tự chọn** theo thời điểm gửi: mẫu ca có khung `[giờ bắt đầu − 15 phút, giờ kết thúc)` chứa thời điểm đó (giờ theo múi giờ Việt Nam, UTC+7). Hai khung chồng nhau → chọn ca bắt đầu muộn hơn (ca sắp tới). Ca đêm sau 0h thuộc `workDate` của ngày bắt đầu.
- **Vòng đời**: `pending` → `approved` | `rejected`; `pending` chưa ai duyệt khi ca kết thúc → `expired` (sweep). Bị từ chối/quá hạn thì Staff gửi lại trên chính bản ghi đó (unique `(staff, workDate, shift)`).
- **Ca đang hoạt động** (điều kiện "Ca trực" của RBAC): `approved`, chưa `checkOutAt`, và `scheduledEndAt` + 5 phút > hiện tại. Staff được thao tác thêm 5 phút sau giờ kết thúc; frontend tự đăng xuất + check-out khi hết 5 phút, sweep check-out các ca còn sót.
- **Đi trễ**: `WorkShiftResponseDto.lateMinutes` được tính khi trả về (không lưu DB) = số phút nguyên `checkInAt` sau `scheduledStartAt`; `0` nếu chấm công đúng giờ hoặc sớm, `null` nếu chưa có `checkInAt`.
- Mỗi thay đổi đẩy sự kiện `workshift:changed` (`{ workShiftId, warehouseId, staffId, status, lateMinutes }`) tới room của Staff đó, các Manager của kho và mọi Admin.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /work-shifts/me` | mọi role (dữ liệu của chính mình) | — | `AttendanceResponseDto` `{ active, open, request, warehouses }` |
| `POST /work-shifts/check-in` | S, **P** theo `warehouseId` trong body | `{ warehouseId }` | `WorkShiftResponseDto` (`pending`); `409` nếu không có ca nào đang mở hoặc đã có yêu cầu `pending`/`approved` cho ca này |
| `GET /work-shifts` | A, M, S | `status?`, `warehouseId?`, `shiftId?`, `staffId?`, `workDateFrom?`/`workDateTo?`, `page?`, `limit?` | `Paginated<WorkShiftResponseDto>` |
| `GET /work-shifts/:id` | A, M, S, **P** | — | `WorkShiftResponseDto` |
| `POST /work-shifts/:id/approve` | A, M, **P** | — | `WorkShiftResponseDto`; `409` nếu không `pending` hoặc ca đã kết thúc |
| `POST /work-shifts/:id/reject` | A, M, **P** | `{ reason? }` (≤ 255 ký tự) | `WorkShiftResponseDto`; `409` nếu không `pending` |
| `POST /work-shifts/:id/check-out` | S, **P** + chỉ đúng ca của chính mình | — | `WorkShiftResponseDto`; `409` nếu không phải ca `approved` chưa check-out |
| `DELETE /work-shifts/:id` | A, M, **P** | — | `null` (hard delete — bảng này không có `deleted_at`) |

---

## 9. Batches (lô hàng) — `/batches`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /batches` | A, M, S (**C** cho Staff, phạm vi theo `coldRoomId` trong body) | `{ coldRoomId, productTypeId, batchCode, quantity, supplier?, receivedAt, expiryDate, notes? }` | `BatchResponseDto` |
| `GET /batches` | A, M, S | `search?` (`batchCode`/`supplier`), `status?`, `warehouseId?`, `coldRoomId?`, `productTypeId?`, `expiryFrom?`/`expiryTo?`, `receivedFrom?`/`receivedTo?`, `page?`, `limit?` | `Paginated<BatchResponseDto>` |
| `GET /batches/:id` | A, M, S, **P** | — | `BatchResponseDto` |
| `PATCH /batches/:id` | A, M, S (**C** cho Staff) | các field như create (trừ `coldRoomId` — không có luồng chuyển hàng; chuyển hàng = xuất lô cũ + nhập lô mới) | `BatchResponseDto` |
| `DELETE /batches/:id` | A, M, S (**C** cho Staff) | — | `null` (hard delete — không có `deleted_at`, dùng `status=removed` làm vòng đời riêng) |

Backend validate: khoảng nhiệt độ khuyến nghị của `product_type` (`storageTempMin/Max`) phải nằm trong ngưỡng an toàn của `cold_room` (`tempMin/Max`) khi tạo/gán batch — không thể ép bằng CHECK constraint SQL vì so sánh chéo 2 bảng.

---

## 10. Devices — `/devices`

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /devices` | A | `{ uniqueId, firmwareVersion? }` | `DeviceResponseDto` — thiết bị mới ở trạng thái `registered`, `coldRoomId = null` |
| `GET /devices` | A, M, T, S | `search?` (`uniqueId`/`firmwareVersion`), `status?`, `warehouseId?`, `coldRoomId?`, `unassigned?` (`"true"` = chưa claim, chỉ Admin thấy), `page?`, `limit?` | `Paginated<DeviceResponseDto>` |
| `GET /devices/:id` | A, M, T, S (**C** cho Staff) | — | `DeviceResponseDto` |
| `PATCH /devices/:id` | A, T, **P** | `{ firmwareVersion? }` | `DeviceResponseDto` |
| `POST /devices/:id/claim-code` | A, T, **P** | — | `ClaimCodeResponseDto { claimCode, claimCodeExpiresAt }` — **mã gốc chỉ trả về đúng lần này**, sau đó chỉ còn hash trong DB |
| `POST /devices/:id/claim` | A, T (phạm vi tính theo `coldRoomId` đích trong body, không phải phòng hiện tại của thiết bị) | `{ claimCode, coldRoomId }` | `DeviceResponseDto` — gán `coldRoomId`, chuyển `status = active` |
| `POST /devices/:id/decommission` | A, T, **P** | — | `DeviceResponseDto` — chuyển `status = decommissioned` (một chiều, không đảo ngược). Ghi audit `device.decommission` |
| `DELETE /devices/:id` | A | — | `null` (soft delete — tách biệt với `decommission`, dùng cho xoá bản ghi hẳn) |

---

## 11. Device Channels — `/devices/:deviceId/channels`

Cảm biến/cơ cấu chấp hành gắn trên 1 device.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /devices/:deviceId/channels` | A, T, **P** (theo `deviceId`) | `{ channelType, label? }` | `DeviceChannelResponseDto` — `channelRole` (`sensor`/`actuator`) suy ra tự động từ `channelType`, không nhận từ client |
| `GET /devices/:deviceId/channels` | A, M, T, S (**C** cho Staff — để chọn kênh khi gửi lệnh) | — | `DeviceChannelResponseDto[]` |
| `GET /devices/:deviceId/channels/:id` | A, M, T, S (**C** cho Staff) | — | `DeviceChannelResponseDto` |
| `PATCH /devices/:deviceId/channels/:id` | A, T, **P** | `{ label? }` | `DeviceChannelResponseDto` |
| `DELETE /devices/:deviceId/channels/:id` | A, T, **P** | — | `null` (hard delete) |

---

## 12. Device Status History — `/devices/:deviceId/status-history`

Chỉ đọc — nhật ký đổi trạng thái thiết bị, ghi nội bộ. `DevicesService` ghi một dòng (`trigger = manual`, `changedBy` = người thao tác) trong cùng transaction với mỗi bước vòng đời làm đổi trạng thái: sinh mã kích hoạt (`registered → provisioned`; sinh lại mã khi đã `provisioned` thì không ghi), claim (`provisioned → active`), decommission. Các chuyển trạng thái tự động (mất kết nối, lỗi cảm biến) chưa được ghi.

| Method & Path | Vai trò | Response |
|---|---|---|
| `GET /devices/:deviceId/status-history` | A, M, T, **P** | `Paginated<DeviceStatusHistoryResponseDto>` (query `page?`, `limit?`) |

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
| `GET /alerts` | A, M, T, S | Query: `status?`, `type?`, `warehouseId?`, `coldRoomId?`, `deviceId?`, `batchId?`, `createdFrom?`/`createdTo?`, `page?`, `limit?` | `Paginated<AlertResponseDto>` |
| `GET /alerts/:id` | A, M, T, S, **P** | — | `AlertResponseDto` |
| `POST /alerts/:id/acknowledge` | A, M, T, S (**C** cho Staff) | — (`acknowledgedBy` = user đang đăng nhập, không nhận từ body) | `AlertResponseDto` — `status → acknowledged` |
| `POST /alerts/:id/resolve` | A, M, T, **P** | — (`resolvedBy` = user đang đăng nhập) | `AlertResponseDto` — `status → resolved`, `resolution = manual` |

---

## 15. Commands (điều khiển thiết bị) — `/commands`

Không có `DELETE /:id` — lịch sử lệnh là vĩnh viễn, cùng nguyên tắc với `alerts`/`audit-logs`/`device-status-history`.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `POST /commands` | A, T, S (**C** cho Staff, phạm vi theo `channelId` trong body) | `{ channelId, action, payload? }` | `CommandResponseDto` — `status = pending`; `issuedBy` = user đang đăng nhập, không nhận từ body (lệnh do hệ thống tự phát có `issuedBy = null`) |
| `GET /commands` | A, M, T, S | `status?`, `action?`, `warehouseId?`, `deviceId?`, `channelId?`, `issuedBy?`, `createdFrom?`/`createdTo?`, `page?`, `limit?` | `Paginated<CommandResponseDto>` |
| `GET /commands/:id` | A, M, T, S, **P** | — | `CommandResponseDto` |
| `POST /commands/:id/sent` | A (nội bộ — do cầu nối thiết bị/broker gọi, chưa có cơ chế service-account riêng) | — | `CommandResponseDto` — `status → sent` |
| `POST /commands/:id/ack` | A (nội bộ) | `{ status: "done" \| "failed" }` | `CommandResponseDto` — set `ackAt` |

---

## 16. Notifications — `/notifications`

Web Push. Mọi endpoint (trừ `vapid-public-key`) chỉ thao tác trên dữ liệu của **chính user đang đăng nhập** — `userId` luôn lấy từ cookie phiên, không nhận từ body/query.

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /notifications/vapid-public-key` | công khai | — | `{ publicKey: string \| null }` (không qua `@Serialize`, không phải entity) |
| `POST /notifications/subscriptions` | mọi role | `{ endpoint, keys: { p256dh, auth }, userAgent? }` | `PushSubscriptionResponseDto` — endpoint đã tồn tại (cùng trình duyệt) được chuyển sang user hiện tại |
| `DELETE /notifications/subscriptions` | mọi role | `{ endpoint }` | `null` — chỉ xoá subscription của chính mình |
| `GET /notifications` | mọi role | `unreadOnly?`, `search?` (`title`/`body`), `createdFrom?`/`createdTo?`, `page?`, `limit?` | `Paginated<NotificationResponseDto>` của chính mình |
| `POST /notifications/:id/read` | mọi role | — | `NotificationResponseDto` (`404` nếu thông báo không thuộc về mình) |

---

## 17. Audit Logs — `/audit-logs`

Append-only và **chỉ đọc qua API** — không có `POST`/`PATCH`/`DELETE`, kể cả với Admin. Bản ghi chỉ được thêm từ bên trong server (các module khác gọi trực tiếp `AuditLogsService.create()`), để không client nào giả mạo hay sửa được nhật ký. Xem: Admin toàn hệ thống; Manager chỉ thấy bản ghi có `warehouse_id` thuộc warehouse mình giữ vai trò Manager (lọc `warehouseId` ngoài phạm vi → `403`, xem 1 bản ghi ngoài phạm vi hoặc không gắn warehouse → `403`).

| Method & Path | Vai trò | Request | Response |
|---|---|---|---|
| `GET /audit-logs` | A, M (**P**) | `userId?`, `warehouseId?`, `targetType?`, `targetId?`, `action?` (khớp chính xác), `createdFrom?`/`createdTo?`, `page?`, `limit?` | `Paginated<AuditLogResponseDto>` |
| `GET /audit-logs/:id` | A, M (**P**) | — | `AuditLogResponseDto` |

---

## 18. WebSocket (Realtime)

Cùng HTTP server, namespace mặc định `/`. Xác thực bằng cookie `access_token` trong **middleware bắt tay** (`RealtimeGateway.afterInit`): không hit DB, cùng cơ chế với REST, và kiểm tra key Redis `blocked:<id>`. Kết nối không có token hợp lệ, hoặc của tài khoản `locked`, bị từ chối trước khi mở. Client nhận `connect_error` với message `Unauthorized`, không bao giờ nhận `connect`. Vì vậy không handler nào thấy được socket chưa xác thực xong. CORS origin cấu hình qua `CORS_ORIGINS` (mặc định `http://localhost:5173`, dùng chung với REST), `credentials: true`. Khoá hoặc xoá tài khoản sẽ ngắt ngay mọi socket đang mở của user đó.

Có 2 loại phòng (room):
- `user:{id}`: mọi socket tự join khi kết nối. Sự kiện riêng của một người (chatbot) đi qua đây, tới tất cả tab của người đó.
- `warehouse:{id}`: client phải chủ động `join` mới nhận được sự kiện của warehouse đó. Không có kênh broadcast dùng chung cho toàn hệ thống.

| Sự kiện (client → server) | Payload | Ghi chú |
|---|---|---|
| `join:warehouse` | `{ warehouseId }` | Admin join được mọi warehouse; role khác chỉ join được warehouse mình có mặt trong `warehouse_staff` (`WsException` nếu không hợp lệ). Trả về `{ warehouseId }` khi thành công. |
| `leave:warehouse` | `{ warehouseId }` | Rời phòng, trả về `{ warehouseId }`. |
| `chatbot:send` | `{ conversationId, content }` | Xem §18.1. |

Chiều server → client theo warehouse (`emitToWarehouse(warehouseId, event, payload)`) đã có sẵn hạ tầng nhưng **chưa có module nghiệp vụ nào gọi tới**. Dự kiến dùng cho `alert:new`.

### 18.1 Chatbot qua WebSocket

Quản lý cuộc trò chuyện và đọc lịch sử vẫn dùng REST (`/chatbot/conversations` — `GET` trả `Paginated<ConversationResponseDto>`, nhận `page?`/`limit?`; `GET :id/messages` giữ phân trang cursor `before`/`limit`). **Gửi tin nhắn** thì dùng socket:

```js
socket.emit('chatbot:send', { conversationId, content }, (ack) => { ... });
```

- **Ack** trả về ngay khi tin nhắn của user đã được lưu, không đợi model:
  - Thành công: `{ ok: true, message: MessageResponseDto }`.
  - Lỗi: `{ ok: false, error: { statusCode, message } }`. Mọi lỗi đều nằm trong ack, không phát sự kiện `exception`.

  | `statusCode` | Nguyên nhân |
  |---|---|
  | `400` | Payload sai. `content` tối đa 2000 ký tự. |
  | `401` | Access token của socket đã hết hạn. Client gọi `POST /auth/refresh` rồi kết nối lại. |
  | `404` | Cuộc trò chuyện không tồn tại hoặc không thuộc về mình. |
  | `409` | Cuộc trò chuyện đang có một lượt trả lời chưa xong. |
  | `429` | Vượt giới hạn tin nhắn. |

  `400`, `401` và `404` không tính vào giới hạn tin nhắn.
- **Sự kiện server → client**, gửi tới phòng `user:{id}` (mọi tab của người gửi):

  | Sự kiện | Payload | Khi nào |
  |---|---|---|
  | `chatbot:message` | `MessageResponseDto` | Tin nhắn user vừa lưu. Sau đó là **câu trả lời cuối** của trợ lý (`role: "assistant"`), sự kiện này kết thúc lượt. Tab gửi nhận tin của chính mình cả qua ack lẫn qua sự kiện, nên client cần **khử trùng theo `id`**. |
  | `chatbot:tool_call` | `{ conversationId, tools: string[] }` | Trợ lý đang tra cứu dữ liệu. Dùng để hiện "Đang tra cứu…". Tên tool là tên nội bộ, frontend tự ánh xạ sang nhãn hiển thị. |
  | `chatbot:error` | `{ conversationId, message }` | Lượt đã được nhận nhưng lỗi ngoài dự kiến (vd DB lỗi). Lỗi của Gemini (hết quota, mất mạng) **không** đi qua đây: chúng thành một `chatbot:message` của trợ lý với nội dung thông báo lỗi. |

- **Mỗi cuộc trò chuyện chỉ chạy một lượt tại một thời điểm**, dùng khoá Redis `chatbot:turn:<conversationId>` (TTL 180s phòng khi process chết giữa lượt). Nhờ vậy gửi trùng hay gửi từ hai tab không làm lịch sử bị xen kẽ.
- Giới hạn tin nhắn (`CHATBOT_RATE_LIMIT_PER_MINUTE` / `_PER_DAY`) dùng chung bộ đếm với REST.
- `POST /chatbot/conversations/:id/messages` vẫn còn: chạy cùng một lượt, nhưng chỉ trả về câu trả lời cuối khi đã xong. Các sự kiện trên vẫn được phát. Endpoint này dùng khi test bằng REST Client, hoặc khi client không có socket.
- Kịch bản test tay: `node http/chatbot-socket.mjs "câu hỏi" [conversationId]` (chạy trong `server/`).

---

## 19. Danh sách roles theo module (tóm tắt)

| Module | Ghi (create/update/delete) | Chỉ xem |
|---|---|---|
| Users | A | TT |
| Warehouses, Product Types, Shifts (mẫu ca) | A | mọi role |
| Cold Rooms | A, M (**P**) | mọi role, **P** khi truy cập 1 phòng cụ thể |
| Work Shifts | duyệt/từ chối: A, M (**P**); check-in/out: S (own) | A, M, S |
| Batches | A, M (**P**); S (**C**) | A, M, S |
| Devices — vòng đời kỹ thuật | A, T (**P**); tạo mới/xoá cứng: A | A, M, T, S (xem cơ bản) |
| Device Channels | A, T (**P**) | A, M, T (**P**) |
| Commands — gửi lệnh | A, T (**P**), S (**C**) | A, M, T, S |
| Alerts — acknowledge | A, M, T, S (**C**) | A, M, T, S |
| Alerts — resolve | A, M, T (**P**) | — |
| Audit Logs | Nội bộ (không qua API) | A, M (**P**) |
| Notifications | mọi role (tự thân) | mọi role (tự thân) |
