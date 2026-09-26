import { chatbotApi } from '@/api/endpoints'
import type { ChatConversation } from '@/api/types'
import { ChatPanel } from '@/components/chatbot/ChatPanel'
import { ErrorState, Spinner } from '@/components/common/States'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { readQuickConversation, writeQuickConversation } from '@/lib/chatbot'
import { mutationErrorText } from '@/lib/forms'
import { formatRelative } from '@/lib/format'
import { CHAT_CONVERSATIONS_KEY } from '@/lib/useChatConversation'
import { cn } from '@/lib/utils'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, MessageSquarePlus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'

const PAGE_SIZE = 30
const untitled = 'Cuộc trò chuyện mới'

/** Full-screen chat: the caller's conversations on the left, the open one on the right (?c=<id>). */
export function ChatbotPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('c')
  // Remounts the chat (fresh draft and state) when the user switches
  // conversations — but not when their first message creates one.
  const [panelKey, setPanelKey] = useState(0)
  const select = useCallback(
    (id: string | null) => {
      setPanelKey((k) => k + 1)
      setParams(id ? { c: id } : {}, { replace: !id })
    },
    [setParams],
  )
  const onCreated = useCallback((id: string) => setParams({ c: id }, { replace: true }), [setParams])
  // Phones show one pane at a time: the list until a conversation (or a new one) is opened.
  const [composingNew, setComposingNew] = useState(false)
  const showChat = !!selected || composingNew

  const startNew = () => {
    select(null)
    setComposingNew(true)
  }

  return (
    // Fills the viewport under the 3.5rem header and the page's 1.5rem vertical padding.
    <div className="-my-2 flex h-[calc(100dvh-3.5rem-2rem)] min-h-96 overflow-hidden rounded-xl border bg-card">
      <aside
        className={cn('flex w-full flex-col border-r md:flex md:w-72 md:shrink-0', showChat && 'max-md:hidden')}
        aria-label="Các cuộc trò chuyện"
      >
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h1 className="text-lg font-semibold">Trợ lý AI</h1>
          <Button size="sm" onClick={startNew}>
            <MessageSquarePlus aria-hidden="true" />
            Trò chuyện mới
          </Button>
        </div>
        <ConversationList selected={selected} onSelect={select} />
      </aside>

      <section className={cn('flex min-w-0 flex-1 flex-col', !showChat && 'max-md:hidden')} aria-label="Cuộc trò chuyện">
        <div className="flex items-center gap-2 border-b p-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Quay lại danh sách"
            onClick={() => {
              select(null)
              setComposingNew(false)
            }}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <span className="font-medium">Trợ lý AI</span>
        </div>
        <ChatPanel
          key={panelKey}
          conversationId={selected}
          onConversationCreated={onCreated}
          onConversationGone={startNew}
        />
      </section>
    </div>
  )
}

function ConversationList({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const [removing, setRemoving] = useState<ChatConversation | null>(null)
  const list = useInfiniteQuery({
    queryKey: [...CHAT_CONVERSATIONS_KEY, { limit: PAGE_SIZE }],
    queryFn: ({ pageParam }) => chatbotApi.conversations({ page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {list.isPending ? (
        <Spinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <p className="p-4 text-center text-muted-foreground">Chưa có cuộc trò chuyện nào.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 p-2">
          {items.map((c) => (
            <li key={c.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === selected ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-md py-2 pr-10 pl-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  c.id === selected && 'bg-muted',
                )}
              >
                <span className="line-clamp-1 font-medium break-all">{c.title || untitled}</span>
                <span className="text-xs text-muted-foreground">
                  {formatRelative(c.lastMessageAt ?? c.createdAt)}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                // Centred without translate: Button's pressed state nudges its own translate,
                // which would drop the -50% and move it from under the pointer mid-click.
                className="absolute inset-y-0 right-1.5 my-auto opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                aria-label={`Xoá cuộc trò chuyện ${c.title || untitled}`}
                onClick={() => setRemoving(c)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
          >
            {list.isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden="true" />}
            Xem thêm
          </Button>
        </div>
      )}
      <DeleteConversationDialog
        conversation={removing}
        onClose={() => setRemoving(null)}
        onDeleted={(id) => {
          setRemoving(null)
          if (id === selected) onSelect(null)
        }}
      />
    </div>
  )
}

function DeleteConversationDialog({
  conversation,
  onClose,
  onDeleted,
}: {
  conversation: ChatConversation | null
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) => chatbotApi.remove(id),
    onSuccess: (_, id) => {
      toast.success('Đã xoá cuộc trò chuyện')
      if (readQuickConversation() === id) writeQuickConversation(null)
      qc.removeQueries({ queryKey: ['chatbot', 'messages', id] })
      onDeleted(id)
    },
    onError: (err) => toast.error('Không xoá được cuộc trò chuyện', { description: mutationErrorText(err) }),
    onSettled: () => qc.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY }),
  })

  return (
    <Dialog open={!!conversation} onOpenChange={(next) => !next && !remove.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Xoá cuộc trò chuyện?</DialogTitle>
          <DialogDescription>
            “{conversation?.title || untitled}” và toàn bộ tin nhắn trong đó sẽ bị xoá vĩnh viễn.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={remove.isPending}>
              Huỷ
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => conversation && remove.mutate(conversation.id)}
          >
            {remove.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Xoá
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
