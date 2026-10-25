# Phục hồi dữ liệu và thông báo sau mất mạng

Tài liệu này thay thế các mô tả cũ về mất thông báo, retry, MQTT clean session
trong `MESSAGE_QUEUE.md`, `NOTIFICATION.md` và `ARCHITECTURE.md`.

## Hành vi mới

| Sự cố | Cách khôi phục |
|---|---|
| Server mất Internet, datastore còn hoạt động | Alert và yêu cầu gửi vẫn lưu MySQL; push lỗi mạng được thử lại |
| Redis mất kết nối hoặc mất queue | Worker quét MySQL mỗi 5 giây, không cần job Redis để tìm công việc |
| Worker chết giữa lúc gửi | Lease MySQL hết sau 60 giây; worker khác/lần khởi động sau tiếp tục |
| Một trong nhiều trình duyệt gửi lỗi | Chỉ retry trình duyệt đó, không gửi lại tới các trình duyệt đã thành công |
| ESP32 mất WiFi hoặc backend không nhận telemetry | Mẫu đo lưu LittleFS; gửi lại tới khi có ACK từ backend |
| Frontend ngắt socket | Khi kết nối lại, tải lại trạng thái phòng, thiết bị, alert và notification |

### Backend

`AlertsService.raise()` lưu alert và `notification_outbox` trong **cùng transaction**.
Outbox chụp danh sách người nhận, nội dung và thời điểm sự cố. Lỗi ghi outbox làm
transaction rollback; enqueue Redis chỉ là tín hiệu xử lý sớm, không quyết định
việc thông báo có tồn tại hay không.

`NotificationRecoveryService` chạy trong worker, có timer riêng mỗi 5 giây.
Nó tạo notification từ outbox, chuẩn bị các dòng `notification_deliveries`
(mỗi notification/subscription một dòng), rồi xử lý các lần gửi tới hạn.
Mọi bước tạo dữ liệu đều có khóa/ràng buộc chống trùng.

`notifications.dedupe_key` duy nhất theo `alertId:userId`. Các dòng trùng từ bản
cũ được giữ nguyên; migration chỉ gán khóa cho một dòng chuẩn (ưu tiên dòng đã gửi).
Outbox đã xử lý chỉ được đánh dấu sau khi notification đã lưu thành công.
Các delivery chờ gửi vẫn ở MySQL nên Redis mất dữ liệu không làm mất chúng.

Lỗi mạng, timeout, HTTP 408/429/5xx được retry: 5s, 10s, 20s… tối đa 5 phút
giữa các lần; tôn trọng `Retry-After`. HTTP 404/410 xoá endpoint hết hiệu lực;
các lỗi HTTP còn lại kết thúc delivery. Không có subscription thì notification
vẫn tồn tại trong app, nhưng không thử gửi push mãi.

Mỗi lần gửi có timeout 10 giây, lease 60 giây và token riêng để ngăn worker cũ
ghi đè kết quả của lượt mới. Trước mỗi push, kiểm tra lại chủ subscription,
tài khoản và phân công kho. Browser chuyển sang user khác hoặc quyền kho bị
thu hồi thì không nhận các push đang chờ của user trước.

**Cửa sổ push: 6 giờ tính từ lúc sự cố được ghi nhận**, không gia hạn sau mỗi
retry. Sau đó delivery thành `expired`; notification trong app vẫn còn.
`notifications.status` giữ tương thích API: `pending` khi chờ, `sent` nếu ít
nhất một browser thành công, `failed` nếu không còn lần gửi nào có thể tiếp tục.
Các browser lỗi vẫn được retry riêng ngay cả khi notification tổng đã `sent`.

Sự cố resolved trước lúc gửi có tiêu đề cho biết đã kết thúc. Sự cố phát hiện
từ mẫu gửi bù được gom tối đa một bản ghi mỗi thiết bị/loại/phòng/giờ, đánh dấu
`details.replayed`, không thay đổi alert đang hoạt động. Tiêu đề push ghi rõ là
lịch sử trong thời gian mất kết nối; trạng thái resolved ở bản ghi này có nghĩa
không phải alert thời gian thực, không chứng minh sự cố vật lý đã hết.

**Không cam kết push hiển thị đúng một lần**: worker có thể chết sau khi provider
nhận push nhưng trước khi commit kết quả. Khi đó sẽ gửi lại. Service worker
dùng tag alert/notification để thay thế thông báo trùng; `sent` vẫn chỉ là
provider đã nhận, không phải người dùng đã đọc.

### Telemetry và firmware

Backend dùng `clean: false`, ID ổn định `<MQTT_CLIENT_ID>-app` và
`<MQTT_CLIENT_ID>-worker`. Mặc định base ID là `iot-backend`; mỗi môi trường
chia sẻ broker phải có base ID riêng. Chưa hỗ trợ nhiều replica app dùng chung
một ID. Broker Cloud phải cho phép persistent session; giới hạn queue/expiry
của broker vẫn áp dụng.

Firmware vẫn dùng PubSubClient publish QoS 0, nên không dựa vào QoS của broker
để bảo đảm đã lưu database. Mỗi mẫu có `ts` UTC giữ nguyên, được commit xuống
LittleFS bằng file tạm + rename trước khi publish. Backend chỉ gửi
`devices/<uniqueId>/telemetry-ack` với `{ ts, status: "stored" }` sau khi lưu mẫu
và xử lý alert/outbox thành công; mẫu trùng được ACK lại. Mongo đã lưu nhưng
MySQL lỗi thì không ACK, lần sau tiếp tục phần xử lý chưa hoàn thành qua
`effectsApplied`. Bộ đệm chỉ xoá mẫu khi nhận ACK.

Mỗi board giữ tối đa **720 mẫu chưa được ACK** (~1 giờ nếu đúng chu kỳ 5 giây;
ngắn hơn nếu có nhiều sự kiện). Đầy thì bỏ mẫu cũ nhất, có cảnh báo Serial;
không thể giữ vô hạn. Gửi mẫu hiện tại ngay, đồng thời phát lại một mẫu tồn
mỗi 250ms theo vòng. Mất điện/khởi động lại khôi phục các file đã commit.
Mẫu đang ghi đúng lúc mất điện có thể chưa commit. Ghi flash có hao mòn;
vận hành dài hạn/tần suất cao nên dùng bộ nhớ phù hợp hoặc thẻ nhớ.

**Cần partition filesystem và LittleFS đã được chuẩn bị.** Firmware gọi
`LittleFS.begin(false)` và không tự format. Nếu mount lỗi, Serial báo rõ và
board chỉ còn gửi trực tiếp. Với board mới, nạp image LittleFS rỗng lần đầu
bằng công cụ filesystem của ESP32; không format board đang có mẫu chờ gửi.
Firmware cần có giờ NTP hợp lệ ít nhất một lần trong lần khởi động đó trước
khi tạo mẫu có timestamp. Board reboot khi hoàn toàn offline cần RTC ngoài
nếu muốn tiếp tục ghi chính xác giờ tuyệt đối ngay lập tức.

Mẫu phát lại có `replayed: true`; mẫu cũ hơn 60 giây hoặc đến sau mẫu mới hơn
cũng được xem là lịch sử. Lưu trong raw và đưa vào biểu đồ, nhưng không cập
nhật realtime, heartbeat, AI hay resolve alert hiện tại. Trạng thái mới nhất
của phòng/thiết bị bỏ qua mẫu replay. Ngưỡng đánh giá phía server là cấu hình
phòng tại lúc ingest; `configVersion` trong mẫu giữ dấu vết cấu hình thiết bị.
Mẫu quá 30 ngày, sớm hơn đồng hồ server quá 60 giây, hoặc thuộc phòng trước
(nếu có `coldRoomId`) bị từ chối và ACK `discarded`, kèm log, để không kẹt queue.

## Nâng cấp

1. Backup MySQL như quy trình triển khai thông thường.
2. Build lại backend/worker cùng revision và chạy migration
   `1791500000000-DurableNotifications` (`npm run migration:run` khi chạy host;
   container app tự chạy migration trước khi mở API).
3. Với Redis đang có dữ liệu RDB, bật AOF trên instance đang chạy trước:
   `docker exec redis_db redis-cli CONFIG SET appendonly yes` (compose đã đặt
   `REDISCLI_AUTH`). Kiểm tra `docker exec redis_db redis-cli INFO persistence`,
   chờ `aof_rewrite_in_progress:0` và `aof_last_bgrewrite_status:ok`, rồi mới
   tạo lại container từ compose đã sửa, giữ volume. Đừng chỉ bật AOF qua lệnh
   startup rồi khởi động lại một volume chỉ có RDB. Redis mới chưa có dữ liệu
   có thể dùng compose ngay. Không dùng `down -v`. AOF `everysec` vẫn có cửa sổ
   mất khoảng 1 giây khi crash; MySQL outbox/delivery phục hồi công việc gửi thông báo.
4. Restart Mosquitto để nhận ACL mới. Với EMQX Cloud, cấp backend quyền
   publish `devices/+/telemetry-ack`, mỗi board chỉ subscribe
   `devices/<uniqueId>/telemetry-ack` của chính nó.
5. Đặt `MQTT_CLIENT_ID` riêng cho môi trường nếu dùng chung broker; restart
   app/worker. Session random của bản cũ không thể khôi phục ngược.
6. Chuẩn bị LittleFS nếu chưa có, nạp firmware mới gồm cả
   `offline_telemetry.h`, giữ nguyên config riêng của board. Build lại frontend.

Migration có thể retry các notification `pending/failed` có sẵn trong 6 giờ
gần nhất, trừ dòng trùng và dòng đã gửi. Alert cũ chưa từng có notification
hoặc dữ liệu telemetry đã mất trước bản vá không thể tự khôi phục.

## Kiểm tra khi vận hành

```sql
SELECT COUNT(*) FROM notification_outbox WHERE processed_at IS NULL;
SELECT status, COUNT(*) FROM notification_deliveries GROUP BY status;
SELECT notification_id, attempts, next_attempt_at, last_error
FROM notification_deliveries WHERE status = 'pending'
ORDER BY next_attempt_at LIMIT 20;
```

Thử trên môi trường demo: ngắt Internet (giữ MySQL), tạo sự cố, quan sát delivery
pending, nối mạng lại và kiểm tra sent. Dừng worker rồi tạo alert: outbox phải
còn pending; bật worker phải xử lý được. Ngắt Redis: outbox/delivery vẫn được
worker quét. Tắt WiFi board, tạo số đo/sự cố rồi nối lại: lịch sử phải bổ sung,
trạng thái hiện tại không bị số đo cũ ghi đè. Reset board khi còn queue và
kiểm tra Serial báo khôi phục. Kiểm tra riêng hai browser, trong đó một browser
có endpoint lỗi, để bảo đảm browser đã thành công không bị gửi lại.

Rollup định kỳ hiện tính lại 3 giờ đã đóng gần nhất. Nếu gửi bù dữ liệu cũ hơn
khoảng này, dữ liệu raw vẫn được lưu nhưng cần chạy job rollup `{ hour }` cho
các giờ cũ muốn cập nhật trong báo cáo hourly (xem `MESSAGE_QUEUE.md`).

Docker/MySQL thực và phần cứng ESP32 cần kiểm thử tích hợp riêng; unit test
mô phỏng retry/restart không thay thế việc cắt mạng hoặc nguồn trên board.
