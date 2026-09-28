# HƯỚNG DẪN XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING GUIDE)

---

## 1. Sự cố Lô hàng bị từ chối khi tạo (Batch Creation Rejected)
* **Triệu chứng:** Khi bấm tạo lô hàng mới, hệ thống báo lỗi HTTP 400 và không cho lưu.
* **Nguyên nhân chính:** Ngưỡng nhiệt độ của phòng lạnh không tương thích với dải nhiệt độ bảo quản khuyến nghị của loại sản phẩm. Ví dụ: Loại sản phẩm là *Thịt bò tươi* (yêu cầu $0^\circ\text{C} - 4^\circ\text{C}$), nhưng người dùng chọn *Phòng cấp đông* (ngưỡng $-22^\circ\text{C} - -18^\circ\text{C}$).
* **Cách khắc phục:** 
  1. Kiểm tra lại thông số nhiệt độ khuyến nghị của sản phẩm trong mục *Loại sản phẩm*.
  2. Chọn phòng lạnh có ngưỡng $[T_{\min}, T_{\max}]$ nằm trong dải khuyến nghị của sản phẩm.

---

## 2. Sự cố Thiết bị báo OFFLINE hoặc Mất kết nối
* **Triệu chứng:** Thẻ thiết bị hiển thị màu xám, trạng thái `OFFLINE`, không có dữ liệu nhiệt độ mới.
* **Nguyên nhân:** Bộ điều khiển ESP32 bị mất nguồn, mất sóng Wi-Fi, hoặc MQTT Broker bị ngắt kết nối.
* **Cách khắc phục:**
  1. Kiểm tra đèn LED nguồn trên bo mạch ESP32.
  2. Kiểm tra bộ phát Wi-Fi của kho bãi.
  3. Kiểm tra container `mosquitto_broker` tại cổng 1883 trên máy chủ.
  4. Nếu thiết bị đã thay thế bo mạch mới, Quản lý kho cần tạo **Claim Code** mới để ghép nối lại.

---

## 3. Sự cố Nhân viên không bấm được Xác nhận cảnh báo hoặc Nhập kho
* **Triệu chứng:** Nút bấm bị vô hiệu hóa hoặc hệ thống báo lỗi 403 Forbidden.
* **Nguyên nhân:** Nhân viên chưa thực hiện Check-in ca trực, hoặc ca trực đã hết giờ, hoặc nhân viên đang thao tác trên kho mà mình không được phân công trực.
* **Cách khắc phục:**
  1. Vào mục *Ca trực* kiểm tra xem đã bấm *Check-in* chưa.
  2. Kiểm tra tài khoản có đúng là tài khoản được xếp lịch ca trực đó không.
