"use client"

import Link from "next/link"
import { RefreshCw, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-5 py-10">
      <Card className="w-full max-w-xl border-destructive/35 bg-card/85">
        <CardHeader>
          <CardTitle>The workspace hit a problem</CardTitle>
          <CardDescription>Your forecasts are durable records; retrying this screen will not create a duplicate run.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm leading-6 text-muted-foreground">{error.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link href="/setup" />}>
              <Settings2 data-icon="inline-start" />
              System setup
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
