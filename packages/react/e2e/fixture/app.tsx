import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Pinwren, usePinwren } from "../../src/index";

// A small app the way a Next.js layout would use the package: <Pinwren> once near the root, usePinwren()
// wherever a button wants to open the widget.

const SIG = "5a".repeat(32);

function HelpButton() {
  const pinwren = usePinwren();
  return (
    <button type="button" disabled={!pinwren.ready} onClick={() => pinwren.open("bug")}>
      {pinwren.ready ? "Report a problem" : "Loading feedback…"}
    </button>
  );
}

function App() {
  const [mounted, setMounted] = useState(true);
  const [sent, setSent] = useState<number | null>(null);
  return (
    <main>
      <h1 data-testid="title">Acme dashboard</h1>
      <p data-testid="copy">Monthly revenue is up 12 % on last quarter.</p>
      <HelpButton />
      <button type="button" onClick={() => setMounted((m) => !m)}>
        {mounted ? "Remove widget" : "Add widget"}
      </button>
      {sent !== null && <p role="status">Thanks for report #{sent}</p>}
      {mounted && (
        <Pinwren
          projectKey="pk_react"
          endpoint={location.origin}
          urlPattern="/dashboard/:id"
          user={{ id: "user_7", name: "Ada Lovelace", email: "ada@example.com" }}
          userSignature={SIG}
          onSubmit={(d) => setSent(d.number)}
        />
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
