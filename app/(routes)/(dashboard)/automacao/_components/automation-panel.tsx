"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { INTENTS, ACTION_TYPES, type Intent, type ActionType } from "@/types/dm-pilot";
import { RulesEditor } from "./rules-editor";
import { FaqEditor } from "./faq-editor";
import { FlowEditor } from "./flow-editor";
import { KeywordsEditor } from "./keywords-editor";

export type ChannelOption = { id: string; handle: string | null; typeName: string };

type Config = {
  channel_id: string;
  enabled: boolean;
  kill_switch: boolean;
  require_human_review: boolean;
  min_confidence: number;
  agent_prompt?: string;
};

async function fetchConfigs(): Promise<Config[]> {
  const res = await fetch("/api/automation/config");
  if (!res.ok) throw new Error("Falha ao carregar configurações");
  return (await res.json()).configs;
}

async function saveConfig(patch: Partial<Config> & { channel_id: string }) {
  const res = await fetch("/api/automation/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Falha ao salvar (precisa ser admin?)");
  return (await res.json()).config as Config;
}

const INTENT_LABELS: Record<Intent, string> = {
  purchase: "Compra",
  question: "Pergunta",
  praise: "Elogio",
  complaint: "Reclamação",
  troll: "Provocação",
  spam: "Spam",
  other: "Outro",
};

const ACTION_LABELS: Record<ActionType, string> = {
  public_reply: "Responder em público",
  private_reply: "Responder no privado",
  route_dm: "Puxar pro DM",
  hide: "Ocultar",
  like: "Curtir",
  ignore: "Ignorar",
  human: "Revisão humana",
};

export default function AutomationPanel({
  channels,
  canEdit,
}: {
  channels: ChannelOption[];
  canEdit: boolean;
}) {
  const [active, setActive] = useState<string | null>(channels[0]?.id ?? null);

  if (channels.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum canal do Instagram conectado. Conecte um canal para ativar o
          piloto de DM.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {channels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <Button
              key={c.id}
              variant={active === c.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActive(c.id)}
            >
              {c.handle ? `@${c.handle}` : c.typeName}
            </Button>
          ))}
        </div>
      )}
      {active && (
        <ChannelAutomation channelId={active} canEdit={canEdit} intentLabels={INTENT_LABELS} actionLabels={ACTION_LABELS} />
      )}
    </div>
  );
}

function ChannelAutomation({
  channelId,
  canEdit,
  intentLabels,
  actionLabels,
}: {
  channelId: string;
  canEdit: boolean;
  intentLabels: Record<Intent, string>;
  actionLabels: Record<ActionType, string>;
}) {
  const qc = useQueryClient();
  const { data: configs, isLoading } = useQuery({
    queryKey: ["automation-config"],
    queryFn: fetchConfigs,
  });

  const config = configs?.find((c) => c.channel_id === channelId) ?? {
    channel_id: channelId,
    enabled: false,
    kill_switch: false,
    require_human_review: true,
    min_confidence: 0.75,
    agent_prompt: "",
  };

  const mutation = useMutation({
    mutationFn: saveConfig,
    onMutate: () => qc.cancelQueries({ queryKey: ["automation-config"] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-config"] });
      toast.success("Configuração salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patch = (p: Partial<Config>) => mutation.mutate({ channel_id: channelId, ...p });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KILL-SWITCH EM DESTAQUE */}
      <Card className={config.kill_switch ? "border-destructive bg-destructive/5" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle
              className={config.kill_switch ? "size-5 text-destructive" : "size-5 text-muted-foreground"}
            />
            Kill-switch
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Interrompe imediatamente qualquer envio à Meta. As interações
            continuam sendo recebidas e classificadas, mas nenhuma resposta é
            enviada enquanto isto estiver ligado.
          </p>
          <Switch
            checked={config.kill_switch}
            disabled={!canEdit || mutation.isPending}
            onCheckedChange={(v) => patch({ kill_switch: v })}
            aria-label="Kill-switch"
          />
        </CardContent>
      </Card>

      {/* CONFIGURAÇÕES GERAIS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Row
            label="Automação ativa"
            hint="Liga o piloto de DM para este canal."
          >
            <Switch
              checked={config.enabled}
              disabled={!canEdit || mutation.isPending}
              onCheckedChange={(v) => patch({ enabled: v })}
            />
          </Row>
          <Row
            label="Revisão humana obrigatória"
            hint="Toda resposta passa pela fila de revisão antes de ser enviada."
          >
            <Switch
              checked={config.require_human_review}
              disabled={!canEdit || mutation.isPending}
              onCheckedChange={(v) => patch({ require_human_review: v })}
            />
          </Row>
          <div className="space-y-2">
            <Label htmlFor="min_conf">Confiança mínima ({config.min_confidence.toFixed(2)})</Label>
            <p className="text-xs text-muted-foreground">
              Abaixo deste valor, a interação vai para a fila de revisão em vez
              de ser respondida automaticamente.
            </p>
            <Input
              id="min_conf"
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={config.min_confidence}
              disabled={!canEdit || mutation.isPending}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v <= 1 && v !== config.min_confidence) {
                  patch({ min_confidence: v });
                }
              }}
              className="max-w-[140px]"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent_prompt">Instruções do agente</Label>
            <p className="text-xs text-muted-foreground">
              System prompt do agente: como ele deve se comportar, o que pode
              oferecer, o que evitar. Aplicado junto da voz da marca.
            </p>
            <textarea
              id="agent_prompt"
              rows={4}
              defaultValue={config.agent_prompt ?? ""}
              disabled={!canEdit || mutation.isPending}
              onBlur={(e) => {
                const v = e.target.value;
                if (v !== (config.agent_prompt ?? "")) patch({ agent_prompt: v });
              }}
              placeholder="Ex.: Você é o assistente da marca. Seja breve e cordial. Ofereça o link do catálogo quando perguntarem preço. Nunca prometa prazos de entrega."
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            />
          </div>
        </CardContent>
      </Card>

      {/* PALAVRAS-CHAVE (resposta pronta antes do LLM) */}
      <KeywordsEditor canEdit={canEdit} />

      {/* REGRAS POR INTENÇÃO */}
      <RulesEditor
        channelId={channelId}
        canEdit={canEdit}
        intents={INTENTS}
        actions={ACTION_TYPES}
        intentLabels={intentLabels}
        actionLabels={actionLabels}
      />

      {/* FUNIL DE VENDAS */}
      <FlowEditor canEdit={canEdit} />

      {/* FAQ */}
      <FaqEditor canEdit={canEdit} />
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
