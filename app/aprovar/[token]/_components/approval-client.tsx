"use client";

import { useState } from "react";
import type { PublicApprovalData } from "@/lib/approvals/public-guard";
import { CheckCircle2, RotateCcw, XCircle, Clock, MessageSquarePlus, Loader2 } from "lucide-react";

const STATUS_META: Record<string, { label: string; icon: typeof Clock; cls: string }> = {
  pending: { label: "Pendente", icon: Clock, cls: "text-slate-400" },
  approved: { label: "Aprovado", icon: CheckCircle2, cls: "text-green-600" },
  changes_requested: { label: "Ajuste pedido", icon: RotateCcw, cls: "text-amber-600" },
  rejected: { label: "Reprovado", icon: XCircle, cls: "text-red-600" },
};

type Decision = "approved" | "changes_requested" | "rejected";

export function ApprovalClient({
  token,
  data,
}: {
  token: string;
  data: PublicApprovalData;
}) {
  const primary = data.branding.primary_color || "#6366f1";
  const accent = data.branding.accent_color || "#06b6d4";

  return (
    <div
      className="min-h-screen bg-muted/20"
      style={{ ["--brand" as string]: primary, ["--brand-accent" as string]: accent }}
    >
      {/* Cabeçalho white-label */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {data.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.logoUrl} alt="" className="h-9 w-auto" />
          ) : (
            <div
              className="flex size-9 items-center justify-center rounded-lg font-bold text-white"
              style={{ background: primary }}
            >
              {(data.collection.client_name?.[0] ?? "A").toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-base font-semibold leading-tight">{data.collection.title}</h1>
            <p className="text-xs text-muted-foreground">Aprovação de conteúdo</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <p className="text-sm text-muted-foreground">
          Revise cada publicação abaixo e aprove, peça ajustes ou reprove.
        </p>

        {data.items.map((item) => (
          <ItemCard key={item.id} token={token} item={item} brand={primary} />
        ))}

        {data.items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma publicação nesta coleção.
          </p>
        )}
      </main>

      <footer className="py-8 text-center text-xs text-muted-foreground">
        Powered by Flow Insta
      </footer>
    </div>
  );
}

function ItemCard({
  token,
  item,
  brand,
}: {
  token: string;
  item: PublicApprovalData["items"][number];
  brand: string;
}) {
  const [status, setStatus] = useState(item.item_status);
  const [comments, setComments] = useState(item.comments);
  const [pending, setPending] = useState<Decision | null>(null);
  const [commentBox, setCommentBox] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  const meta = STATUS_META[status] ?? STATUS_META.pending;
  const MetaIcon = meta.icon;

  const decide = async (decision: Decision, comment?: string) => {
    setPending(decision);
    try {
      const res = await fetch("/api/approvals/public/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, collection_item_id: item.id, decision, comment }),
      });
      if (res.ok) {
        const map: Record<Decision, typeof status> = {
          approved: "approved",
          changes_requested: "changes_requested",
          rejected: "rejected",
        };
        setStatus(map[decision]);
        if (comment) {
          setComments((c) => [
            ...c,
            { id: `tmp-${Date.now()}`, author_type: "client", body: comment, created_at: new Date().toISOString() },
          ]);
        }
      }
    } finally {
      setPending(null);
    }
  };

  const sendComment = async () => {
    if (!commentBox.trim()) return;
    setSendingComment(true);
    try {
      const res = await fetch("/api/approvals/public/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, collection_item_id: item.id, body: commentBox.trim() }),
      });
      if (res.ok) {
        setComments((c) => [
          ...c,
          { id: `tmp-${Date.now()}`, author_type: "client", body: commentBox.trim(), created_at: new Date().toISOString() },
        ]);
        setCommentBox("");
        setShowComment(false);
      }
    } finally {
      setSendingComment(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <span
            className="size-2 rounded-full"
            style={{ background: item.post.channel?.color ?? "#999" }}
          />
          <span className="font-medium">{item.post.channel?.name ?? "Publicação"}</span>
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium ${meta.cls}`}>
          <MetaIcon className="size-3.5" /> {meta.label}
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="whitespace-pre-wrap text-sm">{item.post.content}</p>
      </div>

      {comments.length > 0 && (
        <div className="space-y-1 border-t bg-muted/30 px-4 py-2">
          {comments.map((c) => (
            <p key={c.id} className="text-xs text-muted-foreground">
              <strong>{c.author_type === "client" ? "Você" : "Agência"}:</strong> {c.body}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <button
          onClick={() => decide("approved")}
          disabled={pending !== null}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: brand }}
        >
          {pending === "approved" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Aprovar
        </button>
        <button
          onClick={() => setShowComment((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-amber-700"
        >
          <RotateCcw className="size-4" /> Pedir ajuste
        </button>
        <button
          onClick={() => decide("rejected")}
          disabled={pending !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-red-600 disabled:opacity-50"
        >
          {pending === "rejected" ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
          Reprovar
        </button>
        <button
          onClick={() => setShowComment((s) => !s)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <MessageSquarePlus className="size-3.5" /> Comentar
        </button>
      </div>

      {showComment && (
        <div className="space-y-2 border-t px-4 py-3">
          <textarea
            value={commentBox}
            onChange={(e) => setCommentBox(e.target.value)}
            placeholder="Descreva o ajuste ou deixe um comentário…"
            rows={2}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              onClick={() => decide("changes_requested", commentBox.trim() || undefined)}
              disabled={pending !== null}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#d97706" }}
            >
              {pending === "changes_requested" ? "Enviando…" : "Pedir ajuste com comentário"}
            </button>
            <button
              onClick={sendComment}
              disabled={sendingComment || !commentBox.trim()}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              {sendingComment ? "Enviando…" : "Só comentar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
