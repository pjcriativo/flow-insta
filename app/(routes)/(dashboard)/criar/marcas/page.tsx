"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// Editor de marcas (brand_profiles): identidade visual + verbal. Distinto da
// página "Marca (white-label)" em configuracoes/marca (workspace_branding).

type BrandProfile = {
  id: string;
  brand_name: string;
  instagram_handle: string | null;
  description: string | null;
  target_audience: string | null;
  tone_of_voice: string | null;
  visual_style: string | null;
  mood_keywords: string[] | null;
  color_palette: { name?: string; hex?: string; role?: string }[] | null;
};

type BrandForm = {
  brand_name: string;
  instagram_handle: string;
  description: string;
  target_audience: string;
  tone_of_voice: string;
  visual_style: string;
  mood_keywords: string;
};

const EMPTY: BrandForm = {
  brand_name: "",
  instagram_handle: "",
  description: "",
  target_audience: "",
  tone_of_voice: "",
  visual_style: "",
  mood_keywords: "",
};

export default function BrandsPage() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BrandForm>(EMPTY);

  const { data, isLoading } = useQuery({
    queryKey: ["brand-profiles"],
    queryFn: async (): Promise<BrandProfile[]> => {
      const res = await fetch("/api/brand-profiles");
      if (!res.ok) throw new Error("Falha ao listar marcas");
      return (await res.json()).brandProfiles ?? [];
    },
  });

  const toPayload = (f: BrandForm) => ({
    brand_name: f.brand_name.trim(),
    instagram_handle: f.instagram_handle.trim() || null,
    description: f.description.trim() || null,
    target_audience: f.target_audience.trim() || null,
    tone_of_voice: f.tone_of_voice.trim() || null,
    visual_style: f.visual_style.trim() || null,
    mood_keywords: f.mood_keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const save = useMutation({
    mutationFn: async (f: BrandForm) => {
      const url = editingId ? `/api/brand-profiles/${editingId}` : "/api/brand-profiles";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(f)),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao salvar");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-profiles"] });
      toast.success(editingId ? "Marca atualizada" : "Marca criada");
      setEditingId(null);
      setForm(EMPTY);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/brand-profiles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao excluir");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-profiles"] });
      toast.success("Marca excluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (b: BrandProfile) => {
    setEditingId(b.id);
    setForm({
      brand_name: b.brand_name ?? "",
      instagram_handle: b.instagram_handle ?? "",
      description: b.description ?? "",
      target_audience: b.target_audience ?? "",
      tone_of_voice: b.tone_of_voice ?? "",
      visual_style: b.visual_style ?? "",
      mood_keywords: (b.mood_keywords ?? []).join(", "),
    });
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marcas</h1>
        <p className="text-sm text-muted-foreground">
          Identidade visual e voz da marca usadas para gerar copy e imagens.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{editingId ? "Editar marca" : "Nova marca"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Nome da marca *">
            <Input
              value={form.brand_name}
              onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              placeholder="Minha Marca"
            />
          </Field>
          <Field label="@ do Instagram">
            <Input
              value={form.instagram_handle}
              onChange={(e) => setForm({ ...form, instagram_handle: e.target.value })}
              placeholder="@minhamarca"
            />
          </Field>
          <Field label="Sobre a marca">
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
            />
          </Field>
          <Field label="Público-alvo">
            <Input
              value={form.target_audience}
              onChange={(e) => setForm({ ...form, target_audience: e.target.value })}
            />
          </Field>
          <Field label="Tom de voz">
            <Input
              value={form.tone_of_voice}
              onChange={(e) => setForm({ ...form, tone_of_voice: e.target.value })}
              placeholder="Descontraído, direto, inspirador"
            />
          </Field>
          <Field label="Estilo visual">
            <Input
              value={form.visual_style}
              onChange={(e) => setForm({ ...form, visual_style: e.target.value })}
              placeholder="Minimalista, cores quentes, fotografia real"
            />
          </Field>
          <Field label="Palavras-chave de mood (separadas por vírgula)">
            <Input
              value={form.mood_keywords}
              onChange={(e) => setForm({ ...form, mood_keywords: e.target.value })}
              placeholder="energético, confiável, jovem"
            />
          </Field>

          <div className="flex gap-2">
            <Button
              onClick={() => save.mutate(form)}
              disabled={save.isPending || !form.brand_name.trim()}
            >
              {save.isPending ? "Salvando…" : editingId ? "Salvar alterações" : "Criar marca"}
            </Button>
            {editingId && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                }}
              >
                Cancelar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Marcas cadastradas</h2>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma marca ainda.</p>
        ) : (
          data.map((b) => (
            <Card key={b.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium">{b.brand_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {b.tone_of_voice || b.description || "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(b)}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(b.id)}
                    disabled={remove.isPending}
                  >
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
