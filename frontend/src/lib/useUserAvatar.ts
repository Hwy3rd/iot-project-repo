import { usersApi } from '@/api/endpoints'
import type { User } from '@/api/types'
import { ME_KEY, useAuth } from '@/auth/auth-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Change or remove one account's avatar: your own (from the profile), or
 * anyone's for an Admin (POST|DELETE /users/:id/images let Admin past the
 * self-only check). The Users list is refetched, and when it's your own
 * account the signed-in user in the cache is replaced so the header updates.
 */
export function useUserAvatar(user: User | null | undefined) {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const store = (updated: User) => {
    if (updated.id === me?.id) qc.setQueryData<User | null>(ME_KEY, updated)
    void qc.invalidateQueries({ queryKey: ['users'] })
  }

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

  return { setAvatar, removeAvatar }
}
