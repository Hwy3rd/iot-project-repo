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
├── docker-compose.yml            # Dev: chỉ datastore (mysql/mongo/redis/minio)
├── docker-compose.production.yml # Full stack: app/worker + datastore + migrate job
├── init.sh                       # Khởi tạo hệ thống lần đầu (build, migrate, seed admin)
└── run.sh                        # Start/stop/restart hệ thống đã khởi tạo
```

## Bắt đầu nhanh

**Yêu cầu:** Docker + Docker Compose v2.

1. Tạo `server/.env` từ mẫu [server/.env.production.example](server/.env.production.example) (điền các giá trị `<CHANGE_ME_...>`), hoặc lấy `.env` dev từ đồng đội.
2. Khởi tạo hệ thống (build image, chạy migration, seed tài khoản admin đầu tiên):
   ```bash
   ./init.sh
   ```
   API chạy tại `http://localhost:8080`.
3. Các lần sau, không cần chạy lại `init.sh` — dùng `run.sh` để bật/tắt:
   ```bash
   ./run.sh stop      # tắt, giữ nguyên dữ liệu
   ./run.sh start      # bật lại
   ./run.sh status      # xem trạng thái container
   ./run.sh logs app    # xem log
   ```

Nếu chỉ cần chạy backend trực tiếp trên host (không qua container `app`) để dev với hot-reload:
```bash
docker compose up -d redis mysql mongo minio   # chỉ datastore
cd server && pnpm install
MYSQL_HOST=localhost pnpm migration:run
pnpm start:dev
```

## Tài liệu

- [docs/API_DESIGN.md](docs/API_DESIGN.md) — API REST + WebSocket, quy ước response/lỗi, mã hoá quyền theo endpoint.
- [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) — Schema MySQL, quan hệ giữa các entity.
- [docs/RBAC.md](docs/RBAC.md) — 4 vai trò (Admin/Manager/Technician/Staff), phạm vi theo warehouse, ma trận quyền theo module.
- [server/CLAUDE.md](server/CLAUDE.md) — Quy ước kiến trúc, cấu trúc module, auth flow, ghi chú kỹ thuật khi phát triển backend.

`docs/ARCHITECTURE.md`, `docs/MESSAGE_QUEUE.md`, `docs/NOTIFICATION.md`, `docs/REQUIREMENT.md` hiện chưa có nội dung — sẽ bổ sung sau.
