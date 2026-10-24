import { encode } from "uqr";
import { cn } from "@/lib/utils";

/**
 * A QR code drawn as inline SVG from the encoded module grid, with no HTML strings and no network. Dark
 * modules are one path, on a white quiet zone so phone cameras read it in dark mode too.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { data, size } = encode(value, { border: 2, ecc: "M" });
  let d = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x},${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("size-44 rounded-md bg-white", className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
