# LLM Architecture — Trợ lý AI (chatbot)

> Tài liệu thiết kế trợ lý AI: các thành phần, luồng xử lý một lượt trả lời, bộ tool đọc dữ liệu, cách phân quyền, các giới hạn và cấu hình. Giao thức socket/REST chi tiết xem [API_DESIGN.md](API_DESIGN.md) mục 18.1; mô hình phân quyền xem [RBAC.md](RBAC.md) §3.

---

## 1. Tổng quan

Trợ lý AI trả lời câu hỏi của người dùng về dữ liệu kho lạnh (cảnh báo, nhiệt độ, thiết bị, lô hàng, ca trực) bằng tiếng Việt. Nó dùng **Gemini** qua Google AI Studio (Gemini Developer API, không phải Vertex AI) với cơ chế **function calling**: model không đọc database trực tiếp mà yêu cầu gọi các *tool* do backend định nghĩa, backend kiểm tra quyền, chạy truy vấn rồi trả kết quả cho model tổng hợp thành câu trả lời.

Nguyên tắc thiết kế:

- **Chỉ đọc.** Không có tool nào ghi hay sửa dữ liệu (xác nhận cảnh báo, gửi lệnh…). Nếu prompt bị vượt qua (jailbreak), hậu quả xấu nhất là một câu trả lời lạc đề, không phải mất hay lộ dữ liệu.
- **Không bao giờ rộng hơn REST.** Mỗi tool áp đúng quyền của route REST tương ứng, qua cùng `WarehouseAccessService` mà các guard dùng.
- **Không text-to-SQL.** Model không tự viết truy vấn: làm vậy sẽ bỏ qua toàn bộ lớp phân quyền theo kho và ca trực.
- **Không có module nào bắt buộc phụ thuộc chatbot.** Thiếu `GEMINI_API_KEY` thì app vẫn khởi động, chỉ lượt chat trả về thông báo lỗi.

---

## 2. Thành phần

| Thành phần | File | Vai trò |
|---|---|---|
| `LlmModule` / `LlmService` | `server/src/libs/llm/` | Bọc `GoogleGenAI`: áp model, `maxOutputTokens`, retry của SDK. Không biết gì về chatbot. |
| `ChatbotController` | `modules/chatbot/chatbot.controller.ts` | REST: tạo/liệt kê/xoá cuộc trò chuyện, đọc lịch sử, gửi tin đồng bộ (dùng khi test). |
| `ChatbotGateway` | `modules/chatbot/chatbot.gateway.ts` | Socket `chatbot:send` — cách gửi tin chính. Trả ack ngay khi đã lưu tin của user. |
| `ChatbotOrchestratorService` | `modules/chatbot/chatbot-orchestrator.service.ts` | Vòng lặp một lượt: khoá lượt, dựng lịch sử, gọi Gemini, chạy tool, lưu và phát sự kiện. |
| `ChatbotToolExecutorService` | `modules/chatbot/tools/chatbot-tool-executor.service.ts` | Kiểm tra quyền và chạy từng tool; định hình kết quả cho model. |
| Định nghĩa tool | `modules/chatbot/tools/chatbot-tools.definitions.ts` | Tên, mô tả, JSON Schema tham số, `allowedRoles`, `requireShift`. Gửi nguyên văn cho model. |
| System prompt | `modules/chatbot/chatbot-system-prompt.constant.ts` | Phạm vi hỗ trợ, quy tắc bắt buộc, hướng dẫn gọi tool hiệu quả, thời điểm hiện tại. |
| `ChatbotService` | `modules/chatbot/chatbot.service.ts` | Lưu cuộc trò chuyện và tin nhắn (MySQL). |
| `ChatbotRateLimiterService` | `modules/chatbot/guards/` | Giới hạn số tin mỗi phút / mỗi ngày trên Redis, dùng chung cho socket và REST. |
| Frontend | `frontend/src/pages/ChatbotPage.tsx`, `components/chatbot/`, `lib/chatbot.ts`, `lib/useChatConversation.ts` | Trang `/chatbot` và cửa sổ chat nhanh (nút nổi góc dưới phải). |

`ChatbotModule` import thêm `AlertsModule`, `TelemetryModule`, `DeviceStatusHistoryModule` và `ColdRoomsModule` (lấy `ColdRoomStatusService` cho trạng thái phòng hiện tại). Các entity đơn giản (Device, Batch, ColdRoom, Warehouse…) được đọc thẳng qua repository thay vì service của module khác, giống quy ước của `NotificationsService`.

---

## 3. Luồng một lượt trả lời

```
Client ── socket chatbot:send { conversationId, content } ──▶ ChatbotGateway
                                                                │
   1. kiểm tra token socket còn hạn, validate payload (≤ 2000 ký tự)
   2. rate limit (Redis, theo user)                    → lỗi: ack { ok: false, 429 }
   3. Orchestrator.startTurn()
        ├─ kiểm tra conversation thuộc user            → 404
        ├─ lấy khoá lượt chatbot:turn:<id> (SET NX EX)  → 409 nếu lượt trước chưa xong
        ├─ lưu tin user, đặt title nếu chưa có
        └─ emit chatbot:message (tin user) tới room user:{id}
   ◀── ack { ok: true, message }   (không chờ model)
                                                                │
   4. runTurn() chạy nền:
        dựng lịch sử (40 tin user/assistant gần nhất) + system prompt + tool của role
        lặp tối đa 5 lần:
          ├─ LlmService.generateContent()
          ├─ model trả text  ──▶ lưu tin assistant ──▶ emit chatbot:message ──▶ KẾT THÚC
          └─ model trả function calls:
               lưu tin assistant (toolCalls)
               emit chatbot:tool_call { tools }       (frontend hiện "Đang tra cứu…")
               chạy các tool SONG SONG (Promise.all)
               lưu từng kết quả (role tool), đưa kết quả lại cho model → vòng tiếp
        hết 5 vòng mà chưa có text ──▶ lưu câu trả lời dự phòng
   5. finally: nhả khoá lượt (chỉ khi token còn là của lượt này)
```

Một số điểm cần biết:

- **Nội dung model trả về được gửi lại nguyên văn** ở vòng tiếp theo, không dựng lại từ các call đã parse. Gemini 3.x gắn `thoughtSignature` vào function-call part và từ chối request tiếp theo (400) nếu chữ ký không được gửi lại.
- **Lượt đã xong chỉ còn text khi được đưa lại cho model.** `findRecentHistory` bỏ các tin tool-call và kết quả tool của các lượt trước: chúng chỉ cần để tạo câu trả lời lượt đó. Hai tin liên tiếp cùng role (vd lượt bị crash giữa chừng) được gộp để lịch sử luôn xen kẽ user/model.
- **Thời điểm hiện tại** được nối vào system prompt ở mỗi request (giờ Việt Nam), để model hiểu "hôm nay", "hôm qua" và truyền đúng mốc thời gian cho tool.
- **REST `POST /chatbot/conversations/:id/messages`** chạy cùng lượt nhưng chờ tới khi có câu trả lời cuối. Các sự kiện socket vẫn được phát.

---

## 4. Lưu trữ

| Bảng | Nội dung |
|---|---|
| `chatbot_conversations` | `id`, `user_id`, `title` (80 ký tự đầu của tin đầu tiên), `last_message_at`. Index `(user_id, last_message_at)`. |
| `chatbot_messages` | `conversation_id`, `role` (`user` / `assistant` / `tool` / `system`), `content`, `tool_calls` (JSON), `tool_call_id`, `tool_name`. Index `(conversation_id, created_at)`. |

Một lượt có thể sinh nhiều dòng: tin user → (tin assistant chứa `tool_calls` → các tin `tool` chứa kết quả JSON `{ output }` hoặc `{ error }`) × số vòng → tin assistant cuối. Frontend chỉ hiển thị tin `user` và tin `assistant` có nội dung text.

Cuộc trò chuyện thuộc riêng một user (lọc theo `user_id`, không theo kho). Xoá cuộc trò chuyện xoá luôn tin nhắn.

---

## 5. Tool

### 5.1 Danh sách

`S*` = Staff chỉ dùng được khi đang trong ca đã được duyệt (`requireShift`).

| Tool | Role | Dùng cho |
|---|---|---|
| `get_system_health_summary` | A, M, T, S | Tổng quan hiện tại trong 1 lần gọi (xem 5.3). Ưu tiên cho câu hỏi "tình hình thế nào", "có gì bất thường". |
| `get_alerts` | A, M, T, S | Cảnh báo, lọc theo trạng thái/loại/kho/phòng/thiết bị/lô/khoảng ngày. |
| `get_alert_detail` | A, M, T, S | Chi tiết 1 cảnh báo. |
| `get_devices` | A, M, T, S* | Thiết bị, lọc theo kho/phòng/`status` (vd `offline`). |
| `get_device_detail` | A, M, T, S* | Chi tiết 1 thiết bị. |
| `get_device_status_history` | A, M, T | Lịch sử chuyển trạng thái thiết bị. |
| `get_telemetry_hourly` | A, M, T, S* | Nhiệt độ/cửa theo giờ, cho 1 thiết bị hoặc mọi thiết bị trong phòng. |
| `get_telemetry_raw` | A, M, T | Mẫu cảm biến thô gần nhất (chỉ lưu ngắn hạn). |
| `get_cold_rooms` | A, M, T, S | Phòng lạnh và ngưỡng nhiệt độ. |
| `get_cold_room_detail` | A, M, T, S | 1 phòng kèm trạng thái hiện tại (nhiệt độ mới nhất, cửa, thiết bị, cảnh báo). |
| `get_warehouses` | A, M, T, S | Kho và số phòng lạnh. |
| `get_batches` | A, M, S | Lô hàng, lọc theo kho/phòng/trạng thái/`expiringWithinDays`. |
| `get_batch_detail` | A, M, S | Chi tiết 1 lô. |
| `get_commands` | A, M, T, S | Lịch sử lệnh điều khiển. |
| `get_work_shifts` | A, M, S | Ca trực / chấm công (Staff chỉ thấy ca của mình). |
| `get_product_types` | A, M, T, S | Loại sản phẩm (dữ liệu dùng chung, không gắn kho). |
| `search_docs` | A, M, T, S | Tìm trong tài liệu nghiệp vụ (xem 5.4). |
| `get_inventory_summary` | A, M | **Chưa triển khai** — bị ẩn khỏi model. |
| `get_staff_performance_summary` | A, M | **Chưa triển khai** — bị ẩn khỏi model. |
| `get_previous_shift_summary` | A, M, T, S | **Chưa triển khai** — bị ẩn khỏi model. |

Model chỉ được khai báo những tool mà role của người dùng được phép (`toolDeclarationsFor`), và không bao giờ thấy các tool trong `CHATBOT_TOOLS_NOT_IMPLEMENTED`.

### 5.2 Quy ước để model lấy dữ liệu ít vòng nhất

Mỗi vòng gọi model tốn khoảng 1–1,5 giây (có khi lâu hơn nhiều, xem mục 9), nên các tool được thiết kế để một câu hỏi cần ít vòng nhất:

- **Nhận tên hoặc mã thay cho id.** Tham số `warehouseId`, `coldRoomId`, `deviceId`, `batchId` nhận id, hoặc: mã/tên kho (`WH-HCM-01`), tên phòng (`Phòng A1`), `uniqueId` thiết bị, `batchCode`. Tên được so khớp không phân biệt hoa thường và dấu, theo thứ tự trùng khớp hoàn toàn → bắt đầu bằng → chứa. Nhiều kết quả khớp thì tool trả lỗi liệt kê các lựa chọn để model hỏi lại người dùng. Nhờ vậy model không phải liệt kê trước để tìm id.
- **Bộ lọc theo câu hỏi thường gặp**: thiết bị theo `status`, lô sắp hết hạn, cảnh báo theo kho và ngày, nhiệt độ theo cả phòng.
- **Kết quả gọn**: chỉ các trường cần cho câu trả lời, kèm **tên phòng và mã kho thay cho id**, bỏ trường rỗng. Model không cần gọi thêm để đổi id sang tên.
- **Danh sách có giới hạn** (mặc định 20–50 dòng, tối đa 100–200) và luôn kèm `total`. Khi bị cắt, kết quả có `note` để model biết và báo lại người dùng.
- **Tool của cùng một vòng chạy song song**, và system prompt yêu cầu model gọi mọi tool cần thiết trong cùng một vòng.

### 5.3 `get_system_health_summary`

Dựa trên `ColdRoomStatusService` (phần phục vụ màn hình giám sát: 1 aggregation Mongo cho nhiệt độ mới nhất + 2 truy vấn đếm), cộng một truy vấn đếm cảnh báo chưa xử lý theo loại và danh sách thiết bị `offline`/`fault`/`maintenance`. Trả về:

- số kho, số phòng, thiết bị theo trạng thái, cảnh báo chưa xử lý theo loại;
- `roomsNeedingAttention`: các phòng có vấn đề kèm lý do bằng lời (nhiệt độ ngoài ngưỡng, cửa đang mở, lỗi cảm biến, mất tín hiệu > 10 phút, thiết bị hỏng, có cảnh báo). Phòng mất tín hiệu thì không đánh giá nhiệt độ cũ;
- `problemDevices`: thiết bị offline/lỗi/bảo trì kèm phòng, kho, heartbeat cuối.

Ngưỡng "mất tín hiệu" 10 phút giống frontend (`frontend/src/lib/room-status.ts`).

### 5.4 `search_docs`

Tìm theo từ khoá trong **đúng 3 file** được liệt kê trong `CHATBOT_SEARCHABLE_DOCS`: `BUSINESS_RULES.md`, `SYSTEM_OPERATIONS_GUIDE.md`, `TROUBLESHOOTING.md`. Các tài liệu kỹ thuật nội bộ (kể cả file này) không bao giờ được đưa cho model. Thư mục tài liệu lấy từ `CHATBOT_DOCS_DIR` (image Docker copy `docs/` vào `/app/docs`); mặc định khi chạy dev là `../docs` tính từ `server/`.

---

## 6. Phân quyền

Có ba lớp, lớp sau không phụ thuộc lớp trước:

1. **System prompt** giới hạn chủ đề và cấm tiết lộ chi tiết nội bộ. Lớp này có thể bị vượt qua, nên không được coi là biện pháp bảo mật.
2. **Danh sách tool theo role**: model chỉ biết các tool mà role được phép.
3. **Executor kiểm tra lại mọi thứ** trước khi đọc dữ liệu, vì guard HTTP không chạy khi service được gọi trực tiếp:
   - `WarehouseAccessService.resolve()` tính các kho người dùng được đọc với `allowedRoles` và `requireShift` của tool (Admin: không giới hạn; Staff với tool `requireShift`: chỉ kho đang có ca được duyệt). Không có kho nào thì tool trả lỗi "không có quyền".
   - Mỗi lượt gọi tool nạp **phạm vi** (các kho và phòng lạnh được đọc) một lần. Mọi id, tên hay mã model đưa vào chỉ được tìm trong phạm vi đó; thuộc kho khác thì trả cùng một thông báo như không tồn tại.
   - Thiết bị chưa gán phòng không thuộc kho nào nên không ai đọc được qua chatbot, kể cả Admin (trừ khi Admin liệt kê thiết bị không kèm bộ lọc vị trí).
   - `get_work_shifts`: ở kho mà người gọi là Staff, `staffId` do model truyền bị bỏ qua và thay bằng chính người gọi.
   - Kết quả thiết bị không bao giờ chứa `claim_code_hash` / `claim_code_expires_at`.

Lỗi trong tool (không có quyền, không tìm thấy, thiếu tham số) được trả cho model dưới dạng `{ error }` để nó giải thích với người dùng, không phải lỗi HTTP.

---

## 7. Giới hạn và chống lạm dụng

| Giới hạn | Giá trị | Nơi đặt |
|---|---|---|
| Độ dài tin nhắn | 2000 ký tự | `CHATBOT_MESSAGE_MAX_LENGTH` |
| Tin nhắn mỗi user | 10/phút, 200/ngày | `CHATBOT_RATE_LIMIT_PER_MINUTE` / `_PER_DAY` (Redis, cửa sổ cố định, dùng chung socket và REST) |
| Lượt đồng thời | 1 lượt / cuộc trò chuyện | Khoá Redis `chatbot:turn:<id>`, TTL 180 s phòng khi process chết giữa lượt |
| Số vòng gọi model / lượt | 5 | `MAX_TOOL_ITERATIONS` |
| Lịch sử gửi cho model | 40 tin user/assistant gần nhất | `CHATBOT_HISTORY_LIMIT` |
| Token đầu ra | 1024 | `LLM_MAX_OUTPUT_TOKENS` |
| Retry khi Gemini lỗi | 3 lần (tính cả lần đầu), chỉ với 429/500/502/503/504 | `LLM_RETRY_ATTEMPTS`, `LLM_RETRY_STATUS_CODES` |

Lỗi `400`, `401`, `404` ở `chatbot:send` không bị tính vào rate limit. Retry của SDK dùng chung quota với request mới, nên số lần thử được giữ thấp.

---

## 8. Xử lý lỗi

| Tình huống | Kết quả người dùng thấy |
|---|---|
| Gemini lỗi sau khi hết retry (hết quota 429, mất mạng, 5xx) | Lượt kết thúc bằng **một tin assistant** thông báo lỗi (hết hạn mức hoặc tạm thời không phản hồi). Lịch sử vẫn đúng định dạng. |
| Hết 5 vòng mà model chưa trả lời bằng text | Tin assistant dự phòng: "chưa thể hoàn tất câu trả lời trong giới hạn số bước". |
| Lỗi ngoài dự kiến sau khi đã nhận tin (vd DB lỗi) | Sự kiện `chatbot:error`; frontend hiện thông báo lỗi. |
| Tool lỗi | Model nhận `{ error }` và tự giải thích. |
| Socket rớt giữa lượt | Frontend tải lại lịch sử khi kết nối lại; quá 180 s không có câu trả lời thì dừng chờ và báo lỗi. |
| Token socket hết hạn (ack `401`) | Frontend gọi `POST /auth/refresh`, kết nối lại và gửi lại một lần. |

---

## 9. Hiệu năng

Thời gian một lượt ≈ **số vòng gọi model × độ trễ của Gemini**. Truy vấn database và kích thước kết quả tool (vài KB) gần như không đáng kể.

Số đo trên môi trường local (`gemini-3.5-flash-lite`, tháng 09/2026):

| Câu hỏi | Vòng gọi model | Thời gian |
|---|---|---|
| "Xin chào" | 1 | ~1,8 s |
| "Có cảnh báo nào đang mở không?" | 2 | ~2,2 s |
| Liệt kê phòng lạnh + thiết bị mất kết nối | 2 (trước khi tối ưu tool: 4–5) | từ ~3 s |
| "Lô nào sắp hết hạn 30 ngày?" | 2 | ~2,6 s |

**Độ trễ của Gemini rất thất thường**: phần lớn lần gọi mất khoảng 1 giây, nhưng thỉnh thoảng mất 10–90 giây, kể cả với prompt rất ngắn và đã tắt retry. Đây là giới hạn phía nhà cung cấp (nhiều khả năng do gói miễn phí), không phải do code.

Các hướng cải thiện chưa làm:

- **Timeout cho mỗi lần gọi Gemini** (khoảng 10–15 s) kèm thử lại. Hiện không đặt timeout, nên một request bị treo làm người dùng chờ đủ thời gian đó.
- **Gói trả phí hoặc model khác**: đo lại bằng cùng bộ câu hỏi trước khi đổi.
- **Streaming câu trả lời** (`generateContentStream`) để hiện chữ dần: không giảm tổng thời gian nhưng người dùng thấy phản hồi sớm hơn; phải sửa cả backend lẫn frontend.

---

## 10. Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GEMINI_API_KEY` | — | Key Google AI Studio. Thiếu thì app vẫn chạy, chỉ lượt chat báo lỗi. |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Model được pin rõ ràng (không dùng alias kiểu `-latest`), để thay đổi phía Google không âm thầm đổi hành vi hay chi phí. |
| `LLM_MAX_OUTPUT_TOKENS` | `1024` | Giới hạn token đầu ra mỗi lần gọi. |
| `LLM_RETRY_ATTEMPTS` | `3` | Tổng số lần thử, tính cả lần đầu. |
| `CHATBOT_RATE_LIMIT_PER_MINUTE` | `10` | Tin nhắn mỗi user mỗi phút. |
| `CHATBOT_RATE_LIMIT_PER_DAY` | `200` | Tin nhắn mỗi user mỗi ngày. |
| `CHATBOT_DOCS_DIR` | `../docs` (dev) / `/app/docs` (Docker) | Thư mục chứa tài liệu cho `search_docs`. |

---

## 11. Frontend

- **Trang `/chatbot`**: danh sách cuộc trò chuyện bên trái, khung chat bên phải; cuộc trò chuyện đang mở nằm trên URL (`?c=<id>`).
- **Chat nhanh**: nút nổi góc dưới phải trên mọi trang (trừ `/chatbot`), mở cửa sổ chat và nhớ cuộc trò chuyện dùng lần trước (`localStorage`). Staff chưa check-in ca không thấy nút này.
- Gửi tin qua socket `chatbot:send`, nhận `chatbot:message` / `chatbot:tool_call` / `chatbot:error` từ room `user:{id}` và khử trùng tin nhắn theo `id` (tab gửi nhận tin của mình cả qua ack lẫn sự kiện).
- Câu trả lời hiển thị dạng Markdown (`react-markdown` + `remark-gfm`, không render HTML thô). Tên tool được ánh xạ sang nhãn tiếng Việt cho dòng "Đang tra cứu…" trong `frontend/src/lib/chatbot.ts`: thêm tool mới thì thêm nhãn ở đây.

---

## 12. Thêm một tool mới

1. **Khai báo** trong `chatbot-tools.definitions.ts`: tên, mô tả nói rõ *khi nào nên dùng*, JSON Schema tham số (dùng `WAREHOUSE_REF` / `COLD_ROOM_REF` / `DEVICE_REF` / `BATCH_REF` cho tham số chỉ tới tài nguyên), `allowedRoles` và `requireShift` **khớp với route REST tương ứng**.
2. **Viết handler** trong `ChatbotToolExecutorService` và thêm vào `dispatch()`:
   - nạp phạm vi bằng `loadScope(caller)` và phân giải tham số bằng `resolveWarehouse` / `resolveColdRoom` / `resolveDevice` / `resolveBatch` / `roomsFor` — không bao giờ dùng thẳng id model đưa vào;
   - chỉ trả các trường cần thiết, kèm tên thay cho id (`location()`), dùng `listResult()` cho danh sách có giới hạn;
   - lỗi dành cho model thì ném `ChatbotToolError`.
3. **Test** trong `chatbot-tool-executor.service.spec.ts`: ít nhất một trường hợp bị từ chối vì ngoài phạm vi hoặc sai role.
4. Thêm **nhãn tiếng Việt** cho tool trong `frontend/src/lib/chatbot.ts`.
5. Nếu tool thay thế một chuỗi gọi hay gặp, cập nhật phần "Cách lấy dữ liệu hiệu quả" trong system prompt.

---

## 13. Hạn chế đã biết

- Ba tool tổng hợp (`get_inventory_summary`, `get_staff_performance_summary`, `get_previous_shift_summary`) chưa được triển khai.
- Không có timeout cho lần gọi Gemini (mục 9).
- Model `flash-lite` không phải lúc nào cũng làm theo gợi ý trong kết quả tool: ví dụ vẫn gọi thêm tool nhiệt độ dù `get_cold_room_detail` đã ghi rõ phòng không có mẫu gần đây.
- Không streaming: người dùng chỉ thấy câu trả lời khi đã hoàn tất (trong lúc chờ có dòng "Đang tra cứu…").
- Rate limit dùng cửa sổ cố định: sát ranh giới cửa sổ có thể lọt tới gấp đôi giới hạn.
- `SYSTEM_OPERATIONS_GUIDE.md` hiện rỗng nên `search_docs` chưa tìm được gì trong file này.
