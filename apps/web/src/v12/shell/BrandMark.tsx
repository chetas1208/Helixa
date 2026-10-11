import { useId } from "react";

/** Two strands forming an H. Original mark; not a diamond and not a third-party logo. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="rgb(7 11 18)" />
      <path d="M8 5c3.2 3.4 3.2 6.2.4 9.2C11.2 17.2 11.2 20 8 27" fill="none" stroke={`url(#${gid}-a)`} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M24 5c-3.2 3.4-3.2 6.2-.4 9.2C20.8 17.2 20.8 20 24 27" fill="none" stroke={`url(#${gid}-b)`} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.2 16h11.6" fill="none" stroke="rgb(215 236 255)" strokeWidth="1.5" strokeLinecap="round" />
      <defs>
        <linearGradient id={`${gid}-a`} x1="6" y1="4" x2="14" y2="28">
          <stop offset="0" stopColor="rgb(127 227 255)" />
          <stop offset="1" stopColor="rgb(90 160 255)" />
        </linearGradient>
        <linearGradient id={`${gid}-b`} x1="18" y1="4" x2="26" y2="28">
          <stop offset="0" stopColor="rgb(186 210 255)" />
          <stop offset="1" stopColor="rgb(142 162 255)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

