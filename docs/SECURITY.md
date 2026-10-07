# Bảo mật

> Tổng hợp các cơ chế bảo mật đang có trong hệ thống: xác thực và phiên, chống dò mật khẩu khi đăng nhập, phân quyền, bảo mật MQTT, và các điểm còn thiếu. Chi tiết hạ tầng (cổng, tunnel, biến môi trường) xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md); chi tiết endpoint xem [API_DESIGN.md](API_DESIGN.md).

---

## 1. Xác thực & phiên

JWT được gửi qua **cookie httpOnly**, không dùng header `Authorization`, nên JavaScript phía trình duyệt không đọc được token.

| Token   | Cookie (mặc định) | Path  | Secret               | Hạn (mặc định) |
| ------- | ----------------- | ----- | -------------------- | -------------- |
| Access  | `access_token`    | `/`   | `JWT_SECRET`         | 15 phút        |
| Refresh | `refresh_token`   | `/auth` | `JWT_REFRESH_SECRET` | 7 ngày         |

- Hai token dùng **hai secret khác nhau**; không dùng lẫn.
- Cookie đặt `httpOnly`, `sameSite: 'lax'`, và `secure` khi `NODE_ENV=production`. Cookie refresh chỉ được gửi tới `/auth/*`.
- **Một phiên cho mỗi user.** Redis lưu `sha256(refreshToken)` (không lưu token thô) ở key `refresh:<userId>`, TTL bằng thời hạn còn lại của token. Đăng nhập lại hoặc refresh sẽ ghi đè key, nên phiên ở nơi khác bị vô hiệu. Mỗi lần refresh đều xoay vòng cả cặp token.
- Access token chứa sẵn `role`/`status` và **không truy vấn DB** mỗi request, nên đổi role chỉ có hiệu lực khi access token hiện tại hết hạn. Ngoại lệ là khoá/xoá tài khoản: `UsersService` đặt key Redis `blocked:<userId>`, được `JwtStrategy` và `RealtimeGateway` kiểm tra mỗi request/handshake, nên có hiệu lực ngay.
- Đăng xuất xoá key refresh trong Redis và xoá cả hai cookie. Route logout dùng `JwtRefreshGuard` để vẫn hoạt động khi access token đã hết hạn.

## 2. Đăng nhập

### 2.1 Chống dò username

- Username không tồn tại vẫn chạy một lần `bcrypt.compare` với hash giả, nên thời gian phản hồi gần bằng trường hợp sai mật khẩu.
- Cả hai trường hợp trả cùng thông báo `Invalid username or password`. **Đừng** tách thông báo hoặc bỏ hash giả.
- Ghi audit log `auth.login_failed` chạy nền (không `await`) để không tạo chênh lệch thời gian giữa các nhánh lỗi.

### 2.2 Giới hạn đăng nhập sai

`LoginRateLimiterService` chạy **trước** mọi truy vấn user và bcrypt, nên client bị chặn nhận cùng một mã 429 dù username có tồn tại hay không, và không tốn CPU băm mật khẩu. Trạng thái nằm trong Redis nên giữ nguyên qua restart và nhiều replica. Response 429 có header `Retry-After` (giây).

Ba bucket đếm số lần sai, mỗi bucket bù cho lỗ hổng của hai bucket kia:

| Bucket       | Đếm theo           | Chặn kiểu tấn công                              | Mặc định | Khoá              |
| ------------ | ------------------ | ----------------------------------------------- | -------- | ----------------- |
| `account_ip` | username + IP      | Một client đoán mật khẩu của một tài khoản      | 5 lần    | Tăng dần          |
| `ip`         | IP                 | Một client thử nhiều username (password spraying) | 30 lần | Tăng dần          |
| `account`    | username           | Nhiều IP (botnet) cùng nhắm một tài khoản       | 50 lần   | Cố định 15 phút   |

- **Cửa sổ đếm:** `LOGIN_FAILED_WINDOW_MINUTES` (15 phút) tính từ lần sai đầu tiên của bucket.
- **Khoá tăng dần** (`account_ip`, `ip`): lần khoá thứ 1/2/3/4+ lần lượt là 1/5/15/60 phút (`LOGIN_LOCKOUT_STEPS_MINUTES`). Số lần khoá ("strike") bị quên sau `LOGIN_LOCKOUT_RESET_HOURS` (24 giờ) không có khoá mới.
- **Bucket `account` không tăng dần và có ngưỡng cao.** Ai cũng có thể cố tình đăng nhập sai bất kỳ username nào từ bất kỳ đâu; nếu khoá tăng dần thì kẻ tấn công dễ khoá người dùng thật (hoặc admin) hàng giờ.
- **Đăng nhập đúng mật khẩu không bị tính là lần đoán.** Mỗi lần thử được "giữ chỗ" trước rồi hoàn lại khi mật khẩu đúng: xoá hẳn bucket và strike `account_ip`, còn bucket `ip` và `account` chỉ được trả lại đúng 1 lượt (để thành công không xoá được các lần sai do người khác gây ra). Strike của `ip` không bao giờ bị xoá bởi đăng nhập thành công, vì kẻ tấn công có thể tự đăng nhập tài khoản của mình để reset.
- Kiểm tra và đếm nằm trong **một script Lua**, nên nhiều request đồng thời không cùng vượt qua bước kiểm tra trước khi được đếm.
- Bucket `account_ip`/`account` đầy sẽ đánh dấu tài khoản bị chặn (hiển thị ở trang Users). Admin có thể **mở khoá sớm** (`UsersService.unlock`).
- Mọi giá trị đọc từ env (xem [server/.env.example](../server/.env.example)). Giá trị không phải số nguyên dương, hoặc `LOGIN_LOCKOUT_STEPS_MINUTES` giảm dần, làm app **từ chối khởi động** thay vì chạy với chính sách hỏng.

**Phụ thuộc vào `TRUST_PROXY`:** hai bucket theo IP dùng `req.ip`. Sau Cloudflare Tunnel phải đặt `TRUST_PROXY=1`, nếu không mọi client có chung IP của proxy và một người sai nhiều lần sẽ khoá tất cả. Ngược lại, **không bật** khi không có proxy, vì client giả `X-Forwarded-For` sẽ né được giới hạn theo IP.

### 2.3 Khoá tài khoản thủ công

Admin khoá tài khoản (`status = LOCKED`): đăng nhập trả 403, `refreshTokens` xoá phiên Redis, và key `blocked:<userId>` cắt access token đang dùng ngay lập tức.

## 3. Mật khẩu

- Lưu bằng **bcrypt** (`bcryptjs`). `passwordHash` không bao giờ ra khỏi API: `UserResponseDto` chỉ `@Expose()` các field an toàn và `UsersService` còn tự loại bỏ thêm (phòng thủ nhiều lớp).
- Độ dài: tối thiểu **6**, tối đa **64** ký tự; username tối đa 50 (`libs/constants/auth.constant.ts`). Cùng một hằng số dùng cho login, tạo user, đổi và reset mật khẩu, để không tạo được tài khoản mà không đăng nhập được. Mức tối đa 64 giữ mật khẩu ASCII dưới giới hạn 72 byte của bcrypt (byte thừa bị bỏ qua âm thầm).
- `ValidationPipe({ whitelist: true, transform: true })` bật toàn cục: field ngoài DTO bị loại.

## 4. Phân quyền

- Mọi route mặc định yêu cầu đăng nhập; route công khai phải đánh dấu `@Public()` (ví dụ `login`, `refresh`, `logout`).
- `RolesGuard` + `@Roles(...)` kiểm tra role (Admin, Manager, Technician, Staff) từ `req.user.role`.
- Dữ liệu theo kho được giới hạn theo kho mà user được phân công. Chatbot cũng chỉ truy vấn trong phạm vi kho của user.
- Socket.IO (`RealtimeGateway`) xác thực bằng cùng cookie và kiểm tra key `blocked:` ở handshake.

## 5. Mạng, CORS, cookie

- `CORS_ORIGINS` là danh sách origin chính xác, **không dùng `*`** (đang bật `credentials: true`). Áp dụng cho cả REST lẫn Socket.IO.
- Ở production, API và datastore chỉ bind `127.0.0.1`; truy cập public qua Cloudflare Tunnel (HTTPS, ẩn IP gốc). **Không bỏ tiền tố `127.0.0.1:`** trong `ports`: Docker tự thêm rule iptables vượt qua `ufw`/`firewalld`.
- Frontend và API nên cùng registrable domain và phục vụ qua HTTPS, vì cookie `secure` + `sameSite: 'lax'`.

## 6. MQTT (thiết bị)

Broker bắt buộc đăng nhập (`allow_anonymous false`). Password file và ACL được **sinh lúc container khởi động** từ env bởi [mosquitto/entrypoint.sh](../mosquitto/entrypoint.sh): credential chỉ nằm trong `.env`, không nằm trong git hay trên đĩa host. Thiếu bất kỳ biến `MQTT_*` nào thì container không khởi động.

| Tài khoản              | Dùng bởi            | Quyền                                                     |
| ---------------------- | ------------------- | --------------------------------------------------------- |
| `MQTT_USERNAME`        | Backend (và healthcheck) | Đọc `devices/+/telemetry`, `devices/+/ack` và `$SYS/#`; ghi `devices/+/commands` và `devices/+/config` |
| `MQTT_DEVICE_USERNAME` | Firmware ESP32 (dùng chung) | Ghi `devices/+/telemetry`; đọc `devices/<client id>/commands`, `devices/<client id>/config` và ghi `devices/<client id>/ack` (ACL `pattern` với `%c`) |

Nhờ ACL, credential thiết bị bị lộ cũng không đọc được dữ liệu hay lệnh của thiết bị khác, và không giả danh server được. Firmware kết nối với client ID = `unique_id`, nên mỗi board chỉ nhận lệnh của chính nó. Server còn kiểm tra thêm: ack chỉ được chấp nhận khi lệnh thuộc đúng thiết bị có tên trong topic. Thư mục `/mosquitto/auth` được `chmod 700`, file `passwd`/`acl` được `chmod 600` và thuộc user `mosquitto`.

## 7. Bí mật & cấu hình

- `.env` (root) và `server/.env` nằm trong `.gitignore`; `.env` cũng nằm trong `.dockerignore` của `server`. Nên `chmod 600 .env`.
- Sinh secret bằng `openssl rand -hex 32`; `JWT_SECRET` và `JWT_REFRESH_SECRET` phải khác nhau và khác bộ dev.
- Khoá VAPID (Web Push) ở production phải là cặp khoá riêng (`npx web-push generate-vapid-keys`), không dùng lại cặp dev.
- Seed: cả 4 tài khoản seed dùng chung `SEED_ADMIN_PASSWORD`. Sau lần `init.sh` đầu, xoá hoặc đổi biến này trong `.env` và đổi mật khẩu các tài khoản qua giao diện.
- Credential datastore chỉ có hiệu lực ở lần khởi động đầu khi volume còn rỗng (xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md) mục 6).

## 8. Audit log

- `auth.login` và `auth.login_failed` được ghi kèm IP và User-Agent; lý do thất bại nằm trong metadata (`unknown_username`, `wrong_password`, `locked`). Với username không tồn tại, `user_id` là null và username thử được giữ trong metadata.
- Request bị rate limiter từ chối **không** ghi audit, vì các lần sai đã tạo ra bucket đầy đều đã được ghi; ghi thêm mỗi request bị chặn sẽ cho phép một đợt flood làm phình bảng.

## 9. Điểm còn thiếu

| Vấn đề                                              | Rủi ro                                                                                       | Hướng xử lý                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| MQTT không có TLS                                   | Credential đi dạng plain text; chỉ chấp nhận được trên LAN tin cậy                           | Thêm listener TLS 8883                                                                          |
| Mọi thiết bị dùng chung một tài khoản MQTT          | Lộ credential của một thiết bị cho phép giả telemetry của mọi thiết bị                        | Credential riêng từng thiết bị (username = `unique_id`, ACL `pattern write devices/%u/telemetry`) |
| Mật khẩu tối thiểu chỉ 6 ký tự, không kiểm tra độ mạnh | Dễ đoán; rate limiter chỉ làm chậm chứ không ngăn được mật khẩu yếu                       | Nâng tối thiểu (OWASP khuyến nghị ≥ 8) và/hoặc chặn mật khẩu phổ biến                            |
| Không có MFA                                        | Lộ mật khẩu là mất tài khoản                                                                 | Cân nhắc TOTP cho Admin                                                                         |
| Không có rate limit chung cho các route khác        | Chỉ `POST /auth/login` và chatbot có giới hạn                                                | Thêm throttler toàn cục cho các route ghi/tốn tài nguyên                                        |
| Chưa có security header (ví dụ `helmet`)            | Thiếu một lớp phòng thủ mặc định ở tầng HTTP                                                 | Thêm `helmet` trong `main.ts`                                                                   |
| Bucket MinIO cho đọc public                         | Ai có URL đều xem được ảnh                                                                   | Chuyển sang presigned URL nếu ảnh cần riêng tư                                                   |
| Image dùng tag `latest`, chưa có backup tự động     | Phiên bản đổi ngoài ý muốn; mất dữ liệu khi hỏng đĩa                                         | Pin phiên bản; cron backup (xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md) mục 7)                    |

## 10. Checklist trước khi triển khai

- [ ] `NODE_ENV=production`, `TRUST_PROXY=1` (chỉ khi có proxy), `CORS_ORIGINS` đúng origin frontend.
- [ ] `JWT_SECRET`, `JWT_REFRESH_SECRET`, `VAPID_*`, `MQTT_*`, mật khẩu datastore đều là giá trị riêng cho production.
- [ ] Đã xoá/đổi `SEED_ADMIN_PASSWORD` sau khi seed.
- [ ] Firmware ESP32 dùng `MQTT_DEVICE_USERNAME/PASSWORD`, không dùng tài khoản backend.
- [ ] Cổng datastore trong compose production vẫn có tiền tố `127.0.0.1:`.
- [ ] `chmod 600 .env`.
