"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { BarChart3, BookOpen, FlaskConical, KeyRound, MessageSquarePlus, Workflow } from "lucide-react"

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
} from "@/components/ui/sidebar"
import { formatModeLabel, runTitle, statusTone, type JsonRecord } from "@/lib/records"

const nav = [
  { href: "/", label: "New Forecast", icon: MessageSquarePlus, path: "/" },
  { href: "/lab", label: "Lab", icon: FlaskConical, path: "/lab" },
  { href: "/lab#workflows", label: "Workflows", icon: Workflow, path: "/lab", hash: "#workflows" },
  { href: "/lab#benchmarks", label: "Benchmarks", icon: BarChart3, path: "/lab", hash: "#benchmarks" },
  { href: "/lab#diagnostics", label: "Diagnostics", icon: KeyRound, path: "/lab", hash: "#diagnostics" },
]

export function AppShell({ children, runs = [] }: { children: React.ReactNode; runs?: JsonRecord[] }) {
  const pathname = usePathname()
  const currentHash = useCurrentHash(pathname)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-sidebar-border bg-sidebar/95">
        <SidebarHeader className="border-b border-sidebar-border p-3">
          <Link className="flex min-w-0 items-center gap-2 rounded-md px-1 py-2" href="/">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-xs font-semibold text-primary">
              △
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium tracking-[0.14em] text-primary/90">forecast</span>
              <span className="block truncate text-xs text-muted-foreground">local research lab</span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
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
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Guide" render={<Link href="/lab" />}>
                    <BookOpen />
                    <span>Guide</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="min-h-0 flex-1">
            <SidebarGroupLabel>Conversations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {runs.slice(0, 10).map((run) => {
                  const id = String(run.id ?? "")
                  const status = String(run.status ?? "queued")
                  return (
                    <SidebarMenuItem key={id || runTitle(run)}>
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
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="p-3 text-xs text-muted-foreground">
          <span className="truncate">Personal workspace</span>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
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

function isNavItemActive(pathname: string, currentHash: string, item: (typeof nav)[number]) {
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
