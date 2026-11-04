# Tối ưu model cảnh báo và hiệu chỉnh ngưỡng riêng

Thử nghiệm tiếp theo của `room_warning.py` kiểm tra hai thay đổi:

1. Chọn HGBClassifier giữa bản 300 vòng, bản 500 vòng/63 lá cùng quy mô model
   nhiệt độ, bản tăng regularization và bản tăng trọng số lớp nguy hiểm.
2. Tách riêng nguồn fit, hiệu chỉnh ngưỡng và test. Ngưỡng được hiệu chỉnh bằng
   chính bản model dùng để chấm test; model không fit lại sau hiệu chỉnh.

Nguồn dữ liệu vẫn là bộ công khai đang có. Các kênh trong bộ dữ liệu chỉ là
thông tin nguồn, không phải các loại ngăn hay cách chia phòng của dự án.
Đánh giá theo bốn preset phòng, khi nhiệt độ hiện tại còn trong ngưỡng và có
ít nhất một điểm đo vượt ngưỡng ở t+5, t+10 hoặc t+15 phút.

## Quy trình so sánh

- Giữ 25 nguồn test của phép thử trước, dùng 98 nguồn còn lại cho phát triển.
  Đây là dữ liệu đã được nghiên cứu trước, không phải test hoàn toàn mới.
- Lượt chính chia 98 nguồn thành 73 nguồn fit/chọn cấu hình và 25 nguồn hiệu
  chỉnh. Ba fold theo nguồn trong nhóm fit dùng chọn cấu hình ở ngân sách FPR 4%.
- So cả model nhiệt độ dùng ngưỡng gốc, model nhiệt độ được hiệu chỉnh và
  classifier 300 vòng được hiệu chỉnh. Tất cả fit lại trên cùng nhóm được phép.
- Ngân sách FPR hiệu chỉnh cho từng preset: 2%, 4%, 6%. Mức 4% được đặt làm
  chính trước khi chấm. FPR thực tế trên test có thể khác ngân sách này.
- Lặp ba seed chia nhóm fit/hiệu chỉnh, giữ nguyên cấu hình đã chọn và 25 nguồn
  test. Báo cáo đủ cả ba lượt, không chọn lượt đẹp nhất làm kết luận.
- Kiểm tra theo thời gian: fit 60% đầu, hiệu chỉnh 60..80%, test 20% cuối.
  Nhãn tương lai ở phần trước không được đi qua ranh giới phần sau.

Lượt chính so thêm hai cách chọn ngưỡng OOF và dùng tập hiệu chỉnh riêng trên
cùng bản model, cùng mẫu test, cùng ngân sách 4%, để tách tác dụng của hiệu chỉnh.
Ngưỡng của cả hai cách đều được chọn bằng dữ liệu ngoài test.

Cấu hình classifier được chọn từ các chuỗi đầy đủ của nhóm fit theo nguồn.
Vì vậy phần replay theo thời gian chỉ là kiểm tra bổ sung, chưa độc lập với
bước chọn cấu hình; không xem nó là test hoàn toàn mới.

Để xem là cải thiện, recall cần tăng ít nhất 2 điểm phần trăm, FPR trung bình
tăng tối đa 0,5 điểm và FPR từng preset tăng tối đa 1 điểm so với đối chứng.
Đây là tiêu chí kỹ thuật cho bài tập, không phải ngưỡng an toàn thực phẩm.

## Chạy lại

Từ thư mục gốc worktree AI với môi trường `.venv-ai` đã cài requirements:

```powershell
$env:OMP_NUM_THREADS='4'
$env:OPENBLAS_NUM_THREADS='4'
.venv-ai/Scripts/python.exe -B -m unittest discover -s ai-service/tests -v
.venv-ai/Scripts/python.exe -B -u ai-service/experiments/room_warning_tuning.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-warning-tuning-reproduction --threads 4
```

Mỗi lần chạy dùng output mới. Thêm `--resume` với thư mục output cũ để dùng lại
các model đã fit nếu manifest đầu vào trùng khớp. Cache được bỏ qua bởi Git;
manifest, số liệu, báo cáo và artifact của lượt chính được giữ để kiểm tra.

[Báo cáo và kết quả thực chạy](../ai-service/experiments/results/room-warning-tuning-2026-10-17/report.md).

Model runtime, API và production giữ nguyên. Artifact đánh giá chứa model fit
trên 73 nguồn, kèm ngưỡng hiệu chỉnh từ nhóm khác; không thay trực tiếp cho API
trả về nhiệt độ dự báo hiện tại.
