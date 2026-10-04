# Demo AI ngay, không cần chờ cảm biến

Bài tập có thể dùng lịch sử mẫu Bangkok đã đóng gói tại
[scripts/fixtures/ai-demo-bangkok.json](../scripts/fixtures/ai-demo-bangkok.json).
Bạn không cần tự cung cấp 60 phút dữ liệu và không cần tải lại bộ dữ liệu thô.

Model vẫn nhận đủ lịch sử theo đúng cách đã huấn luyện. Script demo chuẩn bị
lịch sử đó trong vài giây bằng các quan sát Bangkok, gán thời gian gần hiện tại.
Những mẫu giữa hai quan sát được giả lập bằng cách giữ giá trị trước đó.
Đây là dữ liệu phục vụ demo, không phải lịch sử đo tại kho của bạn.

## Chỉ thử API AI

Cần thư viện backend trong `server/node_modules` và AI service đã chạy:

```powershell
# Từ thư mục gốc repo, sau khi bật Docker Desktop:
docker compose up -d --build ai-service

# Ngăn đông: bình thường, rồi dự báo sắp vượt ngưỡng:
node scripts/demo_ai.js --api-only --profile freezer-normal
node scripts/demo_ai.js --api-only --profile freezer-warning

# Ngăn mát:
node scripts/demo_ai.js --api-only --profile chill-normal
node scripts/demo_ai.js --api-only --profile chill-warning
```

Các lệnh này chỉ gọi API; không cần thiết bị, MQTT, MySQL hoặc MongoDB.
Kết quả hiện ngay trong terminal, gồm nhiệt độ dự báo, ngưỡng và loại cảnh báo.

## Demo trên biểu đồ của hệ thống

Chạy stack và tạo dữ liệu danh mục như hướng dẫn [DEVELOPMENT.md](DEVELOPMENT.md).
Thiết bị demo cần tồn tại và đã gán vào phòng lạnh.

Stack local có thể chạy backend và worker bằng Docker, dùng secret trong
`server/.env`. Compose tự đổi địa chỉ MySQL/MongoDB/Redis/MQTT/MinIO thành
tên dịch vụ trong container, nên không cần tạo `.env` ở root.

```powershell
# Từ thư mục gốc repo:
docker compose up -d --build app worker ai-service
node scripts/demo_ai.js --list-devices

# Thay <uniqueId> bằng mã thiết bị vừa liệt kê, hoặc mã trên giao diện:
node scripts/demo_ai.js --device <uniqueId>

# So sánh cảnh báo ngay: chọn thiết bị demo khác có ngưỡng phù hợp:
node scripts/demo_ai.js --device <uniqueIdKhac> --scenario warning
```

Backend Docker mặc định ở `http://localhost:8080`. Nếu cổng này không dùng
được, đặt `$env:APP_PORT='18080'` trước lệnh `docker compose up`; giữ biến này
khi chạy lại lệnh Compose có khởi động `app`.

Frontend chạy ở terminal riêng, trỏ proxy tới cổng backend Docker:

```powershell
cd frontend
$env:VITE_DEV_API_TARGET='http://localhost:8080' # hoặc :18080 nếu đổi APP_PORT
npm run dev -- --host 127.0.0.1
```

Mở `http://127.0.0.1:5173/monitoring`, đăng nhập bằng tài khoản demo hiện có,
chọn kho rồi chọn phòng tương ứng. Không chạy thêm backend trên host khi
dùng cách này.

Backend gọi AI tối đa một lần/phút cho mỗi thiết bị. Lịch sử của các lần demo
trước được giữ lại; chạy hai tình huống trên hai thiết bị riêng giúp so sánh
ngay mà không trộn lịch sử. Dự báo được giữ trong cache 15 phút; script mặc
định tiếp tục gửi MQTT 120 giây để trình diễn dữ liệu trực tiếp.

Script tự chọn bộ mẫu phù hợp với ngưỡng phòng. Các bộ mẫu hỗ trợ phòng mát
0..4°C, mát 2..6°C, đông −22..−18°C, đông −20..−15°C và đông sâu −28..−22°C.
Tình huống cảnh báo có cho phòng mát 0..4°C và hai dải phòng đông.

Script nạp 780 mẫu lịch sử cách 5 giây, trải dài 65 phút, vào MongoDB; mẫu có
`demoSource.type = "bangkok-coursework"`. Nó không đổi ngưỡng phòng hay ghi đè
bản ghi đã tồn tại. Sau đó gửi nhiệt độ hiện tại qua MQTT mỗi 5 giây trong
120 giây. Backend dùng luồng dự báo và cảnh báo hiện có. Mở đúng phòng tại
Monitoring để xem dự báo; không phải chờ thêm một giờ.

Có thể đổi thời gian gửi bằng `--duration 30`; `--duration 0` gửi một mẫu.
`--profile` chọn bộ mẫu cụ thể khi cần. `--help` liệt kê đầy đủ tùy chọn.
Kết nối dùng `server/.env`, biến môi trường có ưu tiên cao hơn; credential
MQTT thiết bị dùng `MQTT_DEVICE_USERNAME/PASSWORD`.

Các script `simulate_telemetry.js/.py` trước đây vẫn phục vụ thử cảm biến,
cảnh báo nhiệt độ thực tế và lỗi quạt. Dùng `demo_ai.js` để chuẩn bị đủ lịch sử
cho model mới.

## Kiểm tra không cần Docker

```powershell
node scripts/demo_ai.js --dry-run --profile freezer-normal
```

Lệnh chỉ in kế hoạch và payload mẫu, không kết nối hoặc ghi dữ liệu.
Kiểm tra đầy đủ từ thư mục gốc, sau khi backend đã build:

```powershell
node --test scripts/demo_ai.test.js
# Với Python đã cài requirements-dev.txt:
python -B -m unittest discover -s ai-service/tests -v
```

Nguồn: [Bangkok DOI 10.57745/TMWYBQ](https://doi.org/10.57745/TMWYBQ).
Fixture lưu tên file, SHA-256, các mốc thời gian gốc và phiên bản model.
Script tái tạo fixture là `ai-service/experiments/generate_ai_demo.py`.
Các con số độ chính xác trong README AI vẫn là validation Bangkok;
các kịch bản này dùng để trình diễn luồng chức năng.
