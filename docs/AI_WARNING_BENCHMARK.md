# Thử model học trực tiếp mục tiêu cảnh báo

Mục tiêu là phát hiện nhiệt độ vượt ngưỡng phòng tại ít nhất một mốc t+5, t+10 hoặc t+15 phút, khi nhiệt độ hiện tại vẫn trong ngưỡng. Đây là bài toán phân loại; MAE nhiệt độ không phải thước đo chính của nó.

## Cách thử

- Dùng lại 123 nguồn dữ liệu Bangkok và bốn preset phòng của dự án. Nhãn kênh dữ liệu ngoài chỉ mô tả nguồn, không quyết định cách model xử lý phòng.
- Đầu vào gồm 22 đặc trưng lịch sử hiện có, ngưỡng phòng và khoảng cách hiện tại đến hai ngưỡng. Không đưa nhiệt độ tương lai, mã nguồn hay nhãn kênh vào model.
- Các cấu hình thử cố định: HGBClassifier 300 vòng, learning rate 0,05, tối đa 31 lá; Random Forest 120 cây, depth tối đa 14; Logistic Regression có chuẩn hóa. Đây chưa phải một tìm kiếm tham số toàn diện. Model nhiệt độ đối chứng dùng cấu hình 500 vòng đã chọn trước đó.
- Giữ đúng phép chia 98 nguồn phát triển / 25 nguồn kiểm tra của thử nghiệm trước để đối chiếu. Bộ dữ liệu và nhóm kiểm tra này đã được nghiên cứu trước; kết quả có tính thăm dò, chưa phải kiểm định trên dữ liệu hoàn toàn mới.
- Ba fold chia theo nguồn vật lý trên nhóm phát triển tạo điểm số ngoài fold. Các kênh và các ngưỡng phòng chồng nhau của cùng nguồn luôn cùng nhóm.
- Với từng phòng, chọn ngưỡng điểm số theo ngân sách false-positive rate của model nhiệt độ trên nhóm phát triển. Model nhiệt độ cũng được chỉnh ngưỡng với cùng quy trình để làm đối chứng.
- Chọn classifier bằng recall trung bình theo phòng trên nhóm phát triển. Giữ nguyên model và ngưỡng trước khi chấm 25 nguồn kiểm tra. Chỉ số trên nhóm phát triển là điểm chọn cấu hình, không phải kết quả test độc lập.
- Kiểm tra thêm 20% thời gian cuối từng chuỗi. Fit và chọn ngưỡng lại trên phần thời gian trước đó; nhãn train không được vượt qua ranh giới thời gian.
- FPR là số cảnh báo nhầm chia cho số mẫu thực tế không vượt ngưỡng, khác với phần trăm cảnh báo sai trong toàn bộ cảnh báo. Recall là phần mẫu thực tế vượt ngưỡng được phát hiện.
- Chỉ số là trung bình đều bốn preset, tính theo mẫu thời gian. Không coi các mẫu liên tiếp hay các preset chồng nhau là các sự cố độc lập.

## Kết quả trên 25 nguồn giữ riêng

| Model | Recall | FPR | Precision |
|---|---:|---:|---:|
| Dự báo nhiệt độ hiện tại | 58.50% | 4.01% | 80.67% |
| Dự báo nhiệt độ + chỉnh độ nhạy | 58.50% | 4.01% | 80.67% |
| Logistic Regression | 17.94% | 6.84% | 46.03% |
| Random Forest | 47.27% | 2.51% | 80.84% |
| HistGradientBoostingClassifier | 48.78% | 1.98% | 83.42% |

Classifier được chọn trước khi chấm test: **HistGradientBoostingClassifier**.

Với ngưỡng chọn từ nhóm phát triển, classifier đã chọn giảm cảnh báo nhầm nhưng cũng giảm tỷ lệ phát hiện so với model nhiệt độ. Điểm AP trên test cao hơn cho thấy khả năng xếp hạng nguy cơ có tiềm năng; điểm quyết định hiện tại vẫn chưa đạt mục tiêu tăng recall. Ngưỡng không được chọn lại dựa vào test này.

Hai preset −22..−18 và −28..−22°C lần lượt chỉ có 9 và 3 nguồn test có mẫu trong ngưỡng. Các chỉ số này dễ thay đổi theo nguồn; số mẫu thời gian lớn không thay thế được số nguồn độc lập.

## Kiểm tra phần thời gian cuối

| Model | Recall | FPR |
|---|---:|---:|
| Dự báo nhiệt độ hiện tại | 58.87% | 2.72% |
| Dự báo nhiệt độ + chỉnh độ nhạy | 58.86% | 2.70% |
| HistGradientBoostingClassifier | 56.65% | 2.40% |

## Đánh giá

Tiêu chí thử được đặt trong script: recall tăng ít nhất 2 điểm phần trăm so với cả hai đối chứng; FPR trung bình tăng không quá 0,5 điểm và FPR từng phòng tăng không quá 1 điểm, trên cả hai phép kiểm tra. Đây là dung sai so sánh của bài tập, không phải giới hạn an toàn thực phẩm.

Kết quả: **chưa đạt cả hai phép kiểm tra**. Xem điều kiện cụ thể và từng phòng trong báo cáo đầy đủ.

Khoảng tin cậy thăm dò 95% lấy mẫu lại theo toàn bộ nguồn vật lý (giữ các mẫu liên tiếp và các preset cùng nguồn với nhau):

| So classifier đã chọn với | Chênh recall (điểm %) | Chênh FPR (điểm %) |
|---|---:|---:|
| Dự báo nhiệt độ hiện tại | -12.30 đến -2.78 | -3.14 đến -0.38 |
| Dự báo nhiệt độ + chỉnh độ nhạy | -12.30 đến -2.78 | -3.14 đến -0.38 |

Các khoảng này chỉ mô tả độ biến động giữa các nguồn trong bộ dữ liệu đang dùng, không xóa hạn chế của dữ liệu đã được nghiên cứu. Nhiệt độ chỉ được quan sát mỗi 5 phút; không xác định được mọi lần vượt ngưỡng giữa các mốc hoặc thời gian báo trước thực tế.

## Chạy lại

Từ thư mục gốc worktree AI với môi trường `.venv-ai` đã cài requirements:

```powershell
$env:OMP_NUM_THREADS='4'
$env:OPENBLAS_NUM_THREADS='4'
.venv-ai/Scripts/python.exe -B -m unittest discover -s ai-service/tests -p test_room_warning.py -v
.venv-ai/Scripts/python.exe -B -u ai-service/experiments/room_warning.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-reproduction --threads 4
```

Mỗi lần dùng output mới. Script lưu tham số, danh sách nguồn và hash dữ liệu, ngưỡng hiệu chỉnh, điểm số, báo cáo và model đã chấm trong output. Không cần MQTT, database hoặc ESP32 để chạy phép thử này.

Model thử nghiệm trong `evaluated_warning_models.pkl` chỉ fit trên 98 nguồn phát triển và dùng ngưỡng đã chọn từ development. Ngưỡng phòng tùy chỉnh ngoài bốn preset chưa được đánh giá. Artifact này khác hợp đồng API dự báo nhiệt độ; không đặt nó vào `MODEL_PATH` hiện tại.

Model nhiệt độ mặc định, API và production giữ nguyên. Nếu tích hợp sau, phần dự báo nhiệt độ để vẽ chart và phần chấm nguy cơ cảnh báo cần được xử lý riêng trong hợp đồng API.

[Báo cáo đầy đủ](../ai-service/experiments/results/room-warning-2026-10-17/report.md) · [Số liệu và cấu hình](../ai-service/experiments/results/room-warning-2026-10-17/metrics.json)
