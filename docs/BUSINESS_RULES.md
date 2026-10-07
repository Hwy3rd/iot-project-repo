# Quy tắc nghiệp vụ

> Các quy tắc hệ thống áp dụng khi giám sát kho lạnh và điều khiển thiết bị. Tài liệu viết cho người vận hành (Admin, Quản lý, Kỹ thuật viên, Nhân viên) và là nguồn tra cứu của trợ lý ảo. Hiện mới gồm phần giám sát, kênh thiết bị và lệnh điều khiển.

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

Hệ thống dự báo nhiệt độ của phòng sau **15 phút** và cho biết có nguy cơ vượt ngưỡng hay không, kèm mức rủi ro và khuyến nghị. Dự báo chỉ áp dụng cho phòng có ngưỡng nằm trong khoảng 0 – 15 °C (kho mát); kho đông chưa có dự báo. Dự báo chỉ hiện nếu được tạo trong 15 phút gần đây. Đây là ước lượng, không phải số đo thật.

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
