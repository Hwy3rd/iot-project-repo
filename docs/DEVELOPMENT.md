# Môi trường phát triển

> Hướng dẫn chạy toàn bộ hệ thống trên máy local để phát triển, dành cho người mới clone repo. Datastore chạy bằng Docker, còn backend và frontend chạy trực tiếp trên host để có hot-reload. Triển khai production (`init.sh`, `run.sh`, Cloudflare Tunnel) xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

---

## 1. Yêu cầu

- **Docker** + **Docker Compose v2**
- **Node.js 22** (Vite 8 cần Node ≥ 20.19)
- **npm** (đi kèm Node.js)

`server/` và `frontend/` chỉ có `pnpm-lock.yaml`, nên `npm install` sẽ resolve lại dependency theo `package.json` và tạo `package-lock.json`. Phiên bản cài được có thể lệch nhẹ so với lockfile. **Không commit `package-lock.json`**. Docker image production vẫn build bằng pnpm.

## 2. Clone

```bash
git clone <repo-url> iot-project-repo
cd iot-project-repo
```

## 3. Datastore

Chạy Redis, MySQL, MongoDB, MinIO và Mosquitto bằng [docker-compose.yml](../docker-compose.yml). Credential dùng giá trị mặc định trong file compose, khớp sẵn với `server/.env.example`.

```bash
docker compose up -d redis mysql mongo minio mosquitto
docker compose ps        # chờ tất cả ở trạng thái healthy
```

**Không** tạo file `.env` ở root. File đó dành cho production: nếu có, Compose sẽ đọc nó để điền `${MYSQL_PASSWORD:-password}`…, khiến datastore nhận credential khác với `server/.env`.

### Cách khác: dùng stack production (`./run.sh dev`)

Nếu máy đã chạy `./init.sh` (có `.env` ở root), có thể dùng luôn stack production thay cho lệnh `docker compose up` ở trên. Stack này dùng chung dữ liệu với production.

```bash
./run.sh stop    # nếu app/cloudflared đang chạy, `dev` không tự dừng chúng
./run.sh dev     # up worker + datastore + broker, không up app/cloudflared
```

Datastore ở production chỉ bind `127.0.0.1` nhưng dùng cùng cổng với dev (mục 7), nên `server/.env` vẫn trỏ `localhost`. Khác biệt:

- Credential trong `server/.env` (MySQL, Mongo, MinIO) phải khớp `.env` ở root, không dùng giá trị mặc định của `server/.env.example`.
- `worker` đã chạy trong container, **bỏ qua mục 5**. Container này chạy image đã build, không phải code đang sửa. Muốn nó nhận code mới thì `./run.sh rebuild worker`.
- Backend thì vẫn tự chạy trên host như mục 4.

## 4. Backend (NestJS)

```bash
cd server
cp .env.example .env
```

Điền các giá trị `<...>` trong `server/.env`:

| Biến                                    | Cách tạo                                                       |
| --------------------------------------- | -------------------------------------------------------------- |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`      | `openssl rand -hex 32`, chạy 2 lần để có hai giá trị khác nhau |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`                             |
| `SEED_ADMIN_PASSWORD`                   | Mật khẩu local tuỳ chọn, dùng chung cho admin/manager/technician/staff seed ra |
| `GEMINI_API_KEY`                        | Để trống nếu không dùng chatbot                                |

Sau đó chạy:

```bash
npm install
npm run migration:run    # tạo schema MySQL
npm run seed:admin       # tạo admin + manager/technician/staff, chung mật khẩu SEED_ADMIN_PASSWORD
npm run seed:master      # (tuỳ chọn) dữ liệu mẫu Hà Nội: 3 kho, 11 phòng lạnh, thực phẩm, lô hàng, thiết bị... (cần SEED_DEMO_PASSWORD)
npm run start:dev        # API ở http://localhost:3000, hot-reload
```

Hai lệnh seed chạy lại nhiều lần vẫn an toàn: chúng chỉ tạo dữ liệu còn thiếu, không sửa dữ liệu đã có.

Muốn làm lại dữ liệu mẫu từ đầu: `npm run seed:master -- --reset`. Lệnh này **xoá sạch** mọi bảng MySQL (trừ `migrations`) và các tài khoản demo `@coldchain.local`, giữ tài khoản tạo bởi `seed:admin` và gán họ vào mọi kho mẫu. Telemetry trong MongoDB không bị đụng tới. Dev và prod dùng chung database nên lệnh này xoá dữ liệu của cả hai.

## 5. Worker (tuỳ chọn)

Bỏ qua mục này nếu dùng `./run.sh dev` (worker đã chạy trong container).

Worker tiêu thụ job BullMQ (alert, push notification). Chỉ cần chạy khi test các tính năng đó. Chạy ở terminal khác:

```bash
cd server
npm run build && node dist/workers/main.js
```

Không chạy `nest start --watch` lần thứ hai cho worker: hai tiến trình watch cùng xoá và ghi lại `dist/`. Khi sửa code worker, chạy lại lệnh trên.

## 6. Frontend (React + Vite)

```bash
cd frontend
cp .env.example .env    # giữ nguyên giá trị mặc định
npm install
npm run dev             # http://localhost:5173
```

Vite dev server chuyển `/api` và `/socket.io` sang `localhost:3000` (xem [vite.config.ts](../frontend/vite.config.ts)), nên cookie đăng nhập hoạt động trên `http://` mà không cần cấu hình CORS.

Mở http://localhost:5173 và đăng nhập bằng `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (hoặc `manager` / `technician` / `staff` với cùng mật khẩu). Tài khoản Manager/Technician/Staff seed ra chưa thuộc kho nào: đăng nhập admin, mở chi tiết một kho và thêm họ vào mục "Nhân sự phụ trách" thì họ mới thấy dữ liệu của kho đó.

## 7. Cổng

| Dịch vụ               | Địa chỉ                                             |
| --------------------- | --------------------------------------------------- |
| Frontend              | http://localhost:5173                               |
| API + WebSocket       | http://localhost:3000                               |
| MinIO console         | http://localhost:9001 (`minioadmin` / `minioadmin`, hoặc `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` trong `.env` root nếu dùng `./run.sh dev`) |
| MySQL / Mongo / Redis | `3306` / `27017` / `6379`                           |
| MQTT                  | `1883`                                              |

## 8. Công việc thường gặp

```bash
# trong server/
npm test          # unit test
npm run lint
npm run migration:generate -- src/database/migrations/<TenMigration>   # sau khi thêm/sửa entity (cần `--` để truyền tham số)
npm run migration:run
npm run migration:revert

# trong frontend/
npm run lint
npm run build     # kiểm tra type + build production
```

Quy ước code backend (module, response envelope, auth, migration) xem [server/CLAUDE.md](../server/CLAUDE.md).

## 9. Lỗi thường gặp

| Triệu chứng                                    | Cách xử lý                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `docker compose up` báo cổng đã bị chiếm       | Trên máy đã có MySQL/Redis/Mongo chạy sẵn. Tắt dịch vụ đó hoặc đổi cổng trong `docker-compose.yml`       |
| Backend báo `Access denied` khi kết nối MySQL  | Có file `.env` ở root, hoặc volume được tạo với credential khác. Xem mục 3 và mục reset bên dưới         |
| App báo `S3Error: Access Denied` khi khởi động | Volume MinIO sai owner, xem [INFRASTRUCTURE.md](INFRASTRUCTURE.md) mục 7                                 |
| ESP32 không kết nối được MQTT (WSL2)           | Chạy `scripts/setup-windows-lan.ps1`, xem [README.md](../README.md#kết-nối-thiết-bị-esp32-qua-wifi-wsl2) |

**Reset toàn bộ dữ liệu dev:**

```bash
docker compose down -v   # xoá luôn volume, không hỏi xác nhận
```

Sau đó làm lại từ mục 3.
