import { ogCard, OG_SIZE } from "@/lib/og/card";

export const alt = "Pinwren — pinned feedback and annotated bug reports for any website";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Visual feedback",
    title: "Point at the page. Fix what’s wrong.",
    description:
      "Pinned comments and annotated bug reports for any website, with a triage inbox you run yourself.",
  });
}
