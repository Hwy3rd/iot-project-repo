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

- **"đã thực hiện"**: thiết bị đã xác nhận lệnh tắt; nếu còi vẫn kêu ngay, cần kiểm tra phần cứng và dữ liệu thực tế. Nếu còi kêu lại sau một lúc, đó là chế độ tự động: lệnh chỉ ghi đè trong 10 phút; hết thời gian mà sự cố vẫn còn (cửa vẫn mở, nhiệt độ quá cao, nguồn quạt bất thường) thì còi kêu lại. Hãy xử lý nguyên nhân (đóng cửa), hoặc gửi lại lệnh Tắt.
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

## Lô hàng bị từ chối khi tạo

Kiểm tra phòng có thuộc kho được phép thao tác không, dải nhiệt độ phòng có nằm hoàn toàn trong dải bảo quản của loại sản phẩm không, và ngày hết hạn có sau ngày nhận không. Nếu là Nhân viên, kiểm tra ca đã được duyệt và chưa check-out. Không có chính sách chung từ chối mọi lô còn dưới 48 giờ hạn dùng. Ví dụ lỗi cấu hình: chọn phòng cấp đông cho loại sản phẩm được cấu hình bảo quản 0–4 °C.

## Nhân viên không xác nhận cảnh báo hoặc nhập hàng được

Kiểm tra đang chọn đúng kho được phân công, đã gửi check-in và đã được Quản lý duyệt, ca đã bắt đầu và chưa kết thúc quá 5 phút, chưa check-out. Chỉ check-in rồi chờ duyệt chưa có quyền thao tác. Nếu vẫn bị từ chối, nhờ Quản lý kiểm tra phân công kho và trạng thái ca; không dùng tài khoản người khác để bỏ qua phân quyền.

## Không thấy dự báo AI

Kiểm tra thiết bị có số đo mới, đủ lịch sử khoảng 60 phút theo bước lấy mẫu 5 phút, nhiệt độ và ngưỡng nằm trong dải mô hình hỗ trợ. Dự báo hiện tại là hai mốc 5 và 10 phút, hết hiệu lực sau 5 phút không cập nhật. Dịch vụ AI có thể chưa sẵn sàng; phần đo đạc và cảnh báo nhiệt độ thật vẫn phải kiểm tra độc lập. Không tự coi thiếu dự báo là an toàn.

## Thiết bị ở mạng Wi-Fi khác không gửi dữ liệu

ESP32 cần Wi-Fi 2,4 GHz có Internet và kết nối được máy chủ MQTT. Địa chỉ IP LAN riêng của máy chủ chỉ truy cập được trong mạng được định tuyến tới nó; đổi Wi-Fi sẽ không tự biến địa chỉ đó thành địa chỉ công khai. Với kết nối qua Tunnel, thiết bị dùng địa chỉ WSS công khai đã cấu hình; tài khoản, mã thiết bị và quyền gửi/nhận theo topic phải khớp. Backend cũng cần nối cùng broker. Người vận hành kiểm tra nguồn, Wi-Fi và trạng thái thiết bị; nhờ người quản trị kiểm tra kết nối MQTT. Không chia sẻ mật khẩu trong hội thoại.
