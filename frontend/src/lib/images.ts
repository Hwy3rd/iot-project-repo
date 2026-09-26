import { IMAGE_UPLOAD } from '@/api/endpoints'

/** Why these files can't be uploaded, checked before sending (the backend checks again). */
export function imageFilesError(files: File[]) {
  if (files.length > IMAGE_UPLOAD.maxFiles) return `Chọn tối đa ${IMAGE_UPLOAD.maxFiles} ảnh mỗi lần.`
  if (files.some((f) => !f.type.startsWith('image/'))) return 'Chỉ nhận file ảnh.'
  if (files.some((f) => f.size > IMAGE_UPLOAD.maxBytes)) return 'Mỗi ảnh tối đa 5 MB.'
  return null
}
