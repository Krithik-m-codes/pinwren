import { ImageResponse } from "next/og";
import {
  LOGO_VIEWBOX,
  MARK_BIRD,
  MARK_DETAIL,
  MARK_FACE,
  WORD_DOT,
  WORD_LETTERS,
} from "@/components/brand/paths";
import { SITE_URL } from "@/lib/site";

// Brand palette (brand/README.md).
const ORANGE = "#F04424";
const NAVY = "#17243A";

export const OG_SIZE = { width: 1200, height: 630 };

/** The social card for every page: the logo, eyebrow, title and a one-line description, on white. */
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
        background: "#ffffff",
        borderBottom: `14px solid ${ORANGE}`,
        color: NAVY,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="232" height="59" viewBox={LOGO_VIEWBOX}>
          <path fill="#FFFFFF" d={MARK_FACE} />
          <path fill={ORANGE} fillRule="evenodd" d={MARK_BIRD} />
          <path fill={NAVY} d={MARK_DETAIL} />
          <path fill={NAVY} fillRule="evenodd" d={WORD_LETTERS} />
          <path fill={ORANGE} d={WORD_DOT} />
        </svg>
        <div style={{ marginLeft: "auto", fontSize: 24, color: "#D63A1C", fontWeight: 600 }}>{eyebrow}</div>
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
          <div style={{ fontSize: 30, color: "#4a5568", lineHeight: 1.35, maxWidth: 980 }}>
            {description.length > 140 ? `${description.slice(0, 137)}…` : description}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: 22, color: "#5a6478" }}>
        <span>Open source</span>
        <span>·</span>
        <span>Self-hosted</span>
        <span>·</span>
        <span>{new URL(SITE_URL).host}</span>
      </div>
    </div>,
    OG_SIZE,
  );
}
