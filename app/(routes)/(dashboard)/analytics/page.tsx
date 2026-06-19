"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveOrg } from "@/components/active-org-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { FileText, Send, TrendingUp } from "lucide-react";
import { BestTimesCard } from "@/components/best-times-card";

type Analytics = {
  timeline: { date: string; created: number; published: number }[];
  byStatus: { status: string; count: number }[];
  byChannel: { name: string; color: string; count: number }[];
  totals: { total: number; published: number; last30: number };
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  queue: "Na fila",
  published: "Publicado",
  failed: "Falhou",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "#f59e0b",
  queue: "#3b82f6",
  published: "#84cc16",
  failed: "#ef4444",
};

export default function AnalyticsPage() {
  const { activeOrgId } = useActiveOrg();
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", activeOrgId],
    queryFn: async (): Promise<Analytics> => {
      const res = await fetch("/api/analytics");
      return await res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Desempenho do seu conteúdo nos últimos 30 dias.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Mini icon={FileText} label="Total de posts" value={data?.totals.total} loading={isLoading} />
        <Mini icon={Send} label="Publicados" value={data?.totals.published} loading={isLoading} />
        <Mini icon={TrendingUp} label="Publicados (30d)" value={data?.totals.last30} loading={isLoading} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Atividade (30 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data?.timeline ?? []}>
                <defs>
                  <linearGradient id="aCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="aPublished" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#84cc16" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#84cc16" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="created" name="Criados" stroke="#3b82f6" fill="url(#aCreated)" strokeWidth={2} />
                <Area type="monotone" dataKey="published" name="Publicados" stroke="#84cc16" fill="url(#aPublished)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={(data?.byStatus ?? []).map((s) => ({ ...s, label: STATUS_LABEL[s.status] ?? s.status }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip />
                  <Bar dataKey="count" name="Posts" radius={[4, 4, 0, 0]}>
                    {(data?.byStatus ?? []).map((s) => (
                      <Cell key={s.status} fill={STATUS_COLOR[s.status] ?? "#999"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por canal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : (data?.byChannel ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum post ainda.
              </p>
            ) : (
              (() => {
                const max = Math.max(...(data?.byChannel ?? []).map((c) => c.count), 1);
                return (data?.byChannel ?? []).map((c) => (
                  <div key={c.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">{c.count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(c.count / max) * 100}%`, background: c.color }}
                      />
                    </div>
                  </div>
                ));
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <BestTimesCard />

      <p className="text-xs text-muted-foreground">
        * Métricas de engajamento real (curtidas, alcance) serão adicionadas quando
        as integrações com as APIs das redes estiverem ativas.
      </p>
    </div>
  );
}

function Mini({
  icon: Icon, label, value, loading,
}: { icon: React.ElementType; label: string; value?: number; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-9 w-12" /> : <div className="text-3xl font-semibold">{value ?? 0}</div>}
      </CardContent>
    </Card>
  );
}
