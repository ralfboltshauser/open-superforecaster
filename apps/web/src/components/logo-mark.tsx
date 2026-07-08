import { cn } from "@/lib/utils"

type LogoMarkProps = {
  className?: string
  title?: string
}

export function LogoMark({ className, title = "Open Superforecaster" }: LogoMarkProps) {
  return (
    <svg className={cn("shrink-0", className)} viewBox="0 0 48 48" role="img" aria-label={title}>
      <defs>
        <linearGradient id="osf-mark-stroke" x1="10" x2="38" y1="38" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.64" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
        <radialGradient id="osf-mark-glow" cx="0" cy="0" r="1" gradientTransform="matrix(0 22 -22 0 24 24)">
          <stop stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="currentColor" opacity="0.08" />
      <rect x="1" y="1" width="46" height="46" rx="11" fill="url(#osf-mark-glow)" />
      <path d="M11 32.5h26" stroke="currentColor" strokeOpacity="0.26" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 31.5 24 13l9 18.5" stroke="url(#osf-mark-stroke)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.6 24.7h8.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="13" cy="32.5" r="2.4" fill="currentColor" opacity="0.72" />
      <circle cx="35" cy="32.5" r="2.4" fill="currentColor" opacity="0.72" />
      <circle cx="24" cy="13" r="2.4" fill="currentColor" />
    </svg>
  )
}
