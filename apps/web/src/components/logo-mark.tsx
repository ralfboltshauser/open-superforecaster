import { cn } from "@/lib/utils"

type LogoMarkProps = {
  className?: string
  title?: string
}

export function LogoMark({ className, title = "Open Superforecaster" }: LogoMarkProps) {
  return (
    <svg className={cn("shrink-0", className)} viewBox="0 0 48 48" role="img" aria-label={title}>
      <rect width="48" height="48" rx="12" fill="currentColor" opacity="0.08" />
      <rect x="1" y="1" width="46" height="46" rx="11" fill="none" stroke="currentColor" strokeOpacity="0.24" />
      <path d="M12.5 24h23" stroke="currentColor" strokeOpacity="0.42" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 17.5v13M31 17.5v13" stroke="currentColor" strokeOpacity="0.72" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="24" cy="24" r="7.2" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="24" cy="24" r="2.2" fill="currentColor" />
      <circle cx="24" cy="24" r="14.4" fill="none" stroke="currentColor" strokeOpacity="0.1" />
    </svg>
  )
}
