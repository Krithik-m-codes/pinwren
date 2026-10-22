import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/** The social card for every page: brand mark, eyebrow, title and a one-line description. */
export function ogCard({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string | undefined;
}) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "linear-gradient(135deg, #0f0f17 0%, #1b1b2e 55%, #2a2a5a 100%)",
        color: "#f4f4f8",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#5b5bd6",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4">
            <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
            <circle cx="12" cy="9.5" r="2.4" fill="#fff" stroke="none" />
          </svg>
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>Pinwren</div>
        <div style={{ marginLeft: "auto", fontSize: 24, color: "#a5a5f0" }}>{eyebrow}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            fontSize: title.length > 40 ? 64 : 76,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 30, color: "#c4c4d4", lineHeight: 1.35, maxWidth: 980 }}>
            {description.length > 140 ? `${description.slice(0, 137)}…` : description}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 22, color: "#9a9ab0" }}>
        <span>Open source</span>
        <span>·</span>
        <span>Self-hosted</span>
        <span>·</span>
        <span>pinwren.dev</span>
      </div>
    </div>,
    OG_SIZE,
  );
}
