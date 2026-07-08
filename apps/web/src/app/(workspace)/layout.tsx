import { AppShell } from "@/components/app-shell"
import { listRecentRunsForServer } from "@/lib/server-runs"

export const dynamic = "force-dynamic"

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const runs = await listRecentRunsForServer()

  return <AppShell runs={runs}>{children}</AppShell>
}
