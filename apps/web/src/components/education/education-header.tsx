import Link from "next/link"
import { ArrowLeft, BookOpen, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"

type EducationHeaderProps = {
  section: string
  title: string
  description: string
  backHref?: string
  backLabel?: string
  actions?: React.ReactNode
}

export function EducationHeader({
  section,
  title,
  description,
  backHref = "/",
  backLabel = "New forecast",
  actions,
}: EducationHeaderProps) {
  return (
    <header className="border-b border-border/80">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={backHref} />}>
            <ArrowLeft aria-hidden="true" />
            {backLabel}
          </Button>
          <div className="flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/learn" />}>
              <BookOpen aria-hidden="true" />
              Learn
            </Button>
          </div>
        </div>

        <div className="mt-7 grid gap-5 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] lg:items-end">
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.28em] text-primary">{section}</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl lg:text-5xl">
              {title}
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
        </div>

        <div className="flex items-center gap-2 border-t border-border/65 pt-3 text-xs text-muted-foreground">
          <Settings2 aria-hidden="true" className="size-3.5 text-primary" />
          <span>
            This is forecasting education. Provider authentication and runtime checks live in{" "}
            <Link className="font-bold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary" href="/setup">
              System setup
            </Link>
            .
          </span>
        </div>
      </div>
    </header>
  )
}
