# RAG cho chatbot kho lạnh

Nhánh `feat/chatbot-rag` được tạo từ bản AI 5–10 phút, tích hợp `fix/chatbot-turn-reliability` và `feat/chatbot-prompt-knowledge`. Các thay đổi giao diện/dự báo cũ trong lịch sử nhánh kiến thức được xử lý theo bản AI hiện tại.

## Luồng hoạt động

1. Người dùng gửi tin nhắn; backend kiểm tra tài khoản, quyền kho, giới hạn lượt và khóa hội thoại như trước.
2. Backend đọc ba tài liệu đi kèm và các tài liệu đã xử lý thành công do Admin tải lên, chia theo đề mục thành các đoạn tối đa 1.200 ký tự, chồng 180 ký tự khi một mục dài. Nội dung và cấu hình được băm để nhận ra thay đổi.
3. Vector tài liệu tải lên đã được worker tạo và lưu trong MySQL được dùng lại. Với các đoạn chưa có vector, Gemini `gemini-embedding-001` tạo vector 768 chiều cho từng đoạn với nhiệm vụ `RETRIEVAL_DOCUMENT`. Vector được chuẩn hóa và lưu trong file JSON; những lần sau dùng chỉ mục trong bộ nhớ hoặc trên đĩa.
4. Câu hỏi được tạo embedding với nhiệm vụ `RETRIEVAL_QUERY`. Backend tính cosine similarity, lấy tối đa bốn đoạn đạt ngưỡng 0,45, đưa đoạn trích và nguồn vào ngữ cảnh của Gemini. Hai tin nhắn người dùng gần nhất được dùng để hỗ trợ câu hỏi tiếp nối; tổng truy vấn giới hạn 2.000 ký tự.
5. Gemini trả lời dựa trên các đoạn truy xuất và được yêu cầu ghi tên tài liệu/mục. Nếu cần tìm thêm, công cụ `search_docs` dùng cùng bộ tìm kiếm ngữ nghĩa.
6. Câu hỏi về nhiệt độ hiện tại, danh sách cảnh báo, lô hàng hoặc ca trực vẫn gọi các công cụ dữ liệu có kiểm tra phân quyền. Tài liệu không chứa dữ liệu riêng của từng kho và không thay thế kiểm tra quyền.

Luồng RAG đã được triển khai để gọi API embedding; cần khóa API và xử lý thành công mới có vector thật. Chỉ mục vector tổng hợp nhỏ nằm trong ứng dụng. Chưa cần triển khai một dịch vụ vector database riêng. Chỉ mục được tạo lười khi có truy vấn, hoặc chuẩn bị trước bằng CLI.

## Nguồn kiến thức

Ba file đi kèm sau được phép đọc và gửi tới API embedding:

- `docs/BUSINESS_RULES.md`: quy tắc, quyền, cảnh báo, lô hàng, dự báo.
- `docs/SYSTEM_OPERATIONS_GUIDE.md`: thao tác vận hành.
- `docs/TROUBLESHOOTING.md`: cách kiểm tra sự cố.

Ngoài ba file trên, Admin có thể tải MD, TXT hoặc PDF có văn bản tại **Quản trị → Tài liệu chatbot**. Sau khi xem trước và chọn xử lý, worker tạo embedding; chỉ tài liệu Sẵn sàng được lấy từ database vào RAG. Xem [Quản lý tài liệu chatbot](CHATBOT_DOCUMENTS.md).

Không quét toàn bộ thư mục. File cấu hình, mật khẩu, tài liệu kiến trúc và dữ liệu vận hành riêng từng kho không được đưa vào chỉ mục này. Khi cần bổ sung kiến thức, sửa các tài liệu trên; chỉ mục tự tạo lại khi nội dung thay đổi. Với Docker, tài liệu được đóng gói lúc build nên cần build lại image để nhận bản mới.

Tài liệu từ nhánh kiến thức cũ đã được sửa theo code: dự báo 5/10 phút, bốn vai trò, bảy mã cảnh báo cùng phạm vi thực sự triển khai, điều kiện ca được duyệt, quyền kỹ thuật viên và Claim Code. Không còn ghi tám loại cảnh báo giả định hay dự báo 15 phút.

## Cấu hình

Chạy backend trực tiếp: thêm vào `server/.env` từ mẫu, dùng khóa Gemini đang sử dụng cho chatbot:

```dotenv
GEMINI_API_KEY=<khóa riêng, không commit>
CHATBOT_KNOWLEDGE_MODE=rag
CHATBOT_RAG_TOP_K=4
CHATBOT_RAG_MIN_SCORE=0.45
CHATBOT_RAG_TIMEOUT_MS=20000
CHATBOT_RAG_INDEX_PATH=.cache/chatbot-rag/index.json
# Mặc định khi chạy từ server/: ../docs
# CHATBOT_DOCS_DIR=<đường dẫn thư mục docs>
```

Giữ `LLM_MODEL` theo model sinh câu trả lời mà tài khoản hỗ trợ. Model embedding độc lập với model trả lời; không đổi sang model embedding khác mà giữ nguyên cache. Phiên bản này cố định `gemini-embedding-001` và 768 chiều.

Hai file Compose dev/production dùng volume `chatbot_rag_cache` và đường dẫn `/app/.cache/chatbot-rag/index.json`. Image tạo thư mục với quyền ghi cho user `node`. Phần upload cần migration tạo bảng `chatbot_documents` và worker cùng phiên bản code; không cần dịch vụ vector mới hoặc thay đổi ESP32.

Các chế độ so sánh, áp dụng sau khi khởi động lại backend:

| Chế độ | Kiến thức gửi vào mô hình | Công cụ tìm tài liệu |
| --- | --- | --- |
| `none` | Không tự thêm tài liệu | Tắt |
| `prompt` | Toàn bộ cùng bộ tài liệu, tối đa 40.000 ký tự | Tắt |
| `rag` (mặc định) | Các đoạn liên quan được truy xuất | Bật tìm kiếm ngữ nghĩa |

`none` không xóa kiến thức vốn có của Gemini hoặc lịch sử hội thoại. Khi so sánh phải dùng hội thoại mới và cùng tài khoản, câu hỏi, model sinh câu trả lời. Dữ liệu thực tế và quyền truy cập vẫn được kiểm tra trong cả ba chế độ.

## Kiểm tra chỉ mục và truy xuất

Từ thư mục dự án, sau khi cài dependency backend:

```powershell
cd server
npm run build
cd ..
node scripts/chatbot_rag.js corpus
node scripts/chatbot_rag.js index
node scripts/chatbot_rag.js query "Quản lý có được bật quạt từ xa không?"
node scripts/chatbot_rag.js benchmark
```

CLI tự đọc `server/.env`; có thể thêm `--env <đường dẫn file env>` để chọn cấu hình khác. Nếu chạy CLI trên máy host, không dùng nguyên đường dẫn `/app/...` của container.

`corpus` chạy được khi chưa có khóa API, chỉ kiểm tra tài liệu và số đoạn. Ba lệnh còn lại cần khóa Gemini và kết nối mạng. CLI chỉ dùng ba file đi kèm; không đọc tài liệu upload từ database, không đăng nhập website, không tạo hội thoại hoặc sửa dữ liệu máy chủ. Lệnh query trả `method: semantic` khi embedding thành công; mã thoát 2 nghĩa là chỉ có fallback. Lệnh benchmark dừng và không ghi báo cáo thành công nếu có truy vấn fallback.

`server/test/chatbot-rag-suite.json` có bộ câu hỏi diễn đạt lại, mỗi câu gán một file và đề mục đích. Báo cáo `chatbot_rag_results.json` gồm Recall@1, Recall@k, MRR, nguồn truy xuất và thời gian. Đây là bộ kiểm tra phát triển nhỏ, không chứng minh độ chính xác câu trả lời hoặc khả năng chống vượt quyền. Cần bổ sung câu hỏi độc lập và kiểm tra thủ công trước khi dùng số liệu trong báo cáo bài tập.

Script `scripts/benchmark_chatbot.js` từ nhánh cũ vẫn dùng được với tài khoản kiểm thử qua `CHATBOT_BENCHMARK_USERNAME` / `CHATBOT_BENCHMARK_PASSWORD`. Script này gọi API chat và tạo hội thoại, chỉ nên chạy trên môi trường kiểm thử. Điểm so khớp từ khóa là kiểm tra sơ bộ, không phải accuracy hay bằng chứng phân quyền. Không còn tài khoản/mật khẩu được điền sẵn trong script.

## Khi API embedding gặp lỗi

Nếu thiếu khóa, hết quota hoặc quá thời gian, chatbot trả ngữ cảnh `keyword_fallback` có cảnh báo rõ, dùng các từ trong câu hỏi để tìm trong cùng bộ tài liệu. Backend tạm ngừng thử lại embedding trong 60 giây để tránh gọi dồn. Thiếu toàn bộ tài liệu thì trả `unavailable`. Công cụ dữ liệu trực tiếp vẫn có thể dùng; Gemini được yêu cầu nói rõ khi thiếu căn cứ nghiệp vụ.

Truy vấn và API có timeout, tiếp nhận tín hiệu hủy của lượt chat. Tác vụ tạo chỉ mục dùng timeout riêng và chia sẻ giữa các lượt đồng thời; nó có thể hoàn tất cache sau khi một người dùng ngừng chờ. Tác vụ này chỉ ghi cache tài liệu công khai, không ghi tin nhắn hoặc phát sự kiện trả lời muộn. Vector query được cache tối đa 100 mục trong năm phút. Nội dung corpus thay đổi làm chỉ mục tổng hợp được cập nhật, dùng lại vector của những đoạn không đổi; file hỏng, sai kích thước hoặc sai model được tạo lại. Nếu đĩa không ghi được, tiến trình vẫn dùng chỉ mục trong bộ nhớ.

## Giới hạn cần kiểm chứng

- Chất lượng còn phụ thuộc tài liệu, embedding, cách chia đoạn và model sinh câu trả lời. Chưa được phép coi điểm cosine là phần trăm độ chính xác.
- Hướng dẫn trích nguồn là yêu cầu cho mô hình; chưa có bộ kiểm chứng tự động mọi phát biểu cuối cùng.
- Đã có giao diện Admin tải MD/TXT/PDF có văn bản; chưa có OCR hoặc tài liệu riêng từng kho. Thêm tài liệu riêng cần bổ sung phân quyền ở bước truy xuất trước.
- Tài liệu được gửi tới dịch vụ Gemini để tạo embedding; chỉ đưa nội dung hướng dẫn dùng chung đã được rà soát vào ba file được cho phép và các tài liệu Admin tải lên.

Tài liệu API: [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings).
