"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2, Plus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type Keyword = {
  id: string;
  keyword: string;
  response_message: string;
  active: boolean;
};

async function fetchKeywords(): Promise<Keyword[]> {
  const res = await fetch("/api/automation/keywords");
  if (!res.ok) throw new Error("Falha ao carregar palavras-chave");
  return (await res.json()).keywords;
}

// Camada determinística: se o texto recebido casa uma palavra-chave, o agente
// responde a resposta pronta na hora, SEM chamar o LLM (instantâneo e sem custo).
export function KeywordsEditor({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [responseMessage, setResponseMessage] = useState("");

  const { data: keywords, isLoading } = useQuery({
    queryKey: ["automation-keywords"],
    queryFn: fetchKeywords,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/automation/keywords", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, response_message: responseMessage }),
      });
      if (!res.ok) throw new Error("Falha ao salvar (precisa ser admin?)");
    },
    onSuccess: () => {
      setKeyword("");
      setResponseMessage("");
      qc.invalidateQueries({ queryKey: ["automation-keywords"] });
      toast.success("Palavra-chave adicionada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/automation/keywords?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Falha ao remover");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation-keywords"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Palavras-chave</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Resposta pronta e instantânea quando a mensagem contém a palavra-chave
          (sem custo de IA). Variações de acento/caixa/espaço são tratadas
          automaticamente.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {(keywords ?? []).map((k) => (
              <div key={k.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {k.keyword}
                    {!k.active && (
                      <span className="ml-2 text-xs text-muted-foreground">(inativa)</span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">{k.response_message}</p>
                </div>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove.mutate(k.id)}
                    disabled={remove.isPending}
                    aria-label="Remover"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {(keywords ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma palavra-chave cadastrada.</p>
            )}
          </div>
        )}

        {canEdit && (
          <div className="space-y-2 border-t pt-4">
            <Input
              placeholder="Palavra-chave (ex.: preço, comprar, link)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Textarea
              placeholder="Resposta pronta"
              value={responseMessage}
              onChange={(e) => setResponseMessage(e.target.value)}
              rows={2}
            />
            <Button
              size="sm"
              disabled={!keyword.trim() || !responseMessage.trim() || create.isPending}
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
