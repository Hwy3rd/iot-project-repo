# Thử nghiệm chuỗi nhiệt độ bằng GRU

Thử nghiệm offline trên bộ Bangkok đang có, dùng chung dữ liệu và nhóm nguồn
test với benchmark HGB trước. Không cập nhật model runtime hoặc production.
T_MS/T_FC là nhãn nguồn dữ liệu; không dùng để phân loại phòng hoặc chọn model.

- Đầu vào: đúng 13 nhiệt độ từ t−60 đến t, cách nhau 5 phút.
- Đầu ra: thay đổi nhiệt độ sau 5, 10 và 15 phút; cộng lại nhiệt độ hiện tại.
- Hai cấu hình GRU: một lớp, 32 hoặc 64 hidden units. Loss L1 trung bình ba mốc.
- Chuẩn hóa chỉ fit trên tập train. Kênh vào gồm nhiệt độ chuẩn hóa và chênh lệch
  so với nhiệt độ hiện tại; không bổ sung thông tin ngoài lịch sử nhiệt.
- Chọn cấu hình/epoch bằng MAE trung bình bốn preset trên tập validation riêng
  theo nguồn, rồi fit lại 98 nguồn phát triển cho số epoch đã cố định.
- Báo cáo đủ ba seed đã chọn trước. Không chọn seed đẹp nhất từ test.
- Đối chứng: HGB500 tại phút 15, HGB500 riêng từng mốc 5–10–15 và GRU đa mốc.
- HGB giữ 22 đặc trưng tổng hợp và cấu hình cũ, gồm `early_stopping='auto'`;
  500 là số vòng tối đa. GRU đọc trực tiếp 13 nhiệt độ; cùng lịch sử gốc nhưng
  cách biểu diễn đầu vào khác nhau. Số vòng HGB thực chạy được ghi trong metadata.
- Cảnh báo đa mốc: ít nhất một dự báo vượt ngưỡng, khi nhiệt độ hiện tại còn
  trong ngưỡng. So recall, FPR, precision và từng preset cùng với MAE/P95.
- Kiểm tra bổ sung theo thời gian: train 60%, validation giữa 60–80%, test 20%
  cuối; chọn cấu hình lại từ phần trước test. Nhãn tương lai không vượt ranh giới.
- Bộ dữ liệu và nhóm test cũ đã được nghiên cứu nhiều lần. Kết quả là thăm dò,
  không phải kiểm định trên kho thật. Các mẫu liên tiếp/preset có chồng lặp.

## Chạy

Môi trường Python 3.10, scikit-learn 1.7.2 và PyTorch 2.5.1. Máy hiện có thể
dùng môi trường GPU tại `../../PTCHTTM/ACCIDENT/venv` mà không thay đổi môi trường đó.
Nếu tạo môi trường mới, cài `ai-service/requirements-sequence.txt`; chọn bản
PyTorch CPU hoặc CUDA phù hợp từ nguồn chính thức.

Từ gốc worktree AI:

```powershell
python -B -m unittest discover -s ai-service/tests -p test_room_sequence_gru.py -v
python -u -B ai-service/experiments/room_sequence_gru.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-sequence-gru-2026-10-31 --device cuda
```

Mỗi lượt cần một thư mục output mới. Báo cáo `report.md`, số liệu `metrics.json`,
dự báo `predictions.npz` và trọng số đánh giá được lưu riêng tại output.
Các model runtime và file API được kiểm tra SHA-256 trước/sau lượt chạy.

## Điều kiện xem là cải thiện

- Dự báo: MAE trung bình preset giảm ít nhất 1%, P95 tăng tối đa 5%, MAE từng
  preset tăng tối đa 5% so với HGB tại phút 15.
- Cảnh báo: recall tăng ít nhất 2 điểm phần trăm, FPR trung bình tăng tối đa
  0,5 điểm và FPR từng preset tăng tối đa 1 điểm. So cả hai đối chứng HGB.

Đây là tiêu chí so sánh cho bài tập, không phải giới hạn an toàn thực phẩm.

## Kết quả ngày 31/10/2026

Lượt chạy sử dụng GPU RTX 2050, PyTorch 2.5.1+cu121, scikit-learn 1.7.2,
NumPy 2.2.6, pandas 2.3.3 và joblib 1.6.0 trong môi trường đã có sẵn.
Phiên bản môi trường thực chạy được ghi đầy đủ trong `metrics.json`.

Trên 25 nguồn giữ riêng, validation chọn GRU 64 hidden units, 11 epoch:

| Model | MAE phút 15 (°C) | Recall cảnh báo | FPR |
|---|---:|---:|---:|
| HGB tại phút 15 | 0,5794 | 58,50% | 4,01% |
| HGB tại 5–10–15 phút | 0,5794 | 61,86% | 4,50% |
| GRU tại 5–10–15 phút, trung bình 3 seed | 0,5823 | 60,94% | 4,92% |

MAE GRU giữa ba seed nằm trong 0,5776–0,5900°C; recall 60,06–61,62%;
FPR 4,80–4,98%. Không seed nào đạt toàn bộ tiêu chí cải thiện dự báo hoặc
cảnh báo so với HGB tại phút 15. Điểm HGB đối chứng tái lập đúng benchmark cũ.

Kiểm tra 20% thời gian cuối, validation độc lập chọn GRU 64 units, 30 epoch:

| Model | MAE phút 15 (°C) | Recall cảnh báo | FPR |
|---|---:|---:|---:|
| HGB tại phút 15 | 0,4549 | 58,87% | 2,72% |
| HGB tại 5–10–15 phút | 0,4549 | 65,63% | 3,31% |
| GRU tại 5–10–15 phút, seed 20261031 | 0,4440 | 68,81% | 3,52% |

Ở kiểm tra thời gian, GRU giảm MAE khoảng 2,39% và tăng recall, nhưng FPR tăng
khoảng 0,80 điểm phần trăm so với HGB tại phút 15, vượt ngân sách tăng 0,5 điểm.
GRU tốt hơn HGB đa mốc trong riêng lượt thời gian này; kết quả không lặp lại ở
nhóm nguồn giữ riêng. Lượt thời gian đạt giới hạn huấn luyện 30 epoch, vì vậy
kết luận chỉ áp dụng cho hai cấu hình và ngân sách đã thử, không phủ định mọi GRU.

HGB đa mốc tăng recall trên cả hai phép kiểm tra. Nó đạt ngân sách báo nhầm theo
nguồn, nhưng FPR ở lượt thời gian tăng khoảng 0,59 điểm phần trăm, nhỉnh hơn mức
0,5 điểm đã đặt trước. Chưa có căn cứ thay model runtime theo các tiêu chí này.

[Báo cáo đầy đủ](../ai-service/experiments/results/room-sequence-gru-2026-10-31/report.md)
· [Số liệu](../ai-service/experiments/results/room-sequence-gru-2026-10-31/metrics.json)

## Kiểm chứng artifact

Script sau nạp lại HGB và toàn bộ bốn checkpoint GRU đánh giá, tái tạo dự báo,
tính lại chỉ số từ file dự báo và đối chiếu SHA-256 các file runtime:

```powershell
python -B ai-service/experiments/verify_room_sequence_gru.py --raw-dir '../dataverse_files/Dataset of household cold-chain conditions/01_src' --output-dir ai-service/experiments/results/room-sequence-gru-2026-10-31 --device cuda --write
```

Kết quả kiểm chứng được lưu tại `verification.json` trong thư mục kết quả.
Test GRU là tùy chọn: môi trường runtime không cài PyTorch sẽ bỏ qua sáu test
GRU; môi trường thí nghiệm có PyTorch chạy đủ cả sáu test.
