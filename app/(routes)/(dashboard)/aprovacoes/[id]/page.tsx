"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Link2, Copy, Ban, MessageSquare, CheckCircle2, Clock, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const ITEM_STATUS = {
  pending: { label: "Pendente", icon: Clock, color: "text-muted-foreground" },
  approved: { label: "Aprovado", icon: CheckCircle2, color: "text-green-500" },
  changes_requested: { label: "Ajuste pedido", icon: RotateCcw, color: "text-amber-500" },
  rejected: { label: "Reprovado", icon: XCircle, color: "text-red-500" },
} as const;

type Detail = {
  collection: { id: string; client_name: string; title: string; status: string };
  items: {
    id: string; post_id: string; item_status: keyof typeof ITEM_STATUS;
    scheduled_posts?: { content: string; user_channels?: { channel_types?: { name?: string; color?: string } } };
  }[];
  links: { id: string; expires_at: string; revoked_at: string | null; used_count: number }[];
  decisions: { id: string; collection_item_id: string; decision: string; comment: string | null; decided_by_email: string | null; created_at: string }[];
  comments: { id: string; collection_item_id: string; author_type: string; body: string; created_at: string }[];
};

export default function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["approval", id],
    queryFn: async (): Promise<Detail> => {
      const res = await fetch(`/api/approvals/${id}`);
      return await res.json();
    },
  });

  const genLink = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/approvals/${id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 14 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha");
      return json as { url: string };
    },
    onSuccess: ({ url }) => {
      setLinkUrl(url);
      navigator.clipboard?.writeText(url).catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["approval", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (linkId: string) => {
      const res = await fetch(`/api/approvals/${id}/link`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId }),
      });
      if (!res.ok) throw new Error("Falha ao revogar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval", id] });
      toast.success("Link revogado");
    },
  });

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data?.collection) return <p className="text-sm text-muted-foreground">Coleção não encontrada.</p>;

  const activeLink = data.links.find((l) => !l.revoked_at && new Date(l.expires_at) > new Date());
  const commentsByItem = (itemId: string) =>
    data.comments.filter((c) => c.collection_item_id === itemId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{data.collection.title}</h1>
        <p className="text-sm text-muted-foreground">Cliente: {data.collection.client_name}</p>
      </div>

      {/* Link */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4" /> Link de aprovação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeLink ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="flex-1 text-sm">
                <p className="font-medium text-green-600">Link ativo</p>
                <p className="text-xs text-muted-foreground">
                  Expira {new Date(activeLink.expires_at).toLocaleDateString("pt-BR")} · {activeLink.used_count} acesso(s)
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => revoke.mutate(activeLink.id)}>
                <Ban className="size-4" /> Revogar
              </Button>
            </div>
          ) : (
            <Button onClick={() => genLink.mutate()} disabled={genLink.isPending}>
              <Link2 className="size-4" /> {genLink.isPending ? "Gerando…" : "Gerar link para o cliente"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Itens */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posts ({data.items.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.items.map((item) => {
            const st = ITEM_STATUS[item.item_status];
            const StIcon = st.icon;
            const itemComments = commentsByItem(item.id);
            return (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{ background: item.scheduled_posts?.user_channels?.channel_types?.color ?? "#999" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{item.scheduled_posts?.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.scheduled_posts?.user_channels?.channel_types?.name ?? "Sem canal"}
                    </p>
                  </div>
                  <Badge variant="outline" className={`gap-1 ${st.color}`}>
                    <StIcon className="size-3" /> {st.label}
                  </Badge>
                </div>
                {itemComments.length > 0 && (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    {itemComments.map((c) => (
                      <div key={c.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <MessageSquare className="mt-0.5 size-3 shrink-0" />
                        <span>
                          <strong>{c.author_type === "client" ? "Cliente" : "Agência"}:</strong> {c.body}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Diálogo: link gerado (mostra a URL uma vez) */}
      <Dialog open={!!linkUrl} onOpenChange={(o) => !o && setLinkUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link gerado</DialogTitle>
            <DialogDescription>
              Copiado para a área de transferência. Envie ao cliente — este link
              não será exibido novamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={linkUrl ?? ""} className="text-xs" />
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(linkUrl ?? "");
                toast.success("Copiado");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
