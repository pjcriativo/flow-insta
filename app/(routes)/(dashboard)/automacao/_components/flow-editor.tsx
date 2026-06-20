"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type FlowStep = { prompt: string; goal?: string };
type Flow = { id: string; name: string; steps: FlowStep[]; active: boolean };

async function fetchFlows(): Promise<Flow[]> {
  const res = await fetch("/api/automation/sales-flows");
  if (!res.ok) throw new Error("Falha ao carregar funis");
  return (await res.json()).flows;
}

export function FlowEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [stepsText, setStepsText] = useState("");

  const { data: flows, isLoading } = useQuery({ queryKey: ["sales-flows"], queryFn: fetchFlows });

  const save = useMutation({
    mutationFn: async (flow: { id?: string; name: string; steps: FlowStep[]; active?: boolean }) => {
      const res = await fetch("/api/automation/sales-flows", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flow),
      });
      if (!res.ok) throw new Error("Falha ao salvar funil (precisa ser admin?)");
    },
    onSuccess: () => {
      setName("");
      setStepsText("");
      qc.invalidateQueries({ queryKey: ["sales-flows"] });
      toast.success("Funil salvo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createFlow = () => {
    // Cada linha do textarea vira um passo do funil.
    const steps: FlowStep[] = stepsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((prompt) => ({ prompt }));
    save.mutate({ name, steps });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Funil de vendas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Sequência de passos que a IA conduz no DM para qualificar e converter
          uma intenção de compra. Um passo por linha.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {(flows ?? []).map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{f.name}</p>
                  <ol className="ml-4 list-decimal text-sm text-muted-foreground">
                    {f.steps.map((s, i) => (
                      <li key={i}>{s.prompt}</li>
                    ))}
                  </ol>
                </div>
                <Switch
                  checked={f.active}
                  disabled={!canEdit || save.isPending}
                  onCheckedChange={(v) => save.mutate({ id: f.id, name: f.name, steps: f.steps, active: v })}
                  aria-label={`Ativar funil ${f.name}`}
                />
              </div>
            ))}
            {(flows ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum funil cadastrado.</p>
            )}
          </div>
        )}

        {canEdit && (
          <div className="space-y-2 border-t pt-4">
            <Input placeholder="Nome do funil" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              placeholder={"Passo 1: pergunte o que a pessoa procura\nPasso 2: apresente a oferta\nPasso 3: envie o link"}
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
              rows={3}
            />
            <Button
              size="sm"
              disabled={!name.trim() || !stepsText.trim() || save.isPending}
              onClick={createFlow}
            >
              <Plus className="size-4" />
              Criar funil
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
