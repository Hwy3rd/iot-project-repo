# Quy tắc nghiệp vụ

> Các quy tắc hệ thống áp dụng khi giám sát kho lạnh và điều khiển thiết bị. Tài liệu viết cho người vận hành (Admin, Quản lý, Kỹ thuật viên, Nhân viên) và là nguồn tra cứu của trợ lý ảo. Gồm giám sát, dự báo, phân quyền, lô hàng, thiết bị và điều khiển.

---

## Trạng thái nhiệt độ của phòng lạnh

Mỗi phòng có một trạng thái, tính từ số đo mới nhất của thiết bị trong phòng:

- **Bình thường**: nhiệt độ nằm trong ngưỡng sàn – trần của phòng.
- **Vượt ngưỡng**: nhiệt độ cao hơn trần hoặc thấp hơn sàn.
- **Lỗi cảm biến**: thiết bị gửi số đo nhưng không đọc được nhiệt độ.
- **Mất tín hiệu**: hơn 10 phút không nhận được số đo nào.
- **Chưa có dữ liệu**: phòng chưa từng nhận được số đo.

Ngưỡng sàn và trần được cài cho từng phòng.

## Số liệu cũ khi phòng mất tín hiệu

Khi phòng ở trạng thái **Mất tín hiệu**, các số liệu (nhiệt độ, cửa, quạt, còi) vẫn hiển thị nhưng bị làm mờ, kèm dòng cho biết số liệu có từ bao lâu trước. Không nên dựa vào số liệu này để ra quyết định, vì tình trạng thật của phòng có thể đã khác. Phần điều khiển cũng không hiển thị trạng thái quạt hay còi trong lúc này.

## Dự báo nhiệt độ bằng AI

Hệ thống dự báo nhiệt độ tại hai mốc **sau 5 phút và sau 10 phút**, tính từ số đo đầu vào gần nhất. Cần đủ lịch sử 60 phút, lấy mẫu theo bước 5 phút; dải nhiệt độ mô hình hỗ trợ là khoảng −28 đến 19,6 °C. Dự báo hết hiệu lực sau 5 phút nếu không có bản cập nhật. Đây là ước lượng tại hai mốc rời rạc, không bảo đảm phát hiện mọi lần vượt ngưỡng giữa hai mốc.

Khi một mốc dự báo vượt sàn hoặc trần, hệ thống có thể tạo cảnh báo sớm **temperature_predicted** để nhân viên tiếp nhận và kiểm tra. AI không tự bật/tắt quạt hoặc còi. Cảnh báo nhiệt độ thực tế **temperature_out_of_range** là một loại riêng, chỉ dựa trên số đo thật.

## Kênh của thiết bị

Mỗi thiết bị gồm nhiều **kênh**, mỗi kênh là một bộ phận gắn trên thiết bị:

- **Kênh cảm biến (chỉ đọc)**: cảm biến nhiệt ẩm, công tắc cửa, cảm biến dòng (nguồn quạt).
- **Kênh điều khiển (nhận lệnh)**: quạt, còi, đèn báo.

Chỉ kênh điều khiển mới nhận được lệnh bật/tắt. Kênh cảm biến dùng để biết thiết bị có những bộ phận nào, từ đó quyết định chỉ số nào được hiển thị.

## Kênh mặc định khi kích hoạt thiết bị

Khi một thiết bị được kích hoạt (claim) vào phòng lạnh, hệ thống tự khai báo 5 kênh của board chuẩn: Cảm biến nhiệt ẩm, Công tắc cửa, Nguồn quạt, Quạt làm lạnh, Còi báo động. Nếu board được lắp khác, Admin hoặc Kỹ thuật viên sửa tên hoặc xoá kênh sau. Thiết bị kích hoạt từ trước khi có quy tắc này có thể bổ sung bằng nút **Thêm kênh mặc định**.

## Chỉ số nào được hiển thị

Nhiệt độ và trạng thái cửa luôn hiển thị. Các chỉ số còn lại chỉ hiển thị khi thiết bị có khai báo kênh tương ứng:

- Độ ẩm: kênh Cảm biến nhiệt ẩm.
- Quạt đang chạy hay tắt: kênh Quạt.
- Điện áp quạt, quạt mất nguồn: kênh Cảm biến dòng (nguồn quạt).
- Còi đang kêu: kênh Còi.

Thiết bị chưa khai báo kênh nào thì hiển thị mọi số liệu nó gửi lên.

## Cảnh báo thiếu dữ liệu

Nếu thiết bị đã khai báo một kênh nhưng không gửi số liệu của kênh đó, hệ thống hiện cảnh báo **"Thiếu dữ liệu …"** (ví dụ thiếu độ ẩm, trạng thái quạt, còi) thay vì để trống. Nguyên nhân thường gặp là thiết bị chạy firmware cũ, hoặc cảm biến hỏng hay chưa được nối dây.

## Ai được gửi lệnh điều khiển

- **Admin**: gửi lệnh tới mọi thiết bị.
- **Kỹ thuật viên**: gửi lệnh tới thiết bị ở các kho được phân công.
- **Nhân viên**: gửi lệnh tới thiết bị ở kho được phân công, **chỉ khi đang trong ca trực đã được duyệt**.
- **Quản lý**: chỉ xem lịch sử lệnh, không gửi lệnh.

Mọi lệnh được lưu vĩnh viễn kèm người gửi và không xoá được.

## Thời hạn của một lệnh

Mỗi lệnh có hiệu lực trong **60 giây** kể từ lúc gửi. Nếu thiết bị chưa xác nhận, hệ thống tự gửi lại mỗi 10 giây, tối đa 5 lần. Quá 60 giây mà thiết bị vẫn chưa xác nhận thì lệnh chuyển **Hết hạn** và không được gửi nữa. Thiết bị cũng từ chối lệnh đã quá hạn, để không bật hoặc tắt muộn. Gửi lại nhiều lần không làm lệnh chạy hai lần: thiết bị nhận ra lệnh đã thực hiện và chỉ xác nhận lại.

## Trạng thái của lệnh

- **Chờ gửi**: lệnh đã tạo nhưng chưa tới được máy chủ trung chuyển; hệ thống tự gửi lại.
- **Đã gửi**: đã gửi tới thiết bị, đang chờ thiết bị xác nhận.
- **Thành công**: thiết bị đã thực hiện.
- **Thất bại**: thiết bị từ chối, kèm lý do.
- **Hết hạn**: thiết bị không xác nhận trong 60 giây.
- **Bị thay thế**: có lệnh mới hơn cho cùng kênh trước khi lệnh này xong.

## Lệnh mới thay lệnh cũ

Gửi lệnh mới cho một kênh trong lúc lệnh trước của kênh đó còn **Chờ gửi** hoặc **Đã gửi** thì lệnh trước chuyển **Bị thay thế** và không được gửi nữa. Thiết bị luôn thực hiện theo ý định mới nhất.

## Lệnh thủ công và chế độ tự động

Thiết bị có chế độ tự động: quạt luôn chạy, cửa đóng hay mở không ảnh hưởng tới quạt; còi kêu khi cửa mở quá thời gian cho phép của phòng, khi nhiệt độ ra ngoài ngưỡng của phòng, hoặc khi nguồn quạt bất thường. Lệnh thủ công **ghi đè chế độ tự động của kênh đó trong 10 phút**. Hết 10 phút, thiết bị tự quay lại chế độ tự động. Vì vậy nếu sự cố vẫn còn (ví dụ cửa vẫn mở) thì còi sẽ kêu lại.

## Phân quyền theo kho và ca trực

Hệ thống có bốn vai trò. **Admin** quản lý toàn hệ thống. **Quản lý (Manager)** quản lý phòng, ngưỡng nhiệt độ, lô hàng, ca trực và cảnh báo trong các kho được phân công; Quản lý không gửi lệnh quạt/còi. **Kỹ thuật viên (Technician)** phụ trách thiết bị, kênh, ghép nối, bảo trì và lệnh điều khiển tại kho được giao; không cần ca trực. **Nhân viên (Staff)** được xem tổng quan, phòng, biểu đồ, lô hàng và cảnh báo tại kho được phân công; xem chi tiết thiết bị và một số dữ liệu kỹ thuật còn tùy quyền của chức năng.

Nhân viên chỉ được tạo/sửa lô hàng, xác nhận cảnh báo hoặc gửi lệnh khi có ca được duyệt, đã check-in, chưa check-out và đang trong thời gian ca (cộng 5 phút sau giờ kết thúc). Gửi yêu cầu check-in chưa đủ: cần Quản lý duyệt. Ra ngoài kho được phân công vẫn bị từ chối dù đang trong ca.

## Lô hàng và dải nhiệt độ bảo quản

Dải vận hành của phòng phải nằm hoàn toàn trong dải bảo quản của loại sản phẩm: nhiệt độ tối thiểu của phòng không nhỏ hơn mức tối thiểu sản phẩm; nhiệt độ tối đa của phòng không lớn hơn mức tối đa sản phẩm. Không thỏa điều kiện thì hệ thống từ chối tạo hoặc đổi lô hàng. Ví dụ minh họa: sản phẩm cấu hình 0–4 °C không được xếp vào phòng −22 đến −18 °C. Đây là ví dụ kiểm tra cấu hình, không phải hướng dẫn an toàn cho một loại thực phẩm cụ thể.

Lô hàng phải có ngày nhận và ngày hết hạn; ngày hết hạn phải sau ngày nhận. Không có quy tắc chung từ chối mọi lô còn dưới 48 giờ. Có thể lọc lô sắp hết hạn trong danh sách; không mặc định việc lọc này đồng nghĩa đã phát thông báo tự động.

## Danh mục cảnh báo và phạm vi đang triển khai

Danh mục hiện có bảy mã: **temperature_out_of_range**, **temperature_predicted**, **device_fault**, **offline**, **door_open_too_long**, **batch_temperature_out_of_range**, **batch_expiring_soon**. Không có các loại riêng tên PROLONGED_OVERHEAT, BATTERY_LOW, POWER_OUTAGE, OVERCOOL hay DOOR_AJAR; nóng quá và lạnh quá cùng thuộc temperature_out_of_range.

Trong luồng thu nhận dữ liệu hiện tại, hệ thống tạo cảnh báo nhiệt độ thật, dự báo AI và lỗi nguồn quạt (device_fault). Một số mã khác mới có trong danh mục, chưa có đầy đủ luồng tự phát sinh cảnh báo phía máy chủ. Cửa mở quá lâu có thể kích còi trên thiết bị theo ngưỡng thời gian của phòng; không có quy tắc cố định 5 phút cho mọi phòng. Không cam kết mọi lỗi cảm biến hoặc mọi lần mất mạng sẽ tự tạo thông báo backend.

## Vòng đời và chống trùng cảnh báo

Cảnh báo có ba trạng thái: **open** (đang mở), **acknowledged** (đã tiếp nhận), **resolved** (đã xử lý xong). Tiếp nhận không có nghĩa sự cố đã hết. Vi phạm lặp lại cùng loại trên cùng thiết bị/lô hàng được cập nhật vào cảnh báo đang hoạt động, không tạo bản mới mỗi bản tin.

Nhiệt độ thực tế chỉ tự đóng cảnh báo khi trở vào khoảng an toàn có tính hysteresis: từ sàn cộng độ trễ đến trần trừ độ trễ. Cảnh báo dự báo chỉ tự đóng khi cả hai mốc 5 và 10 phút trở vào khoảng này. Không có quy tắc chung phải đủ ba mẫu an toàn. Dữ liệu lỗi hoặc thiếu không chứng minh đã hồi phục. Hệ thống không chia toàn bộ cảnh báo thành các cấp HIGH/MEDIUM/CRITICAL; mức WARNING của dự báo là thông tin AI riêng.

## Vòng đời thiết bị và Claim Code

Các trạng thái gồm **registered**, **provisioned**, **active**, **offline**, **fault**, **maintenance**, **decommissioned**. Trạng thái là thông tin quản lý thiết bị; khi cần biết thiết bị nào đang ở trạng thái nào phải tra dữ liệu hiện tại.

Claim Code là mã ghép nối **6 chữ số**, có hiệu lực **15 phút**, dùng để gán thiết bị vào phòng lạnh. Admin đăng ký phần cứng mới; Admin hoặc Kỹ thuật viên có quyền trong kho thực hiện các thao tác kỹ thuật, ghép nối hoặc ngừng sử dụng (decommission). Thiết bị chưa thuộc kho cần Admin tạo mã; Kỹ thuật viên không được tùy ý thao tác thiết bị ngoài phạm vi. Quản lý không có quyền kỹ thuật này. Xóa hẳn thiết bị là quyền Admin, khác với decommission.

## Phạm vi của chatbot

Chatbot hỗ trợ tra cứu và hướng dẫn; không tự nhập/xuất hàng, xác nhận cảnh báo, bật quạt hoặc tắt còi. Dữ liệu từng kho được kiểm tra theo người đang đăng nhập. Tài liệu hướng dẫn dùng chung không mở rộng quyền xem kho của bất kỳ tài khoản nào.
