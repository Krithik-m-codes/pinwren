/** Structured data as a script tag. `<` is escaped so nothing in the data can close the element. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // The six characters \u003c (a JSON escape). The literal "\u003c" would be `<` again.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
