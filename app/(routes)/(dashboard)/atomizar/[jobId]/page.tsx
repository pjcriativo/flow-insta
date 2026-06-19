"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  Pencil,
  XCircle,
  AlertTriangle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobStatus } from "@/types/atomization";

// Ordem das etapas do pipeline (para a barra de progresso).
const PIPELINE_STEPS: { key: JobStatus; label: string }[] = [
  { key: "queued", label: "Na fila" },
  { key: "fetching", label: "Buscando" },
  { key: "transcribing", label: "Transcrevendo" },
  { key: "selecting", label: "Selecionando" },
  { key: "rendering", label: "Renderizando" },
  { key: "generating", label: "Gerando copy" },
  { key: "scheduling", label: "Agendando" },
  { key: "completed", label: "Concluído" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Na fila",
  fetching: "Buscando vídeo",
  transcribing: "Transcrevendo",
  selecting: "Selecionando trechos",
  rendering: "Renderizando",
  generating: "Gerando copy",
  scheduling: "Agendando",
  completed: "Concluído",
  failed: "Falhou",
  canceled: "Cancelado",
};

const TERMINAL: JobStatus[] = ["completed", "failed", "canceled"];

type Asset = { id: string; asset_type: string; payload: unknown; post_id: string | null };
type Clip = {
  id: string;
  clip_index: number;
  start_seconds: number;
  end_seconds: number;
  hook_text: string | null;
  rationale: string | null;
  virality_score: number | null;
  status: string;
  video_asset_path: string | null;
  thumbnail_path: string | null;
  assets: Asset[];
};
type JobDetail = {
  job: {
    id: string;
    title: string | null;
    channel_title: string | null;
    youtube_video_id: string | null;
    status: JobStatus;
    error: string | null;
    settings: { clip_count?: number; auto_schedule?: boolean } | null;
  };
  clips: Clip[];
  postsById: Record<string, { id: string; content: string; status: string }>;
};

const CLIP_STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  selected: { label: "Selecionado", variant: "secondary" },
  rendering: { label: "Renderizando", variant: "outline" },
  rendered: { label: "Renderizado", variant: "default" },
  render_failed: { label: "Falha no render", variant: "destructive" },
  discarded: { label: "Descartado", variant: "outline" },
};

export default function AtomizationJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ postId: string; content: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["atomization-job", jobId],
    queryFn: async (): Promise<JobDetail> => {
      const res = await fetch(`/api/atomization/${jobId}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro");
      return await res.json();
    },
    // Polling enquanto não terminal; para quando completed/failed/canceled.
    refetchInterval: (query) => {
      const s = query.state.data?.job?.status;
      return s && TERMINAL.includes(s) ? false : 3000;
    },
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/atomization/${jobId}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao cancelar");
      return json;
    },
    onSuccess: () => {
      toast.success("Job cancelado");
      queryClient.invalidateQueries({ queryKey: ["atomization-job", jobId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveDraft = useMutation({
    mutationFn: async (vars: { postId: string; content: string }) => {
      const res = await fetch(`/api/post/${vars.postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: vars.content, status: "draft" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao salvar");
      return json;
    },
    onSuccess: () => {
      toast.success("Rascunho atualizado");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["atomization-job", jobId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !data?.job) {
    return (
      <div className="space-y-4">
        <Link href="/atomizar" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Voltar
        </Link>
        <Card>
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Job não encontrado.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { job, clips, postsById } = data;
  const isTerminal = TERMINAL.includes(job.status);
  const currentIdx = PIPELINE_STEPS.findIndex((s) => s.key === job.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/atomizar" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
          <h1 className="truncate text-2xl font-semibold">{job.title ?? "Atomização"}</h1>
          {job.channel_title && (
            <p className="text-sm text-muted-foreground">{job.channel_title}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <JobStatusBadge status={job.status} />
          {!isTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Barra de etapas do pipeline */}
      {job.status !== "failed" && job.status !== "canceled" && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              {PIPELINE_STEPS.map((step, i) => {
                const done = currentIdx >= 0 && i < currentIdx;
                const active = i === currentIdx;
                return (
                  <div key={step.key} className="flex items-center gap-2">
                    <span
                      className={
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs " +
                        (done
                          ? "bg-primary/10 text-primary"
                          : active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground")
                      }
                    >
                      {done ? (
                        <CheckCircle2 className="size-3" />
                      ) : active ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Clock className="size-3" />
                      )}
                      {step.label}
                    </span>
                    {i < PIPELINE_STEPS.length - 1 && (
                      <span className="text-muted-foreground/40">›</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erro */}
      {job.status === "failed" && job.error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{job.error}</span>
          </CardContent>
        </Card>
      )}

      {/* Grid de clips */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {clips.length > 0 ? `${clips.length} clip(s)` : "Aguardando seleção de clips…"}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => {
            const reelAsset = clip.assets?.find((a) => a.asset_type === "reel_caption");
            const post = reelAsset?.post_id ? postsById[reelAsset.post_id] : null;
            const badge = CLIP_STATUS_BADGE[clip.status] ?? { label: clip.status, variant: "secondary" as const };
            const thumb = job.youtube_video_id
              ? `https://i.ytimg.com/vi/${job.youtube_video_id}/hqdefault.jpg`
              : null;
            return (
              <Card key={clip.id} className="overflow-hidden">
                <div className="relative aspect-video bg-muted">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  )}
                  <Badge variant={badge.variant} className="absolute right-2 top-2">
                    {badge.label}
                  </Badge>
                </div>
                <CardHeader className="pb-2">
                  <CardTitle className="line-clamp-2 text-sm">
                    {clip.hook_text ?? `Clip ${clip.clip_index + 1}`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {Math.round(Number(clip.start_seconds))}s–{Math.round(Number(clip.end_seconds))}s
                    </span>
                    {clip.virality_score != null && (
                      <span>★ {(Number(clip.virality_score) * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  {post && (
                    <>
                      <p className="line-clamp-3 text-sm">{post.content}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => setEditing({ postId: post.id, content: post.content })}
                      >
                        <Pencil className="size-3.5" /> Editar rascunho
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Dialog de edição do rascunho */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar rascunho</DialogTitle>
          </DialogHeader>
          <Textarea
            value={editing?.content ?? ""}
            onChange={(e) =>
              setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))
            }
            rows={8}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => editing && saveDraft.mutate(editing)}
              disabled={saveDraft.isPending || !editing?.content.trim()}
            >
              {saveDraft.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant: "default" | "secondary" | "outline" | "destructive" =
    status === "completed"
      ? "default"
      : status === "failed"
        ? "destructive"
        : status === "canceled"
          ? "outline"
          : "secondary";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}
