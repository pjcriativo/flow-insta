"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveOrg } from "@/components/active-org-provider";
import { toast } from "sonner";

// Gera um plano de conteúdo (várias ideias de uma vez) com IA e joga no Kanban.
export function ContentPlanDialog() {
  const queryClient = useQueryClient();
  const { activeOrgId } = useActiveOrg();
  const [open, setOpen] = useState(false);
  const [businessType, setBusinessType] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [count, setCount] = useState(7);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/idea/content-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessType, targetAudience, count }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha ao gerar plano");
      return json as { created: number };
    },
    onSuccess: ({ created }) => {
      queryClient.invalidateQueries({ queryKey: ["ideas", activeOrgId] });
      setOpen(false);
      setBusinessType("");
      setTargetAudience("");
      toast.success(`${created} ideias adicionadas ao seu quadro 🎉`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white hover:opacity-90">
          <Sparkles className="h-4 w-4" />
          Plano de conteúdo IA
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-purple-500" /> Gerar plano de conteúdo
          </DialogTitle>
          <DialogDescription>
            A IA cria várias ideias de posts de uma vez e adiciona ao seu quadro de ideias.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-business">Tipo de negócio / nicho</Label>
            <Input
              id="cp-business"
              placeholder="ex.: loja de roupas fitness"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-audience">Público-alvo</Label>
            <Input
              id="cp-audience"
              placeholder="ex.: mulheres 25-40 que treinam"
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cp-count">Quantidade de ideias</Label>
            <Input
              id="cp-count"
              type="number"
              min={1}
              max={14}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !businessType.trim() || !targetAudience.trim()}
          >
            {mutation.isPending ? "Gerando…" : "Gerar ideias"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
