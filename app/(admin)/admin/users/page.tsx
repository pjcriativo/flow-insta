"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AdminUser = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
};

export default function AdminUsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<AdminUser[]> => {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      return json.users ?? [];
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Usuários</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${data?.length ?? 0} usuário(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data ?? []).map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 rounded-lg border p-3 text-sm"
            >
              <span className="flex-1 truncate">{u.email}</span>
              {u.confirmed ? (
                <Badge variant="secondary">confirmado</Badge>
              ) : (
                <Badge variant="outline">pendente</Badge>
              )}
              <span className="text-muted-foreground">
                {new Date(u.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
