
"use client"
import * as React from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Repeat, Minus, Plus, Wand2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "../ui/spinner"

const QUICK_ACTIONS = [
  { icon: Repeat, action: "rephrase", label: "Reformular" },
  { icon: Minus, action: "shorten", label: "Encurtar" },
  { icon: Plus, action: "expand", label: "Expandir" },
]

interface AIAssistantProps {
  onGenerate?: (content:string) => void
  className?: string
  content?: string 
  channelId?: string
}

export function AIAssistant({ className, content, channelId, onGenerate }: AIAssistantProps) {
  const [prompt, setPrompt] = React.useState("")
  // Billing desativado (sem Clerk): IA liberada para todos os usuários logados.
  const canUseAI = true

  const generateMutation = useMutation({
    mutationFn: async ({ action, promptText }: { action: string; promptText?: string }) => {
      const res = await fetch("/api/post/generate-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          prompt: promptText,
          content,
          channelId,
        }),
      })
      if (!res.ok) {
        throw new Error("Falha ao gerar o post")
      }
      return res.json()
    },
    onSuccess: (data) => {
      // setGeneratedContent(data.content)
      onGenerate?.(data.content)
      setPrompt("")
    },
    onError: (error: unknown) => {
      console.error("Generation error:", error)
      const message = error instanceof Error ? error.message : "Falha ao gerar o post. Tente novamente."
      toast.error(message)
    },
  })

  const handleQuickAction = (action: string) => {
    generateMutation.mutate({
      action
    })
  }

  const handleGenerate = () => {
    if (prompt.trim()) {
      generateMutation.mutate({
        action: "generate",
        promptText: prompt.trim()
      })
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full rounded-lg border border-border bg-background p-4",
        className
      )}
    >

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 ">
          <Wand2Icon className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold bg-linear-to-r from-purple-500
           to-blue-500 bg-clip-text text-transparent">
            Assistente de IA
          </span>
        </div>
      </div>

      <p className="mb-3 text-sm font-medium">
        Como posso ajudar com este post?
      </p>

      {/* Textarea for custom prompt */}
      <div className="flex flex-col gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ex.: Divulgue meu curso de fotografia para conseguir novas inscrições. As inscrições encerram em 3 dias."
          className="w-full min-h-[130px] resize-none"
          disabled={!canUseAI}
        />

        <Button
          size="lg"
          onClick={handleGenerate}
          disabled={!prompt.trim() || generateMutation.isPending || !canUseAI}
          className="w-full gap-2 bg-linear-to-r
           from-purple-500 from-50%  to-blue-500 text-white"
        >
          {generateMutation.isPending && generateMutation.variables?.action === "generate" ? (
            <Spinner />
          ) : (
            <Wand2Icon className="h-4 w-4" />
          )}
          Gerar
        </Button>
      </div>

      {content && content.trim() && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">Ações rápidas:</p>
          <div className="flex flex-col gap-2">
            {QUICK_ACTIONS.map(({ icon: Icon, action, label }) => (
              <Button
                key={label}
                variant="outline"
                className="justify-start gap-2 text-sm font-normal h-9"
                onClick={() => handleQuickAction(action)}
                disabled={generateMutation.isPending || !canUseAI}
              >
                {generateMutation.isPending && generateMutation.variables?.action === action ? (
                  <Spinner className="h-4 w-4 text-purple-500" />
                ) : (
                  <Icon className="h-4 w-4 text-purple-500" />
                )}
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="mt-auto pt-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          Dica: adicione contexto para obter melhores resultados
        </span>
      </p>
    </div>
  )
}
