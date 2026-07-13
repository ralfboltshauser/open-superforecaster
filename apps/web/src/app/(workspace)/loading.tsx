import { Skeleton } from "@/components/ui/skeleton"

export default function WorkspaceLoading() {
  return (
    <main className="min-h-svh px-5 py-10 md:px-8" aria-label="Loading workspace">
      <div className="mx-auto grid w-full max-w-6xl gap-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-9 w-full max-w-xl" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </main>
  )
}
