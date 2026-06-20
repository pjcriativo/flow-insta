"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, X, Pencil } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SuggestedAction = { action_type?: string; reason?: string; text?: string | null; intent?: string | null };

type Item = {
  id: string;
  suggested_action: SuggestedAction;
  created_at: string;
  interaction_events: {
    id: string;
    type: string;
    external_username: string | null;
    text: string | null;
    intent: string | null;
    intent_confidence: number | null;
  } | null;
};

async function fetchQueue(): Promise<Item[]> {
  const res = await fetch("/api/inbox/review");
  if (!res.ok) throw new Error("Falha ao carregar fila");
  return (await res.json()).items;
}

const REASON_LABELS: Record<string, string> = {
  require_human_review: "Revisão obrigatória",
  low_confidence: "Confiança baixa",
  guardrail: "Guardrail de compliance",
  rule_human: "Regra: revisão humana",
};

export default function ReviewQueue() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["review-queue"], queryFn: fetchQueue });

  const decide = useMutation({
    mutationFn: async (args: { id: string; decision: "approve" | "edit" | "reject"; text?: string }) => {
      const res = await fetch(`/api/inbox/review/${args.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: args.decision, text: args.text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao decidir");
      return json as { ok: boolean; sent: boolean; reason?: string };
    },
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      if (vars.decision === "reject") toast.success("Descartado");
      else if (r.sent) toast.success("Enviado");
      else toast.warning(`Não enviado${r.reason ? `: ${r.reason}` : ""}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nada para revisar. 🎉
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <ReviewCard key={item.id} item={item} onDecide={(decision, text) => decide.mutate({ id: item.id, decision, text })} pending={decide.isPending} />
      ))}
    </div>
  );
}

function ReviewCard({
  item,
  onDecide,
  pending,
}: {
  item: Item;
  onDecide: (decision: "approve" | "edit" | "reject", text?: string) => void;
  pending: boolean;
}) {
  const suggestedText = item.suggested_action.text ?? "";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestedText);

  const ev = item.interaction_events;
  const reason = item.suggested_action.reason;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {ev?.intent && <Badge variant="outline">{ev.intent}</Badge>}
          {item.suggested_action.action_type && (
            <Badge variant="secondary">{item.suggested_action.action_type}</Badge>
          )}
          {reason && <Badge variant="outline">{REASON_LABELS[reason] ?? reason}</Badge>}
          <span className="ml-auto text-muted-foreground">
            {new Date(item.created_at).toLocaleString("pt-BR")}
          </span>
        </div>

        {/* Interação original */}
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          {ev?.external_username && <span className="font-medium">@{ev.external_username} </span>}
          {ev?.text ?? <span className="text-muted-foreground">(sem texto)</span>}
        </div>

        {/* Sugestão / edição */}
        {editing ? (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
        ) : (
          <p className="text-sm">
            {suggestedText || <span className="text-muted-foreground">(sem sugestão — edite antes de aprovar)</span>}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {editing ? (
            <Button size="sm" disabled={pending || !text.trim()} onClick={() => onDecide("edit", text)}>
              <Check className="size-4" />
              Salvar e enviar
            </Button>
          ) : (
            <Button size="sm" disabled={pending || !suggestedText.trim()} onClick={() => onDecide("approve")}>
              <Check className="size-4" />
              Aprovar e enviar
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing((v) => !v)}>
            <Pencil className="size-4" />
            {editing ? "Cancelar edição" : "Editar"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => onDecide("reject")}>
            <X className="size-4" />
            Rejeitar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
