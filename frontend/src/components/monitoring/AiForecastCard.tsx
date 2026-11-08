import type { AiForecastStatus, ColdRoomPrediction } from '@/api/types'
import { ToneBadge, type Tone } from '@/components/common/StatusBadge'
import { formatDateTime, formatTemp } from '@/lib/format'
import { AI_RISK_LEVEL_LABEL, AI_VIOLATION_LABEL } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'

type Props = {
  prediction: ColdRoomPrediction | null
  status?: AiForecastStatus
  loading: boolean
  error: boolean
}

function statusContent(status?: AiForecastStatus): { title: string; detail: string; tone: Tone } {
  switch (status?.code) {
    case 'collecting_data':
      return {
        title: 'Đang thu thập lịch sử',
        detail: 'Cần các mốc nhiệt độ hợp lệ cách nhau 5 phút trong khoảng 60 phút, từ cùng một thiết bị. Khoảng trống dữ liệu có thể làm thời gian chờ lâu hơn.',
        tone: 'info',
      }
    case 'unsupported_range': {
      const range = `${formatTemp(status.supportedMinTemp)} đến ${formatTemp(status.supportedMaxTemp)}`
      return {
        title: 'Ngoài dải AI hỗ trợ',
        detail: status.reason === 'current_reading'
          ? `Nhiệt độ hiện tại ${formatTemp(status.currentTemp)} nằm ngoài dải mô hình hỗ trợ (${range}). Tiếp tục theo dõi số đo và cảnh báo thực tế.`
          : `Ngưỡng phòng ${formatTemp(status.tempMin)} đến ${formatTemp(status.tempMax)} nằm ngoài dải mô hình hỗ trợ (${range}). Chờ thêm dữ liệu chưa giải quyết được giới hạn này.`,
        tone: 'warning',
      }
    }
    case 'no_device':
      return { title: 'Chưa có thiết bị', detail: 'Gán thiết bị vào phòng và bắt đầu gửi số đo để chuẩn bị dữ liệu dự báo.', tone: 'neutral' }
    case 'no_data':
      return { title: 'Chưa nhận được số đo', detail: 'Kiểm tra nguồn điện và kết nối của thiết bị. AI sẽ kiểm tra lịch sử khi phòng có dữ liệu mới.', tone: 'neutral' }
    case 'stale_data':
      return { title: 'Thiếu dữ liệu mới', detail: 'Số đo gần nhất đã quá 5 phút. Dự báo cũ hết hiệu lực; kiểm tra kết nối thiết bị để tiếp tục cập nhật.', tone: 'warning' }
    case 'prediction_expired':
      return { title: 'Dự báo đã hết hiệu lực', detail: 'Kết quả cũ đã quá 5 phút. Đang chờ dự báo mới; tiếp tục theo dõi số đo và cảnh báo thực tế.', tone: 'warning' }
    case 'sensor_error':
      return { title: 'Số đo nhiệt độ không hợp lệ', detail: 'Kiểm tra cảm biến nhiệt độ. AI cần số đo hợp lệ để đánh giá lịch sử và tạo dự báo.', tone: 'warning' }
    case 'temperature_out_of_range':
      return { title: 'Nhiệt độ thực tế đã vượt ngưỡng', detail: 'Ưu tiên xử lý cảnh báo nhiệt độ hiện tại. Hệ thống tiếp tục đánh giá dự báo khi số đo trở lại trong ngưỡng.', tone: 'warning' }
    case 'service_unavailable':
      return { title: 'Dịch vụ dự báo tạm gián đoạn', detail: 'Lần gọi AI gần nhất chưa thành công. Hệ thống sẽ tự thử lại khi có số đo mới; giám sát và cảnh báo thực tế vẫn hoạt động.', tone: 'warning' }
    case 'unavailable':
      return { title: 'Chưa kiểm tra được dự báo', detail: 'Tạm thời chưa đọc được kết quả hoặc trạng thái AI. Hệ thống sẽ tự kiểm tra lại; tiếp tục theo dõi số đo thực tế.', tone: 'warning' }
    case 'pending':
    case 'ready':
      return { title: 'Đang chờ dự báo mới', detail: 'Lịch sử đã đủ điều kiện. Hệ thống sẽ cập nhật kết quả sau lần đánh giá dữ liệu tiếp theo.', tone: 'info' }
    default:
      return { title: 'Chưa có dự báo', detail: 'Cần khoảng 60 phút lịch sử hợp lệ và nhiệt độ trong dải AI hỗ trợ. Trạng thái chi tiết sẽ xuất hiện khi backend cung cấp thông tin.', tone: 'neutral' }
  }
}

export function AiForecastCard({ prediction, status, loading, error }: Props) {
  if (prediction) {
    return (
      <section aria-label="Dự báo AI" className={cn(
        'flex flex-col gap-2 rounded-xl border p-3.5 transition-colors',
        prediction.willExceedThreshold
          ? 'border-warning/50 bg-warning/10 dark:border-warning/40 dark:bg-warning/15'
          : 'border-purple-500/20 bg-purple-50/50 dark:border-purple-500/30 dark:bg-purple-950/20',
      )}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
            <span className="text-sm font-semibold">Dự báo AI (+5 và +10 phút)</span>
          </div>
          {prediction.willExceedThreshold
            ? <ToneBadge tone="warning">{AI_VIOLATION_LABEL[prediction.violationType]}</ToneBadge>
            : <ToneBadge tone="success">Nhiệt độ ổn định</ToneBadge>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {prediction.forecasts.map((point) => (
            <div key={point.horizonMinutes} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Sau {point.horizonMinutes} phút</span>
              <span className={cn('text-2xl font-bold tabular-nums', point.willExceedThreshold && 'text-warning')}>
                {formatTemp(point.predictedTemp)}
              </span>
              <span className="text-xs text-muted-foreground">
                {point.willExceedThreshold ? AI_VIOLATION_LABEL[point.violationType] : 'Trong ngưỡng'}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Cảnh báo sớm · {AI_RISK_LEVEL_LABEL[prediction.riskLevel]}</p>
        <p className="text-xs text-muted-foreground">Dữ liệu dự báo lúc {formatDateTime(prediction.predictedAt)}</p>
        {prediction.recommendation && (
          <p className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Khuyến nghị:</span>{' '}{prediction.recommendation}
          </p>
        )}
      </section>
    )
  }

  const content = loading
    ? { title: 'Đang kiểm tra dữ liệu', detail: 'Đang tải trạng thái dự báo của phòng.', tone: 'info' as const }
    : error
      ? { title: 'Không tải được trạng thái AI', detail: 'Kiểm tra kết nối và thử tải lại dữ liệu. Chưa thể kết luận phòng đã đủ lịch sử hay dịch vụ AI đang gặp lỗi.', tone: 'warning' as const }
      : statusContent(status)
  const showProgress = !loading && !error && status?.code === 'collecting_data'
    && typeof status.collectedSamples === 'number' && typeof status.requiredSamples === 'number'
    && status.requiredSamples > 0
  const received = showProgress ? Math.max(0, Math.min(status.collectedSamples!, status.requiredSamples!)) : 0

  return (
    <section aria-label="Dự báo AI" className={cn(
      'flex flex-col gap-3 rounded-xl border p-3.5',
      content.tone === 'warning' ? 'border-warning/50 bg-warning/5' : 'border-border bg-muted/30',
    )}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
          Dự báo AI (+5 và +10 phút)
        </h3>
        <ToneBadge tone={content.tone}>{content.title}</ToneBadge>
      </div>
      <div role="status" className="flex items-start gap-2 text-sm" aria-live="polite">
        {loading
          ? <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          : content.tone === 'warning'
            ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            : null}
        <p>{content.detail}</p>
      </div>
      {showProgress && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Mốc nhiệt độ hợp lệ trong {status.requiredHistoryMinutes ?? 60} phút</span>
            <span>{received}/{status.requiredSamples} mốc</span>
          </div>
          <progress aria-label="Tiến độ thu thập lịch sử dự báo" value={received} max={status.requiredSamples}
            className="h-2 w-full overflow-hidden rounded-full accent-primary" />
        </div>
      )}
      {!loading && !error && status?.deviceUniqueId && (
        <p className="text-xs text-muted-foreground">Thiết bị: <span className="font-mono">{status.deviceUniqueId}</span></p>
      )}
      {!loading && !error && status?.lastReadingAt && (
        <p className="text-xs text-muted-foreground">Số đo gần nhất: {formatDateTime(status.lastReadingAt)}</p>
      )}
      <p className="border-t pt-2 text-xs text-muted-foreground">Chưa có dự báo không đồng nghĩa nhiệt độ đang an toàn. Tiếp tục kiểm tra số đo và cảnh báo thực tế.</p>
    </section>
  )
}
