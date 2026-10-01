import type { ChatMessage } from '@/api/types'
import { ErrorState, Spinner } from '@/components/common/States'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CHAT_MESSAGE_MAX_LENGTH, toolActivityText } from '@/lib/chatbot'
import { formatDateTime } from '@/lib/format'
import { useChatConversation } from '@/lib/useChatConversation'
import { cn } from '@/lib/utils'
import { Bot, CircleAlert, Loader2, SendHorizontal, Warehouse } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChatMarkdown } from './ChatMarkdown'

const SUGGESTIONS = [
  'Tóm tắt tình trạng hệ thống hiện tại',
  'Có cảnh báo nào đang mở không?',
  'Phòng lạnh nào đang có nhiệt độ bất thường?',
]

// Within this distance of the bottom counts as "reading the latest", so new
// messages keep the view pinned there.
const STICK_PX = 80

/**
 * A conversation with the assistant: history, the in-flight reply and a
 * composer. Shared by the chatbot page and the quick-chat window. With
 * `conversationId` null it starts a new conversation on the first message.
 */
export function ChatPanel({
  conversationId,
  onConversationCreated,
  onConversationGone,
  compact,
}: {
  conversationId: string | null
  onConversationCreated: (id: string) => void
  /** The conversation was deleted (e.g. from another tab). */
  onConversationGone?: () => void
  /** Tighter spacing for the quick-chat window. */
  compact?: boolean
}) {
  const chat = useChatConversation(conversationId, onConversationCreated)
  const [draft, setDraft] = useState('')

  const submit = async (text: string) => {
    const content = text.trim()
    if (!content || chat.sending || chat.pending || !chat.warehouseReady) return
    setDraft('')
    if (!(await chat.send(content))) setDraft(content)
  }

  const busy = chat.sending || chat.pending !== null || !chat.warehouseReady
  const scopeLabel = chat.warehouse ? `${chat.warehouse.name} (${chat.warehouse.code})` : 'tất cả kho của bạn'
  const tooLong = draft.length > CHAT_MESSAGE_MAX_LENGTH

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {chat.notFound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-muted-foreground">Cuộc trò chuyện này không còn tồn tại.</p>
          {onConversationGone && (
            <Button variant="outline" onClick={onConversationGone}>
              Bắt đầu cuộc trò chuyện mới
            </Button>
          )}
        </div>
      ) : chat.history.isError ? (
        <div className="flex-1">
          <ErrorState error={chat.history.error} onRetry={() => chat.history.refetch()} />
        </div>
      ) : conversationId && chat.history.isPending ? (
        <div className="flex-1">
          <Spinner label="Đang tải cuộc trò chuyện…" />
        </div>
      ) : (
        <MessageList
          messages={chat.messages}
          pending={chat.pending}
          compact={compact}
          hasOlder={chat.history.hasNextPage}
          loadingOlder={chat.history.isFetchingNextPage}
          onLoadOlder={() => chat.history.fetchNextPage()}
          onSuggestion={(text) => void submit(text)}
          suggestionsDisabled={busy}
        />
      )}

      <div className={cn('shrink-0 border-t pb-[max(0.5rem,env(safe-area-inset-bottom))]', compact ? 'px-2 pt-2' : 'px-3 pt-3')}>
        {chat.error && (
          <Alert variant="destructive" className="mb-2 py-2">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{chat.error}</AlertDescription>
          </Alert>
        )}
        {/* Answers default to the header's warehouse (see useChatConversation). */}
        <p className="mb-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Warehouse className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Đang hỏi về: <span className="font-medium text-foreground">{scopeLabel}</span>
          </span>
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(draft)
          }}
        >
          <label htmlFor={compact ? 'quick-chat-input' : 'chat-input'} className="sr-only">
            Tin nhắn cho trợ lý
          </label>
          <textarea
            id={compact ? 'quick-chat-input' : 'chat-input'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              // Enter sends, Shift+Enter breaks the line; not while an IME is composing.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (!tooLong) void submit(draft)
              }
            }}
            rows={1}
            placeholder={chat.warehouse ? `Hỏi về ${chat.warehouse.name}…` : 'Hỏi về kho, phòng lạnh, cảnh báo…'}
            aria-invalid={tooLong || undefined}
            aria-describedby={tooLong ? 'chat-too-long' : undefined}
            className="field-sizing-content max-h-[min(10rem,25dvh)] min-h-9 w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm dark:bg-input/30"
          />
          <Button
            type="submit"
            size="icon-lg"
            disabled={!draft.trim() || tooLong || busy}
            aria-label="Gửi tin nhắn"
          >
            {chat.sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <SendHorizontal aria-hidden="true" />}
          </Button>
        </form>
        {tooLong ? (
          <p id="chat-too-long" className="mt-1 text-xs text-destructive">
            Tin nhắn tối đa {CHAT_MESSAGE_MAX_LENGTH} ký tự ({draft.length}/{CHAT_MESSAGE_MAX_LENGTH}).
          </p>
        ) : (
          !compact && (
            <p className="mt-1 text-xs text-muted-foreground [@media(max-height:500px)]:hidden">
              Enter để gửi, Shift + Enter để xuống dòng. Đổi kho ở đầu trang để hỏi về kho khác; trợ lý chỉ xem được dữ liệu trong phạm vi của bạn.
            </p>
          )
        )}
      </div>
    </div>
  )
}

function MessageList({
  messages,
  pending,
  compact,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onSuggestion,
  suggestionsDisabled,
}: {
  messages: ChatMessage[]
  pending: string[] | null
  compact?: boolean
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onSuggestion: (text: string) => void
  suggestionsDisabled: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prev = useRef<{ firstId?: string; count: number; height: number }>({ count: 0, height: 0 })

  // Older messages loaded above: keep the view where it was. Otherwise
  // follow new messages when the reader is at (or near) the bottom, or
  // when they just sent one.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstId = messages[0]?.id
    const { firstId: prevFirst, count: prevCount, height: prevHeight } = prev.current
    if (prevCount > 0 && firstId !== prevFirst && messages.length > prevCount) {
      el.scrollTop += el.scrollHeight - prevHeight
    } else {
      const nearBottom = prevHeight - el.scrollTop - el.clientHeight < STICK_PX
      const ownLast = messages.at(-1)?.role === 'user'
      if (prevCount === 0 || nearBottom || ownLast) el.scrollTop = el.scrollHeight
    }
    prev.current = { firstId, count: messages.length, height: el.scrollHeight }
  }, [messages, pending])

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-4 text-center sm:p-6">
        <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Bot className="size-6" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium">Trợ lý AI giám sát kho lạnh</p>
          <p className="mt-1 text-pretty text-muted-foreground">
            Hỏi về cảnh báo, nhiệt độ phòng lạnh, thiết bị, lô hàng hay ca trực trong phạm vi của bạn.
          </p>
        </div>
        <div className="flex w-full min-w-0 max-w-md flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-w-0 max-w-full py-1.5 whitespace-normal [overflow-wrap:anywhere]"
              disabled={suggestionsDisabled}
              onClick={() => onSuggestion(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-label="Tin nhắn"
      className={cn('flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain', compact ? 'p-3' : 'p-4')}
    >
      {hasOlder && (
        <div className="flex justify-center">
          <Button type="button" variant="ghost" size="sm" onClick={onLoadOlder} disabled={loadingOlder}>
            {loadingOlder && <Loader2 className="animate-spin" aria-hidden="true" />}
            Xem tin nhắn cũ hơn
          </Button>
        </div>
      )}
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="flex justify-end">
            <p
              className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground"
              title={formatDateTime(m.createdAt)}
            >
              {m.content}
            </p>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2">
            <AssistantAvatar />
            <div
              className="max-w-[85%] min-w-0 rounded-2xl rounded-tl-sm bg-muted px-3 py-2"
              title={formatDateTime(m.createdAt)}
            >
              <ChatMarkdown>{m.content ?? ''}</ChatMarkdown>
            </div>
          </div>
        ),
      )}
      {pending && (
        <div className="flex items-start gap-2" role="status">
          <AssistantAvatar />
          <p className="inline-flex items-center gap-2 rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {toolActivityText(pending)}
          </p>
        </div>
      )}
    </div>
  )
}

function AssistantAvatar() {
  return (
    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
      <Bot className="size-4" />
    </span>
  )
}
