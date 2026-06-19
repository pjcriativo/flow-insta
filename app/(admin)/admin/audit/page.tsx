"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";

type Log = {
  id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  "user.promote": "Promoveu a admin",
  "user.demote": "Removeu admin",
  "user.delete": "Excluiu usuário",
  "org.update": "Atualizou organização",
  "org.delete": "Excluiu organização",
  "plan.update": "Atualizou plano",
  "settings.update": "Atualizou configurações",
};

export default function AdminAuditPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async (): Promise<Log[]> => {
      const res = await fetch("/api/admin/audit");
      return (await res.json()).logs ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Registro das ações administrativas (últimas 100).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4" /> Atividade
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : (data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma ação registrada ainda.
            </p>
          ) : (
            (data ?? []).map((log) => (
              <div key={log.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Badge variant="outline" className="whitespace-nowrap">
                  {ACTION_LABEL[log.action] ?? log.action}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {log.actor_email ?? "—"}
                  {log.target_type && ` · ${log.target_type}`}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("pt-BR")}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
