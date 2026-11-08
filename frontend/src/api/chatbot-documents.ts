import { api } from "./client";

export type ChatbotDocumentStatus =
  "pending" | "queued" | "processing" | "ready" | "failed";
export interface ChatbotDocument {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  bytes: number;
  pages: number | null;
  status: ChatbotDocumentStatus;
  chunkCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BuiltinDocument {
  filename: string;
  title: string;
  chunkCount: number;
  available: boolean;
}
export interface ChatbotDocumentsOverview {
  items: ChatbotDocument[];
  builtins: BuiltinDocument[];
  processingAvailable: boolean;
  knowledgeMode: "none" | "prompt" | "rag";
  maxDocuments: number;
}
export const chatbotDocumentsApi = {
  list: () => api.get<ChatbotDocumentsOverview>("/chatbot/documents"),
  detail: (id: string) =>
    api.get<ChatbotDocument & { textContent: string }>(
      `/chatbot/documents/${id}`,
    ),
  builtin: (filename: string) =>
    api.get<BuiltinDocument & { textContent: string }>(
      `/chatbot/documents/builtin/${encodeURIComponent(filename)}`,
    ),
  upload: (file: File, title: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("title", title);
    return api.post<ChatbotDocument>("/chatbot/documents", body);
  },
  process: (id: string) =>
    api.post<ChatbotDocument>(`/chatbot/documents/${id}/process`),
  remove: (id: string) => api.delete<null>(`/chatbot/documents/${id}`),
};
