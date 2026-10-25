// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiDuplicateBanner } from "./ai-duplicate-banner";
import { AiReproSteps } from "./ai-repro-steps";
import { AiSummaryCard } from "./ai-summary-card";

describe("AI detail components", () => {
  it("renders executive summary and suggested title", () => {
    render(
      <AiSummaryCard
        summary="Server 500 error during checkout"
        suggestedTitle="Checkout failure on payment"
      />,
    );
    expect(screen.getByText("Server 500 error during checkout")).toBeDefined();
    expect(screen.getByText("Checkout failure on payment")).toBeDefined();
  });

  it("renders duplicate candidate banner with confidence and candidate reference", () => {
    render(
      <AiDuplicateBanner
        candidateId="cand-123"
        candidateNumber={42}
        candidateTitle="Checkout button does nothing"
        confidence={88}
        reason="Both reports observe payment failure at POST /api/pay"
      />,
    );
    expect(screen.getByText(/Possible duplicate detected/i)).toBeDefined();
    expect(screen.getByText(/88% confidence/i)).toBeDefined();
    expect(screen.getByText(/#42 Checkout button does nothing/i)).toBeDefined();
    expect(screen.getByText("Both reports observe payment failure at POST /api/pay")).toBeDefined();
  });

  it("renders reproduction steps ordered checklist", () => {
    render(
      <AiReproSteps
        steps={[
          "Navigate to /checkout",
          "Click the Pay with Card button",
          "Observe 500 Internal Server Error in network console",
        ]}
      />,
    );
    expect(screen.getByText("Reproduction Steps")).toBeDefined();
    expect(screen.getByText("Navigate to /checkout")).toBeDefined();
    expect(screen.getByText("Click the Pay with Card button")).toBeDefined();
    expect(screen.getByText("Observe 500 Internal Server Error in network console")).toBeDefined();
  });
});
