"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Building2,
  User,
  UsersRound,
  FileText,
  Send,
  Clock,
  Link2,
  TrendingUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

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

type Analytics = {
  growth: { date: string; users: number; newOrgs: number; newPosts: number }[];
  distribution: { name: string; value: number }[];
  recentOrgs: { name?: string; type?: string; created_at?: string }[];
};

const CARDS: { key: keyof Metrics; label: string; icon: React.ElementType }[] = [
  { key: "totalUsers", label: "Usuários", icon: Users },
  { key: "totalOrgs", label: "Organizações", icon: Building2 },
  { key: "personalOrgs", label: "Pessoais (B2C)", icon: User },
  { key: "teamOrgs", label: "Equipes (B2B)", icon: UsersRound },
  { key: "totalPosts", label: "Posts", icon: FileText },
  { key: "publishedPosts", label: "Publicados", icon: Send },
  { key: "queuedPosts", label: "Na fila", icon: Clock },
  { key: "connectedChannels", label: "Canais", icon: Link2 },
];

const PIE_COLORS = ["#84cc16", "#3b82f6"];

type MetricsResponse = {
  metrics: Metrics;
  trends: {
    orgs: { value: number; changePct: number };
    posts: { value: number; changePct: number };
  };
  health: {
    freeOrgs: number; proOrgs: number; businessOrgs: number;
    paidOrgs: number; activationRate: number; mrrCents: number;
  };
};

export default function AdminOverviewPage() {
  const { data: full, isLoading: loadingMetrics } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async (): Promise<MetricsResponse> => {
      const res = await fetch("/api/admin/metrics");
      return await res.json();
    },
  });
  const metrics = full?.metrics;
  const trends = full?.trends;
  const health = full?.health;

  const { data: analytics, isLoading: loadingAnalytics } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: async (): Promise<Analytics> => {
      const res = await fetch("/api/admin/analytics");
      return await res.json();
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className="text-sm text-muted-foreground">
          Métricas e atividade da plataforma.
        </p>
      </div>

      {/* Saúde do negócio */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HealthCard
          label="MRR estimado"
          value={health ? `R$ ${(health.mrrCents / 100).toFixed(0)}` : "—"}
          hint="receita recorrente mensal"
          loading={loadingMetrics}
          highlight
        />
        <HealthCard
          label="Orgs pagas"
          value={health?.paidOrgs ?? "—"}
          hint={`${health?.proOrgs ?? 0} Pro · ${health?.businessOrgs ?? 0} Business`}
          loading={loadingMetrics}
        />
        <TrendCard
          label="Novas orgs (30d)"
          value={trends?.orgs.value ?? 0}
          changePct={trends?.orgs.changePct ?? 0}
          loading={loadingMetrics}
        />
        <TrendCard
          label="Novos posts (30d)"
          value={trends?.posts.value ?? 0}
          changePct={trends?.posts.changePct ?? 0}
          loading={loadingMetrics}
        />
      </div>

      {/* Cards de métricas */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => (
          <Card key={c.key}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingMetrics ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <div className="text-3xl font-semibold">
                  {metrics?.[c.key] ?? "—"}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Crescimento (30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAnalytics ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={analytics?.growth ?? []}>
                  <defs>
                    <linearGradient id="gUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#84cc16" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#84cc16" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="users"
                    name="Usuários (acum.)"
                    stroke="#84cc16"
                    fill="url(#gUsers)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição de orgs</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingAnalytics ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={analytics?.distribution ?? []}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {(analytics?.distribution ?? []).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Posts por dia */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novos posts por dia (30 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingAnalytics ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={analytics?.growth ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <Tooltip />
                <Bar dataKey="newPosts" name="Posts" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Atividade recente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Organizações recentes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingAnalytics ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : (analytics?.recentOrgs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma atividade ainda.</p>
          ) : (
            (analytics?.recentOrgs ?? []).map((o, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <Building2 className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{o.name}</span>
                <span className="text-xs text-muted-foreground">
                  {o.type === "team" ? "B2B" : "B2C"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString() : ""}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthCard({
  label, value, hint, loading, highlight,
}: {
  label: string; value: string | number; hint?: string; loading: boolean; highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary/40 bg-primary/5" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {highlight && <DollarSign className="size-4 text-primary" />}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <>
            <div className="text-3xl font-semibold">{value}</div>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TrendCard({
  label, value, changePct, loading,
}: { label: string; value: number; changePct: number; loading: boolean }) {
  const up = changePct >= 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {up ? (
          <TrendingUp className="size-4 text-green-500" />
        ) : (
          <TrendingDown className="size-4 text-red-500" />
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold">{value}</span>
            <span className={`text-sm font-medium ${up ? "text-green-500" : "text-red-500"}`}>
              {up ? "+" : ""}{changePct}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
