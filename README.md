# IoT Cold Storage Management System

Hệ thống giám sát & quản lý kho lạnh: theo dõi nhiệt độ/thiết bị IoT theo thời gian thực, quản lý lô hàng, cảnh báo, ca trực nhân viên, và phân quyền theo vai trò (RBAC) trên nhiều kho.

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Frontend | React + Vite (TypeScript) — [frontend/](frontend/) |
| Backend API | NestJS (TypeScript) — [server/](server/) |
| Dữ liệu quan hệ | MySQL + TypeORM (migration-based, không dùng `synchronize`) |
| Dữ liệu phi quan hệ | MongoDB + Mongoose |
| Queue / job nền | Redis + BullMQ (worker riêng biệt) |
| Lưu trữ file | MinIO (S3-compatible) |
| Realtime | WebSocket (Socket.IO), cùng cổng với HTTP |
| Auth | JWT qua httpOnly cookie (access + refresh token, single-session/user) |
| Dự báo nhiệt độ | Python FastAPI + scikit-learn, service riêng — [ai-service/](ai-service/) |

Xem chi tiết kiến trúc & quy ước code trong [server/CLAUDE.md](server/CLAUDE.md).

## Cấu trúc thư mục

```
.
├── server/                       # NestJS backend (toàn bộ code ứng dụng)
├── frontend/                     # React + Vite SPA
├── ai-service/                   # FastAPI dự báo nhiệt độ 15 phút tới (model scikit-learn)
├── docs/                         # Tài liệu thiết kế & vận hành
│   ├── DEVELOPMENT.md            # Chạy môi trường dev local
│   ├── INFRASTRUCTURE.md         # Hạ tầng production, Cloudflare Tunnel
│   ├── API_DESIGN.md             # REST + WebSocket API reference
│   ├── DATABASE_DESIGN.md        # Schema, quan hệ, entity
│   └── RBAC.md                   # Vai trò, phạm vi, ma trận quyền
├── docker-compose.yml            # Dev: full stack, publish port ra localhost, credential mặc định
├── docker-compose.production.yml # Production (độc lập): bắt buộc credential, port chỉ bind 127.0.0.1, cloudflared
├── init.sh                       # Khởi tạo hệ thống lần đầu (build, migrate, seed admin)
└── run.sh                        # Start/stop/restart hệ thống đã khởi tạo
```

## Bắt đầu nhanh

**Yêu cầu:** Docker + Docker Compose v2.

1. Tạo `.env` ở root từ mẫu [.env.example](.env.example) (điền các giá trị `<CHANGE_ME_...>`, rồi `chmod 600 .env`) — đây là file env duy nhất của `docker-compose.production.yml`: nạp vào container `app`/`worker`, đồng thời cấp mật khẩu cho mysql/mongo/minio và token cho `cloudflared`. Tách riêng khỏi `server/.env` (dùng khi chạy backend trực tiếp trên host, xem mục dev bên dưới).
2. Khởi tạo hệ thống (build image, chạy migration, seed tài khoản admin đầu tiên cùng một tài khoản Manager/Technician/Staff, chung mật khẩu admin):
   ```bash
   ./init.sh
   ```
   Production chỉ publish MQTT `1883` ra ngoài; API, MinIO và datastore chỉ bind `127.0.0.1` (dùng client ngay trên máy chủ). Từ bên ngoài, API và MinIO được truy cập qua hostname của Cloudflare Tunnel (xem [.env.example](.env.example)).
3. Các lần sau, không cần chạy lại `init.sh` — dùng `run.sh` để bật/tắt:
   ```bash
   ./run.sh stop      # tắt, giữ nguyên dữ liệu
   ./run.sh start      # bật lại
   ./run.sh dev        # bật mọi thứ trừ app + cloudflared, để tự chạy backend trên host
   ./run.sh rebuild    # sau git pull: build lại app + worker (thêm `rebuild ai-service` nếu ai-service/ đổi)
   ./run.sh status      # xem trạng thái container
   ./run.sh logs app    # xem log
   ```

## Phát triển local

Datastore chạy bằng Docker, backend và frontend chạy trực tiếp trên host với hot-reload. Tóm tắt:

```bash
docker compose up -d redis mysql mongo minio mosquitto   # chỉ datastore + broker
docker compose up -d --build ai-service                  # (tuỳ chọn) dự báo nhiệt độ AI
cd server && cp .env.example .env    # điền các giá trị <...>
npm install && npm run migration:run && npm run seed:admin && npm run start:dev
# terminal khác, từ root repo:
cd frontend && cp .env.example .env && npm install && npm run dev
```

Hoặc dùng luôn stack production đã `init.sh` (chung dữ liệu với production) thay cho `docker compose up -d ...` ở trên:

```bash
./run.sh stop     # nếu app/cloudflared đang chạy — `dev` không tự dừng chúng
./run.sh dev      # up worker + datastore + broker + ai-service, không up app/cloudflared
cd server && npm run start:dev   # tự chạy backend trên host
```

Khi đó `server/.env` phải dùng đúng credential trong `.env` ở root (không phải giá trị mặc định của dev). `worker` đã chạy trong container nên không chạy thêm worker trên host.

Hướng dẫn đầy đủ (cách tạo secret, seed dữ liệu mẫu, worker, cổng, lỗi thường gặp) xem [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Kết nối thiết bị ESP32 qua WiFi (WSL2)

Server chạy trong Docker trên WSL2, mặc định nằm sau NAT riêng nên thiết bị cùng WiFi không kết nối được tới MQTT `1883`. Chạy **một lần** trên Windows, trong PowerShell mở bằng *Run as Administrator* (bật mirrored networking, chuyển mạng sang Private, mở firewall `1883`, in IP LAN để nạp vào ESP32, rồi `wsl --shutdown`):

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\<đường dẫn repo>\scripts\setup-windows-lan.ps1
```

Khi đổi sang WiFi/hotspot mới, chạy lại để chuyển mạng đó sang Private (các bước đã làm sẽ được bỏ qua).

## Tài liệu

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — Chạy môi trường dev local cho người mới clone repo.
- [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) — Hạ tầng production: container, cổng, Cloudflare Tunnel, volume, vận hành.
- [docs/REQUIREMENT.md](docs/REQUIREMENT.md) — Bài toán, đối tượng sử dụng, yêu cầu chức năng/phi chức năng.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Tổng quan kiến trúc backend: tiến trình, luồng dữ liệu, các phần đã/chưa hoàn thiện.
- [docs/API_DESIGN.md](docs/API_DESIGN.md) — API REST + WebSocket, quy ước response/lỗi, mã hoá quyền theo endpoint.
- [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) — Schema MySQL, quan hệ giữa các entity.
- [docs/RBAC.md](docs/RBAC.md) — 4 vai trò (Admin/Manager/Technician/Staff), phạm vi theo warehouse, ma trận quyền theo module.
- [docs/MESSAGE_QUEUE.md](docs/MESSAGE_QUEUE.md) — BullMQ giữa `app`/`worker` và MQTT với thiết bị.
- [docs/NOTIFICATION.md](docs/NOTIFICATION.md) — Cơ chế thông báo: khi nào gửi, gửi cho ai, luồng xử lý.
- [docs/LLM_ARCHITECTURE.md](docs/LLM_ARCHITECTURE.md) — Trợ lý AI: luồng một lượt trả lời, bộ tool đọc dữ liệu, phân quyền, giới hạn, cấu hình.
- [server/CLAUDE.md](server/CLAUDE.md) — Quy ước kiến trúc, cấu trúc module, auth flow, ghi chú kỹ thuật khi phát triển backend.
