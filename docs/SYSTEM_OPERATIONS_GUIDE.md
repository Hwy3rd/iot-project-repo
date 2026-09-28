# HƯỚNG DẪN VẬN HÀNH HỆ THỐNG GIÁM SÁT KHO LẠNH (SYSTEM OPERATIONS GUIDE)

Tài liệu hướng dẫn thao tác chuẩn cho Quản lý kho (Manager) và Nhân viên ca trực (Staff).

---

## 1. Quy trình Ca trực và Điểm danh (Work Shift & Attendance)

1. **Xem lịch ca trực:**
   - Nhân viên truy cập mục **Ca trực** để xem các ca trực được Quản lý phân công trong tuần.
   - Mỗi ca trực có thời gian bắt đầu, thời gian kết thúc và Kho trực được chỉ định.

2. **Quy trình Check-in ca trực:**
   - Khi đến kho làm việc, nhân viên mở hệ thống và bấm nút **"Check-in"**.
   - Thời gian check-in hợp lệ: Trong khoảng 15 phút trước giờ bắt đầu ca trực cho đến khi ca kết thúc.
   - Nếu check-in muộn hơn giờ bắt đầu ca trực, hệ thống sẽ tự động tính số phút đi muộn (Lateness) và ghi nhận vào lịch sử ca.
   - **Lưu ý:** Chỉ sau khi Check-in thành công, nhân viên mới có quyền thao tác trên các Lô hàng và Cảnh báo của kho đó.

3. **Quy trình Check-out:**
   - Kết thúc ca làm việc, nhân viên bấm **"Check-out"**.
   - Hệ thống tự động khóa quyền thao tác của nhân viên tại kho cho đến ca trực tiếp theo.

---

## 2. Quy trình Giám sát Trực tiếp & Phân tích Biểu đồ (Monitoring)

1. **Bộ chọn kho (Warehouse Switcher):**
   - Trên thanh tiêu đề (Header), nhấp vào bộ chọn kho để chọn cơ sở kho lạnh cần theo dõi (ví dụ: *Kho lạnh Sơn Trà*, *Kho lạnh Hải Phòng*, *Kho lạnh Biên Hoà*).
   - Màn hình sẽ lọc và hiển thị tất cả các phòng lạnh thuộc kho đó.

2. **Đọc hiểu Biểu đồ Nhiệt độ & Dự báo AI:**
   - Nhấp vào thẻ của một phòng lạnh để mở ngăn kéo chi tiết (*Room Detail Sheet*).
   - **Đường nét liền:** Nhiệt độ đo thực tế trung bình trong từng khoảng 5 phút.
   - **Dải nhạt phía sau:** Biên độ nhiệt độ thấp nhất và cao nhất trong chu kỳ đo.
   - **Đường nét đứt (+15 phút):** Dự báo xu hướng nhiệt độ trong 15 phút tới từ mô hình Trí tuệ nhân tạo (AI).
     - Màu tím AI: Nhiệt độ dự báo an toàn trong ngưỡng.
     - Màu cam/đỏ: AI cảnh báo nguy cơ vượt ngưỡng trần hoặc tụt dưới ngưỡng sàn.
   - **Thẻ Banner AI:** Nằm trên đầu biểu đồ, cung cấp tóm tắt nhanh tình trạng rủi ro và khuyến nghị hành động tức thì.

---

## 3. Quy trình Xử lý Cảnh báo (Alert Handling SOP)

Khi nhận được cảnh báo (qua giao diện web, còi hú, hoặc push notification):

1. **Bước 1 — Tiếp nhận và Xác nhận (Acknowledge):**
   - Nhân viên trực ca vào mục **Cảnh báo (Alerts)**.
   - Bấm nút **"Xác nhận (Acknowledge)"** trên cảnh báo tương ứng. Thao tác này thông báo cho toàn bộ đội ngũ rằng đã có người tiếp nhận xử lý, tránh xử lý trùng.
2. **Bước 2 — Kiểm tra thực tế tại hiện trường:**
   - Đối với cảnh báo `DOOR_AJAR`: Đến kiểm tra cửa buồng lạnh, đóng chặt cửa và kiểm tra gioăng cao su cách nhiệt.
   - Đối với cảnh báo `OVERHEAT`: Kiểm tra quạt đối lưu, dàn bay hơi có bị đóng tuyết dày không, kiểm tra đèn báo máy nén lạnh.
   - Đối với cảnh báo `SENSOR_FAULT` hoặc `OFFLINE`: Kiểm tra nguồn điện cấp cho bộ điều khiển ESP32, kiểm tra dây tín hiệu cảm biến DS18B20/DHT22.
3. **Bước 3 — Theo dõi và Tự động hoàn tất:**
   - Sau khi khắc phục sự cố tại hiện trường, hệ thống sẽ tự động đo đạc lại. Khi thông số trở về trạng thái an toàn, cảnh báo sẽ **Tự động đóng (Auto-resolved)** mà không cần đóng thủ công.
