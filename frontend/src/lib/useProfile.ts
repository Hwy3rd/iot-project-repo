import { usersApi, type UpdateUserBody } from '@/api/endpoints'
import type { User } from '@/api/types'
import { ME_KEY, useAuth } from '@/auth/auth-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Edits to your own account (PATCH /users/:id and the avatar image). Each
 * result replaces the signed-in user in the cache, so the header's name and
 * avatar change at once.
 */
export function useProfile() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const store = (updated: User) => {
    qc.setQueryData<User | null>(ME_KEY, updated)
    // The Users page (Admin) lists this account too.
    void qc.invalidateQueries({ queryKey: ['users'] })
  }

  const update = useMutation({
    mutationFn: (body: Pick<UpdateUserBody, 'fullName' | 'email' | 'phone'>) =>
      usersApi.update(user!.id, body),
    onSuccess: store,
  })

  // Upload first, then drop every older image: a failed upload leaves the
  // old avatar in place, and the account ends up with exactly one image.
  const setAvatar = useMutation({
    mutationFn: async (file: File) => {
      const previous = user!.imageUrls ?? []
      let updated = await usersApi.addImages(user!.id, [file])
      for (const url of previous) updated = await usersApi.removeImage(user!.id, url)
      return updated
    },
    onSuccess: store,
  })

  const removeAvatar = useMutation({
    mutationFn: async () => {
      let updated = user!
      for (const url of user!.imageUrls ?? []) updated = await usersApi.removeImage(user!.id, url)
      return updated
    },
    onSuccess: store,
  })

  return { user, update, setAvatar, removeAvatar }
}
