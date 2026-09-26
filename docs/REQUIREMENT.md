# Yêu cầu hệ thống

> Đặc tả yêu cầu (bài toán, đối tượng sử dụng, yêu cầu chức năng/phi chức năng) cho hệ thống giám sát & quản lý kho lạnh. Không lặp lại chi tiết kỹ thuật đã có ở [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [API_DESIGN.md](API_DESIGN.md), [RBAC.md](RBAC.md) — tài liệu này trả lời "hệ thống cần làm gì và cho ai", các tài liệu kia trả lời "làm bằng cách nào".

---

## 1. Bối cảnh & bài toán

Kho lạnh bảo quản hàng hoá nhạy cảm với nhiệt độ (thực phẩm, dược phẩm...) hiện chủ yếu được quản lý thủ công: nhân viên ghi nhiệt độ bằng tay theo chu kỳ, sự cố (mất điện, hỏng dàn lạnh, quên đóng cửa) chỉ được phát hiện khi hàng đã hỏng hoặc muộn, còn hạn sử dụng lô hàng và ca trực nhân viên theo dõi rời rạc trên giấy tờ/bảng tính.

Hệ thống thay thế các quy trình thủ công đó bằng:

- Cảm biến IoT gắn trong từng phòng lạnh, gửi liên tục dữ liệu nhiệt độ, độ ẩm, trạng thái cửa, tình trạng thiết bị về hệ thống.
- Cảnh báo tự động ngay khi thông số vượt ngưỡng an toàn hoặc thiết bị gặp sự cố, gửi tới đúng người phụ trách kho đó gần như tức thời.
- Một nơi duy nhất để quản lý nhiều kho lạnh, nhiều phòng, nhiều lô hàng, ca trực nhân viên và lịch sử thao tác — thay vì mỗi kho vận hành độc lập, dữ liệu tách rời.

## 2. Đối tượng sử dụng

Bốn vai trò; ma trận quyền chi tiết theo từng chức năng xem [RBAC.md](RBAC.md).

| Vai trò | Nhu cầu chính |
|---|---|
| Admin | Quản trị toàn hệ thống: tài khoản, kho, danh mục dùng chung, giám sát toàn cục, tra soát nhật ký hệ thống |
| Quản lý kho (Manager) | Vận hành nghiệp vụ tại (các) kho được giao: lô hàng, duyệt chấm công ca trực, theo dõi tình trạng kho |
| Kỹ thuật viên (Technician) | Lắp đặt, bảo trì, điều khiển thiết bị IoT tại (các) kho được giao |
| Nhân viên (Staff) | Thực hiện công việc vận hành hằng ngày (nhập/xuất hàng, xử lý cảnh báo cơ bản) trong ca trực đã được duyệt chấm công |

## 3. Yêu cầu chức năng

### 3.1 Xác thực & tài khoản người dùng

- Đăng nhập bằng username/mật khẩu; mỗi tài khoản chỉ duy trì **một** phiên đăng nhập hoạt động — đăng nhập ở nơi khác vô hiệu hoá phiên trước đó.
- Phiên tự làm mới mà không cần đăng nhập lại trong lúc còn hoạt động, tự hết hạn sau một khoảng thời gian.
- Admin tạo, chỉnh sửa, khoá và xoá tài khoản cho toàn bộ nhân sự, gán vai trò toàn cục cho từng người.
- Mỗi người dùng tự quản lý thông tin cá nhân của chính mình (ảnh đại diện, liên hệ).
- Khoá tài khoản ngay khi nhân viên nghỉ việc mà không xoá lịch sử thao tác đã ghi nhận trước đó của người đó.

### 3.2 Quản lý kho, phòng lạnh & danh mục sản phẩm

- Quản lý danh sách kho (warehouse) và các phòng lạnh (cold room) bên trong từng kho; mỗi phòng có ngưỡng nhiệt độ an toàn riêng, biên trễ chống bật/tắt liên tục thiết bị làm mát, ngưỡng thời gian mở cửa tối đa và sức chứa.
- Gán nhân sự (Manager/Technician/Staff) vào một hoặc nhiều kho. Mỗi tài khoản chỉ có một vai trò và dùng vai trò đó ở mọi kho được gán — không gán vai trò riêng theo từng kho. Quản trị viên không cần gán vì đã thấy mọi kho.
- Quản lý danh mục loại sản phẩm dùng chung toàn hệ thống, kèm khoảng nhiệt độ bảo quản khuyến nghị, dùng để đối chiếu khi xếp một lô hàng vào một phòng lạnh cụ thể.

### 3.3 Quản lý lô hàng

- Ghi nhận lô hàng nhập kho: loại sản phẩm, số lượng, nhà cung cấp, ngày nhận, hạn sử dụng, gắn với một phòng lạnh cụ thể.
- Theo dõi trạng thái lô hàng theo vòng đời: đang lưu kho → hết hạn (tự động phát hiện) → đã xuất kho.
- Tự động đánh dấu lô hàng đã quá hạn sử dụng mà chưa được xuất kho.
- Cảnh báo khi lô hàng sắp tới hạn sử dụng, hoặc khi phòng lạnh chứa lô hàng có nhiệt độ nằm ngoài khoảng bảo quản khuyến nghị của loại sản phẩm đó.

### 3.4 Quản lý ca trực nhân viên

- Quản trị viên định nghĩa các mẫu ca làm việc (tên, giờ bắt đầu, giờ kết thúc, có thể qua đêm) dùng chung toàn hệ thống; số lượng tự do nhưng khung giờ các mẫu ca không được chồng nhau trong ngày.
- Chỉ Nhân viên cần chấm công. Khi đăng nhập, Nhân viên phải chấm công trước khi dùng hệ thống: chọn kho được phân công, ca và giờ do hệ thống tự điền theo thời điểm gửi (từ 15 phút trước giờ bắt đầu ca tới khi ca kết thúc); mỗi nhân viên chỉ có một lượt chấm công cho một ca trong ngày.
- Yêu cầu chấm công được gửi tới Quản lý kho duyệt hoặc từ chối (kèm lý do); bị từ chối thì gửi lại được. Chưa được duyệt thì chưa dùng được hệ thống.
- Các quyền vận hành hằng ngày của Nhân viên (nhập/xuất hàng, điều khiển thiết bị mức cơ bản) chỉ có hiệu lực trong ca đã được duyệt tại đúng kho.
- Hết ca, Nhân viên được nhắc đăng xuất, có thể thao tác thêm tối đa 5 phút, sau đó hệ thống tự đăng xuất và ghi nhận giờ ra ca. Yêu cầu không được duyệt trước khi ca kết thúc được tự đánh dấu quá hạn.

### 3.5 Quản lý thiết bị IoT

- Đăng ký thiết bị mới vào hệ thống; sinh mã kích hoạt có thời hạn để gán (claim) một thiết bị vật lý vào đúng phòng lạnh.
- Theo dõi vòng đời thiết bị: đăng ký → provision → hoạt động ⇄ mất kết nối/lỗi → bảo trì → ngừng sử dụng — một chiều, thiết bị đã ngừng sử dụng không quay lại hoạt động.
- Ghi nhận đầy đủ, không thể chỉnh sửa, lịch sử mọi lần đổi trạng thái thiết bị (thời điểm, ai/cái gì thực hiện, lý do) phục vụ tra soát sự cố sau này.
- Mỗi thiết bị có nhiều kênh ngoại vi độc lập (cảm biến nhiệt độ/độ ẩm, cảm biến dòng điện, công tắc hành trình cửa, quạt, đèn báo, còi) — cấu hình và theo dõi riêng theo từng kênh, một thiết bị có thể có nhiều kênh cùng loại.

### 3.6 Giám sát telemetry thời gian thực

- Nhận dữ liệu đo liên tục từ thiết bị (nhiệt độ, trạng thái cửa, lỗi cảm biến) và lưu đủ dữ liệu thô trong một khoảng thời gian gần đây để tra soát sự cố.
- Tổng hợp dữ liệu theo giờ (trung bình/nhỏ nhất/lớn nhất, số lần vượt ngưỡng, số lần lỗi cảm biến) để tra cứu xu hướng dài hạn mà không cần quét lại toàn bộ dữ liệu thô.
- Xem được dữ liệu tức thời và dữ liệu lịch sử theo giờ của từng thiết bị, trong phạm vi kho mà người xem được phân quyền.

### 3.7 Cảnh báo tự động

Hệ thống tự động phát sinh cảnh báo, gắn với đúng phòng lạnh/thiết bị/lô hàng liên quan, khi phát hiện:

- Nhiệt độ đã vượt ngưỡng an toàn của phòng lạnh, hoặc có xu hướng dự báo sắp vượt ngưỡng.
- Thiết bị gặp lỗi, hoặc mất kết nối quá lâu.
- Cửa phòng lạnh mở quá thời gian cho phép.
- Lô hàng bị lưu trong điều kiện nhiệt độ ngoài khoảng bảo quản khuyến nghị, hoặc sắp tới hạn sử dụng.

Mỗi loại sự cố tại một đối tượng chỉ giữ đúng một cảnh báo đang hoạt động tại một thời điểm — không phát trùng cảnh báo cho cùng một sự cố chưa được xử lý xong. Cảnh báo có vòng đời: mở → đã tiếp nhận (acknowledge) → đã xử lý (resolve, tự động hoặc thủ công); người/thời điểm xử lý được ghi nhận lại.

### 3.8 Điều khiển thiết bị từ xa

- Gửi lệnh bật/tắt tới các kênh cơ cấu chấp hành (quạt, đèn, còi...) của thiết bị; theo dõi trạng thái lệnh (đang chờ → đã gửi → hoàn tất/thất bại) và thời điểm thiết bị xác nhận đã thực thi.
- Cho phép hệ thống tự động phát lệnh điều khiển khi một cảnh báo xảy ra (ví dụ tự bật còi báo động khi quá nhiệt), không nhất thiết cần người thực hiện.
- Giữ lại toàn bộ lịch sử lệnh điều khiển vĩnh viễn, không xoá, phục vụ truy vết trách nhiệm.

### 3.9 Thông báo

- Khi phát sinh cảnh báo mới, chủ động gửi thông báo tới toàn bộ nhân sự được phân công tại kho liên quan, không chờ họ tự vào hệ thống kiểm tra.
- Người dùng xem được danh sách thông báo của riêng mình, lọc theo đã đọc/chưa đọc, và tự đánh dấu đã đọc.
- Hỗ trợ nhận thông báo đẩy ngay cả khi không mở ứng dụng, theo từng thiết bị/trình duyệt mà người dùng đã đăng ký nhận.

### 3.10 Nhật ký & truy vết

- Ghi lại nhật ký các thao tác quan trọng trong hệ thống: ai, làm gì, trên đối tượng nào, khi nào — phục vụ tra soát và tuân thủ nội bộ.
- Nhật ký, cũng như lịch sử cảnh báo/lệnh điều khiển/đổi trạng thái thiết bị, không bị xoá hay chỉnh sửa sau khi ghi, kể cả khi đối tượng liên quan (thiết bị, người dùng, kho) sau đó bị xoá khỏi hệ thống.
- Chỉ vai trò quản trị cao nhất (Admin) được xem nhật ký ở phạm vi toàn hệ thống; Quản lý kho xem được nhật ký các thao tác diễn ra tại (các) kho mình quản lý.

### 3.11 Phân quyền theo vai trò & phạm vi

- Mọi chức năng nghiệp vụ, trừ quản trị toàn hệ thống, chỉ áp dụng trong phạm vi (các) kho mà người dùng được phân công — người phụ trách kho A không thấy và không thao tác được dữ liệu của kho B.
- Với vai trò Nhân viên, quyền thao tác nghiệp vụ hằng ngày chỉ có hiệu lực khi đang trong ca trực đã được duyệt chấm công tại đúng kho đó.
- Ma trận quyền đầy đủ theo từng chức năng: xem [RBAC.md](RBAC.md).

## 4. Yêu cầu phi chức năng

- **Bảo mật** — xác thực bắt buộc cho mọi thao tác trừ đăng nhập; phân quyền nhiều lớp (vai trò + phạm vi kho + trạng thái ca trực); không lộ thông tin nhạy cảm (mật khẩu, mã kích hoạt thiết bị) qua bất kỳ phản hồi nào; mỗi tài khoản chỉ duy trì một phiên đăng nhập hoạt động tại một thời điểm.
- **Toàn vẹn & độ tin cậy dữ liệu** — dữ liệu đo từ thiết bị có thể bị gửi lặp do đặc thù truyền không dây nhưng không được tính trùng; giá trị đo và ngưỡng tại thời điểm phát sinh cảnh báo phải được lưu lại nguyên trạng dù cấu hình ngưỡng sau đó thay đổi; lịch sử thao tác/cảnh báo/lệnh điều khiển là bất biến, tồn tại độc lập với dữ liệu gốc liên quan bị xoá sau này.
- **Khả năng mở rộng** — kiến trúc hỗ trợ nhiều kho, nhiều phòng lạnh, nhiều thiết bị hoạt động đồng thời mà không giới hạn cứng về số lượng; dữ liệu đo tần suất cao (telemetry) tách khỏi dữ liệu nghiệp vụ để không ảnh hưởng hiệu năng truy vấn nghiệp vụ.
- **Hiệu năng truy vấn lịch sử** — tra cứu xu hướng nhiệt độ dài hạn (theo ngày/tuần/tháng) không yêu cầu quét toàn bộ dữ liệu đo thô.
- **Thời gian thực** — cảnh báo và thay đổi trạng thái quan trọng phải đến được người phụ trách gần như ngay lập tức, không phụ thuộc vào việc họ chủ động làm mới trang.
- **Khả năng vận hành** — thay đổi cấu trúc dữ liệu phải có đường nâng cấp (migration) có thể hoàn tác, triển khai/nâng cấp hệ thống không được làm mất dữ liệu đã có.

## 5. Giả định & ngoài phạm vi

- Thiết bị IoT vật lý giao tiếp với hệ thống qua giao thức nhắn tin phù hợp cho thiết bị nhúng (MQTT); hệ thống không quy định phần cứng/firmware cụ thể, chỉ định nghĩa hợp đồng dữ liệu (loại kênh, đơn vị đo, khuôn dạng lệnh điều khiển).
- Giao diện người dùng (web/mobile) là bên tiêu thụ API do hệ thống cung cấp; đặc tả UI/UX không thuộc phạm vi tài liệu này.
- Ngoài phạm vi giai đoạn hiện tại: tích hợp thanh toán/hoá đơn, đa ngôn ngữ, ứng dụng di động riêng, tích hợp hệ thống ERP/kế toán của bên thứ ba.
