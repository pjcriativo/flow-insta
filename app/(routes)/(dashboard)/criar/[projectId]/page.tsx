"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Project = {
  id: string;
  content_type: string;
  idea: string;
  status: string;
  slide_count: number | null;
  generation_error: string | null;
};

type Slide = {
  id: string;
  slide_number: number;
  role: string | null;
  headline: string | null;
  body: string | null;
  visual_description: string | null;
  generation_status: string;
  image_path: string | null;
  image_url: string | null;
};

// Estimativa de custo por imagem (gpt-image-1 'high'). Aproximada — só para a UI
// dar uma noção antes de gerar; o custo real depende do tamanho/saída.
const COST_PER_IMAGE_USD = 0.17;

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const qc = useQueryClient();

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ["content-project", projectId],
    queryFn: async (): Promise<Project> => {
      // Reusa a lista (sem rota GET :id de projeto na Fase 1) — filtra o atual.
      const res = await fetch("/api/content-projects");
      const list: Project[] = (await res.json()).projects ?? [];
      const found = list.find((p) => p.id === projectId);
      if (!found) throw new Error("Projeto não encontrado");
      return found;
    },
    // Enquanto gera imagens, faz polling do status do projeto.
    refetchInterval: (q) => (q.state.data?.status === "generating" ? 4000 : false),
  });

  const { data: slides, isLoading: loadingSlides } = useQuery({
    queryKey: ["content-slides", projectId],
    queryFn: async (): Promise<Slide[]> => {
      const res = await fetch(`/api/content-projects/${projectId}/slides`);
      if (!res.ok) return [];
      return (await res.json()).slides ?? [];
    },
    // Polling enquanto houver slide gerando/pendente (geração de imagem no tick).
    refetchInterval: (q) => {
      const list = q.state.data ?? [];
      const pending = list.some(
        (s) => s.generation_status === "generating" || s.generation_status === "pending"
      );
      return pending ? 4000 : false;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-projects/${projectId}/generate-copy`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao gerar copy");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-slides", projectId] });
      qc.invalidateQueries({ queryKey: ["content-project", projectId] });
      toast.success("Copy gerada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateImages = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-projects/${projectId}/generate-images`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.json()).error || "Falha ao enfileirar imagens");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-slides", projectId] });
      qc.invalidateQueries({ queryKey: ["content-project", projectId] });
      toast.success("Geração de imagens iniciada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loadingProject || !project) {
    return <Skeleton className="h-64 w-full max-w-3xl" />;
  }

  const hasSlides = (slides?.length ?? 0) > 0;
  const slideCount = slides?.length ?? 0;
  const generating = project.status === "generating";
  const estimatedCost = (slideCount * COST_PER_IMAGE_USD).toFixed(2);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <Link href="/criar" className="text-sm text-muted-foreground hover:underline">
            ← Projetos
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{project.idea}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {project.content_type}
            {project.slide_count ? ` · ${project.slide_count} slides` : ""}
          </p>
        </div>
        <Badge variant="outline">{project.status}</Badge>
      </div>

      {project.generation_error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {project.generation_error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => generate.mutate()} disabled={generate.isPending || generating}>
          {generate.isPending ? "Gerando…" : hasSlides ? "Regerar copy" : "Gerar copy"}
        </Button>
        {hasSlides && (
          <Button
            variant="secondary"
            onClick={() => generateImages.mutate()}
            disabled={generateImages.isPending || generating}
          >
            {generating ? "Gerando imagens…" : "Gerar imagens"}
          </Button>
        )}
        {hasSlides && !generating && (
          <span className="text-xs text-muted-foreground">
            ~US$ {estimatedCost} ({slideCount} {slideCount === 1 ? "imagem" : "imagens"})
          </span>
        )}
      </div>

      {loadingSlides ? (
        <Skeleton className="h-40 w-full" />
      ) : hasSlides ? (
        <div className="space-y-4">
          {slides!
            .sort((a, b) => a.slide_number - b.slide_number)
            .map((s) => (
              // key inclui o conteúdo: quando a regeração troca a copy, o card
              // remonta com os novos valores (sem efeito de sincronização).
              <SlideCard
                key={`${s.id}:${s.headline ?? ""}:${s.body ?? ""}:${s.visual_description ?? ""}`}
                slide={s}
                projectId={projectId}
              />
            ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ainda não há copy. Clique em “Gerar copy”.
        </p>
      )}
    </div>
  );
}

function SlideCard({ slide, projectId }: { slide: Slide; projectId: string }) {
  const qc = useQueryClient();
  // Estado inicial vem da prop; o card é remontado (via key no pai) quando a
  // regeração troca o conteúdo, então não precisa de efeito de sincronização.
  const [headline, setHeadline] = useState(slide.headline ?? "");
  const [body, setBody] = useState(slide.body ?? "");
  const [visual, setVisual] = useState(slide.visual_description ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-slides/${slide.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headline, body, visual_description: visual }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao salvar");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-slides", projectId] });
      toast.success(`Slide ${slide.slide_number} salvo`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-slides/${slide.id}/regenerate-copy`, {
        method: "POST",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao regerar");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-slides", projectId] });
      toast.success(`Slide ${slide.slide_number} regerado`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateImage = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/content-slides/${slide.id}/regenerate-image`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.json()).error || "Falha ao regerar imagem");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-slides", projectId] });
      qc.invalidateQueries({ queryKey: ["content-project", projectId] });
      toast.success(`Imagem do slide ${slide.slide_number} sendo regerada`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const imgStatus = slide.generation_status;
  const imgBusy = imgStatus === "generating" || imgStatus === "pending";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          Slide {slide.slide_number}
          {slide.role ? <span className="text-sm text-muted-foreground">({slide.role})</span> : null}
          <ImageStatusBadge status={imgStatus} />
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending ? "Regerando…" : "Regerar copy"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Preview da imagem gerada (bucket público). */}
        {slide.image_url && (
          <div className="overflow-hidden rounded-lg border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slide.image_url} alt={`Slide ${slide.slide_number}`} className="w-full" />
          </div>
        )}
        {imgBusy && !slide.image_url && <Skeleton className="h-48 w-full" />}

        <div className="space-y-1.5">
          <Label>Headline</Label>
          <Input value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Texto de apoio</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        </div>
        <div className="space-y-1.5">
          <Label>Descrição visual (para a imagem)</Label>
          <Textarea value={visual} onChange={(e) => setVisual(e.target.value)} rows={3} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar slide"}
          </Button>
          {slide.image_url && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => regenerateImage.mutate()}
              disabled={regenerateImage.isPending || imgBusy}
            >
              {imgBusy ? "Gerando…" : "Regerar imagem"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ImageStatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge variant="outline">imagem ✓</Badge>;
  if (status === "generating") return <Badge variant="outline">gerando…</Badge>;
  if (status === "pending") return <Badge variant="outline">na fila</Badge>;
  if (status === "failed") return <Badge variant="destructive">falhou</Badge>;
  return null;
}
