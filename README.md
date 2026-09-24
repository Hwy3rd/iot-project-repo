# IoT Cold Storage Management System

Hệ thống giám sát & quản lý kho lạnh: theo dõi nhiệt độ/thiết bị IoT theo thời gian thực, quản lý lô hàng, cảnh báo, ca trực nhân viên, và phân quyền theo vai trò (RBAC) trên nhiều kho.

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Backend API | NestJS (TypeScript) — [server/](server/) |
| Dữ liệu quan hệ | MySQL + TypeORM (migration-based, không dùng `synchronize`) |
| Dữ liệu phi quan hệ | MongoDB + Mongoose |
| Queue / job nền | Redis + BullMQ (worker riêng biệt) |
| Lưu trữ file | MinIO (S3-compatible) |
| Realtime | WebSocket (Socket.IO), cùng cổng với HTTP |
| Auth | JWT qua httpOnly cookie (access + refresh token, single-session/user) |

Xem chi tiết kiến trúc & quy ước code trong [server/CLAUDE.md](server/CLAUDE.md).

## Cấu trúc thư mục

```
.
├── server/                       # NestJS backend (toàn bộ code ứng dụng)
├── frontend/                     # (chưa scaffold)
├── docs/                         # Tài liệu thiết kế
│   ├── API_DESIGN.md             # REST + WebSocket API reference
│   ├── DATABASE_DESIGN.md        # Schema, quan hệ, entity
│   └── RBAC.md                   # Vai trò, phạm vi, ma trận quyền
├── docker-compose.yml            # Dev: full stack, publish port ra localhost, credential mặc định
├── docker-compose.production.yml # Production (độc lập): bắt buộc credential, không publish port, cloudflared
├── init.sh                       # Khởi tạo hệ thống lần đầu (build, migrate, seed admin)
└── run.sh                        # Start/stop/restart hệ thống đã khởi tạo
```

## Bắt đầu nhanh

**Yêu cầu:** Docker + Docker Compose v2.

1. Tạo `.env` ở root từ mẫu [.env.example](.env.example) (điền các giá trị `<CHANGE_ME_...>`, rồi `chmod 600 .env`) — đây là file env duy nhất của `docker-compose.production.yml`: nạp vào container `app`/`worker`, đồng thời cấp mật khẩu cho mysql/mongo/minio và token cho `cloudflared`. Tách riêng khỏi `server/.env` (dùng khi chạy backend trực tiếp trên host, xem mục dev bên dưới).
2. Khởi tạo hệ thống (build image, chạy migration, seed tài khoản admin đầu tiên):
   ```bash
   ./init.sh
   ```
   Production không publish port nào ra host ngoài MQTT `1883`: API và MinIO được truy cập qua hostname của Cloudflare Tunnel (xem [.env.example](.env.example)).
3. Các lần sau, không cần chạy lại `init.sh` — dùng `run.sh` để bật/tắt:
   ```bash
   ./run.sh stop      # tắt, giữ nguyên dữ liệu
   ./run.sh start      # bật lại
   ./run.sh status      # xem trạng thái container
   ./run.sh logs app    # xem log
   ```

Nếu chỉ cần chạy backend trực tiếp trên host (không qua container `app`) để dev với hot-reload — tạo `server/.env` từ mẫu [server/.env.example](server/.env.example) (khác với `.env` ở root, chỉ dùng cho container; hostname là `localhost`, mật khẩu datastore khớp mặc định của `docker-compose.yml`):
```bash
cp server/.env.example server/.env   # rồi điền các giá trị <...>
docker compose up -d redis mysql mongo minio mosquitto   # chỉ datastore + broker
cd server && pnpm install
pnpm migration:run
pnpm start:dev
```

## Kết nối thiết bị ESP32 qua WiFi (WSL2)

Server chạy trong Docker trên WSL2, mặc định nằm sau NAT riêng nên thiết bị cùng WiFi không kết nối được tới MQTT `1883`. Chạy **một lần** trên Windows, trong PowerShell mở bằng *Run as Administrator* (bật mirrored networking, chuyển mạng sang Private, mở firewall `1883`, in IP LAN để nạp vào ESP32, rồi `wsl --shutdown`):

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\<đường dẫn repo>\scripts\setup-windows-lan.ps1
```

Khi đổi sang WiFi/hotspot mới, chạy lại để chuyển mạng đó sang Private (các bước đã làm sẽ được bỏ qua).

## Tài liệu

- [docs/REQUIREMENT.md](docs/REQUIREMENT.md) — Bài toán, đối tượng sử dụng, yêu cầu chức năng/phi chức năng.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Tổng quan kiến trúc backend: tiến trình, luồng dữ liệu, các phần đã/chưa hoàn thiện.
- [docs/API_DESIGN.md](docs/API_DESIGN.md) — API REST + WebSocket, quy ước response/lỗi, mã hoá quyền theo endpoint.
- [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) — Schema MySQL, quan hệ giữa các entity.
- [docs/RBAC.md](docs/RBAC.md) — 4 vai trò (Admin/Manager/Technician/Staff), phạm vi theo warehouse, ma trận quyền theo module.
- [server/CLAUDE.md](server/CLAUDE.md) — Quy ước kiến trúc, cấu trúc module, auth flow, ghi chú kỹ thuật khi phát triển backend.

`docs/MESSAGE_QUEUE.md`, `docs/NOTIFICATION.md` hiện chưa có nội dung — sẽ bổ sung sau.
