"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type ContentType = "post" | "carousel" | "thumbnail";

type Project = {
  id: string;
  content_type: ContentType;
  idea: string;
  status: string;
  slide_count: number | null;
  created_at: string;
};

type Brand = { id: string; brand_name: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  copy_ready: "Copy pronta",
  generating: "Gerando imagens",
  completed: "Concluído",
  failed: "Falhou",
};

export default function CriarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [contentType, setContentType] = useState<ContentType>("carousel");
  const [idea, setIdea] = useState("");
  const [slideCount, setSlideCount] = useState(5);
  const [brandId, setBrandId] = useState<string>("none");

  const { data: projects, isLoading } = useQuery({
    queryKey: ["content-projects"],
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch("/api/content-projects");
      if (!res.ok) throw new Error("Falha ao listar projetos");
      return (await res.json()).projects ?? [];
    },
  });

  const { data: brands } = useQuery({
    queryKey: ["brand-profiles"],
    queryFn: async (): Promise<Brand[]> => {
      const res = await fetch("/api/brand-profiles");
      if (!res.ok) return [];
      return (await res.json()).brandProfiles ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/content-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: contentType,
          idea: idea.trim(),
          brand_id: brandId === "none" ? null : brandId,
          slide_count: contentType === "carousel" ? slideCount : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao criar projeto");
      return (await res.json()).project as Project;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["content-projects"] });
      toast.success("Projeto criado");
      router.push(`/criar/${project.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Criar conteúdo</h1>
          <p className="text-sm text-muted-foreground">
            Gere posts e carrosséis na voz e identidade da sua marca.
          </p>
        </div>
        <Link href="/criar/marcas">
          <Button variant="outline">Marcas</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo projeto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo de conteúdo</Label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="carousel">Carrossel</SelectItem>
                <SelectItem value="post">Post (imagem única)</SelectItem>
                <SelectItem value="thumbnail">Thumbnail (16:9)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {contentType === "carousel" && (
            <div className="space-y-1.5">
              <Label>Número de slides</Label>
              <Input
                type="number"
                min={2}
                max={20}
                value={slideCount}
                onChange={(e) => setSlideCount(Number(e.target.value))}
                className="w-28"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Marca</Label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger>
                <SelectValue placeholder="Sem marca" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem marca</SelectItem>
                {(brands ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.brand_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Ideia / briefing</Label>
            <Textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={3}
              placeholder="Ex.: 5 erros que travam o crescimento de pequenos negócios no Instagram"
            />
          </div>

          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !idea.trim()}
          >
            {create.isPending ? "Criando…" : "Criar projeto"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Projetos</h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !projects || projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>
        ) : (
          projects.map((p) => (
            <Link key={p.id} href={`/criar/${p.id}`}>
              <Card className="transition hover:border-foreground/20">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.idea}</p>
                    <p className="text-sm text-muted-foreground capitalize">
                      {p.content_type}
                      {p.slide_count ? ` · ${p.slide_count} slides` : ""}
                    </p>
                  </div>
                  <Badge variant="outline">{STATUS_LABEL[p.status] ?? p.status}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
