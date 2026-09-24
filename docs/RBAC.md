# RBAC — Phân quyền theo vai trò

> Tài liệu thiết kế phân quyền cho hệ thống giám sát & quản lý kho lạnh: 4 vai trò, phạm vi truy cập, quyền hạn theo từng module và cách các vai trò tương tác với nhau.

---

## 1. Tổng quan vai trò

| Vai trò | Phạm vi | Điều kiện ca trực |
|---|---|---|
| Admin | Toàn hệ thống, mọi warehouse | Không |
| Quản lý kho (Manager) | Các warehouse được gán quản lý | Không |
| Kỹ thuật viên (Technician) | Các warehouse được gán | Không |
| Nhân viên (Staff) | Warehouse được gán | Có — chỉ khi đang check-in ca trực |

Mỗi tài khoản chỉ có **một** role toàn cục. Phạm vi theo từng warehouse được gán riêng cho từng user (một user có thể được gán vào nhiều warehouse, với role có thể khác nhau ở mỗi warehouse) — áp dụng cho Manager, Technician và Staff.

**Role nào quyết định quyền?** Với mọi người trừ Admin, trên các chức năng gắn với 1 warehouse, quyền được xét theo **role tại chính warehouse đó** (`warehouse_staff.role`), không theo role toàn cục. Ví dụ: một user có role toàn cục Staff nhưng được gán Manager ở kho B thì có quyền Manager tại kho B; ngược lại một Manager toàn cục chỉ được gán Staff ở kho C thì tại kho C chỉ có quyền Staff (kể cả điều kiện ca trực). Role toàn cục chỉ còn dùng cho các chức năng không gắn warehouse (danh mục dùng chung, tài khoản) và để xác định Admin.

Điểm khác biệt quan trọng giữa Technician và Staff: cả hai đều bị giới hạn theo warehouse được gán, nhưng chỉ **Staff** bị thêm điều kiện "đang trong ca trực" — Technician thao tác trên thiết bị của kho được gán không cần đang check-in ca.

---

## 2. Vai trò, quyền hạn và khả năng tương tác

### 2.1 Admin

**Phạm vi:** toàn hệ thống, không bị giới hạn theo warehouse.

**Quyền hạn:**
- Quản lý master data toàn hệ thống: tài khoản người dùng, warehouses, product-types, mẫu ca (shift templates) — tạo, sửa, xoá, gán role.
- Gán/thu hồi user (Manager/Technician/Staff) vào warehouse cụ thể.
- Toàn quyền trên mọi warehouse, không giới hạn phạm vi: cold-rooms, batches, devices (toàn bộ vòng đời kể cả decommission), alerts, commands, work-shifts.
- Vai trò duy nhất xem được audit log toàn hệ thống (kể cả log không gắn warehouse nào: tài khoản, master data).

**Tương tác với vai trò khác:** là người duy nhất tạo tài khoản Manager/Technician/Staff mới và gán họ vào warehouse; xử lý các thao tác vượt thẩm quyền của Manager/Technician (ví dụ decommission thiết bị, khoá tài khoản nhân viên nghỉ việc); có thể can thiệp vào bất kỳ warehouse nào khi cần.

### 2.2 Quản lý kho — Manager

**Phạm vi:** các warehouse được gán quản lý, bao trùm mọi cold room bên trong. Không thao tác được ngoài phạm vi này.

**Quyền hạn (trong phạm vi được gán):**
- Thao tác cơ bản (tạo/sửa/xem) trên các loại data cấp warehouse: cấu hình ngưỡng nhiệt độ cold-room, batches (nhập/xuất/điều chỉnh lô hàng), xếp lịch ca trực cho Staff/Technician thuộc warehouse của mình.
- Xem log chi tiết cho kho: lịch sử trạng thái thiết bị, telemetry chi tiết (theo giờ và tức thời), lịch sử alerts và commands trong phạm vi warehouse quản lý.
- Xem (không tạo/sửa) danh sách devices, warehouses, product-types.
- Xem và resolve alerts trong phạm vi; theo dõi lệnh điều khiển thiết bị do Technician/Staff gửi mà không trực tiếp gửi lệnh.
- Xem (không ghi) audit log của các warehouse mình giữ vai trò Manager (`warehouse_staff.role = manager` tại chính warehouse đó) — chỉ các bản ghi có `warehouse_id` thuộc các warehouse này; log không gắn warehouse vẫn chỉ Admin xem được.

**Tương tác với vai trò khác:** giao ca trực cho Staff/Technician; giám sát log chi tiết do Technician ghi nhận trên thiết bị; báo cáo lên Admin khi cần thao tác vượt phạm vi (thêm warehouse mới, decommission thiết bị, tạo tài khoản).

**Giới hạn:** không tạo/khoá tài khoản người dùng, không tạo warehouse/product-type mới, không có quyền kỹ thuật trên thiết bị (claim, provision, maintenance, điều khiển chủ động — thuộc về Technician), không xem audit log toàn hệ thống hay của warehouse mình không quản lý, không thao tác ngoài warehouse được gán.

### 2.3 Kỹ thuật viên — Technician

**Phạm vi:** các warehouse được gán, không yêu cầu đang trong ca trực.

**Quyền hạn (trong phạm vi được gán):**
- Toàn quyền với thiết bị của kho được gán: toàn bộ vòng đời kỹ thuật — sinh mã kích hoạt/provision, claim (ghép nối vào cold room), bảo trì, khoá, decommission, quản lý kênh relay/actuator.
- Xem cảnh báo và log chi tiết cho device: toàn bộ chi tiết alerts, lịch sử trạng thái thiết bị, telemetry (theo giờ và tức thời) trong phạm vi.
- Điều khiển chủ động thiết bị: toàn bộ tập lệnh điều khiển.
- Acknowledge/resolve alerts liên quan tới thiết bị trong phạm vi.

**Tương tác với vai trò khác:** nhận thiết bị/lệnh bảo trì được Admin/Manager phân công; là người xử lý kỹ thuật khi Staff hoặc hệ thống phát alert liên quan thiết bị; báo cáo tình trạng thiết bị chi tiết để Manager theo dõi qua log.

**Giới hạn:** không quản lý master data, không xếp lịch ca trực, không thao tác nghiệp vụ hàng hoá (batches), không xem audit log, không thao tác ngoài warehouse được gán.

### 2.4 Nhân viên — Staff

**Phạm vi:** warehouse được gán, và chỉ khi đang trong ca trực đã check-in.

**Quyền hạn (trong phạm vi + ca trực):**
- Tự check-in / check-out ca trực của chính mình.
- Chỉ có khả năng nghiệp vụ với hàng hoá: ghi nhận nhập/xuất lô hàng trong warehouse.
- Xem cảnh báo cơ bản: xem danh sách và acknowledge cảnh báo trong phạm vi — không xem log kỹ thuật chi tiết, không resolve.
- Điều khiển thiết bị cơ bản: gửi một tập lệnh an toàn, giới hạn được cấu hình trước (ví dụ tắt còi báo động tại chỗ) — không có quyền điều khiển chủ động/toàn bộ tập lệnh như Technician.

**Tương tác với vai trò khác:** thực thi công việc vận hành hằng ngày do Manager xếp lịch; khi phát hiện sự cố, Staff xem/acknowledge ở mức cơ bản rồi việc xử lý kỹ thuật chuyển cho Technician, việc quyết định nghiệp vụ (resolve) thuộc Manager/Admin.

**Giới hạn:** không cấu hình ngưỡng phòng, không thao tác vòng đời thiết bị, không xem log chi tiết thiết bị, không xếp lịch ca trực cho người khác, không tạo/sửa user khác, không xem audit log, không thao tác ngoài warehouse được gán, và mất toàn bộ quyền thao tác nghiệp vụ ngay khi chưa check-in hoặc đã check-out.

---

## 3. Mô hình dữ liệu cho phạm vi truy cập

RBAC trong hệ thống không chỉ dựa vào role — quyền thực tế còn phụ thuộc vào phạm vi warehouse (áp dụng cho Manager, Technician, Staff) và, riêng với Staff, trạng thái ca trực:

| Thực thể | Vai trò trong mô hình phân quyền |
|---|---|
| `User.role` | Role toàn cục, 1 giá trị/user |
| `WarehouseStaff` (`user_id`, `warehouse_id`, `role`) | Gán 1 user vào 1 hoặc nhiều warehouse. Role tại đây có thể khác role toàn cục của user — là nguồn của "Phạm vi" trong ma trận quyền ở Mục 4, áp dụng cho Manager, Technician và Staff |
| `WorkShift` (`staff_id`, `warehouse_id`, `shift_id`, `check_in_at`, `check_out_at`) | Nguồn của điều kiện "Ca trực" — chỉ áp dụng cho Staff |
| `Shift` | Mẫu ca tĩnh (sáng/chiều/tối với giờ bắt đầu/kết thúc cố định), không gắn với user hay ngày cụ thể — `WorkShift` là bản ghi gán 1 mẫu ca cho 1 staff vào 1 ngày, 1 warehouse cụ thể |

**Chuỗi kiểm tra phạm vi khi truy cập 1 thiết bị/lô hàng:**

```
device/batch → cold_room → warehouse → warehouse_staff (→ work_shift nếu caller là Staff)
```

Việc kiểm tra quyền phải đi đủ các cấp này — chỉ kiểm tra `role` là không đủ, vì 2 Manager (hoặc 2 Technician) khác nhau có thể phụ trách 2 warehouse hoàn toàn khác nhau.

**Cài đặt:**
- Route thao tác trên 1 tài nguyên (`@WarehouseScope`): `WarehouseScopeGuard` suy ra warehouse, lấy bản ghi `warehouse_staff` của caller tại đó và kiểm tra `warehouse_staff.role` nằm trong `@Roles` của route; `RolesGuard` bỏ qua kiểm tra role toàn cục trên các route này (trừ Admin). Điều kiện ca trực / "chỉ ca của mình" áp dụng khi role **tại warehouse đó** là Staff.
- Route danh sách (`@WarehouseListScope`): không chặn mà tính danh sách warehouse caller được đọc (các warehouse có `warehouse_staff.role` thuộc `@Roles`; với role Staff và route yêu cầu ca trực thì chỉ tính warehouse đang có ca check-in), service lọc kết quả theo danh sách đó. Áp dụng cho `GET /warehouses`, `/cold-rooms`, `/devices` (có điều kiện ca trực cho Staff), `/batches`, `/work-shifts` (Staff chỉ thấy ca của mình), `/commands`, `/alerts`, `/audit-logs`. Thiết bị chưa claim (không thuộc cold room nào) chỉ Admin thấy.
- Chatbot dùng chung `WarehouseAccessService` với các route REST: mỗi tool có `allowedRoles` (và `requireShift`) khớp với route REST tương ứng, và chỉ thấy các warehouse có role tại kho thuộc `allowedRoles` — Staff không xem được log chi tiết thiết bị (`get_device_status_history`, `get_telemetry_raw`), Technician không xem được lô hàng và lịch ca, Staff chỉ xem thiết bị/telemetry theo giờ khi đang trong ca. Tool gắn warehouse không xét role toàn cục; chỉ `get_product_types` và `search_docs` (không thuộc warehouse nào) xét role toàn cục.
- Khoá hoặc xoá tài khoản có hiệu lực ngay: ngoài xoá phiên refresh, hệ thống đặt key `blocked:<userId>` trong Redis — `JwtStrategy` từ chối access token còn hạn và WebSocket bị ngắt/từ chối kết nối.

---

## 4. Ma trận quyền theo module

Ký hiệu: `✓` = toàn quyền · `Phạm vi` = trong warehouse được gán · `Phạm vi + Ca trực` = Phạm vi và đang check-in ca trực hợp lệ (chỉ áp dụng Staff) · `Chỉ xem` = chỉ xem, không tạo/sửa/xoá · `Cơ bản` = tập quyền giới hạn, hẹp hơn Technician/Admin · `Tự thân` = chỉ trên dữ liệu của chính user đó · `–` = không có quyền · `Nội bộ` = do hệ thống/thiết bị thực hiện, không qua người dùng cuối.

| Module | Admin | Manager | Technician | Staff |
|---|---|---|---|---|
| **Tài khoản người dùng** | Toàn quyền (tạo, sửa, xoá, gán role, gán warehouse) | Tự thân | Tự thân | Tự thân |
| **Warehouses** | Toàn quyền (tạo, sửa, xoá) | Chỉ xem (Phạm vi) | Chỉ xem (Phạm vi) | Chỉ xem (Phạm vi) |
| **Cold rooms** (bao gồm cấu hình ngưỡng nhiệt độ) | Toàn quyền | Phạm vi | Chỉ xem (Phạm vi) | Chỉ xem (Phạm vi) |
| **Product types** | Toàn quyền | Chỉ xem | Chỉ xem | Chỉ xem |
| **Mẫu ca (shift templates)** | Toàn quyền | Chỉ xem | Chỉ xem | Chỉ xem |
| **Xếp lịch ca trực (work shift)** | Toàn quyền | Phạm vi | – | Phạm vi (chỉ ca của mình) |
| **Check-in / check-out ca trực** | – | – | – | ✓ (chính ca của mình) |
| **Lô hàng (batches) — nhập/xuất** | Toàn quyền | Phạm vi (thao tác cơ bản) | – | Phạm vi + Ca trực |
| **Vòng đời kỹ thuật thiết bị** (provision, claim, bảo trì, khoá, decommission, kênh relay/actuator) | Toàn quyền, mọi warehouse | Chỉ xem (Phạm vi) | Toàn quyền (Phạm vi) | – |
| **Trạng thái & thông tin thiết bị** | Toàn quyền | Phạm vi | Phạm vi | Cơ bản (Phạm vi + Ca trực) |
| **Log chi tiết thiết bị** (lịch sử trạng thái, telemetry theo giờ và tức thời) | Toàn quyền | Phạm vi (log chi tiết cho kho) | Phạm vi (log chi tiết cho device) | – (chỉ có cảnh báo cơ bản) |
| **Cảnh báo (alerts) — xem** | Toàn quyền | Phạm vi (chi tiết) | Phạm vi (chi tiết) | Cơ bản (Phạm vi + Ca trực) |
| **Cảnh báo — acknowledge** | Toàn quyền | Phạm vi | Phạm vi | Phạm vi + Ca trực |
| **Cảnh báo — resolve** | Toàn quyền | Phạm vi | Phạm vi | – |
| **Điều khiển thiết bị (commands)** | Toàn quyền, mọi lệnh | Chỉ xem lịch sử (Phạm vi) | Phạm vi (điều khiển chủ động, toàn bộ tập lệnh) | Cơ bản (Phạm vi + Ca trực, tập lệnh an toàn giới hạn) |
| **Audit log** (chỉ xem — log do hệ thống tự ghi, không ai ghi/sửa/xoá qua API) | Chỉ xem (toàn hệ thống) | Chỉ xem (Phạm vi — warehouse mình là Manager) | – | – |
| **Thông báo (notifications)** | Tự thân | Tự thân | Tự thân | Tự thân |
