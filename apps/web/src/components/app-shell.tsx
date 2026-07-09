"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { BarChart3, FlaskConical, KeyRound, MessageSquarePlus, Workflow } from "lucide-react"

import { LogoMark } from "@/components/logo-mark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { formatModeLabel, runTitle, statusTone, type JsonRecord } from "@/lib/records"

type SidebarNavItem = {
  href: string
  label: string
  icon: React.ComponentType
  path: string
  hash?: string
}

const nav: SidebarNavItem[] = [
  { href: "/", label: "New Forecast", icon: MessageSquarePlus, path: "/" },
  { href: "/lab", label: "Lab", icon: FlaskConical, path: "/lab" },
]

const labNav: SidebarNavItem[] = [
  { href: "/lab#workflows", label: "Workflows", icon: Workflow, path: "/lab", hash: "#workflows" },
  { href: "/lab#benchmarks", label: "Benchmarks", icon: BarChart3, path: "/lab", hash: "#benchmarks" },
  { href: "/lab#diagnostics", label: "Diagnostics", icon: KeyRound, path: "/lab", hash: "#diagnostics" },
]

export function AppShell({ children, runs = [] }: { children: React.ReactNode; runs?: JsonRecord[] }) {
  const pathname = usePathname()
  const currentHash = useCurrentHash(pathname)
  const recentRuns = runs.filter(hasRunId).slice(0, 12)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-sidebar-border bg-sidebar/95 shadow-[12px_0_60px_rgba(0,0,0,0.22)]">
        <SidebarHeader className="border-b border-sidebar-border p-3">
          <Link className="flex min-w-0 items-center gap-2 rounded-md px-1 py-2" href="/">
            <LogoMark className="h-8 w-14 drop-shadow-[0_0_18px_rgba(132,205,255,0.18)]" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium uppercase tracking-[0.26em] text-primary/90">Open Superforecaster</span>
              <span className="block truncate text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">local forecast lab</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => {
                  const Icon = item.icon
                  const active = isNavItemActive(pathname, currentHash, item)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={active}
                        aria-current={active ? "page" : undefined}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Lab</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {labNav.map((item) => {
                  const Icon = item.icon
                  const active = isNavItemActive(pathname, currentHash, item)
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={active}
                        aria-current={active ? "page" : undefined}
                        render={<Link href={item.href} />}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="min-h-0 flex-1">
            <SidebarGroupLabel>
              <span className="truncate">Conversations</span>
              <span className="ml-auto text-[10px] tabular-nums text-sidebar-foreground/50">{recentRuns.length}</span>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {recentRuns.length > 0 ? (
                <SidebarMenu>
                  {recentRuns.map((run) => {
                    const id = String(run.id)
                    const status = String(run.status ?? "queued")
                    return (
                      <SidebarMenuItem key={id}>
                        <SidebarMenuButton tooltip={runTitle(run)} isActive={pathname === `/runs/${id}`} render={<Link href={`/runs/${id}`} />}>
                          <span className={`size-2 shrink-0 rounded-full bg-current ${statusTone(status)}`} />
                          <span>
                            <span className="block truncate leading-tight">{runTitle(run)}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {formatModeLabel(run.operationSubmode ?? run.operationMode)} · {status}
                            </span>
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              ) : (
                <p className="px-2 py-1 text-xs leading-5 text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
                  No conversations yet
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3 text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="truncate">science. evidence. open.</span>
        </SidebarFooter>
      </Sidebar>
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur md:hidden">
        <SidebarTrigger aria-label="Open navigation" className="text-foreground" />
        <LogoMark className="h-7 w-12" />
        <span className="truncate text-xs font-medium uppercase tracking-[0.2em] text-foreground">Open Superforecaster</span>
      </div>
      <SidebarInset className="pt-12 md:pt-0">{children}</SidebarInset>
    </SidebarProvider>
  )
}

function hasRunId(run: JsonRecord): run is JsonRecord & { id: string } {
  return typeof run.id === "string" && run.id.length > 0
}

function useCurrentHash(pathname: string) {
  const [hash, setHash] = useState("")

  useEffect(() => {
    function updateHash() {
      setHash(window.location.hash)
    }

    updateHash()
    window.addEventListener("hashchange", updateHash)
    return () => window.removeEventListener("hashchange", updateHash)
  }, [pathname])

  return hash
}

function isNavItemActive(pathname: string, currentHash: string, item: SidebarNavItem) {
  if (item.path === "/") {
    return pathname === "/"
  }

  if (pathname !== item.path) {
    return false
  }

  if (item.hash) {
    return currentHash === item.hash
  }

  return currentHash === ""
}
