import { cn } from "@/lib/utils";

// A small mosaic glyph — four tiles, two in the brand accent — so the identity
// isn't the generic "sparkle in a rounded square" every AI starter ships with.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="2.5" width="8.5" height="8.5" rx="2.6" className="fill-primary" />
      <rect x="13" y="2.5" width="8.5" height="8.5" rx="2.6" className="fill-current opacity-25" />
      <rect x="2.5" y="13" width="8.5" height="8.5" rx="2.6" className="fill-current opacity-25" />
      <rect x="13" y="13" width="8.5" height="8.5" rx="2.6" className="fill-primary" />
    </svg>
  );
}

export function Wordmark({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark className={cn("size-5 text-foreground", markClassName)} />
      <span className="font-mono text-base font-medium tracking-tight lowercase">
        mosaic
      </span>
    </span>
  );
}
