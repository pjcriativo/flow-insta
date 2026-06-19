"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveOrg } from "@/components/active-org-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck, Plus, ArrowRight } from "lucide-react";
import { CreateCollectionDialog } from "./_components/create-collection-dialog";

type Collection = {
  id: string;
  client_name: string;
  title: string;
  status: string;
  due_at: string | null;
  itemCount: number;
  updated_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  approved: "Aprovada",
  changes_requested: "Ajustes pedidos",
  archived: "Arquivada",
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  in_review: "default",
  approved: "default",
  changes_requested: "destructive",
  archived: "outline",
};

export default function ApprovalsPage() {
  const { activeOrgId } = useActiveOrg();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["approvals", activeOrgId],
    queryFn: async (): Promise<Collection[]> => {
      const res = await fetch("/api/approvals");
      return (await res.json()).collections ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Aprovações</h1>
          <p className="text-sm text-muted-foreground">
            Envie posts para o cliente aprovar antes de publicar.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> Nova coleção
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${data?.length ?? 0} coleção(ões)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : (data ?? []).length === 0 ? (
            <div className="py-10 text-center">
              <ClipboardCheck className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma coleção ainda. Crie a primeira para enviar ao cliente.
              </p>
            </div>
          ) : (
            (data ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/aprovacoes/${c.id}`}
                className="flex items-center gap-3 rounded-lg border p-4 hover:bg-accent/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.title}</span>
                    <Badge variant={STATUS_VARIANT[c.status] ?? "secondary"}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Cliente: {c.client_name} · {c.itemCount} post(s)
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <CreateCollectionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => refetch()}
      />
    </div>
  );
}
