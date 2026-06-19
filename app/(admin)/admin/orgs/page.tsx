"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Building2, Search, Users, FileText, Link2, Lightbulb } from "lucide-react";

type AdminOrg = {
  id: string;
  name: string;
  type: "personal" | "team";
  created_at: string;
  memberCount: number;
};

type OrgDetail = {
  org: { id: string; name: string; type: string; created_at: string };
  members: { userId: string; email: string | null; role: string }[];
  stats: { posts: number; connectedChannels: number; ideas: number };
};

export default function AdminOrgsPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: async (): Promise<AdminOrg[]> => {
      const res = await fetch("/api/admin/orgs");
      return (await res.json()).organizations ?? [];
    },
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ["admin-org", selected],
    enabled: !!selected,
    queryFn: async (): Promise<OrgDetail> => {
      const res = await fetch(`/api/admin/orgs/${selected}`);
      return await res.json();
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return data ?? [];
    return (data ?? []).filter((o) => o.name.toLowerCase().includes(q));
  }, [data, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organizações</h1>
        <p className="text-sm text-muted-foreground">
          Todas as organizações da plataforma.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${filtered.length} organização(ões)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma organização encontrada.
            </p>
          ) : (
            filtered.map((org) => (
              <button
                key={org.id}
                onClick={() => setSelected(org.id)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left text-sm hover:bg-accent transition-colors"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Building2 className="size-4 text-muted-foreground" />
                </div>
                <span className="flex-1 truncate font-medium">{org.name}</span>
                <Badge variant={org.type === "team" ? "default" : "secondary"}>
                  {org.type === "team" ? "B2B" : "B2C"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {org.memberCount} membro(s)
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(org.created_at).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{detail?.org?.name ?? "Organização"}</SheetTitle>
            <SheetDescription>
              {detail?.org?.type === "team" ? "Organização de equipe (B2B)" : "Conta pessoal (B2C)"}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 px-4 pb-6">
            {loadingDetail ? (
              <Skeleton className="h-40 w-full" />
            ) : detail ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Stat icon={FileText} label="Posts" value={detail.stats.posts} />
                  <Stat icon={Link2} label="Canais" value={detail.stats.connectedChannels} />
                  <Stat icon={Lightbulb} label="Ideias" value={detail.stats.ideas} />
                </div>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Users className="size-4" /> Membros ({detail.members.length})
                  </div>
                  <div className="space-y-2">
                    {detail.members.map((m) => (
                      <div
                        key={m.userId}
                        className="flex items-center gap-2 rounded-md border p-2 text-sm"
                      >
                        <Avatar className="size-7">
                          <AvatarFallback className="text-[10px] uppercase">
                            {m.email?.[0] ?? "?"}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate">{m.email}</span>
                        <Badge variant="secondary">{m.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
