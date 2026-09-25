import { batchesApi } from '@/api/endpoints'
import type { Batch, ColdRoom, ProductType } from '@/api/types'
import { FormDialog } from '@/components/common/FormDialog'
import { SelectField, TextField } from '@/components/common/form-fields'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { dayjs, formatTemp } from '@/lib/format'
import {
  mutationErrorText,
  nullableText,
  numberRule,
  optionalText,
  requiredText,
  toInput,
} from '@/lib/forms'
import { PRODUCT_UNIT_LABEL } from '@/lib/labels'
import { useColdRoomLookup, useProductTypeLookup, useWarehouseLookup } from '@/lib/lookups'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

interface FormValues {
  coldRoomId: string
  productTypeId: string
  batchCode: string
  quantity: string
  supplier: string
  receivedAt: string
  expiryDate: string
  notes: string
}

const empty = (): FormValues => ({
  coldRoomId: '',
  productTypeId: '',
  batchCode: '',
  quantity: '',
  supplier: '',
  receivedAt: dayjs().format('YYYY-MM-DD'),
  expiryDate: '',
  notes: '',
})

/**
 * Mirrors BatchesService.assertColdRoomFitsProductType so the mismatch is
 * explained before submitting: only enforced when the product type declares
 * both bounds, and the room's whole range must sit inside them.
 */
function fitError(room: ColdRoom | undefined, product: ProductType | undefined) {
  if (!room || !product) return null
  const { storageTempMin: min, storageTempMax: max } = product
  if (min === null || max === null) return null
  if (room.tempMin >= min && room.tempMax <= max) return null
  return (
    `Phòng ${room.name} giữ ${formatTemp(room.tempMin)} – ${formatTemp(room.tempMax)}, ` +
    `ngoài khoảng bảo quản ${formatTemp(min)} – ${formatTemp(max)} của ${product.name}.`
  )
}

const toValues = (b: Batch): FormValues => ({
  coldRoomId: b.coldRoomId,
  productTypeId: b.productTypeId,
  batchCode: b.batchCode,
  quantity: toInput(b.quantity),
  supplier: toInput(b.supplier),
  receivedAt: b.receivedAt,
  expiryDate: b.expiryDate,
  notes: toInput(b.notes),
})

/** Admin, Manager, or Staff with an active shift in that warehouse (backend-checked). */
export function CreateBatchDialog() {
  const [open, setOpen] = useState(false)
  return <BatchFormDialog open={open} onOpenChange={setOpen} />
}

/**
 * Same roles as creating. The cold room can't be changed (moving stock means
 * taking the batch out and recording a new one there).
 * Mount with key={`${id}:${updatedAt}`} so the form reloads fresh values.
 */
export function EditBatchDialog({
  batch,
  open,
  onClose,
}: {
  batch: Batch
  open: boolean
  onClose: () => void
}) {
  return <BatchFormDialog batch={batch} open={open} onOpenChange={(o) => !o && onClose()} />
}

function BatchFormDialog({
  batch,
  open,
  onOpenChange,
}: {
  /** Set = edit this batch; unset = create. */
  batch?: Batch
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const warehouses = useWarehouseLookup()
  const coldRooms = useColdRoomLookup()
  const productTypes = useProductTypeLookup()
  const initial = () => (batch ? toValues(batch) : empty())
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial() })

  const product = productTypes.get(useWatch({ control, name: 'productTypeId' }))
  const roomOptions = coldRooms.items.map((r) => ({
    value: r.id,
    label: `${r.name} · ${warehouses.label(r.warehouseId)}`,
  }))

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      batch
        ? batchesApi.update(batch.id, {
            productTypeId: v.productTypeId,
            batchCode: v.batchCode.trim(),
            quantity: Number(v.quantity),
            supplier: nullableText(v.supplier),
            receivedAt: v.receivedAt,
            expiryDate: v.expiryDate,
            notes: nullableText(v.notes),
          })
        : batchesApi.create({
            coldRoomId: v.coldRoomId,
            productTypeId: v.productTypeId,
            batchCode: v.batchCode.trim(),
            quantity: Number(v.quantity),
            supplier: optionalText(v.supplier),
            receivedAt: v.receivedAt,
            expiryDate: v.expiryDate,
            notes: optionalText(v.notes),
          }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['batches'] })
      toast.success(batch ? 'Đã lưu thay đổi' : 'Đã nhập lô hàng', { description: b.batchCode })
      onOpenChange(false)
      reset(batch ? toValues(b) : empty())
    },
    onError: (err) =>
      setError('root.server', {
        message: mutationErrorText(err, {
          409: 'Phòng lạnh này đã có lô trùng mã. Kiểm tra lại mã lô.',
          403: batch
            ? 'Bạn không có quyền sửa lô hàng này (nhân viên cần đang trong ca trực tại kho).'
            : 'Bạn không có quyền nhập hàng vào phòng lạnh này (nhân viên cần đang trong ca trực tại kho).',
        }),
      }),
  })

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => reset(initial())}
      triggerLabel={batch ? undefined : 'Nhập lô hàng'}
      title={batch ? `Sửa lô hàng ${batch.batchCode}` : 'Nhập lô hàng mới'}
      description="Mã lô là duy nhất trong mỗi phòng lạnh."
      onSubmit={handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={batch ? 'Lưu thay đổi' : 'Nhập lô'}
      serverError={errors.root?.server?.message}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="productTypeId"
          rules={{ required: 'Chọn loại sản phẩm.' }}
          id="batch-product"
          label="Loại sản phẩm"
          options={productTypes.options}
        />
        <SelectField
          control={control}
          name="coldRoomId"
          rules={{
            required: 'Chọn phòng lạnh.',
            validate: (id, all) =>
              fitError(coldRooms.get(id), productTypes.get(all.productTypeId)) ?? true,
            deps: ['productTypeId'],
          }}
          id="batch-room"
          label="Phòng lạnh"
          options={roomOptions}
          disabled={!!batch}
          description={batch ? 'Không đổi được phòng lạnh của lô hàng.' : undefined}
        />
        <TextField
          id="batch-code"
          label="Mã lô"
          spellCheck={false}
          className="font-mono"
          error={errors.batchCode}
          {...register('batchCode', { validate: requiredText('Nhập mã lô.') })}
        />
        <TextField
          id="batch-quantity"
          label={product ? `Số lượng (${PRODUCT_UNIT_LABEL[product.unit]})` : 'Số lượng'}
          inputMode="decimal"
          error={errors.quantity}
          {...register('quantity', {
            validate: numberRule({ required: true, min: 0, label: 'số lượng' }),
          })}
        />
        <TextField
          id="batch-received"
          label="Ngày nhập"
          type="date"
          error={errors.receivedAt}
          {...register('receivedAt', { required: 'Chọn ngày nhập.' })}
        />
        <TextField
          id="batch-expiry"
          label="Hạn sử dụng"
          type="date"
          error={errors.expiryDate}
          {...register('expiryDate', {
            required: 'Chọn hạn sử dụng.',
            validate: (v, all) =>
              !all.receivedAt || v > all.receivedAt || 'Hạn sử dụng phải sau ngày nhập.',
            deps: ['receivedAt'],
          })}
        />
      </div>
      <TextField
        id="batch-supplier"
        label="Nhà cung cấp"
        description="Không bắt buộc."
        error={errors.supplier}
        {...register('supplier')}
      />
      <Field>
        <FieldLabel htmlFor="batch-notes">Ghi chú</FieldLabel>
        <Textarea id="batch-notes" rows={2} {...register('notes')} />
      </Field>
    </FormDialog>
  )
}
