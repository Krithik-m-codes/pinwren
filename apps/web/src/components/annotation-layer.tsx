import type { AnnotationLayer as Layer, AnnotationShape } from "@pinwren/core";

// The reporter's annotations drawn over an unflattened screenshot (wave-5 contract §2). The widget sends the
// shapes as vectors in the exported image's pixels; this mirrors its canvas drawing (packages/widget/src/
// editor.ts) in SVG, so the dashboard can switch them off to see what was underneath. Redactions (blur) and
// the crop are already applied to the image itself and never appear here.

const SCALE = { s: 0.65, m: 1, l: 1.6 } as const;
const strokeWidth = (w: number, size: AnnotationShape["size"]) => Math.max(2, w / 400) * SCALE[size];
const textSize = (w: number, size: AnnotationShape["size"]) =>
  Math.round(Math.min(96, Math.max(14, w / 48)) * SCALE[size]);
const stepRadius = (w: number, size: AnnotationShape["size"]) => Math.round(textSize(w, size) * 0.8);
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const path = (points: { x: number; y: number }[]) =>
  points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");

function Shape({ s, width }: { s: AnnotationShape; width: number }) {
  const lw = strokeWidth(width, s.size);
  const stroke = {
    stroke: s.color,
    strokeWidth: lw,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  } as const;
  switch (s.tool) {
    case "pen":
      return <path d={path(s.points)} {...stroke} />;
    case "highlighter":
      return (
        <path
          d={path(s.points)}
          {...stroke}
          strokeWidth={lw * 4}
          strokeOpacity={0.35}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    case "text":
      return (
        <text
          x={s.at.x}
          y={s.at.y}
          fill={s.color}
          stroke="#fff"
          strokeWidth={s.px / 5}
          paintOrder="stroke"
          dominantBaseline="hanging"
          fontFamily={FONT}
          fontWeight={600}
          fontSize={s.px}
        >
          {s.text}
        </text>
      );
    case "step": {
      const r = stepRadius(width, s.size);
      return (
        <g>
          <circle
            cx={s.at.x}
            cy={s.at.y}
            r={r}
            fill={s.color}
            stroke="#fff"
            strokeWidth={Math.max(2, r / 6)}
          />
          <text
            x={s.at.x}
            y={s.at.y + r * 0.05}
            fill="#fff"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={FONT}
            fontWeight={700}
            fontSize={Math.round(r * 1.1)}
          >
            {s.n}
          </text>
        </g>
      );
    }
    case "ellipse": {
      const x = Math.min(s.a.x, s.b.x);
      const y = Math.min(s.a.y, s.b.y);
      const rx = Math.max(1, Math.abs(s.a.x - s.b.x) / 2);
      const ry = Math.max(1, Math.abs(s.a.y - s.b.y) / 2);
      return <ellipse cx={x + rx} cy={y + ry} rx={rx} ry={ry} {...stroke} />;
    }
    case "rect":
      return (
        <rect
          x={Math.min(s.a.x, s.b.x)}
          y={Math.min(s.a.y, s.b.y)}
          width={Math.abs(s.a.x - s.b.x)}
          height={Math.abs(s.a.y - s.b.y)}
          {...stroke}
        />
      );
    case "arrow": {
      const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
      const head = lw * 5;
      const p1 = `${s.b.x - head * Math.cos(angle - 0.45)},${s.b.y - head * Math.sin(angle - 0.45)}`;
      const p2 = `${s.b.x - head * Math.cos(angle + 0.45)},${s.b.y - head * Math.sin(angle + 0.45)}`;
      return (
        <g>
          <line x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} {...stroke} />
          <polygon points={`${s.b.x},${s.b.y} ${p1} ${p2}`} fill={s.color} />
        </g>
      );
    }
    default:
      // blur and crop are baked into the image
      return null;
  }
}

/**
 * The vector layer, stretched over the image it was drawn on (`layer.width` × `layer.height` are that image's
 * pixels). Purely visual: hidden from assistive tech, never intercepts clicks.
 */
export function AnnotationOverlay({ layer, className }: { layer: Layer; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${layer.width} ${layer.height}`}
      preserveAspectRatio="none"
      className={className ?? "pointer-events-none absolute inset-0 size-full"}
      aria-hidden="true"
      data-annotations={layer.shapes.length}
    >
      {layer.shapes.map((s, i) => (
        // Shapes have no ids; their order is fixed for a given screenshot.
        <Shape key={i} s={s} width={layer.width} />
      ))}
    </svg>
  );
}
