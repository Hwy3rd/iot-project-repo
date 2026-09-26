import { usersApi, type UpdateUserBody } from '@/api/endpoints'
import type { User } from '@/api/types'
import { ME_KEY, useAuth } from '@/auth/auth-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useUserAvatar } from './useUserAvatar'

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

  const { setAvatar, removeAvatar } = useUserAvatar(user)

  return { user, update, setAvatar, removeAvatar }
}
