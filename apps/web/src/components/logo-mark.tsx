import Image from "next/image"

import { cn } from "@/lib/utils"

type LogoMarkProps = {
  className?: string
  title?: string
}

export function LogoMark({ className, title = "Open Superforecaster" }: LogoMarkProps) {
  return (
    <Image
      src="/logo.png"
      alt={title}
      className={cn("shrink-0 object-contain", className)}
      width={1536}
      height={1024}
      draggable={false}
    />
  )
}
