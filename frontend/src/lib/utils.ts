import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Distinct from the message-bubble/graph palette so avatars read as "a
// person" rather than colliding with brand/AI/node-type meaning.
const AVATAR_COLORS = [
  "#5b6b8c", // slate blue
  "#b5566b", // rose
  "#3f7d5c", // forest
  "#7c5a94", // plum
  "#a3673f", // clay
  "#4a7a8c", // steel
]

// Stable per-user avatar color, hashed from their id (Slack/Discord-style
// "who's who" identity cue, no DB column needed).
export function avatarColorFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
