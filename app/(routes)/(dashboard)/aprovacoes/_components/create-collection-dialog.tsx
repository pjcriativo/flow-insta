"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Post = {
  id: string;
  content: string;
  status: string;
  user_channels?: { channel_types?: { name?: string; color?: string } };
};

export function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Posts em rascunho/fila são candidatos a entrar numa coleção.
  const { data: posts, isLoading } = useQuery({
    queryKey: ["approval-candidate-posts"],
    enabled: open,
    queryFn: async (): Promise<Post[]> => {
      const res = await fetch("/api/post");
      const json = await res.json();
      return (json.posts ?? []).filter(
        (p: Post) => p.status === "draft" || p.status === "queue"
      );
    },
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!clientName.trim() || !title.trim() || selected.size === 0) return;
    setSaving(true);
    const res = await fetch("/api/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: clientName.trim(),
        title: title.trim(),
        post_ids: Array.from(selected),
      }),
    });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || "Falha ao criar coleção");
      return;
    }
    toast.success("Coleção criada");
    onOpenChange(false);
    onCreated();
    setClientName("");
    setTitle("");
    setSelected(new Set());
    router.push(`/aprovacoes/${json.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova coleção de aprovação</DialogTitle>
          <DialogDescription>
            Agrupe posts e gere um link para o cliente aprovar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="client">Nome do cliente</Label>
              <Input id="client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Acme Ltda" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="title">Título</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Campanha de junho" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Posts ({selected.size} selecionado(s))</Label>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
              {isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : (posts ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum post em rascunho ou fila para selecionar.
                </p>
              ) : (
                (posts ?? []).map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent/50"
                  >
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} className="mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{p.content}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.user_channels?.channel_types?.name ?? "Sem canal"}
                      </p>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleCreate}
            disabled={saving || !clientName.trim() || !title.trim() || selected.size === 0}
          >
            {saving ? "Criando…" : "Criar coleção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
