"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, Paperclip, SendHorizonal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { postJson } from "@/lib/api-client"
import { cn } from "@/lib/utils"

const DEFAULT_PROMPT =
  "When will an open-weight LLM become comparable to Claude Mythos for professional software engineering and cybersecurity work?"

export function ForecastComposer({ className, compact = false }: { className?: string; compact?: boolean }) {
  const router = useRouter()
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const trimmed = prompt.trim()
    if (!trimmed || submitting) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = await postJson<{ taskId?: string }>("/api/runs", { prompt: trimmed })
      if (!payload.taskId) {
        throw new Error("Could not start the forecast run.")
      }
      router.push(`/runs/${payload.taskId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="fs-panel relative overflow-hidden rounded-lg p-2">
        <div className="pointer-events-none absolute left-4 right-4 top-0 h-px bg-primary/35" />
        <div className="pointer-events-none absolute bottom-0 left-8 right-8 h-px bg-primary/20" />
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault()
              void submit()
            }
          }}
          className={cn(
            "max-h-52 min-h-24 resize-none rounded-md border-0 bg-transparent text-sm leading-6 shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 md:text-base",
            compact && "min-h-16 text-sm",
          )}
          aria-label="Forecast prompt"
          placeholder="Ask a forecasting or research question"
        />
        <div className="flex items-center justify-between gap-3 border-t border-border/80 px-1 pt-2">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach context" className="text-primary/80 hover:bg-primary/10 hover:text-primary">
            <Paperclip data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !prompt.trim()}
            className="border border-primary/25 bg-primary/90 uppercase tracking-[0.14em] shadow-[0_0_24px_rgba(132,205,255,0.12)] hover:bg-primary"
          >
            {submitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <SendHorizonal data-icon="inline-start" />}
            Start forecast
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
