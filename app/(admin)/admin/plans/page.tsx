"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Infinity as InfinityIcon, Save } from "lucide-react";
import { toast } from "sonner";

type Plan = {
  id: string;
  name: string;
  price_cents: number;
  max_channels: number;
  max_posts: number;
  max_members: number;
  ai_enabled: boolean;
  orgCount: number;
};

export default function AdminPlansPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async (): Promise<Plan[]> => {
      const res = await fetch("/api/admin/plans");
      return (await res.json()).plans ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Planos</h1>
        <p className="text-sm text-muted-foreground">
          Defina os limites de cada plano. Use -1 para ilimitado. A cobrança
          (Stripe) será conectada depois.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {(data ?? []).map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-plans"] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [form, setForm] = useState(plan);
  useEffect(() => setForm(plan), [plan]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          price_cents: Number(form.price_cents),
          max_channels: Number(form.max_channels),
          max_posts: Number(form.max_posts),
          max_members: Number(form.max_members),
          ai_enabled: form.ai_enabled,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
    },
    onSuccess: () => {
      toast.success(`Plano ${form.name} salvo`);
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const limitField = (
    key: "max_channels" | "max_posts" | "max_members",
    label: string
  ) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
          className="h-8"
        />
        {form[key] === -1 && (
          <Badge variant="secondary" className="gap-1 whitespace-nowrap">
            <InfinityIcon className="size-3" /> ilimitado
          </Badge>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{form.name}</CardTitle>
          <Badge variant="outline">{plan.orgCount} org(s)</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold">
            R$ {(form.price_cents / 100).toFixed(0)}
          </span>
          <span className="text-xs text-muted-foreground">/mês</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Nome</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Preço (centavos)</Label>
          <Input
            type="number"
            value={form.price_cents}
            onChange={(e) => setForm({ ...form, price_cents: Number(e.target.value) })}
            className="h-8"
          />
        </div>
        {limitField("max_channels", "Canais")}
        {limitField("max_posts", "Posts / mês")}
        {limitField("max_members", "Membros")}
        <div className="flex items-center justify-between pt-1">
          <Label className="text-sm">IA habilitada</Label>
          <Switch
            checked={form.ai_enabled}
            onCheckedChange={(v) => setForm({ ...form, ai_enabled: v })}
          />
        </div>
        <Button
          className="w-full"
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          <Save className="size-4" /> {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
