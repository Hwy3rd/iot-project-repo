# Kết quả phân tích lỗi cảnh báo

Đối chiếu đúng hai artifact đã chấm trong phép thử đầu, cùng 98 nguồn fit / 25 nguồn test. Đầu ra được tái tính và khớp với điểm số đã lưu. Model, API và production không thay đổi.

## 1. Điểm yếu chính là cảnh báo trước 10–15 phút

Bảng sau gộp các mẫu dự báo có nhiệt độ hiện tại còn trong ngưỡng, có chồng lặp giữa các preset; khác cách trung bình đều bốn preset của bảng benchmark ban đầu. Chia theo mốc đầu tiên trong t+5/t+10/t+15 quan sát thấy vượt ngưỡng; không phải thời điểm vượt chính xác giữa các lần đo.

| Mốc đầu tiên vượt sau lúc dự báo | Mẫu | Recall model nhiệt độ | Recall classifier |
|---|---:|---:|---:|
| 5 phút | 1974 | 81.71% | 81.31% |
| 10 phút | 1781 | 62.77% | 53.34% |
| 15 phút | 1561 | 32.93% | 24.09% |

Classifier có 314 mẫu bỏ sót tăng thêm ròng so với model nhiệt độ; 306 mẫu (97.45%) thuộc nhóm cần báo trước 10–15 phút. Ở nhóm sắp vượt sau 5 phút, hai model gần tương đương. Kết quả này áp dụng tại các ngưỡng đã chọn, không chứng minh classifier luôn kém ở mọi mức nhạy.

## 2. Phần mục tiêu mới định giải quyết có tỷ trọng nhỏ

Chỉ 251/5316 mẫu vượt ngưỡng (4.72%) đã trở lại ngưỡng ở phút 15. Classifier bắt 129 mẫu, model nhiệt độ bắt 111 mẫu trong nhóm này.
Tức là việc mở mục tiêu sang vượt giữa chừng có lợi ở một nhóm nhỏ, nhưng chưa bù được phần giảm ở các mẫu vẫn vượt tại phút 15. Đề xuất ban đầu đã quá nhấn mạnh nhóm này trước khi kiểm tra tần suất của nó.

## 3. Vượt nhẹ sát ngưỡng là vùng khó chính

Các mẫu vượt tối đa 0,5 C: 2372/5316 (44.62%). Chúng chiếm 68.37% số bỏ sót của model nhiệt độ và 68.55% số bỏ sót của classifier.

| Độ vượt lớn nhất trong 15 phút | Recall nhiệt độ | Recall classifier |
|---|---:|---:|
| 0..0.2 C | 31.52% | 21.48% |
| 0.2..0.5 C | 50.69% | 42.41% |
| >2 C | 87.15% | 86.58% |

Không thể từ đây tự kết luận các lần vượt nhẹ là vô hại hoặc bỏ nhãn của chúng. Bảng chỉ xác định vùng lỗi của benchmark.

## 4. Bỏ sót một thời điểm khác với bỏ sót cả đợt

Một đợt trong bảng là chuỗi điểm đo 5 phút liên tiếp ngoài ngưỡng. Đợt được xem là có cảnh báo nếu có ít nhất một dự báo phát cảnh báo trong 15 phút trước khi bắt đầu, khi có lịch sử đầu vào hợp lệ. Bảng tính cảnh báo bất kỳ; số đợt có cảnh báo đúng hướng trên/dưới của model nhiệt độ được ghi riêng trong analysis.json.

| Preset | Đợt đủ điều kiện | Có cảnh báo bằng model nhiệt độ | Có cảnh báo bằng classifier |
|---|---:|---:|---:|
| room_0_4 | 853 | 89.80% | 89.92% |
| room_2_6 | 652 | 79.14% | 73.01% |
| room_minus22_minus18 | 386 | 90.93% | 90.93% |
| room_minus28_minus22 | 85 | 92.94% | 71.76% |

Ở preset -22..-18 C, hai model cùng cảnh báo được 351/386 đợt, nhưng trung vị thời gian báo trước của các đợt được bắt là 10 phút với model nhiệt độ và 5 phút với classifier.
Các tỷ lệ theo đợt không thay thế recall tại từng thời điểm hay mục tiêu báo trước đủ 15 phút. Đây là replay trên dữ liệu công khai theo mẫu 5 phút, chưa mô phỏng đầy đủ lịch chạy, hysteresis và thông báo của backend.

## 5. Hai preset nhiệt độ âm ảnh hưởng mạnh đến số trung bình

Hai preset -22..-18 và -28..-22 C tạo ra 79.65% phần giảm recall trung bình đều theo preset. Chúng lần lượt chỉ có 9 và 3 nguồn test có mẫu phù hợp.
Preset -28..-22 C có 206/253 mẫu vượt ngưỡng thuộc nguồn 030_2DT. Vì vậy vài nguồn chi phối mạnh kết quả; không suy rộng thành chất lượng cho tất cả phòng lạnh.

## 6. Phép thử có khác biệt về dữ liệu dùng học

Model nhiệt độ học 284,984 cửa sổ lịch sử vật lý; classifier chỉ học 132,862 cửa sổ vật lý có nhiệt độ hiện tại trong ít nhất một preset. Sau áp các preset chồng nhau, classifier có 165,896 hàng huấn luyện.
Hai model giữ cùng phép chia nguồn nhưng chưa dùng đúng cùng tập mẫu để so riêng tác dụng của mục tiêu hồi quy/phân loại. Đây là một yếu tố gây nhiễu cần kiểm chứng; chưa có bằng chứng rằng chỉ yếu tố này gây ra kết quả giảm.

## Cách xử lý tiếp theo dựa trên phân tích

- Ưu tiên phép thử kiểm soát: cùng tập mẫu và đặc trưng, cùng định nghĩa cảnh báo, cùng ngân sách báo nhầm từng preset. Tách riêng tác dụng của giảm dữ liệu huấn luyện, đổi mục tiêu và đổi ngưỡng.
- Giữ model nhiệt độ hiện tại làm đối chứng. Nếu thử kết hợp, tạo dự báo nhiệt độ ngoài fold làm đặc trưng cho classifier để dùng lại tín hiệu liên tục mà bộ hồi quy đã học; không dùng dự báo từ model đã fit chính mẫu đó làm dữ liệu train cho tầng sau.
- Báo cáo đồng thời recall từng mẫu, tỷ lệ bắt được đợt và thời gian báo trước. Không gộp tất cả thành một con số độ chính xác.
- Chưa xác định được nguyên nhân vật lý của các lần tăng/giảm nhiệt. Không quy chúng cho mở cửa hoặc lỗi máy nén khi dữ liệu không có nhãn tương ứng.

[Bảng và phương pháp đầy đủ](report.md) · [Số liệu](analysis.json) · [Các ví dụ](sample_cases.csv)
