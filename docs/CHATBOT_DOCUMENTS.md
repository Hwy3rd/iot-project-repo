# Quản lý tài liệu chatbot

## Cách sử dụng

Đăng nhập **Admin**, vào **Quản trị → Tài liệu chatbot** (`/chatbot-documents`). Các vai trò khác không có quyền truy cập trang hoặc API quản lý này. Nội dung đã được Admin đưa vào sử dụng là kiến thức hướng dẫn dùng chung cho người dùng chatbot.

1. Nhập tên dễ hiểu và chọn file **Markdown (.md), TXT hoặc PDF có văn bản**.
2. Bấm **Tải lên và xem trước**. Hệ thống đọc văn bản và lưu vào database với trạng thái **Chờ xử lý**; bước này không gọi API embedding.
3. Kiểm tra nội dung trong cửa sổ xem trước, đặc biệt cách ngắt dòng và chữ tiếng Việt trong PDF.
4. Bấm **Xử lý để chatbot sử dụng**, đọc xác nhận rồi chọn **Bắt đầu xử lý**. Bước này gửi nội dung tới Gemini, sử dụng hạn mức và có thể phát sinh phí theo project API.
5. Trang tự cập nhật từ **Đang xếp hàng** sang **Đang xử lý**, rồi **Sẵn sàng** hoặc **Xử lý thất bại**. Chỉ tài liệu Sẵn sàng được dùng trong bước truy xuất.

Có thể xem trước, tìm theo tên, xử lý lại và xóa tài liệu. Nếu xử lý thất bại, đọc thông báo, kiểm tra dịch vụ AI rồi bấm Xử lý để thử lại. Ba tài liệu đi kèm hệ thống hiện riêng ở cuối trang; cập nhật chúng vẫn thông qua phiên bản ứng dụng.

## Giới hạn nhập tài liệu

- Mỗi file tối đa **5 MB**; PDF tối đa **40 trang**.
- Nội dung đọc được tối đa **60.000 ký tự** mỗi tài liệu.
- MD/TXT cần mã hóa **UTF-8**. PDF cần chứa văn bản; chưa có OCR cho PDF scan, không nhận PDF có mật khẩu.
- Tối đa 30 tài liệu tải lên, tổng tối đa 250 đoạn nội dung cho phần tải lên.
- Nội dung trùng với tài liệu đã tải lên sẽ bị từ chối, kể cả tên file khác.
- Phiên bản này lưu **văn bản trích xuất, thông tin file và dữ liệu tìm kiếm**, không lưu lại file PDF gốc để tải xuống.

Tài liệu cần là hướng dẫn dùng chung đã được rà soát. Không đưa mật khẩu hoặc dữ liệu riêng từng kho vào nguồn này. Quyền đọc số liệu kho vẫn được kiểm tra qua các công cụ dữ liệu hiện có của chatbot.

## Lưu trữ và worker

Migration `1793577600000-ChatbotDocuments.ts` tạo bảng `chatbot_documents` trong MySQL, chứa metadata, văn bản và vector đã chuẩn hóa. Danh sách HTTP không trả văn bản, vector, mã job hoặc thông tin nội bộ; API xem trước chỉ trả văn bản cùng metadata được cho phép.

Hàng đợi BullMQ **`chatbot-documents`** lưu tham chiếu id và token trong Redis. `ChatbotDocumentProcessor` chỉ chạy ở worker, xử lý tuần tự, có giới hạn thời gian 60 giây mỗi tài liệu. Nếu worker dừng, tài liệu chờ trong hàng đợi đến khi worker hoạt động lại. BullMQ xử lý job bị gián đoạn theo cơ chế stalled job. Job của tài liệu đã xóa hoặc bị thay thế không được đưa dữ liệu trở lại kho kiến thức.

Model embedding và chiều vector giống cấu hình RAG hiện tại: `gemini-embedding-001`, 768 chiều. RAG kết hợp ba file được cho phép với tài liệu Sẵn sàng trong database. Những vector đã có được dùng lại; thêm hoặc xóa tài liệu không yêu cầu tạo lại toàn bộ embedding của các đoạn không đổi.

## Chạy trên môi trường local

Chuẩn bị MySQL, Redis và các dịch vụ của dự án theo hướng dẫn chung. Điền cấu hình backend vào `server/.env`; `GEMINI_API_KEY` dùng cho cả ứng dụng và worker. Không đưa khóa vào frontend hoặc Git.

Trong `server/`:

```powershell
corepack pnpm@10.18.3 install --frozen-lockfile
corepack pnpm@10.18.3 run migration:run
corepack pnpm@10.18.3 run build
node dist/main.js
```

Mở terminal khác, cũng tại `server/`:

```powershell
node dist/workers/main.js
```

Chạy frontend theo hướng dẫn của dự án rồi mở `/chatbot-documents`. Khi thiếu khóa Gemini, trang vẫn cho lưu và xem trước; nút xử lý bị vô hiệu hóa và có thông báo cấu hình chưa sẵn sàng.

Với Docker, cần build lại **app và worker** cùng phiên bản code; lệnh khởi động app hiện tại chạy migration trước khi phục vụ. Worker chỉ khởi động sau khi app sẵn sàng. Tài liệu nằm trong volume MySQL hiện có, vector cache tổng hợp nằm trong volume RAG hiện có; không thêm dịch vụ lưu trữ mới.

## API quản lý — chỉ Admin

| Phương thức | Đường dẫn | Chức năng |
| --- | --- | --- |
| GET | `/chatbot/documents` | Danh sách metadata, nguồn có sẵn và khả năng xử lý |
| POST | `/chatbot/documents` | Multipart với `file` và `title`, lưu chờ xử lý |
| GET | `/chatbot/documents/:id` | Xem văn bản đã trích xuất |
| POST | `/chatbot/documents/:id/process` | Yêu cầu worker tạo embedding |
| DELETE | `/chatbot/documents/:id` | Xóa nguồn đã tải lên |
| GET | `/chatbot/documents/builtin/:filename` | Xem một trong ba file được cho phép |

Các API dùng cookie JWT và response envelope chung. Upload, xử lý và xóa được ghi audit; nội dung và vector được đặt `select: false`, không bị đưa vào snapshot audit thông thường.

CLI `scripts/chatbot_rag.js` tiếp tục dùng ba file có sẵn, không kết nối database tài liệu tải lên. Dùng giao diện và worker để xử lý nguồn được quản lý trong database.

## Kiểm thử

Các test có thể chạy từ `server/` bằng Jest của dự án. Test đọc PDF tạo một file PDF nhỏ ngay trong test rồi chạy thư viện parser thật. Test embedding dùng vector giả lập, không gọi Gemini. Test HTTP dùng một server cô lập để kiểm tra quyền Admin, multipart, validation và giới hạn trường phản hồi; không thay thế kiểm thử deploy có MySQL/Redis thật.

Thư viện PDF: [pdf-parse](https://github.com/mehmet-kozan/pdf-parse).
