import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Assistant replies are Markdown. react-markdown never renders raw HTML
// from the text, so a reply can't inject markup.
const COMPONENTS: Components = {
  // Only the props needed: react-markdown also passes `node`, which must
  // not reach the DOM.
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b bg-muted/50 px-2 py-1.5 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-2 py-1.5 align-top">
      {children}
    </td>
  ),
}

export function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 space-y-2 break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:mt-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  )
}
