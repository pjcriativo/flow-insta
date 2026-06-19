"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Metrics = {
  totalUsers: number | null;
  totalOrgs: number;
  personalOrgs: number;
  teamOrgs: number;
  totalPosts: number;
  publishedPosts: number;
  queuedPosts: number;
  connectedChannels: number;
};

const CARDS: { key: keyof Metrics; label: string }[] = [
  { key: "totalUsers", label: "Usuários" },
  { key: "totalOrgs", label: "Organizações" },
  { key: "personalOrgs", label: "Orgs pessoais (B2C)" },
  { key: "teamOrgs", label: "Orgs de equipe (B2B)" },
  { key: "totalPosts", label: "Posts (total)" },
  { key: "publishedPosts", label: "Posts publicados" },
  { key: "queuedPosts", label: "Posts na fila" },
  { key: "connectedChannels", label: "Canais conectados" },
];

export default function AdminOverviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async (): Promise<Metrics> => {
      const res = await fetch("/api/admin/metrics");
      const json = await res.json();
      return json.metrics;
    },
  });

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Visão geral</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">
                {isLoading ? "…" : (data?.[c.key] ?? "—")}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
