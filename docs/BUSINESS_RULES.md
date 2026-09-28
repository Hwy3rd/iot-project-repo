# QUY TẮC NGHIỆP VỤ HỆ THỐNG GIÁM SÁT KHO LẠNH (BUSINESS RULES)

Tài liệu quy định các quy tắc nghiệp vụ cốt lõi của hệ thống giám sát và quản lý chuỗi lạnh. Mọi người dùng và trợ lý ảo AI phải tuân thủ nghiêm ngặt các quy tắc này.

---

## 1. Phân quyền và Phạm vi truy cập (RBAC & Data Scoping)

Hệ thống có 3 vai trò người dùng chính:

1. **Quản trị viên (Admin):**
   - Phạm vi toàn hệ thống.
   - Quyền hạn: Quản lý người dùng (tạo/khóa tài khoản, gán vai trò), quản lý danh mục Loại sản phẩm (Product Type), đăng ký phần cứng thiết bị mới, xem nhật ký kiểm toán (Audit Log), decommission thiết bị.

2. **Quản lý kho (Manager):**
   - Phạm vi giới hạn trong các Kho (Warehouse) được phân công (`warehouse_assignments`).
   - Quyền hạn: Cấu hình ngưỡng nhiệt độ phòng lạnh ($T_{\min}, T_{\max}$), xếp lịch ca trực cho nhân viên, xem báo cáo tổng hợp, theo dõi tồn kho và cảnh báo.

3. **Nhân viên kho (Staff):**
   - Phạm vi giới hạn trong Kho được phân công VÀ **chỉ khi đang trong ca trực đã Check-in**.
   - Quyền hạn: Xem trạng thái thiết bị, theo dõi nhiệt độ phòng lạnh, ghi nhận nhập/xuất lô hàng (Batch), xác nhận (Acknowledge) cảnh báo.
   - **Quy tắc bắt buộc:** Nhân viên chưa Check-in hoặc đã Check-out khỏi ca trực KHÔNG THỂ thực hiện các thao tác nghiệp vụ (hệ thống sẽ từ chối với lỗi 403 Forbidden).

---

## 2. Quy tắc Lưu trữ Lô hàng & Phòng lạnh (Batch & Cold Room Compatibility)

1. **Khớp dải nhiệt độ bảo quản:**
   - Mỗi Loại sản phẩm (Product Type) có dải nhiệt độ khuyến nghị bảo quản: $[T_{\text{recommended\_min}}, T_{\text{recommended\_max}}]$.
   - Mỗi Phòng lạnh (Cold Room) có dải nhiệt độ vận hành an toàn: $[T_{\min}, T_{\max}]$.
   - **Điều kiện tạo/nhập lô hàng:** Lô hàng CHỈ được phép nhập vào phòng lạnh nếu dải nhiệt độ của phòng lạnh nằm hoàn toàn trong hoặc khớp với dải nhiệt độ khuyến nghị của loại sản phẩm:
     $$T_{\text{recommended\_min}} \le T_{\min} \quad \text{và} \quad T_{\max} \le T_{\text{recommended\_max}}$$
   - **Xử lý vi phạm:** Nếu người dùng cố gắng xếp lô hàng vào phòng lạnh có ngưỡng không tương thích, hệ thống sẽ từ chối tạo lô hàng (HTTP 400 Bad Request) kèm thông báo lỗi rõ ràng.

2. **Quản lý Hạn sử dụng (Expiry Date):**
   - Mỗi lô hàng khi nhập kho bắt buộc phải có ngày hết hạn (`expiryDate`).
   - Lô hàng có ngày hết hạn trong quá khứ hoặc trong vòng 48 giờ sẽ bị cảnh báo hoặc từ chối nhập kho tùy chính sách kho.
   - Hệ thống tự động quét và cảnh báo các lô hàng sắp hết hạn (Expiring Batches).

---

## 3. Hệ thống Cảnh báo và Quy tắc Chống trùng lặp (Alerts & Deduplication)

Hệ thống định nghĩa chính xác **8 loại Cảnh báo (Alert Types)**:

| Loại Cảnh báo | Mã định danh | Mức độ | Điều kiện kích hoạt |
|:---|:---|:---:|:---|
| **Quá nhiệt** | `OVERHEAT` | HIGH / CRITICAL | Nhiệt độ đo được vượt ngưỡng trần của phòng ($T > T_{\max}$). |
| **Quá lạnh / Đóng băng** | `OVERCOOL` | MEDIUM / HIGH | Nhiệt độ đo được tụt dưới ngưỡng sàn của phòng ($T < T_{\min}$). |
| **Quá nhiệt kéo dài** | `PROLONGED_OVERHEAT` | CRITICAL | Trạng thái quá nhiệt duy trì liên tục trên 30 phút mà chưa hạ nhiệt. |
| **Cửa mở quá lâu** | `DOOR_AJAR` | MEDIUM / HIGH | Cửa phòng lạnh duy trì trạng thái MỞ liên tục quá 5 phút. |
| **Lỗi cảm biến** | `SENSOR_FAULT` | HIGH | Cảm biến báo cờ lỗi phần cứng, đứt cáp, hoặc dữ liệu đo bất thường. |
| **Mất kết nối** | `OFFLINE` | HIGH | Thiết bị không gửi bản tin telemetry / heartbeat trong quá 15 phút. |
| **Mất nguồn điện** | `POWER_OUTAGE` | CRITICAL | Thiết bị hoặc cảm biến điện áp báo mất nguồn điện lưới trạm. |
| **Pin yếu** | `BATTERY_LOW` | LOW / MEDIUM | Pin dự phòng của trạm đo tụt dưới mức an toàn (< 20%). |

**Quy tắc Chống trùng lặp & Tự động đóng cảnh báo (Alert Deduplication & Auto-resolve):**
- Trong khi một cảnh báo cho thiết bị/phòng đang ở trạng thái `ACTIVE` (đang mở), các bản tin vi phạm tiếp theo cùng loại sẽ được gộp vào cảnh báo hiện tại, KHÔNG tạo thêm bản ghi cảnh báo mới.
- Khi điều kiện trở lại bình thường (ví dụ: nhiệt độ trở lại dải $[T_{\min}, T_{\max}]$ liên tục trong 3 chu kỳ đo, hoặc cửa đã đóng), hệ thống sẽ **Tự động đóng cảnh báo (Auto-resolve)** và ghi nhận thời gian kết thúc.
- Nhân viên trong ca trực có thể nhấn **Xác nhận (Acknowledge)** để báo hiệu đang xử lý sự cố.

---

## 4. Vòng đời Thiết bị & Cơ chế Ghép nối (Device Lifecycle & Claim Code)

1. **Các trạng thái của thiết bị:**
   - `REGISTERED`: Thiết bị mới khai báo mã phần cứng (Unique ID / MAC), chưa nạp firmware cấu hình.
   - `PROVISIONED`: Đã tạo mã định danh và sẵn sàng để nhân viên kỹ thuật lắp đặt.
   - `ACTIVE`: Thiết bị đã được gán (claim) vào một phòng lạnh cụ thể và đang gửi dữ liệu telemetry định kỳ.
   - `OFFLINE`: Mất kết nối mạng quá thời gian timeout.
   - `FAULT`: Báo lỗi phần cứng hoặc cảm biến hỏng.
   - `MAINTENANCE`: Đang trong chế độ bảo trì, tạm dừng kích hoạt cảnh báo giả.
   - `DECOMMISSIONED`: Thiết bị ngừng sử dụng vĩnh viễn (thu hồi / thanh lý).

2. **Cơ chế ghép nối qua Claim Code:**
   - Để tránh việc gán nhầm thiết bị vào phòng lạnh, kỹ thuật viên hoặc quản lý phải tạo **Claim Code** (mã 6 ký tự ngẫu nhiên).
   - Mã Claim Code có hiệu lực trong vòng **15 phút**.
   - Khi nhập đúng Claim Code và ID phòng lạnh, thiết bị mới chính thức chuyển sang trạng thái `ACTIVE`.
