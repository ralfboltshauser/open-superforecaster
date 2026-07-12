import { RunWorkspace } from "@/components/run-workspace"

export default async function RunPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  return <RunWorkspace key={taskId} taskId={taskId} />
}
