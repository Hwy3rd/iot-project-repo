import { ApiError } from '@/api/client'
import { chatbotApi } from '@/api/endpoints'
import type { ChatMessage } from '@/api/types'
import { useInfiniteQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHATBOT_EVENTS,
  ChatSendError,
  isShownMessage,
  sendChatMessage,
  type ChatErrorEvent,
  type ChatToolCallEvent,
} from './chatbot'
import { getSocket, holdSocket } from './socket'

const PAGE_SIZE = 50
// Past the server's turn lock (CHATBOT_TURN_LOCK_TTL_SECONDS): by then the
// reply is lost (e.g. the socket dropped mid-turn), so stop waiting.
const TURN_TIMEOUT_MS = 180_000

export const CHAT_CONVERSATIONS_KEY = ['chatbot', 'conversations'] as const
const messagesKey = (id: string) => ['chatbot', 'messages', id] as const

// pages[0] is the newest page; each later page is older. Every page is
// oldest-first, as the server returns it.
type Pages = InfiniteData<ChatMessage[], string | undefined>

function appendMessage(qc: QueryClient, message: ChatMessage) {
  qc.setQueryData<Pages>(messagesKey(message.conversationId), (data) => {
    if (!data) return { pages: [[message]], pageParams: [undefined] }
    // The sending tab gets its own message both in the ack and as an event.
    if (data.pages.some((page) => page.some((m) => m.id === message.id))) return data
    const [newest = [], ...older] = data.pages
    return { ...data, pages: [[...newest, message], ...older] }
  })
}

interface Turn {
  conversationId: string
  tools: string[]
}

/**
 * One conversation's shown messages (oldest first), the in-flight reply
 * and `send`. With `conversationId` null, the first `send` creates the
 * conversation and reports it through `onCreated`.
 */
export function useChatConversation(conversationId: string | null, onCreated: (id: string) => void) {
  const qc = useQueryClient()
  const [turn, setTurn] = useState<Turn | null>(null)
  const [sending, setSending] = useState(false)
  const currentId = useRef(conversationId)
  useEffect(() => {
    currentId.current = conversationId
  }, [conversationId])
  // Tagged with its conversation, so it doesn't follow the user to another one.
  const [failure, setFailure] = useState<{ conversationId: string | null; text: string } | null>(null)
  const setError = useCallback((text: string | null, id: string | null = currentId.current) => {
    setFailure(text ? { conversationId: id, text } : null)
  }, [])

  const history = useInfiniteQuery({
    queryKey: messagesKey(conversationId ?? ''),
    queryFn: ({ pageParam }) => chatbotApi.messages(conversationId!, { limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => (page.length === PAGE_SIZE ? page[0].id : undefined),
    enabled: !!conversationId,
    // Kept current by socket events; refetching would replay every page.
    staleTime: Infinity,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  useEffect(() => {
    const s = getSocket()
    const onMessage = (message: ChatMessage) => {
      appendMessage(qc, message)
      if (message.role === 'user' && message.conversationId === currentId.current) {
        // Also covers a turn started from another tab.
        setTurn((t) => (t?.conversationId === message.conversationId ? t : { conversationId: message.conversationId, tools: [] }))
      }
      if (message.role === 'assistant' && isShownMessage(message)) {
        setTurn((t) => (t?.conversationId === message.conversationId ? null : t))
        void qc.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
      }
    }
    const onToolCall = (event: ChatToolCallEvent) =>
      setTurn((t) => (t?.conversationId === event.conversationId ? { ...t, tools: event.tools } : t))
    const onError = (event: ChatErrorEvent) => {
      setTurn((t) => (t?.conversationId === event.conversationId ? null : t))
      if (event.conversationId === currentId.current) {
        setError('Trợ lý gặp lỗi khi trả lời. Thử gửi lại câu hỏi.', event.conversationId)
      }
    }
    // Events sent while disconnected are lost; reload what was stored.
    const onReconnect = () => {
      if (currentId.current) void qc.invalidateQueries({ queryKey: messagesKey(currentId.current) })
    }
    s.on(CHATBOT_EVENTS.MESSAGE, onMessage)
    s.on(CHATBOT_EVENTS.TOOL_CALL, onToolCall)
    s.on(CHATBOT_EVENTS.ERROR, onError)
    s.io.on('reconnect', onReconnect)
    const release = holdSocket()
    return () => {
      s.off(CHATBOT_EVENTS.MESSAGE, onMessage)
      s.off(CHATBOT_EVENTS.TOOL_CALL, onToolCall)
      s.off(CHATBOT_EVENTS.ERROR, onError)
      s.io.off('reconnect', onReconnect)
      release()
    }
  }, [qc, setError])

  const pendingConversation = turn?.conversationId
  useEffect(() => {
    if (!pendingConversation) return
    const timer = setTimeout(() => {
      setTurn(null)
      setError('Chưa nhận được câu trả lời. Thử tải lại hoặc gửi lại câu hỏi.', pendingConversation)
      void qc.invalidateQueries({ queryKey: messagesKey(pendingConversation) })
    }, TURN_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [pendingConversation, qc, setError])

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      setError(null)
      setSending(true)
      try {
        let id = conversationId
        if (!id) {
          const created = await chatbotApi.create()
          id = created.id
          void qc.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
          currentId.current = id
          onCreated(id)
        }
        const message = await sendChatMessage(id, content)
        appendMessage(qc, message)
        setTurn((t) => (t?.conversationId === id ? t : { conversationId: id, tools: [] }))
        return true
      } catch (err) {
        setError(
          err instanceof ChatSendError || err instanceof ApiError
            ? err.message
            : 'Không gửi được tin nhắn. Thử lại sau.',
          currentId.current,
        )
        return false
      } finally {
        setSending(false)
      }
    },
    [conversationId, onCreated, qc, setError],
  )

  const messages = useMemo(
    () => (history.data ? [...history.data.pages].reverse().flat().filter(isShownMessage) : []),
    [history.data],
  )
  const notFound = history.error instanceof ApiError && history.error.status === 404

  return {
    messages,
    history,
    notFound,
    /** Tools being looked up while the assistant works on a reply; null when idle. */
    pending: turn && turn.conversationId === conversationId ? turn.tools : null,
    sending,
    error: failure && failure.conversationId === conversationId ? failure.text : null,
    send,
  }
}
