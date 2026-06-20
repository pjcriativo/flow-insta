"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Intent, ActionType } from "@/types/dm-pilot";

type Rule = {
  channel_id: string;
  intent: Intent;
  action_type: ActionType;
  enabled: boolean;
};

async function fetchRules(channelId: string): Promise<Rule[]> {
  const res = await fetch(`/api/automation/rules?channel_id=${channelId}`);
  if (!res.ok) throw new Error("Falha ao carregar regras");
  return (await res.json()).rules;
}

async function saveRule(rule: { channel_id: string; intent: Intent; action_type: ActionType; enabled: boolean }) {
  const res = await fetch("/api/automation/rules", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rule),
  });
  if (!res.ok) throw new Error("Falha ao salvar regra (precisa ser admin?)");
  return (await res.json()).rule as Rule;
}

export function RulesEditor({
  channelId,
  canEdit,
  intents,
  actions,
  intentLabels,
  actionLabels,
}: {
  channelId: string;
  canEdit: boolean;
  intents: readonly Intent[];
  actions: readonly ActionType[];
  intentLabels: Record<Intent, string>;
  actionLabels: Record<ActionType, string>;
}) {
  const qc = useQueryClient();
  const { data: rules, isLoading } = useQuery({
    queryKey: ["automation-rules", channelId],
    queryFn: () => fetchRules(channelId),
  });

  const mutation = useMutation({
    mutationFn: saveRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation-rules", channelId] });
      toast.success("Regra salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ruleFor = (intent: Intent): Rule =>
    rules?.find((r) => r.intent === intent) ?? {
      channel_id: channelId,
      intent,
      action_type: defaultAction(intent),
      enabled: true,
    };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Regras por intenção</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="divide-y">
            {intents.map((intent) => {
              const rule = ruleFor(intent);
              return (
                <div key={intent} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm font-medium">{intentLabels[intent]}</span>
                  <div className="flex items-center gap-3">
                    <Select
                      value={rule.action_type}
                      disabled={!canEdit || mutation.isPending}
                      onValueChange={(v) =>
                        mutation.mutate({
                          channel_id: channelId,
                          intent,
                          action_type: v as ActionType,
                          enabled: rule.enabled,
                        })
                      }
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {actions.map((a) => (
                          <SelectItem key={a} value={a}>
                            {actionLabels[a]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Switch
                      checked={rule.enabled}
                      disabled={!canEdit || mutation.isPending}
                      onCheckedChange={(v) =>
                        mutation.mutate({
                          channel_id: channelId,
                          intent,
                          action_type: rule.action_type,
                          enabled: v,
                        })
                      }
                      aria-label={`Ativar regra ${intentLabels[intent]}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Sugestão de ação padrão por intenção (usada quando não há regra salva).
function defaultAction(intent: Intent): ActionType {
  switch (intent) {
    case "purchase":
      return "public_reply";
    case "question":
      return "public_reply";
    case "praise":
      return "like";
    case "complaint":
      return "human";
    case "troll":
      return "ignore";
    case "spam":
      return "hide";
    default:
      return "ignore";
  }
}
