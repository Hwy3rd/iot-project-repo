# Khắc phục sự cố

> Các sự cố thường gặp khi giám sát và điều khiển thiết bị: dấu hiệu, nguyên nhân và cách xử lý. Tài liệu viết cho người vận hành (Admin, Quản lý, Kỹ thuật viên, Nhân viên) và là nguồn tra cứu của trợ lý ảo. Bước nào cần quyền quản trị máy chủ thì có ghi "(Admin)".

---

## Lệnh điều khiển bị "Hết hạn"

**Dấu hiệu:** lệnh hiện "hết hạn, thiết bị không phản hồi"; hệ thống đã gửi nhiều lần (xem số lần gửi trong chi tiết lệnh).

**Nguyên nhân:** thiết bị không xác nhận trong 60 giây: mất điện, mất WiFi, hoặc firmware cũ chưa hỗ trợ nhận lệnh.

**Cách xử lý:**

1. Xem thiết bị có đang gửi số liệu không (phòng có bị "Mất tín hiệu" không).
2. Nếu số liệu vẫn về mà lệnh vẫn hết hạn, cập nhật firmware của thiết bị lên bản 1.2 trở lên.
3. (Admin) Nếu mọi thiết bị đều hết hạn lệnh, kiểm tra máy chủ trung chuyển tin nhắn (MQTT) đã được khởi động lại sau lần cập nhật cấu hình gần nhất chưa.

## Đã tắt còi nhưng còi vẫn kêu

Xem kết quả lệnh "Tắt" dưới tên kênh Còi:

- **"đã thực hiện"**: còi đã tắt. Nếu còi kêu lại sau một lúc, đó là chế độ tự động: lệnh chỉ ghi đè trong 10 phút; hết thời gian mà sự cố vẫn còn (cửa vẫn mở, nhiệt độ quá cao, nguồn quạt bất thường) thì còi kêu lại. Hãy xử lý nguyên nhân (đóng cửa), hoặc gửi lại lệnh Tắt.
- **"hết hạn"**: lệnh chưa tới được thiết bị, xem mục "Lệnh điều khiển bị Hết hạn".
- **"thất bại"**: xem lý do ở mục "Lệnh bị Thất bại".

Kiểm tra thêm: bạn hoặc người khác có vừa gửi lệnh **Bật** còi không (xem màn Lệnh điều khiển).

## Lệnh bị "Thất bại"

Thiết bị nhận được lệnh nhưng từ chối. Lý do hiện ngay dưới tên kênh và trong chi tiết lệnh:

- **Thiết bị không hỗ trợ kênh này**: board không có bộ phận đó (ví dụ Đèn báo trên board chuẩn). Xoá kênh này khỏi thiết bị để tránh gửi nhầm.
- **Thiết bị không hỗ trợ lệnh này**: lệnh không phải Bật hoặc Tắt.
- **Lệnh tới thiết bị khi đã hết hạn**: lệnh đến muộn hơn 60 giây, thường do mạng chập chờn. Gửi lại lệnh.

## Lệnh "Bị thay thế"

Không phải lỗi. Có người đã gửi lệnh mới cho cùng kênh trong lúc lệnh này chưa xong, nên hệ thống bỏ lệnh cũ và thiết bị làm theo lệnh mới nhất. Xem lệnh mới hơn trong màn Lệnh điều khiển.

## Không chọn được kênh khi gửi lệnh

**Dấu hiệu:** ô Kênh trống, hoặc báo "Thiết bị này chỉ có kênh cảm biến"; phần Điều khiển không hiện cho thiết bị.

**Nguyên nhân:** thiết bị chưa có kênh điều khiển (Quạt, Còi, Đèn báo). Kênh cảm biến không nhận được lệnh.

**Cách xử lý:** Admin hoặc Kỹ thuật viên vào Thiết bị → tab **Kênh** → bấm **Thêm kênh mặc định**, hoặc thêm kênh trong nhóm "Điều khiển (nhận lệnh)".

## Nhân viên không thấy nút điều khiển

Nếu hiện dòng "Cần đang trong ca trực tại kho này để điều khiển thiết bị", nhân viên chưa có ca trực được duyệt ở thời điểm hiện tại. Gửi yêu cầu chấm công vào ca và chờ Quản lý duyệt. Quản lý chỉ được xem, không có nút điều khiển.

## Cảnh báo "Thiếu dữ liệu" hoặc "Không có dữ liệu"

**Dấu hiệu:** thẻ phòng hiện "Thiếu dữ liệu độ ẩm, trạng thái quạt, còi"; ô Độ ẩm, Quạt hoặc Còi hiện "Không có dữ liệu".

**Nguyên nhân:** thiết bị có khai báo kênh nhưng không gửi số liệu của kênh đó. Thường do firmware cũ (chỉ gửi nhiệt độ và cửa), hoặc cảm biến hỏng hay lỏng dây.

**Cách xử lý:** cập nhật firmware lên bản mới nhất; kiểm tra dây cảm biến. Nếu board thật sự không có bộ phận đó, xoá kênh tương ứng trong tab Kênh để bỏ cảnh báo.

## Phòng "Mất tín hiệu"

Hơn 10 phút không có số đo từ phòng. Số liệu trên màn hình bị làm mờ vì đã cũ. Kiểm tra nguồn điện và WiFi của thiết bị, sau đó xem thiết bị có còn kết nối không (cột Tín hiệu cuối trong danh sách thiết bị). Phòng tự trở lại bình thường khi có số đo mới.

## Màn hình không cập nhật trạng thái

**Dấu hiệu:** góc trên màn Giám sát trực tiếp hiện **"Đang kết nối lại…"** thay cho trạng thái trực tiếp; số liệu đổi chậm.

**Cách xử lý:** khi mất kết nối trực tiếp, màn hình tự tải lại số liệu mỗi 10 giây nên vẫn dùng được. Nếu tình trạng kéo dài, tải lại trang hoặc đăng nhập lại. Trạng thái quạt và còi đổi ngay khi thiết bị xác nhận lệnh, kể cả lúc đang mất kết nối trực tiếp.
