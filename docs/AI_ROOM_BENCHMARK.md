# Benchmark theo ngưỡng phòng cho bài tập lớn

Thử nghiệm dùng lại dữ liệu nhiệt độ công khai Bangkok. `T_MS` và `T_FC` chỉ
là thông tin nguồn; model không chọn nhánh xử lý theo nhãn ngăn tủ. Các ngưỡng
phòng lấy từ bốn preset đang có trong seed: 0..4, 2..6, −22..−18 và −28..−22°C.
Đây là phép đánh giá dữ liệu ngoài theo ngưỡng phòng mẫu, không phải phép đo
độ chính xác trong phòng lạnh thật hoặc chứng nhận an toàn thực phẩm.

## Chạy thử nghiệm

Chạy ở thư mục gốc repo với Python 3.10 và các phiên bản thư viện đã pin:

```powershell
py -3.10 -m venv .venv-ai
.venv-ai/Scripts/python -m pip install -r ai-service/requirements-dev.txt
.venv-ai/Scripts/python -B -m unittest discover -s ai-service/tests -p test_room_forecast.py -v
.venv-ai/Scripts/python -B -u ai-service/experiments/room_forecast.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --reference-model ai-service/experiments/results/room-forecast-2026-10-17/reference_model.pkl --output-dir ai-service/experiments/results/room-forecast-reproduction --threads 4
```

Dùng thư mục output mới cho mỗi lần chạy. Script không ghi đè model runtime.
Không cần ESP32, MQTT, database hay một giờ dữ liệu cảm biến để chạy benchmark.

## Cách so sánh

- Đầu vào giữ nguyên 13 mốc nhiệt độ của một giờ và 22 đặc trưng đang phục vụ
  API. Mục tiêu chính vẫn là thay đổi nhiệt độ sau 15 phút.
- So cấu hình hiện tại với HGB 300 vòng/bước học 0,05; HGB 500 vòng/bước học
  0,03/63 lá; và HGB 300 vòng/bước học 0,05 với squared-error loss.
- Chia riêng 20% nguồn cho đánh giá cuối của lần chạy; cả hai kênh của một
  nguồn luôn cùng nhóm. Ba fold trên 80% còn lại dùng để chọn cấu hình.
- Bản model runtime đã học toàn bộ 123 nguồn, nên phải huấn luyện lại cấu hình
  hiện tại trên từng phần train để có phép so sánh công bằng.
- Dữ liệu công khai này đã dùng trong các thí nghiệm trước. Nhóm giữ riêng của
  lần chạy mới không phải một bộ test hoàn toàn chưa từng được nghiên cứu.
- Đánh giá thêm phần thời gian cuối của từng chuỗi. Train không nhận nhãn
  tương lai đi qua ranh giới chia thời gian; test được dùng lịch sử đã xảy ra.

Chỉ chấm cảnh báo khi nhiệt độ hiện tại đang trong ngưỡng phòng, giống luồng
backend. Vẫn giữ các điểm nhiệt độ tương lai vượt ngưỡng. Chỉ số gồm MAE, P95,
tỷ lệ sai không quá 1°C, recall, precision và false-positive rate; các mẫu sát
ngưỡng được báo cáo riêng. Ngưỡng phòng có thể chồng nhau, nên trung bình các
phòng cho mỗi preset trọng số bằng nhau và không được coi tổng mẫu là độc lập.

## Thử nghiệm nhiệt độ cao nhất/thấp nhất

Huấn luyện thêm hai model dự báo min/max tại ba quan sát tương lai t+5, t+10,
t+15 phút. Nhờ đó có thể đo trường hợp vượt ngưỡng giữa khoảng dự báo rồi hồi
phục trước phút 15. Đây không phải min/max liên tục giữa các lần lấy mẫu.

Khi suy luận, ràng buộc min ≤ dự báo tại phút 15 ≤ max. Báo cáo so riêng hiệu
quả cảnh báo của hai extrema với bản dự báo tại phút 15; không coi việc tăng
recall bằng cách phát nhiều cảnh báo hơn là cải thiện vô điều kiện.

## Điều kiện chọn bản mới

Việc chọn cấu hình trên fold ưu tiên MAE trung bình theo phòng nhưng không cho
tỷ lệ bỏ sót và cảnh báo nhầm tăng quá 1 điểm phần trăm, hoặc P95 tăng quá 5%.
Sau khi chọn, cả đánh giá theo nguồn và theo thời gian phải đạt:

- MAE trung bình theo phòng giảm ít nhất 1%.
- P95 trung bình tăng không quá 5%.
- Tỷ lệ bỏ sót và false-positive rate tăng không quá 1 điểm phần trăm.
- MAE của từng preset phòng tăng không quá 5%.

Các giới hạn trên là tiêu chí kỹ thuật của thí nghiệm bài tập, không phải giới
hạn an toàn thực phẩm. Chỉ khi đạt, script mới tạo `approved_candidate.pkl`
được fit lại trên toàn bộ nguồn. File này vẫn nằm riêng trong output để kiểm
tra API, fixture demo và tích hợp trước khi thay model mặc định.

Các chỉ số cảnh báo đếm theo mẫu thời gian, không phải số sự cố độc lập hoặc
thời gian báo trước đo trên kho thực tế. Những lần mở cửa hoặc thay đổi điều
khiển chưa xảy ra không thể suy ra chắc chắn chỉ từ lịch sử nhiệt độ.

## Kết quả đã chạy ngày 17/10/2026

Cấu hình `slow_500` đạt cả hai cổng kiểm tra và đã được tích hợp làm artifact
mặc định trong nhánh AI riêng. MAE trung bình theo preset trên nguồn giữ riêng
giảm 3.17%; phần thời gian cuối giảm
11.12%. Recall có tăng nhưng false-positive
rate cũng tăng nhẹ; xem từng phòng trong `metrics.json`. Các giới hạn cảnh báo
được định cho trung bình các preset, không bảo đảm mọi chỉ số của mọi phòng đều tốt hơn.

Hai model extrema vẫn nằm trong `evaluated_models.pkl` để tái lập nghiên cứu,
không điều khiển cảnh báo runtime. Trên nguồn giữ riêng, extrema tăng recall
nhưng false-positive rate lên 5,77%, so với 4,01% của bản point đã chọn, vượt
biên tăng 1 điểm phần trăm được dùng cho quyết định thận trọng trong bài tập.

[Báo cáo](../ai-service/experiments/results/room-forecast-2026-10-17/report.md).
