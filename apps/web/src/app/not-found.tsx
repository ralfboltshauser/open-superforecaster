import Link from "next/link"
import { ArrowRight, History } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground">
      <Card className="w-full max-w-xl border-primary/20 bg-card/85">
        <CardHeader>
          <p className="fs-eyebrow text-primary">404 · unresolved route</p>
          <CardTitle className="mt-2 text-xl">This page is not in the forecast ledger</CardTitle>
          <CardDescription>The link may be incomplete, or the local record may no longer be available.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button nativeButton={false} render={<Link href="/" />}>
            New forecast
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/forecasts" />}>
            <History data-icon="inline-start" />
            Forecasts
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
