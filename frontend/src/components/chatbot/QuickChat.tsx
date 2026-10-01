import { ChatPanel } from '@/components/chatbot/ChatPanel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readQuickConversation, writeQuickConversation } from '@/lib/chatbot'
import { Bot, Maximize2, MessageSquarePlus, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useLocation } from 'react-router'

/**
 * Floating button (bottom right) opening a small chat window over any page.
 * It resumes the conversation last used here, and can hand it over to the
 * full chatbot page. Hidden on that page, which already is the chat.
 */
export function QuickChat() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(readQuickConversation)
  // Remounts the panel for a new conversation, not when its first message creates one.
  const [panelKey, setPanelKey] = useState(0)

  const onCreated = useCallback((id: string) => {
    writeQuickConversation(id)
    setConversationId(id)
  }, [])
  const startNew = () => {
    writeQuickConversation(null)
    setConversationId(null)
    setPanelKey((k) => k + 1)
  }

  if (pathname.startsWith('/chatbot')) return null

  return (
    <>
      {!open && (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Mở trợ lý AI"
          className="relative ml-auto mt-4 flex size-14 rounded-full shadow-lg sm:fixed sm:right-4 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))] sm:z-40 sm:mt-0 [&_svg:not([class*='size-'])]:size-6"
        >
          <Bot aria-hidden="true" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="bg-black/10"
          // Straight to typing (the default would focus, and so pop the tooltip of, the first header button).
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            document.getElementById('quick-chat-input')?.focus()
          }}
          // Anchored bottom right on larger screens, full screen on phones.
          className="top-auto right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] left-auto flex h-[min(640px,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 data-open:slide-in-from-bottom-4 data-open:zoom-in-100 sm:max-w-md max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:rounded-none"
        >
          <header className="flex items-center gap-2 border-b pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 pr-2 pl-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">Trợ lý AI</DialogTitle>
              <DialogDescription className="sr-only">Hỏi nhanh trợ lý AI về dữ liệu kho trong phạm vi của bạn.</DialogDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={startNew} aria-label="Cuộc trò chuyện mới">
                  <MessageSquarePlus aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cuộc trò chuyện mới</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" asChild>
                  <Link
                    to={conversationId ? `/chatbot?c=${conversationId}` : '/chatbot'}
                    onClick={() => setOpen(false)}
                    aria-label="Mở toàn màn hình"
                  >
                    <Maximize2 aria-hidden="true" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mở toàn màn hình</TooltipContent>
            </Tooltip>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Đóng">
                <X aria-hidden="true" />
              </Button>
            </DialogClose>
          </header>
          <ChatPanel
            key={panelKey}
            compact
            conversationId={conversationId}
            onConversationCreated={onCreated}
            onConversationGone={startNew}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
