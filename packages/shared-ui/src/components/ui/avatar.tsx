import { useEffect, useState } from "react"
import { cn } from "../../lib/utils"

function initialsFrom(name?: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0] ?? ""
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : ""
  return (first + last).toUpperCase()
}

const SIZE_CLASSES = {
  sm: "size-8 text-xs",
  md: "size-12 text-sm",
  lg: "size-20 text-xl",
} as const

export interface AvatarProps {
  src?: string | null
  name?: string | null
  size?: keyof typeof SIZE_CLASSES
  className?: string
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const [errored, setErrored] = useState(false)

  // Reset the error flag whenever the source changes (e.g. after a re-upload),
  // so a previously-broken URL doesn't keep us stuck on initials.
  useEffect(() => setErrored(false), [src])

  const showImage = !!src && !errored

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={src as string}
          alt={name ?? "Profile photo"}
          className="size-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        initialsFrom(name)
      )}
    </span>
  )
}
