"use client"

import { Check, Copy, Printer } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"

export function ReportActions() {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={copyLink}>
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        {copied ? "Copied" : "Copy link"}
      </Button>
      <Button type="button" size="sm" onClick={() => window.print()}>
        <Printer data-icon="inline-start" />
        Print / PDF
      </Button>
    </div>
  )
}
