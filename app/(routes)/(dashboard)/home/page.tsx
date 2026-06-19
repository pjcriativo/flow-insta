"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuthUser } from "@/components/auth-provider";
import { useActiveOrg } from "@/components/active-org-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileEdit,
  Clock,
  Send,
  AlertTriangle,
  Flame,
  Plus,
  Lightbulb,
  Link2,
  CalendarClock,
  ArrowRight,
  CheckCircle2,
  Circle,
  Rocket,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import CreatePostDialog from "@/components/schedule/create-post-dialog";

type Dashboard = {
  counts: { draft: number; queue: number; published: number; failed: number };
  upcoming: {
    id: string;
    content: string;
    scheduled_at: string;
    user_channels?: { handle?: string; channel_types?: { name?: string; color?: string } };
  }[];
  recentPublished: {
    id: string;
    content: string;
    published_at: string;
    published_url?: string | null;
    user_channels?: { channel_types?: { name?: string; color?: string } };
  }[];
  connectedChannels: number;
  streak: number;
  series: { date: string; published: number }[];
  onboarding: { hasChannel: boolean; hasIdea: boolean; hasPost: boolean };
};

export default function HomePage() {
  const { user } = useAuthUser();
  const { activeOrgId } = useActiveOrg();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", activeOrgId],
    queryFn: async (): Promise<Dashboard> => {
      const res = await fetch("/api/dashboard");
      return await res.json();
    },
  });

  const name = user?.email?.split("@")[0] ?? "";
  const greeting = getGreeting();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold capitalize">
            {greeting}, {name} 👋
          </h1>
          <p className="text-sm text-muted-foreground">
            Aqui está o resumo da sua atividade.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/ideas">
              <Lightbulb className="size-4" /> Ideias
            </Link>
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Novo post
          </Button>
        </div>
      </div>

      {/* Onboarding — só enquanto há passos incompletos */}
      {!isLoading && data?.onboarding && !(data.onboarding.hasChannel && data.onboarding.hasIdea && data.onboarding.hasPost) && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="size-4 text-primary" /> Primeiros passos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <OnboardStep done={data.onboarding.hasChannel} label="Conecte uma rede social" href="/settings" cta="Conectar" />
            <OnboardStep done={data.onboarding.hasIdea} label="Crie sua primeira ideia de conteúdo" href="/ideas" cta="Criar ideia" />
            <OnboardStep done={data.onboarding.hasPost} label="Agende seu primeiro post" onClick={() => setCreateOpen(true)} cta="Agendar" />
          </CardContent>
        </Card>
      )}

      {/* Cards de status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FileEdit} label="Rascunhos" value={data?.counts.draft} href="/schedule?status=draft" loading={isLoading} tone="text-amber-500" />
        <StatCard icon={Clock} label="Na fila" value={data?.counts.queue} href="/schedule?status=queue" loading={isLoading} tone="text-blue-500" />
        <StatCard icon={Send} label="Publicados" value={data?.counts.published} href="/schedule?status=published" loading={isLoading} tone="text-green-500" />
        <StatCard icon={AlertTriangle} label="Falharam" value={data?.counts.failed} href="/schedule?status=failed" loading={isLoading} tone="text-red-500" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Streak + atividade */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="size-4 text-orange-500" /> Sequência
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <div className="text-4xl font-bold">
                  {data?.streak ?? 0}
                  <span className="ml-1 text-base font-normal text-muted-foreground">
                    {data?.streak === 1 ? "dia" : "dias"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(data?.streak ?? 0) > 0
                    ? "Continue postando para manter a sequência 🔥"
                    : "Publique um post hoje para começar uma sequência."}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Mini gráfico 14 dias */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Publicações (14 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[120px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data?.series ?? []}>
                  <defs>
                    <linearGradient id="gPub" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#84cc16" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#84cc16" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
                  <Tooltip />
                  <Area type="monotone" dataKey="published" name="Publicados" stroke="#84cc16" fill="url(#gPub)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Próximos posts + recém-publicados */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="size-4" /> Próximos posts
            </CardTitle>
            <Link href="/schedule" className="text-xs text-primary hover:underline">
              Ver tudo
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (data?.upcoming ?? []).length === 0 ? (
              <EmptyHint
                text="Nenhum post agendado."
                cta="Agendar um post"
                onClick={() => setCreateOpen(true)}
              />
            ) : (
              data!.upcoming.map((p) => (
                <div key={p.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{ background: p.user_channels?.channel_types?.color ?? "#999" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.user_channels?.channel_types?.name} ·{" "}
                      {new Date(p.scheduled_at).toLocaleString("pt-BR", {
                        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="size-4" /> Publicados recentemente
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (data?.recentPublished ?? []).length === 0 ? (
              <EmptyHint text="Você ainda não publicou nada." />
            ) : (
              data!.recentPublished.map((p) => (
                <div key={p.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{ background: p.user_channels?.channel_types?.color ?? "#999" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{p.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.user_channels?.channel_types?.name}
                      {p.published_at && ` · ${new Date(p.published_at).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  {p.published_url && (
                    <a href={p.published_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                      abrir
                    </a>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Atalho: conectar canal se não houver nenhum */}
      {!isLoading && data?.connectedChannels === 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <Link2 className="size-5 text-primary" />
            <div className="flex-1">
              <p className="font-medium">Conecte sua primeira rede social</p>
              <p className="text-sm text-muted-foreground">
                Conecte um canal para começar a publicar.
              </p>
            </div>
            <Button asChild>
              <Link href="/settings">
                Conectar canal <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <CreatePostDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, href, loading, tone,
}: {
  icon: React.ElementType; label: string; value?: number; href: string; loading: boolean; tone: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <Icon className={`size-4 ${tone}`} />
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-9 w-12" /> : <div className="text-3xl font-semibold">{value ?? 0}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyHint({ text, cta, onClick }: { text: string; cta?: string; onClick?: () => void }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta && (
        <Button variant="link" className="mt-1" onClick={onClick}>
          {cta}
        </Button>
      )}
    </div>
  );
}

function OnboardStep({
  done, label, href, onClick, cta,
}: {
  done: boolean; label: string; href?: string; onClick?: () => void; cta: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background p-3">
      {done ? (
        <CheckCircle2 className="size-5 text-green-500" />
      ) : (
        <Circle className="size-5 text-muted-foreground" />
      )}
      <span className={`flex-1 text-sm ${done ? "text-muted-foreground line-through" : ""}`}>
        {label}
      </span>
      {!done &&
        (href ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={href}>{cta}</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onClick}>
            {cta}
          </Button>
        ))}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
