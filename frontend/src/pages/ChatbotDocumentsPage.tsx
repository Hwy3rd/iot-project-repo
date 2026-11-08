import {
  chatbotDocumentsApi,
  type ChatbotDocument,
  type ChatbotDocumentStatus,
} from "@/api/chatbot-documents";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageHeader } from "@/components/common/PageHeader";
import { ErrorState, Spinner } from "@/components/common/States";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { mutationErrorText } from "@/lib/forms";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const KEY = ["chatbot-documents"] as const;
const STATUS: Record<ChatbotDocumentStatus, string> = {
  pending: "Chờ xử lý",
  queued: "Đang xếp hàng",
  processing: "Đang xử lý",
  ready: "Sẵn sàng",
  failed: "Xử lý thất bại",
};
type Preview =
  | { kind: "upload"; document: ChatbotDocument }
  | { kind: "builtin"; filename: string; title: string };

function StatusBadge({ status }: { status: ChatbotDocumentStatus }) {
  return (
    <Badge
      variant={status === "failed" ? "destructive" : "outline"}
      className={
        status === "ready"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : ""
      }
    >
      {["queued", "processing"].includes(status) && (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      )}
      {status === "ready" && (
        <CheckCircle2 className="size-3" aria-hidden="true" />
      )}
      {STATUS[status]}
    </Badge>
  );
}

export function ChatbotDocumentsPage() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [processing, setProcessing] = useState<ChatbotDocument | null>(null);
  const [deleting, setDeleting] = useState<ChatbotDocument | null>(null);
  const query = useQuery({
    queryKey: KEY,
    queryFn: chatbotDocumentsApi.list,
    refetchInterval: (q) =>
      q.state.data?.items.some((d) =>
        ["queued", "processing"].includes(d.status),
      )
        ? 2000
        : false,
  });
  const detail = useQuery<{ textContent: string }>({
    queryKey: [
      ...KEY,
      "preview",
      preview?.kind,
      preview?.kind === "upload" ? preview.document.id : preview?.filename,
    ],
    enabled: preview !== null,
    queryFn: () => {
      if (!preview) throw new Error("Chưa chọn tài liệu");
      return preview.kind === "upload"
        ? chatbotDocumentsApi.detail(preview.document.id)
        : chatbotDocumentsApi.builtin(preview.filename);
    },
  });
  const upload = useMutation({
    mutationFn: ({ file, title }: { file: File; title: string }) =>
      chatbotDocumentsApi.upload(file, title),
    onSuccess: (document) => {
      void qc.invalidateQueries({ queryKey: KEY });
      setTitle("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setPreview({ kind: "upload", document });
      toast.success("Đã lưu tài liệu. Hãy kiểm tra nội dung trước khi xử lý.");
    },
    onError: (error) => toast.error(mutationErrorText(error)),
  });
  const process = useMutation({
    mutationFn: chatbotDocumentsApi.process,
    onSuccess: () => {
      setProcessing(null);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success("Đã đưa tài liệu vào hàng đợi xử lý.");
    },
    onError: (error) => toast.error(mutationErrorText(error)),
  });
  const remove = useMutation({
    mutationFn: chatbotDocumentsApi.remove,
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success("Đã xóa tài liệu khỏi nguồn kiến thức chatbot.");
    },
    onError: (error) => toast.error(mutationErrorText(error)),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Tài liệu tối đa 5 MB.");
      return;
    }
    if (!/\.(md|txt|pdf)$/i.test(file.name)) {
      toast.error("Chọn file MD, TXT hoặc PDF có văn bản.");
      return;
    }
    upload.mutate({ file, title: title.trim() });
  };
  const items = query.data?.items ?? [];
  const filtered = items.filter((d) =>
    `${d.title} ${d.filename}`
      .toLocaleLowerCase("vi")
      .includes(search.toLocaleLowerCase("vi")),
  );
  const canProcess = query.data?.processingAvailable === true;
  const selectedUpload =
    preview?.kind === "upload"
      ? (items.find((d) => d.id === preview.document.id) ?? preview.document)
      : null;
  const previewTitle =
    preview?.kind === "upload" ? preview.document.title : preview?.title;

  return (
    <>
      <PageHeader
        title="Tài liệu chatbot"
        description="Quản lý kiến thức hướng dẫn dùng chung để trợ lý AI tra cứu khi trả lời."
        actions={
          <Button variant="outline" asChild>
            <Link to="/chatbot">
              <BookOpen aria-hidden="true" />
              Mở trợ lý AI
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
        {query.isPending ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner />
            Đang tải tài liệu…
          </div>
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            {!canProcess && (
              <Alert>
                <CircleAlert />
                <AlertTitle>Chưa cấu hình dịch vụ xử lý tài liệu</AlertTitle>
                <AlertDescription>
                  Bạn vẫn có thể tải lên và xem nội dung. Tài liệu chỉ được
                  chatbot sử dụng sau khi dịch vụ AI được cấu hình và xử lý
                  thành công.
                </AlertDescription>
              </Alert>
            )}
            {query.data.knowledgeMode === "none" && (
              <Alert>
                <CircleAlert />
                <AlertTitle>Chatbot đang tắt sử dụng tài liệu</AlertTitle>
                <AlertDescription>
                  Tài liệu vẫn được lưu. Cần bật chức năng tra cứu tài liệu để
                  chatbot sử dụng nguồn kiến thức này.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Tài liệu tải lên",
                  value: `${items.length}/${query.data.maxDocuments}`,
                  icon: FileText,
                },
                {
                  label: "Sẵn sàng sử dụng",
                  value: items.filter((d) => d.status === "ready").length,
                  icon: CheckCircle2,
                },
                {
                  label: "Cần xử lý hoặc kiểm tra",
                  value: items.filter((d) => d.status !== "ready").length,
                  icon: CircleAlert,
                },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="flex items-center gap-3 pt-5">
                    <div className="rounded-lg bg-muted p-2.5">
                      <Icon className="size-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="text-2xl font-semibold tabular-nums">
                        {value}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold">Thêm tài liệu hướng dẫn</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Nhận MD, TXT (UTF-8) và PDF có văn bản. Tối đa 5 MB, 40 trang PDF
              và 60.000 ký tự. PDF scan cần chuyển thành văn bản trước.
            </p>
            <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="document-title">Tên tài liệu</Label>
                <Input
                  id="document-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ví dụ: Quy trình xử lý mất điện"
                  minLength={3}
                  maxLength={180}
                  required
                  disabled={upload.isPending}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-file">Chọn file</Label>
                <Input
                  id="document-file"
                  ref={fileInput}
                  type="file"
                  accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                  disabled={upload.isPending}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Nội dung được dùng chung cho người dùng chatbot. Sau khi tải
                  lên, bạn có thể xem trước rồi chọn xử lý để đưa vào sử dụng.
                </p>
                <Button
                  type="submit"
                  disabled={
                    upload.isPending ||
                    query.isPending ||
                    query.isError ||
                    items.length >= (query.data?.maxDocuments ?? 30)
                  }
                >
                  {upload.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Upload />
                  )}{" "}
                  {upload.isPending
                    ? "Đang đọc tài liệu…"
                    : "Tải lên và xem trước"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Tài liệu đã tải lên</h2>
                <p className="text-sm text-muted-foreground">
                  Chỉ tài liệu có trạng thái Sẵn sàng mới được thêm vào kiến
                  thức chatbot.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                <RefreshCw className={query.isFetching ? "animate-spin" : ""} />
                Làm mới
              </Button>
            </div>
            {items.length > 0 && (
              <Input
                aria-label="Tìm tài liệu"
                placeholder="Tìm theo tên tài liệu hoặc tên file…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-4 max-w-md"
              />
            )}
            {!query.isPending && !query.isError && items.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <FileText className="mx-auto mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">Chưa có tài liệu tải lên</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Thêm một tài liệu ở phần trên để mở rộng kiến thức của
                  chatbot.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tài liệu</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Nội dung</TableHead>
                    <TableHead>Ngày tải lên</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="min-w-52 whitespace-normal">
                        <p className="font-medium">{d.title}</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {d.filename} · {(d.bytes / 1024).toFixed(1)} KB
                        </p>
                      </TableCell>
                      <TableCell className="min-w-40 whitespace-normal">
                        <StatusBadge status={d.status} />
                        {d.error && (
                          <p className="mt-2 max-w-xs text-xs text-destructive">
                            {d.error}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {d.chunkCount} đoạn
                        {d.pages !== null && ` · ${d.pages} trang`}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(d.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Xem ${d.title}`}
                            onClick={() =>
                              setPreview({ kind: "upload", document: d })
                            }
                          >
                            <Eye />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              !canProcess ||
                              ["queued", "processing"].includes(d.status)
                            }
                            onClick={() => setProcessing(d)}
                          >
                            {["queued", "processing"].includes(d.status) ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <RefreshCw />
                            )}
                            {d.status === "ready" ? "Xử lý lại" : "Xử lý"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Xóa ${d.title}`}
                            onClick={() => setDeleting(d)}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length > 0 && filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Không tìm thấy tài liệu phù hợp.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {query.data && (
          <section aria-labelledby="builtin-documents-title">
            <h2
              id="builtin-documents-title"
              className="mb-1 text-lg font-semibold"
            >
              Tài liệu có sẵn của hệ thống
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Được cập nhật cùng phiên bản ứng dụng. Bạn có thể xem nội dung tại
              đây.
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {query.data.builtins.map((d) => (
                <Card key={d.filename}>
                  <CardContent className="flex h-full flex-col items-start gap-3 pt-5">
                    <BookOpen className="size-5 text-muted-foreground" />
                    <div className="flex-1">
                      <h3 className="font-medium">{d.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {d.available
                          ? `${d.chunkCount} đoạn nội dung`
                          : "Chưa có file trên máy chủ"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!d.available}
                      onClick={() =>
                        setPreview({
                          kind: "builtin",
                          filename: d.filename,
                          title: d.title,
                        })
                      }
                    >
                      <Eye />
                      Xem nội dung
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="max-h-[90dvh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewTitle}</DialogTitle>
            <DialogDescription>
              Nội dung văn bản hệ thống đọc được. Kiểm tra thông tin và cách
              ngắt dòng trước khi đưa vào kiến thức chatbot.
            </DialogDescription>
          </DialogHeader>
          {detail.isPending ? (
            <div className="flex gap-2 py-8">
              <Spinner />
              Đang tải nội dung…
            </div>
          ) : detail.isError ? (
            <ErrorState
              error={detail.error}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <pre className="max-h-[55dvh] overflow-auto rounded-lg border bg-muted/40 p-4 font-sans text-sm whitespace-pre-wrap break-words">
              {detail.data?.textContent}
            </pre>
          )}
          {selectedUpload && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusBadge status={selectedUpload.status} />
              <Button
                disabled={
                  !canProcess ||
                  ["queued", "processing"].includes(selectedUpload.status) ||
                  detail.isPending ||
                  detail.isError
                }
                onClick={() => {
                  setProcessing(selectedUpload);
                  setPreview(null);
                }}
              >
                <RefreshCw />
                {selectedUpload.status === "ready"
                  ? "Xử lý lại tài liệu"
                  : "Xử lý để chatbot sử dụng"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={processing !== null}
        onOpenChange={(open) => !open && setProcessing(null)}
        title="Đưa tài liệu vào kiến thức chatbot?"
        description={
          <>
            Tài liệu “{processing?.title}” sẽ được gửi tới dịch vụ AI để tạo dữ
            liệu tìm kiếm. Việc xử lý sử dụng hạn mức API và có thể phát sinh
            phí theo gói đang dùng. Sau khi thành công, nội dung được dùng chung
            cho người dùng chatbot.
          </>
        }
        confirmLabel="Bắt đầu xử lý"
        pending={process.isPending}
        onConfirm={() => processing && process.mutate(processing.id)}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Xóa tài liệu?"
        description={
          <>
            Xóa “{deleting?.title}” khỏi kho kiến thức. Chatbot sẽ ngừng tra cứu
            tài liệu này ở các lượt mới.
          </>
        }
        confirmLabel="Xóa tài liệu"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </>
  );
}
