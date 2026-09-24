import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Whitelisted by filename, not a directory scan — deliberately excludes
// every other file under docs/ (ARCHITECTURE.md, DATABASE_DESIGN.md,
// RBAC.md, API_DESIGN.md...), which are internal engineering docs the
// chatbot must never surface (see the comment on the `search_docs` tool
// definition and system-prompt rule #5). Add a filename here only if it's
// meant to be end-user/business-facing content.
export const CHATBOT_SEARCHABLE_DOCS = [
  'BUSINESS_RULES.md',
  'SYSTEM_OPERATIONS_GUIDE.md',
  'TROUBLESHOOTING.md',
];

const SNIPPET_MAX_LENGTH = 600;
const MAX_MATCHES = 5;

export interface ChatbotDocMatch {
  file: string;
  heading: string;
  snippet: string;
}

// Correct default only for local dev, where `pnpm start:dev` always runs
// from server/ (see CLAUDE.md) — so process.cwd() is server/ and '..'
// lands on the repo root's docs/. Production overrides this via
// CHATBOT_DOCS_DIR (see the repo-root .env.example) because the Docker image
// copies docs/ to /app/docs, not one level above the working directory.
function resolveDocsDir(): string {
  return process.env.CHATBOT_DOCS_DIR ?? join(process.cwd(), '..', 'docs');
}

// One section per Markdown heading line (any level) — a doc with no
// headings at all becomes a single section under an empty heading.
function splitIntoSections(
  markdown: string,
): Array<{ heading: string; body: string }> {
  const lines = markdown.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0 || currentHeading) {
      sections.push({
        heading: currentHeading,
        body: currentLines.join('\n').trim(),
      });
    }
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      currentHeading = line.replace(/^#{1,6}\s+/, '').trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections.filter((section) => section.body.length > 0);
}

function truncate(text: string): string {
  return text.length > SNIPPET_MAX_LENGTH
    ? `${text.slice(0, SNIPPET_MAX_LENGTH)}…`
    : text;
}

// No index, no vector search — grep-style substring match over a
// deliberately small, whitelisted doc set (see docs-size discussion this
// module's design went through: not worth the infra until these files
// actually grow past a few thousand lines combined).
export async function searchChatbotDocs(
  query: string,
): Promise<ChatbotDocMatch[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const docsDir = resolveDocsDir();
  const matches: ChatbotDocMatch[] = [];

  for (const file of CHATBOT_SEARCHABLE_DOCS) {
    let content: string;
    try {
      content = await readFile(join(docsDir, file), 'utf-8');
    } catch {
      // Missing file is not an error condition for this tool — it just
      // has nothing to contribute yet (matches this session's docs being
      // created empty, filled in later).
      continue;
    }
    if (!content.trim()) continue;

    for (const section of splitIntoSections(content)) {
      const haystack = `${section.heading}\n${section.body}`.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({
          file,
          heading: section.heading || '(không có tiêu đề)',
          snippet: truncate(section.body),
        });
        if (matches.length >= MAX_MATCHES) return matches;
      }
    }
  }

  return matches;
}
