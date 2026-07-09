import { cn } from "@/lib/utils"

type LogoMarkProps = {
  className?: string
  title?: string
}

export function LogoMark({ className, title = "Open Superforecaster" }: LogoMarkProps) {
  return (
    <img
      src="/logo.png"
      alt={title}
      className={cn("shrink-0 object-contain", className)}
      width={512}
      height={512}
      draggable={false}
    />
  )
}
