"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Intent, Sentiment } from "@/types/dm-pilot";

type Action = {
  action_type: string;
  status: string;
  provider_message_id: string | null;
  error: string | null;
};

type Event = {
  id: string;
  type: "comment" | "mention" | "message";
  external_username: string | null;
  text: string | null;
  intent: Intent | null;
  intent_confidence: number | null;
  sentiment: Sentiment | null;
  status: string;
  received_at: string;
  interaction_actions: Action[];
};

const STATUS_LABELS: Record<string, string> = {
  received: "Recebido",
  classified: "Classificado",
  actioned: "Respondido",
  held: "Em revisão",
  ignored: "Ignorado",
  failed: "Falhou",
};

const TYPE_LABELS: Record<string, string> = {
  comment: "Comentário",
  mention: "Menção",
  message: "DM",
};

async function fetchInbox(): Promise<Event[]> {
  const res = await fetch("/api/inbox");
  if (!res.ok) throw new Error("Falha ao carregar caixa de entrada");
  return (await res.json()).events;
}

export default function InboxList() {
  const { data, isLoading, error } = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma interação ainda.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((ev) => (
        <Card key={ev.id}>
          <CardContent className="space-y-2 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary">{TYPE_LABELS[ev.type] ?? ev.type}</Badge>
              {ev.intent && (
                <Badge variant="outline">
                  {ev.intent}
                  {ev.intent_confidence != null && ` ${(ev.intent_confidence * 100).toFixed(0)}%`}
                </Badge>
              )}
              <Badge variant={ev.status === "failed" ? "destructive" : "secondary"}>
                {STATUS_LABELS[ev.status] ?? ev.status}
              </Badge>
              <span className="ml-auto text-muted-foreground">
                {new Date(ev.received_at).toLocaleString("pt-BR")}
              </span>
            </div>
            <p className="text-sm">
              {ev.external_username && <span className="font-medium">@{ev.external_username} </span>}
              {ev.text ?? <span className="text-muted-foreground">(sem texto)</span>}
            </p>
            {ev.interaction_actions?.length > 0 && (
              <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
                {ev.interaction_actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-medium">{a.action_type}</span>
                    <span>·</span>
                    <span>{a.status}</span>
                    {a.error && <span className="text-destructive">— {a.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
