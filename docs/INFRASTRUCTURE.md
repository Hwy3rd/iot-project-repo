# Hạ tầng triển khai

> Mô tả hạ tầng chạy hệ thống: các container, mạng và cổng, cách đưa dịch vụ ra Internet qua Cloudflare Tunnel, file cấu hình môi trường, dữ liệu lưu ở đâu, và các script vận hành. Chi tiết bên trong tiến trình (`app`/`worker`, luồng dữ liệu, migration trong image) xem [ARCHITECTURE.md](ARCHITECTURE.md) (mục 6). Tài liệu này không lặp lại phần đó.

---

## 1. Tổng quan

Toàn bộ hệ thống chạy bằng **Docker Compose trên một máy chủ duy nhất**. Không có orchestrator (Kubernetes/Swarm), không có load balancer, không có datastore managed bên ngoài. Có hai file compose **độc lập**, mỗi file tự đủ để chạy riêng bằng `-f`:

| File                                                              | Dùng khi                                                             | Khác biệt chính                                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [docker-compose.yml](../docker-compose.yml)                       | Dev trên máy cá nhân                                                 | Publish mọi cổng ra `localhost`, credential có giá trị mặc định, `.env` ở root là tuỳ chọn      |
| [docker-compose.production.yml](../docker-compose.production.yml) | Production, được gọi qua [init.sh](../init.sh) / [run.sh](../run.sh) | Bắt buộc `.env` và credential, API/datastore chỉ publish trên `127.0.0.1`, MQTT `1883` publish ra ngoài, có thêm service `cloudflared` |

Hai file dùng chung phần build, healthcheck, `depends_on` và volume nhưng **không kế thừa nhau**. Khi sửa phần chung, phải sửa **cả hai file** bằng tay.

### Sơ đồ production

```
                         Internet
                            │
             ┌──────────────┴──────────────┐
             │     Cloudflare edge (HTTPS) │
             │  api.<domain>  files.<domain>│
             └──────────────┬──────────────┘
                            │  tunnel (kết nối outbound từ máy chủ)
  ┌─────────────────────────┼──────────────────────── Docker host ──┐
  │                  ┌──────▼──────┐                                 │
  │                  │ cloudflared │                                 │
  │                  └──┬───────┬──┘                                 │
  │        http://app:3000     http://minio:9000                     │
  │              ┌──────▼─┐   ┌─▼──────┐                             │
  │              │  app   │   │ minio  │                             │
  │              └─┬──┬─┬─┘   └────────┘                             │
  │                │  │ └──────────────┐                             │
  │   ┌────────┐ ┌─▼──▼──┐ ┌───────┐ ┌─▼────────┐                    │
  │   │ worker │ │ mysql │ │ mongo │ │  redis   │                    │
  │   └────────┘ └───────┘ └───────┘ └──────────┘                    │
  │              ┌───────────┐                                       │
  │              │ mosquitto │◀──── host:1883 (publish ra ngoài host)│
  │              └───────────┘                                       │
  └──────────────────────────────────────────────────────────────────┘
                      ▲
                ESP32 (MQTT qua LAN)
```

---

## 2. Danh sách service

| Service       | Image                            | Container name     | Cổng trong mạng     | Volume              | Ghi chú                                                              |
| ------------- | -------------------------------- | ------------------ | ------------------- | ------------------- | -------------------------------------------------------------------- |
| `app`         | build từ `server/Dockerfile`     | `node_server`      | 3000 (HTTP + WS)    | —                   | Tự chạy `migration:run` trước khi `node dist/main.js`                |
| `worker`      | build từ `server/Dockerfile`     | `service_worker`   | — (không mở cổng)   | —                   | `node dist/workers/main.js`, consumer BullMQ                         |
| `mysql`       | `mysql:8.0`                      | `mysql_db`         | 3306                | `mysql_data`        | Dữ liệu nghiệp vụ                                                    |
| `mongo`       | `mongo:7`                        | `mongo_db`         | 27017               | `mongo_data`        | Telemetry (`telemetry_raw`, `telemetry_hourly`)                      |
| `redis`       | `redis:7-alpine`                 | `redis_db`         | 6379                | `redisdata`         | Session refresh token + queue BullMQ                                 |
| `minio`       | `cgr.dev/chainguard/minio:latest` | `minio_bucket`    | 9000 (S3), 9001 (console) | `minio_data`  | Ảnh upload; bucket được `app` tự tạo và mở quyền đọc public. Bản build MinIO miễn phí của Chainguard (xem mục 7) |
| `mosquitto`   | `eclipse-mosquitto:2`            | `mosquitto_broker` | 1883                | `mosquitto_data` + mount `mosquitto/mosquitto.conf` (read-only) | Broker MQTT cho thiết bị |
| `cloudflared` | `cloudflare/cloudflared:latest`  | `cloudflared`      | —                   | —                   | **Chỉ có ở production**                                              |

Mọi service đều đặt `restart: unless-stopped`: tự khởi động lại khi crash hoặc khi Docker daemon khởi động lại, trừ khi đã bị `stop` thủ công.

`app` và `worker` build từ **cùng một image** (`server/Dockerfile`), chỉ khác `command`. Build dùng `additional_contexts: docs: ./docs` để copy một số file trong `docs/` (`BUSINESS_RULES.md`, `SYSTEM_OPERATIONS_GUIDE.md`, `TROUBLESHOOTING.md`) vào `/app/docs` trong image. Đây là nguồn dữ liệu cho tool `search_docs` của chatbot (`CHATBOT_DOCS_DIR`), nên sửa các file này thì phải **build lại image** mới có hiệu lực.

---

## 3. Thứ tự khởi động & healthcheck

Mỗi datastore có healthcheck riêng, và `depends_on` dùng `condition: service_healthy`, nên compose tự đảm bảo thứ tự:

```
mysql, mongo, redis, minio, mosquitto  (healthy)
        │
        ▼
app  ── migration:run ── node dist/main.js ── healthy (mở được TCP 3000)
        │
        ├──▶ worker
        └──▶ cloudflared  (cần thêm minio healthy)
```

| Service     | Healthcheck                                                        |
| ----------- | ------------------------------------------------------------------ |
| `app`       | Mở TCP tới `localhost:3000` bằng `node -e` (không dùng HTTP status vì `/` trả 404) |
| `mysql`     | `mysql -e "SELECT 1"` bằng chính user/db trong env của container   |
| `mongo`     | `mongosh --eval "db.adminCommand('ping')"`                         |
| `redis`     | `redis-cli ping`                                                   |
| `minio`     | `mc ready local`                                                   |
| `mosquitto` | `mosquitto_sub` (tài khoản `MQTT_USERNAME`) nhận 1 message trên `$SYS/#` |

Vì `app` chỉ mở cổng 3000 **sau khi** migration xong, trạng thái "app healthy" đồng nghĩa với "schema đã ở phiên bản mới nhất". `worker` dựa vào điều này để không đọc schema cũ. Cách làm này chỉ an toàn khi có **đúng 1 container `app`**. Lý do và hướng tách migration khi scale xem [ARCHITECTURE.md](ARCHITECTURE.md) mục 6.

---

## 4. Mạng & cổng

Tất cả service nằm trong network mặc định của compose project và gọi nhau bằng **tên service** (`mysql`, `redis`, `minio`...). Vì vậy `.env` production dùng các hostname này, còn `server/.env` (chạy backend trên host) dùng `localhost`.

### Cổng publish ra host

| Cổng host | Service     | Dev | Production          | Mục đích                               |
| --------- | ----------- | :-: | :-----------------: | -------------------------------------- |
| 8080      | `app`       | ✅  | `127.0.0.1`         | API + WebSocket (`8080 → 3000`)        |
| 3306      | `mysql`     | ✅  | `127.0.0.1`         | Client DB trên máy chủ                 |
| 27017     | `mongo`     | ✅  | `127.0.0.1`         | Client DB trên máy chủ                 |
| 6379      | `redis`     | ✅  | `127.0.0.1`         | Client Redis trên máy chủ              |
| 9000      | `minio`     | ✅  | `127.0.0.1`         | S3 API / tải ảnh                       |
| 9001      | `minio`     | ✅  | `127.0.0.1`         | MinIO web console                      |
| 1883      | `mosquitto` | ✅  | ✅ (mọi interface)  | Thiết bị ESP32 gửi telemetry           |

Ở production, truy cập từ bên ngoài máy chủ: API và ảnh MinIO **chỉ** đi qua Cloudflare Tunnel, datastore thì không có đường nào. Các cổng `127.0.0.1` chỉ để dùng client (DBeaver, `redis-cli`, MinIO console...) ngay trên máy chủ, xem mục 8.

**Đừng bỏ tiền tố `127.0.0.1:`** trong `ports` ở production. Viết `"3306:3306"` sẽ bind ra `0.0.0.0`, tức mọi máy tới được IP của host đều kết nối được, và Docker tự thêm rule iptables vượt qua `ufw`/`firewalld` nên firewall trên host không chặn được. Redis lại không có mật khẩu.

---

## 5. Cloudflare Tunnel (public access)

`cloudflared` mở một kết nối **outbound** từ máy chủ tới Cloudflare edge. Nhờ vậy:

- không cần IP tĩnh, không cần mở port 80/443 hay cấu hình NAT/port-forward trên router;
- HTTPS được Cloudflare terminate, còn bên trong tunnel đi HTTP thường tới container;
- routing được cấu hình trên dashboard Cloudflare (remote-managed tunnel), trong repo không có file config tunnel.

### Thiết lập

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create tunnel** → chọn Docker → copy giá trị sau `--token`.
2. Ghi vào `.env` ở root: `CLOUDFLARE_TUNNEL_TOKEN=<token>`.
3. Trong tab **Public Hostname** của tunnel, thêm route trỏ tới **tên service trong compose**:

   | Public hostname  | Service               |
   | ---------------- | --------------------- |
   | `api.<domain>`   | `http://app:3000`     |
   | `files.<domain>` | `http://minio:9000`   |

   Tên subdomain chỉ là ví dụ, có thể đặt tuỳ ý miễn khớp với env ở bước 4.

4. Cập nhật các biến trong `.env` phụ thuộc vào domain:
   - `MINIO_PUBLIC_URL=https://files.<domain>`: base URL mà browser dùng để tải ảnh. URL ảnh được build từ biến này và lưu vào MySQL, nên **đổi domain sau này không tự cập nhật các URL đã lưu**.
   - `CORS_ORIGINS=https://<frontend-domain>`: origin của frontend, phải khớp chính xác, không chấp nhận `*` (vì bật `credentials: true`). Áp dụng cho cả REST lẫn Socket.IO.
   - `TRUST_PROXY=1`: tin 1 hop proxy (cloudflared) để `req.ip` ghi trong audit log là IP client thật. **Chỉ bật khi thực sự có proxy phía trước**, nếu không client có thể giả IP qua `X-Forwarded-For`.

Nếu thiếu token, stack vẫn chạy bình thường nhưng `cloudflared` sẽ restart liên tục và không có hostname public nào hoạt động (`init.sh` sẽ in cảnh báo).

**Lưu ý về cookie:** auth cookie đặt `secure` khi `NODE_ENV=production` và `sameSite: 'lax'`. Vì vậy frontend và API nên nằm chung một registrable domain (ví dụ `app.<domain>` và `api.<domain>`) và phục vụ qua HTTPS. Tunnel đã lo phần HTTPS.

---

## 6. Cấu hình môi trường

Có **hai file env tách biệt**, không dùng lẫn cho nhau:

| File                                             | Mẫu                                          | Dùng bởi                                                              | Hostname datastore            |
| ------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `.env` (root)                                    | [.env.example](../.env.example)              | `docker-compose.production.yml` (và tuỳ chọn cho `docker-compose.yml`) | Tên service (`mysql`, `redis`…) |
| `server/.env`                                    | [server/.env.example](../server/.env.example) | Backend chạy trực tiếp trên host (`pnpm start:dev`, migration, test)  | `localhost`                   |

Root `.env` được compose dùng theo **hai cách**:

1. `env_file:` nạp **toàn bộ** biến vào `app` và `worker`.
2. Cú pháp `${VAR}` trong file compose chỉ truyền **một vài biến cụ thể** cho `mysql`/`mongo`/`minio`/`cloudflared`. Ở production dùng `${VAR:?...}`, nên thiếu biến là compose báo lỗi và dừng ngay.

Hệ quả của cách (2): ký tự `$` trong giá trị bị hiểu là tham chiếu biến. Nên sinh secret bằng `openssl rand -hex 32` hoặc bọc giá trị trong nháy đơn.

### Nhóm biến

| Nhóm                | Biến                                                                              | Ghi chú                                                                                   |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| App                 | `PORT`, `NODE_ENV`, `TRUST_PROXY`, `CORS_ORIGINS`                                  | Xem mục 5                                                                                 |
| MySQL               | `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`, `MYSQL_ROOT_PASSWORD`                    | Dùng chung cho app lẫn container mysql                                                    |
| MongoDB             | `MONGO_ROOT_USERNAME/PASSWORD`, `MONGO_URI`                                        | Credential trong `MONGO_URI` phải khớp `MONGO_ROOT_*`                                     |
| Redis               | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                                       | `REDIS_PASSWORD` cũng là `requirepass` của container redis                                |
| MQTT                | `MQTT_URL`, `MQTT_USERNAME/PASSWORD`, `MQTT_DEVICE_USERNAME/PASSWORD`              | Broker sinh password file + ACL từ 4 biến này (`mosquitto/entrypoint.sh`); `MQTT_DEVICE_*` nạp vào firmware thiết bị |
| MinIO               | `MINIO_ENDPOINT/PORT/USE_SSL/ACCESS_KEY/SECRET_KEY/BUCKET`, `MINIO_PUBLIC_URL`     | `ACCESS_KEY/SECRET_KEY` cũng là root credential của container minio                       |
| Auth                | `JWT_SECRET`, `JWT_REFRESH_SECRET`, `*_EXPIRES_IN`, `COOKIE_NAME`, `REFRESH_COOKIE_NAME` | Hai secret phải khác nhau và khác bộ secret dev                                     |
| Web Push            | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                           | Sinh cặp khoá riêng cho production: `npx web-push generate-vapid-keys`                    |
| Giới hạn đăng nhập  | `LOGIN_MAX_FAILED_PER_ACCOUNT_IP/PER_IP/PER_ACCOUNT`, `LOGIN_FAILED_WINDOW_MINUTES`, `LOGIN_LOCKOUT_STEPS_MINUTES`, `LOGIN_LOCKOUT_RESET_HOURS`, `LOGIN_ACCOUNT_LOCKOUT_MINUTES` | Tuỳ chọn, mặc định 5/30/50 lần, cửa sổ 15 phút, khoá tăng dần 1/5/15/60 phút (quên sau 24 giờ), khoá theo username 15 phút; xem [API_DESIGN.md](API_DESIGN.md) mục 2 |
| Chatbot (LLM)       | `GEMINI_API_KEY`, `LLM_*`, `CHATBOT_RATE_LIMIT_*`, `CHATBOT_DOCS_DIR`              | `CHATBOT_DOCS_DIR=/app/docs` khớp với đường dẫn copy docs trong Dockerfile                |
| Seed                | `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_USERNAME`, `SEED_TECHNICIAN_USERNAME`, `SEED_STAFF_USERNAME` | Chỉ dùng lúc `init.sh`; cả 4 tài khoản dùng chung `SEED_ADMIN_PASSWORD`; nên xoá/đổi khỏi `.env` sau lần đầu |
| Tunnel              | `CLOUDFLARE_TUNNEL_TOKEN`                                                          | Chỉ `cloudflared` đọc                                                                     |

**Credential datastore chỉ có tác dụng ở lần khởi động đầu, khi volume còn rỗng.** Các biến `MYSQL_USER/PASSWORD/DATABASE`, `MONGO_ROOT_*` và `MINIO_ACCESS_KEY/SECRET_KEY` được container dùng để tạo user khi volume chưa có dữ liệu. Sửa chúng trong `.env` sau đó **không** đổi mật khẩu của DB đã có, mà chỉ làm `app` kết nối thất bại. Muốn đổi thì phải đổi trong DB trước (qua `docker exec`) rồi mới sửa `.env`.

Bảo vệ file: `chmod 600 .env`. `.env` đã có trong `.gitignore` (root) và `.dockerignore` (server), nên không lọt vào git hay image.

---

## 7. Dữ liệu & volume

Dữ liệu bền vững nằm trong **named volume** của Docker (tên thật có tiền tố là tên project compose, ví dụ `iot-project-repo_mysql_data`):

| Volume           | Service     | Nội dung                                       |
| ---------------- | ----------- | ---------------------------------------------- |
| `mysql_data`     | `mysql`     | Toàn bộ dữ liệu nghiệp vụ                      |
| `mongo_data`     | `mongo`     | Telemetry raw + hourly                         |
| `minio_data`     | `minio`     | File ảnh upload                                |
| `redisdata`      | `redis`     | Session refresh token, trạng thái queue BullMQ |
| `mosquitto_data` | `mosquitto` | Message/subscription được persist của broker   |

### Image MinIO và quyền của `minio_data`

Từ 2025–2026 MinIO ngừng phát hành image miễn phí: `quay.io/minio/minio` và `minio/minio` trên Docker Hub đều trả **401** khi pull. Vì vậy compose dùng `cgr.dev/chainguard/minio:latest`, bản MinIO do Chainguard build lại từ mã nguồn và phát hành miễn phí. Cấu hình (biến môi trường, `command`, healthcheck `mc ready local`) giữ nguyên. Có hai điểm khác với image cũ:

- Bản miễn phí chỉ có tag `latest`, nên mỗi lần pull có thể nhận một phiên bản MinIO mới hơn.
- Container chạy bằng **uid 65532** thay vì root. Volume mới tạo không bị ảnh hưởng. Nhưng một `minio_data` **đã có dữ liệu từ image cũ** thì thuộc root, và MinIO sẽ không ghi được vào đó. Trước khi chạy image mới lần đầu, hãy dừng `minio`, backup volume (xem mục Backup bên dưới), rồi đổi chủ sở hữu **một lần**:

  ```bash
  docker compose stop minio app worker
  docker run --rm -v <project>_minio_data:/data alpine chown -R 65532:65532 /data
  docker compose up -d
  ```

  Tên volume thật có tiền tố project, xem bằng `docker volume ls | grep minio_data`.

Các thao tác **giữ nguyên** volume: `./run.sh stop`, `./run.sh down`, `docker compose down`, build lại image, khởi động lại máy.

Các thao tác **xoá** volume: `docker compose down -v`, `docker volume rm ...`, `docker volume prune`. Những lệnh này **mất toàn bộ dữ liệu** và không có bước xác nhận.

### Backup

Hiện **chưa có cơ chế backup tự động**. Có thể backup thủ công từ host bằng các lệnh dưới đây (thay `<...>` bằng giá trị trong `.env`):

```bash
# MySQL
docker exec mysql_db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction "$MYSQL_DATABASE"' > mysql-$(date +%F).sql

# MongoDB
docker exec mongo_db mongodump -u <MONGO_ROOT_USERNAME> -p <MONGO_ROOT_PASSWORD> --authenticationDatabase admin --db iot --archive > mongo-$(date +%F).archive

# MinIO (sao lưu nguyên thư mục dữ liệu của volume)
docker run --rm -v iot-project-repo_minio_data:/data -v "$PWD":/backup alpine tar czf /backup/minio-$(date +%F).tgz -C /data .
```

Redis và Mosquitto chỉ chứa trạng thái tạm (session, queue, message chờ giao), không bắt buộc phải backup.

---

## 8. Vận hành

### Khởi tạo lần đầu: `./init.sh`

Yêu cầu: Docker + Docker Compose v2. Máy chủ **không cần** cài Node/pnpm, vì mọi thứ chạy trong container.

1. Kiểm tra `docker`, `docker compose` và file `.env`. Nếu thiếu `CLOUDFLARE_TUNNEL_TOKEN` thì chỉ cảnh báo, không dừng.
2. `docker compose -f docker-compose.production.yml up -d --build`. Lệnh này chờ đến khi cả chuỗi `depends_on` ở mục 3 hoàn tất, bao gồm migration.
3. Seed tài khoản: `compose run --rm app node dist/seeds/account.seed.js`. Tạo admin nếu chưa có admin nào, và mỗi tài khoản Manager/Technician/Staff nếu username chưa tồn tại — cả 4 dùng chung `SEED_ADMIN_PASSWORD`. Các tài khoản này chưa được phân công vào kho nào — Admin gán trong dialog chi tiết kho.

### Vận hành hằng ngày: `./run.sh`

| Lệnh                         | Tác dụng                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `./run.sh start`             | Bật lại container. Nếu container đã bị `down` thì tạo lại từ volume sẵn có      |
| `./run.sh dev`               | `up` mọi service trừ `app` và `cloudflared`. Backend thì tự chạy trên host (ví dụ `pnpm start:dev` trong `server/`). Datastore truy cập qua cổng `127.0.0.1` (mục 4) |
| `./run.sh stop`              | Dừng mọi container, giữ dữ liệu                                                 |
| `./run.sh restart [svc]`     | Restart toàn bộ hoặc một service                                                |
| `./run.sh status`            | `compose ps -a`                                                                 |
| `./run.sh logs [svc]`        | Theo dõi log (200 dòng cuối)                                                     |
| `./run.sh down`              | Xoá container, **giữ volume**                                                   |
| `./run.sh rebuild [svc]`     | Build lại image backend từ `./server` rồi thay `app` + `worker`, hoặc chỉ một trong hai. Chờ container mới healthy (tối đa 300 giây) |

Chỉ `rebuild` mới build lại image; các lệnh khác dùng image có sẵn. Mỗi lần `app` khởi động nó chạy `migration:run` (không có gì mới thì bỏ qua).

### Deploy phiên bản mới

```bash
git pull
./run.sh rebuild
```

Lệnh này build lại image `app`/`worker` từ `./server` và chỉ thay hai container đó (`--no-deps`). `app` tự chạy migration mới trước khi được coi là healthy. Trong lúc `app` được thay, API và WebSocket sẽ gián đoạn ngắn vì chỉ có một replica.

`rebuild` **không đụng** datastore hay `cloudflared`, kể cả khi định nghĩa của chúng trong compose đã đổi (ví dụ đổi image MinIO). Những thay đổi đó phải làm riêng và có chủ đích (`docker compose -f docker-compose.production.yml up -d <svc>`), sau khi đã làm các bước chuẩn bị cần thiết, như chown `minio_data` ở mục 7.

### Truy cập datastore ở production

Datastore chỉ publish trên `127.0.0.1` (cổng giống dev, xem mục 4), nên dùng client trên chính máy chủ kết nối tới `localhost:3306` / `27017` / `6379`, MinIO console ở `http://localhost:9001`. Từ máy khác thì dùng SSH port-forward (ví dụ `ssh -L 3306:localhost:3306 <host>`). Hoặc thao tác qua `docker exec`:

```bash
docker exec -it mysql_db mysql -u <MYSQL_USER> -p <MYSQL_DATABASE>
docker exec -it mongo_db mongosh -u <MONGO_ROOT_USERNAME> -p --authenticationDatabase admin iot
docker exec -it redis_db redis-cli
```

Muốn mở MinIO console từ xa lâu dài thì thêm một public hostname riêng trên tunnel có bảo vệ bằng Cloudflare Access.

### Dev trên máy cá nhân

```bash
docker compose up -d redis mysql mongo minio mosquitto   # chỉ datastore + broker
cd server && pnpm install && pnpm migration:run && pnpm start:dev
```

Hoặc chạy cả stack trong container bằng `docker compose up -d --build`, khi đó API ở `http://localhost:8080`.

---

## 9. Kết nối thiết bị IoT (MQTT)

ESP32 publish telemetry lên topic `devices/{uniqueId}/telemetry` tới broker ở `<IP máy chủ>:1883`. Đây là cổng duy nhất publish ra host ở production, **không** đi qua Cloudflare Tunnel (tunnel chỉ proxy HTTP).

Cấu hình broker ([mosquitto/mosquitto.conf](../mosquitto/mosquitto.conf)): một listener `1883`, bật persistence, log ra stdout. Hiện đang **cho phép anonymous và không có TLS** (xem mục 10).

### Máy chủ là WSL2 trên Windows

Mặc định WSL2 nằm sau NAT riêng, nên thiết bị cùng WiFi không kết nối được tới cổng 1883. Chạy [scripts/setup-windows-lan.ps1](../scripts/setup-windows-lan.ps1) **một lần** trong PowerShell *Run as Administrator* (cần Windows 11 22H2 trở lên):

```powershell
powershell -ExecutionPolicy Bypass -File \\wsl.localhost\Ubuntu\<đường dẫn repo>\scripts\setup-windows-lan.ps1
```

Script sẽ:

1. đặt `networkingMode=mirrored` trong `%USERPROFILE%\.wslconfig`;
2. chuyển mạng đang kết nối từ Public sang Private;
3. mở inbound TCP 1883 trên cả Windows Defender Firewall và Hyper-V firewall;
4. in IP LAN để nạp vào firmware ESP32;
5. chạy `wsl --shutdown` để áp dụng.

Script chạy lại an toàn. Khi chuyển sang WiFi hoặc hotspot mới thì chạy lại để đổi mạng đó sang Private. Các tham số tuỳ chọn: `-Port`, `-SkipNetworkProfile`, `-NoShutdown`, `-Force`.

---

## 10. Bảo mật & các điểm cần cứng hoá

Đã có:

- Cổng datastore/API ở production chỉ bind `127.0.0.1`, không lộ ra mạng. Truy cập public đi qua Cloudflare (HTTPS, ẩn IP gốc).
- Credential datastore là bắt buộc ở production, không có giá trị mặc định.
- Redis bật `requirepass`; MQTT broker bắt buộc đăng nhập và có ACL tách quyền backend/thiết bị.
- Container `app`/`worker` chạy bằng user `node` (không phải root), có `tini` làm PID 1 để forward signal và dọn zombie process.
- Image runner chỉ chứa `dist/` và production dependencies, không có source hay devDependencies.

Chưa có, cần làm trước khi mở rộng ra môi trường không tin cậy:

| Vấn đề                                   | Rủi ro                                                                                   | Hướng xử lý                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| MQTT chưa có TLS, thiết bị dùng chung 1 tài khoản | Ai nghe lén được LAN sẽ thấy credential; lộ credential của một thiết bị là giả được telemetry của mọi thiết bị | Thêm listener TLS 8883; cấp credential riêng cho từng thiết bị (username = `unique_id`, ACL `pattern write devices/%u/telemetry`) |
| Bucket MinIO cho đọc public              | Ai có URL đều xem được ảnh (tên object là thông tin duy nhất cần biết)                   | Chấp nhận được với ảnh không nhạy cảm; nếu cần riêng tư thì chuyển sang presigned URL |
| Image dùng tag `latest` (`minio`, `cloudflared`) | Build/pull lại có thể kéo phiên bản mới ngoài ý muốn                             | Pin phiên bản cụ thể                                                           |
| Chưa có backup tự động                   | Mất dữ liệu khi hỏng ổ đĩa hoặc lỡ xoá volume                                            | Cron chạy các lệnh ở mục 7 và đẩy bản backup ra ngoài máy chủ                  |
| Chỉ 1 replica `app`, 1 máy chủ           | Gián đoạn khi deploy hoặc khi máy chủ chết                                               | Tách migration thành job riêng trước khi scale (xem [ARCHITECTURE.md](ARCHITECTURE.md) mục 6) |
| Chưa có giám sát/cảnh báo hạ tầng        | Không biết khi container restart liên tục hoặc đĩa đầy                                   | Xem [LOGGING_MONITORING.md](LOGGING_MONITORING.md) (chưa có nội dung)          |
