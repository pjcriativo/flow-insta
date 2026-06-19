"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type Settings = {
  signups_enabled?: boolean;
  ai_enabled?: boolean;
  scheduling_enabled?: boolean;
  announcement?: { text: string; enabled: boolean };
};

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async (): Promise<Settings> => {
      const res = await fetch("/api/admin/settings");
      return (await res.json()).settings ?? {};
    },
  });

  const [announcement, setAnnouncement] = useState({ text: "", enabled: false });
  useEffect(() => {
    if (data?.announcement) setAnnouncement(data.announcement);
  }, [data]);

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success("Configuração salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Controles globais da plataforma e da área do cliente.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recursos (feature flags)</CardTitle>
          <CardDescription>Ligue ou desligue recursos para todos os usuários.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            label="Permitir novos cadastros"
            description="Quando desligado, novos usuários não conseguem se cadastrar."
            checked={data?.signups_enabled !== false}
            onChange={(v) => patch.mutate({ signups_enabled: v })}
          />
          <Toggle
            label="Assistente de IA"
            description="Geração de posts e ideias com IA na plataforma."
            checked={data?.ai_enabled !== false}
            onChange={(v) => patch.mutate({ ai_enabled: v })}
          />
          <Toggle
            label="Agendamento de posts"
            description="Permite agendar publicações automáticas."
            checked={data?.scheduling_enabled !== false}
            onChange={(v) => patch.mutate({ scheduling_enabled: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aviso global (banner)</CardTitle>
          <CardDescription>
            Exibe uma mensagem no topo da área do cliente (manutenção, novidades…).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Banner ativo</Label>
            <Switch
              checked={announcement.enabled}
              onCheckedChange={(v) => setAnnouncement((a) => ({ ...a, enabled: v }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ann">Mensagem</Label>
            <Input
              id="ann"
              placeholder="Ex.: Manutenção programada para domingo às 22h."
              value={announcement.text}
              onChange={(e) => setAnnouncement((a) => ({ ...a, text: e.target.value }))}
            />
          </div>
          <Button onClick={() => patch.mutate({ announcement })} disabled={patch.isPending}>
            Salvar banner
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Toggle({
  label, description, checked, onChange,
}: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
