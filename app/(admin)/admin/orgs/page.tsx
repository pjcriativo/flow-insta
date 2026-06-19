"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AdminOrg = {
  id: string;
  name: string;
  type: "personal" | "team";
  created_at: string;
  memberCount: number;
};

export default function AdminOrgsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: async (): Promise<AdminOrg[]> => {
      const res = await fetch("/api/admin/orgs");
      const json = await res.json();
      return json.organizations ?? [];
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Organizações</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${data?.length ?? 0} organização(ões)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data ?? []).map((org) => (
            <div
              key={org.id}
              className="flex items-center gap-3 rounded-lg border p-3 text-sm"
            >
              <span className="flex-1 truncate font-medium">{org.name}</span>
              <Badge variant={org.type === "team" ? "default" : "secondary"}>
                {org.type === "team" ? "B2B" : "B2C"}
              </Badge>
              <span className="text-muted-foreground">
                {org.memberCount} membro(s)
              </span>
              <span className="text-muted-foreground">
                {new Date(org.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
