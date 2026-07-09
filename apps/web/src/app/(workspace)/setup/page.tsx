import { CheckCircle2, CircleAlert, Copy, KeyRound, Terminal } from "lucide-react"
import { buildHealthSnapshot } from "@open-superforecaster/backend"
import { formatAgentRef, loadAgentPolicy } from "@open-superforecaster/config"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { loadAppConfig } from "@open-superforecaster/config"

export const dynamic = "force-dynamic"

export default async function SetupPage() {
  const config = loadAppConfig()
  const policy = loadAgentPolicy(process.env, process.cwd())
  const health = await buildHealthSnapshot(config)
  const checks = Object.entries(health.checks)
    .filter(([key]) => key.startsWith("agent_"))
    .map(([key, check]) => ({ key, ...check }))

  return (
    <main className="min-h-svh px-4 py-4 md:px-8">
      <header className="border-b pb-6">
        <p className="text-xs uppercase tracking-[0.24em] text-primary/80">Setup</p>
        <h1 className="mt-3 text-3xl font-medium md:text-5xl">Agent providers and auth</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Configure which Smithers CLI agents run each workflow role, then mount one provider-auth root into Docker.
        </p>
      </header>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Provider Policy</CardTitle>
              <CardDescription>These values are read from the active environment.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <PolicyRow label="Default" value={formatAgentRef(policy.defaultRef)} />
                <PolicyRow label="Structured" value={policy.purposes.structured.map(formatAgentRef).join(", ")} />
                <PolicyRow label="Research" value={policy.purposes.research.map(formatAgentRef).join(", ")} />
                <PolicyRow label="Forecast" value={policy.purposes.forecast.map(formatAgentRef).join(", ")} />
                <PolicyRow label="Critic" value={policy.purposes.critic.map(formatAgentRef).join(", ")} />
                <PolicyRow label="Native web" value={policy.allowNativeWeb ? "allowed" : "disabled"} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auth Root Layout</CardTitle>
              <CardDescription>Use provider-specific subdirectories under one mounted root.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <pre className="overflow-x-auto rounded-md border bg-muted p-4 text-xs leading-6 text-muted-foreground">
{`${config.AGENT_AUTH_ROOT}/
  codex/default/      # CODEX_HOME
  claude/default/     # CLAUDE_CONFIG_DIR
  kimi/default/       # KIMI_SHARE_DIR
  pi/default/         # PI sessions/config`}
              </pre>
              <div className="grid gap-3 md:grid-cols-2">
                <CommandBlock command={`mkdir -p ${config.AGENT_AUTH_ROOT}/codex/default`} />
                <CommandBlock command={`CODEX_HOME=${config.AGENT_AUTH_ROOT}/codex/default codex login`} />
                <CommandBlock command={`mkdir -p ${config.AGENT_AUTH_ROOT}/claude/default`} />
                <CommandBlock command={`CLAUDE_CONFIG_DIR=${config.AGENT_AUTH_ROOT}/claude/default claude`} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 content-start">
          <Card>
            <CardHeader>
              <CardTitle>Provider Health</CardTitle>
              <CardDescription>Selected profiles need a CLI binary and auth directory.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {checks.length > 0 ? checks.map((check) => (
                <div key={check.key} className="flex items-start gap-3 rounded-md border p-3">
                  {check.ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-500" /> : <CircleAlert className="mt-0.5 size-4 text-amber-500" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{check.label}</p>
                    {check.detail ? <p className="mt-1 truncate text-xs text-muted-foreground">{check.detail}</p> : null}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No agent provider checks were reported.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Docker Mount</CardTitle>
              <CardDescription>Compose maps the host auth root into the container auth root.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <Badge variant="outline" className="w-fit"><KeyRound className="size-3" /> Credentials stay local</Badge>
              <CommandBlock command="AGENT_AUTH_HOST_ROOT=./data/agent-auth docker compose up --build" />
              <p className="text-muted-foreground">
                Keep Codex as the default until another provider profile is logged in and added to the `AGENT_*` policy.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-sm">{value}</dd>
    </div>
  )
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-background p-3">
      <Terminal className="mt-0.5 size-4 shrink-0 text-primary" />
      <code className="min-w-0 flex-1 break-words text-xs leading-5 text-muted-foreground">{command}</code>
      <Copy className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
    </div>
  )
}
