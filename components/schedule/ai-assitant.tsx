
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
  { icon: Repeat, label: "Rephrase" },
  { icon: Minus, label: "Shorten" },
  { icon: Plus, label: "Expand" },
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
        throw new Error("Failed to generate post")
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
      const message = error instanceof Error ? error.message : "Failed to generate post. Please try again."
      toast.error(message)
    },
  })

  const handleQuickAction = (label: string) => {
    generateMutation.mutate({
      action: label.toLowerCase()
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
            AI Assistant
          </span>
        </div>
      </div>

      <p className="mb-3 text-sm font-medium">
        How can I help with this post?
      </p>

      {/* Textarea for custom prompt */}
      <div className="flex flex-col gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Eg. Promote my photography course to get new signups. Registration closes in 3 days."
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
          Generate
        </Button>
      </div>

      {content && content.trim() && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">Quick actions:</p>
          <div className="flex flex-col gap-2">
            {QUICK_ACTIONS.map(({ icon: Icon, label }) => (
              <Button
                key={label}
                variant="outline"
                className="justify-start gap-2 text-sm font-normal h-9"
                onClick={() => handleQuickAction(label)}
                disabled={generateMutation.isPending || !canUseAI}
              >
                {generateMutation.isPending && generateMutation.variables?.action === label.toLowerCase() ? (
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
          Pro tips: Add context for better results
        </span>
      </p>
    </div>
  )
}
