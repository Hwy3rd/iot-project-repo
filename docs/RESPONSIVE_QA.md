# Kiểm tra responsive frontend

Ngày kiểm tra: 30/09/2026.

## Môi trường và phạm vi

- Vite local, backend Docker; đăng nhập bằng tài khoản local.
- Microsoft Edge headless qua Playwright, có mô phỏng cảm ứng và mobile viewport.
- Dữ liệu dài, danh sách nhiều trang, telemetry và lỗi API được giả lập trong trình duyệt. Không tạo/xóa dữ liệu nghiệp vụ thật để kiểm tra giao diện.
- Đây là kiểm tra trên trình duyệt mô phỏng, chưa phải xác nhận trên iPhone/Android thật hoặc Safari. Thay đổi chiều cao viewport mô phỏng vùng hiển thị thấp, không thay thế kiểm tra bàn phím ảo thật.

## Các lỗi đã sửa trong lần rà soát bổ sung

1. Mã thiết bị dài làm thẻ giám sát và toàn trang tràn ngang; sửa khả năng co của grid, thẻ và tên thiết bị.
2. Panel cảnh báo ép thẻ phòng quá hẹp trên tablet; chỉ đặt cạnh nhau khi đủ rộng, lưới phòng tự chia theo chiều rộng vùng nội dung.
3. Sidebar chiếm quá nhiều chỗ trên tablet; dùng drawer dưới 1024 px.
4. Chatbot chia hai khung quá sớm; dưới 1280 px chuyển qua lại giữa danh sách và cuộc trò chuyện. Chiều cao chat theo chiều cao thực của header.
5. Lịch ngày bị cắt trên màn hình nhỏ/thấp; popup giới hạn theo vùng hiển thị, cuộn được, bảy cột ngày vừa chiều ngang.
6. Nút mở/đóng dialog bị bỏ sót vùng bấm cảm ứng do Radix thay `data-slot`; mở rộng selector và giữ kích thước riêng cho lịch.
7. Khung chi tiết phòng chỉ chiếm 75% điện thoại; sửa biến thể `data-side` để dùng đủ chiều rộng.

## Kết quả kiểm tra

| Nhóm | Phạm vi | Kết quả |
| --- | --- | --- |
| Các trang có dữ liệu dài | 320×568, 768×1024, 1024×768, 844×390 | Không tràn trang hoặc khung nội dung được đo |
| Trang | Tổng quan, người dùng, kho, giám sát, ca trực, hồ sơ, chatbot, cảnh báo, thiết bị, lệnh, phòng lạnh, chi tiết phòng, loại sản phẩm, mẫu ca, thông báo, lô hàng, nhật ký | Đã mở và kiểm tra bố cục |
| Form tạo mới / bộ lọc hiện có | Người dùng, kho, phòng lạnh, loại sản phẩm, lô hàng, thiết bị, mẫu ca, ca trực, cảnh báo, nhật ký; 320×568 và 844×390 | Khung dialog nằm trong viewport, nội dung dài cuộn được; không gửi form tạo dữ liệu |
| Lịch và ô nhập chat | 320×568, 390×360, 844×390 | Đủ cột lịch, cuộn tới tuần cuối; ô nhập chat nằm trong vùng hiển thị |
| Biểu đồ nhiệt độ và bảng | 320×568, 768×1024, 1440×900 | Hiển thị telemetry giả lập, chuyển biểu đồ/bảng được; sheet không tràn |
| Điều hướng | Drawer điện thoại/tablet, chọn trang và đóng drawer | Hoạt động |
| Bảng người dùng | Cuộn ngang tới thao tác ở cuối bảng, mở chi tiết | Hoạt động |
| Trạng thái dữ liệu | Đang tải, rỗng, HTTP 503, bấm thử lại tại 320 px | Hiển thị và phục hồi được |
| Khả năng đọc | Dark mode 390 px, chữ 200% trên tổng quan 390 px, đăng nhập 320 px | Đã kiểm tra; không tràn trang |
| Kiểm tra mã | `corepack pnpm build`, `corepack pnpm lint` trong `frontend` | Đạt; build vẫn cảnh báo bundle JS lớn |

## Cách kiểm tra lại thủ công

1. Mở frontend, dùng DevTools đổi kích thước trong bảng trên, bật mô phỏng cảm ứng.
2. Kiểm tra với tên kho/phòng dài và mã thiết bị không có dấu cách. Cuộn ngang chỉ diễn ra trong bảng, không kéo rộng cả trang.
3. Mở form dài, cuộn tới nút cuối, mở lịch ở gần mép dưới và chọn ngày trong tuần cuối. Xoay màn hình khi dialog đang mở.
4. Trên tablet, mở menu rồi chọn trang. Trong chatbot, tạo cuộc trò chuyện mới và quay lại danh sách; kiểm tra ô nhập khi giảm chiều cao màn hình.
5. Kiểm tra thêm trên thiết bị thật: Safari iOS, Chrome Android, bàn phím ảo, vùng tai thỏ và thanh điều hướng hệ thống. Dùng đúng địa chỉ triển khai và cấu hình cookie/HTTPS của môi trường đó.
