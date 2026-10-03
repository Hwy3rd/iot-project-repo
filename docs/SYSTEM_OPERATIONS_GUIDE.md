# Hướng dẫn vận hành

> Cách dùng hệ thống hằng ngày: giám sát kho lạnh, khai báo kênh thiết bị và gửi lệnh điều khiển. Tài liệu viết cho người vận hành (Admin, Quản lý, Kỹ thuật viên, Nhân viên) và là nguồn tra cứu của trợ lý ảo. Quy tắc phía sau từng thao tác xem tài liệu Quy tắc nghiệp vụ.

---

## Màn Giám sát trực tiếp

Mở **Giám sát trực tiếp** để xem mọi phòng lạnh của kho đang chọn ở đầu trang. Mỗi phòng là một thẻ: viền màu theo trạng thái (xanh: bình thường, đỏ: vượt ngưỡng hoặc lỗi cảm biến, vàng: mất tín hiệu), nhiệt độ, cửa, độ ẩm, quạt, thiết bị và số cảnh báo chưa xử lý. Cột **Cảnh báo** bên phải hiện các cảnh báo mới nhất; nút **Ẩn cảnh báo** ở đầu trang để thu gọn cột này. Số liệu cập nhật trực tiếp, không cần tải lại trang.

## Xem chi tiết một phòng

Bấm vào thẻ phòng để mở chi tiết ngay trên trang (lưới phòng được thay bằng thanh chuyển phòng). Thứ tự từ trên xuống:

1. Tình hình hiện tại: nhiệt độ, độ ẩm, cửa, quạt, còi.
2. **Cần chú ý**: mọi vấn đề của phòng gom vào một chỗ, việc nghiêm trọng (chữ đỏ) đứng trước. Không có vấn đề thì hiện "Mọi chỉ số đang bình thường".
3. Dự báo AI cho 15 phút tới, kèm khuyến nghị.
4. Biểu đồ nhiệt độ.
5. Điều khiển thiết bị.
6. Danh sách thiết bị trong phòng.

## Chuyển nhanh giữa các phòng

Khi đang xem một phòng, thanh ở đầu trang liệt kê mọi phòng của kho dưới dạng ô nhỏ: màu viền theo trạng thái, nhiệt độ, biểu tượng cửa mở và số cảnh báo màu đỏ. Bấm một ô để chuyển sang phòng đó, hoặc dùng nút ‹ › để sang phòng trước hay sau. Nút **Tất cả phòng** đưa về lưới phòng. Trên điện thoại, vuốt ngang thanh này để xem các phòng khác. Nút Quay lại của trình duyệt cũng đưa về phòng xem trước đó.

## Cảnh báo của phòng đang xem

Khi đang xem một phòng, cột Cảnh báo có hai lựa chọn: **Phòng này** (mặc định, chỉ cảnh báo của phòng đang xem) và **Toàn kho**. Từ đây có thể bấm **Tiếp nhận** hoặc **Xử lý xong** cho từng cảnh báo. Bấm tên phòng trong một cảnh báo để mở phòng đó.

## Biểu đồ nhiệt độ

Biểu đồ có ba khoảng xem: **1 giờ**, **6 giờ**, **24 giờ**. Ý nghĩa các nét được ghi ở chú thích ngay trên biểu đồ:

- Đường xanh: nhiệt độ trung bình.
- Dải nhạt: khoảng thấp nhất – cao nhất.
- Hai đường đỏ nét đứt: ngưỡng sàn và trần.
- Chấm đỏ: khoảng thời gian có mẫu vượt ngưỡng.
- Nét đứt tím hoặc cam: dự báo AI. Cam nghĩa là có nguy cơ vượt ngưỡng.

Rê chuột lên biểu đồ để xem chi tiết từng điểm, hoặc bấm **Xem dạng bảng**.

## Ẩn bớt phần không cần xem

Trong chi tiết phòng, bấm vào tiêu đề **Điều khiển** hoặc **Thiết bị** (có mũi tên ▸/▾) để thu gọn hoặc mở lại. Phòng có nhiều thiết bị thì phần Điều khiển của mỗi thiết bị được ẩn hoặc hiện riêng. Các lựa chọn này cùng khoảng xem của biểu đồ được **ghi nhớ riêng cho từng phòng** trên trình duyệt đang dùng, nên tải lại trang vẫn giữ nguyên. Đổi sang trình duyệt hoặc máy khác thì các lựa chọn trở về mặc định.

## Bật, tắt quạt hoặc còi

Có hai nơi điều khiển nhanh:

- **Giám sát trực tiếp**: mở phòng, tìm phần **Điều khiển** bên dưới biểu đồ.
- **Thiết bị**: mở chi tiết thiết bị, phần **Điều khiển nhanh** nằm phía trên các tab.

Mỗi kênh điều khiển có trạng thái hiện tại (ví dụ "Đang chạy", "Đang kêu") và hai nút **Bật** / **Tắt**. Bấm một lần là lệnh được gửi ngay. Lệnh ghi đè chế độ tự động của kênh trong 10 phút.

## Theo dõi kết quả lệnh vừa gửi

Ngay dưới tên kênh hiện kết quả của lệnh gần nhất:

- "đang chờ thiết bị xác nhận…" khi lệnh vừa gửi.
- "✓ đã thực hiện" khi thiết bị đã làm theo.
- "thất bại" kèm lý do.
- "hết hạn, thiết bị không phản hồi".

Thường chỉ mất 1–2 giây để thiết bị xác nhận. Khi thiết bị đã xác nhận, trạng thái của kênh đổi ngay theo lệnh. Nếu lệnh hết hạn hoặc thất bại, xem tài liệu Khắc phục sự cố.

## Màn Lệnh điều khiển

Mục **Lệnh điều khiển** liệt kê toàn bộ lịch sử lệnh trong phạm vi của bạn: thời điểm, lệnh, trạng thái, kênh, người gửi, lúc thiết bị xác nhận. Có thể lọc theo trạng thái, lệnh, người gửi và khoảng ngày. Bấm một dòng để xem chi tiết: số lần gửi, lúc hết hạn, lý do thất bại. Nút **Gửi lệnh** ở đây cũng gửi được lệnh, bằng cách chọn thiết bị, kênh và lệnh. Danh sách tự cập nhật khi còn lệnh đang chờ.

## Khai báo kênh cho thiết bị

Admin và Kỹ thuật viên vào **Thiết bị**, mở thiết bị, chọn tab **Kênh**:

- Nếu board còn thiếu kênh chuẩn, khung **Board chuẩn còn thiếu kênh** hiện ra; bấm **Thêm kênh mặc định** để thêm đủ.
- Để thêm từng kênh: chọn **Loại kênh** (chia hai nhóm "Điều khiển (nhận lệnh)" và "Cảm biến (chỉ đọc)"), đặt tên nếu muốn, rồi bấm **Thêm kênh**.
- Bút chì để đổi tên kênh, thùng rác để xoá kênh.

Thiết bị mới kích hoạt đã có sẵn kênh chuẩn.

## Kiểm tra dữ liệu từng kênh

Trong tab **Kênh** của thiết bị, mỗi kênh hiện giá trị gần nhất mà thiết bị gửi lên, ví dụ "5,2 °C · 71 %", "Cửa đóng", "Đang chạy". Kênh đã khai báo nhưng không có dữ liệu hiện **"Không có dữ liệu"** màu vàng. Dòng trên cùng cho biết số đo gần nhất cách đây bao lâu, và báo nếu thiết bị có thể đã mất kết nối. Phần này dành cho Admin, Quản lý và Kỹ thuật viên.
