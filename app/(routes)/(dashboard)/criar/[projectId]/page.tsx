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
};

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
  });

  const { data: slides, isLoading: loadingSlides } = useQuery({
    queryKey: ["content-slides", projectId],
    queryFn: async (): Promise<Slide[]> => {
      const res = await fetch(`/api/content-projects/${projectId}/slides`);
      if (!res.ok) return [];
      return (await res.json()).slides ?? [];
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

  if (loadingProject || !project) {
    return <Skeleton className="h-64 w-full max-w-3xl" />;
  }

  const hasSlides = (slides?.length ?? 0) > 0;

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

      <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
        {generate.isPending ? "Gerando…" : hasSlides ? "Regerar copy" : "Gerar copy"}
      </Button>

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Slide {slide.slide_number}
          {slide.role ? <span className="ml-2 text-sm text-muted-foreground">({slide.role})</span> : null}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending ? "Regerando…" : "Regerar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
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
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar slide"}
        </Button>
      </CardContent>
    </Card>
  );
}
