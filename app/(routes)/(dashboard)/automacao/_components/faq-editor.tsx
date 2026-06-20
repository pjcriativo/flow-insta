"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Faq = { id: string; question: string; answer: string };

async function fetchFaq(): Promise<Faq[]> {
  const res = await fetch("/api/automation/faq");
  if (!res.ok) throw new Error("Falha ao carregar FAQ");
  return (await res.json()).faq;
}

export function FaqEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const { data: faq, isLoading } = useQuery({ queryKey: ["automation-faq"], queryFn: fetchFaq });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/automation/faq", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer }),
      });
      if (!res.ok) throw new Error("Falha ao salvar (precisa ser admin?)");
    },
    onSuccess: () => {
      setQuestion("");
      setAnswer("");
      qc.invalidateQueries({ queryKey: ["automation-faq"] });
      toast.success("Pergunta adicionada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automation/faq?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao remover");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-faq"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">FAQ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A IA usa estas perguntas e respostas como base ao responder dúvidas.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {(faq ?? []).map((f) => (
              <div key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{f.question}</p>
                  <p className="text-sm text-muted-foreground">{f.answer}</p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove.mutate(f.id)}
                    disabled={remove.isPending}
                    aria-label="Remover"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {(faq ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma pergunta cadastrada.</p>
            )}
          </div>
        )}

        {canEdit && (
          <div className="space-y-2 border-t pt-4">
            <Input
              placeholder="Pergunta"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Textarea
              placeholder="Resposta"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={2}
            />
            <Button
              size="sm"
              disabled={!question.trim() || !answer.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
