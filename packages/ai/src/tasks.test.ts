import { describe, expect, it, vi } from "vitest";
import {
  suggestSeverity,
  summarizeReport,
  synthesizeReproSteps,
  translateText,
  verifyDuplicate,
} from "./tasks";
import type { AiProvider } from "./types";

describe("AI tasks", () => {
  const completeMock = vi.fn();
  const mockProvider: AiProvider = {
    id: "openai",
    model: "gpt-4o-mini",
    complete: completeMock,
  };

  it("extracts summary and title", async () => {
    completeMock.mockResolvedValueOnce({
      suggestedTitle: "Checkout 500 on Pay button click",
      summary: "User encountered a server error during payment processing.",
    });

    const res = await summarizeReport(mockProvider, {
      title: "bad bug",
      body: "clicked checkout and got red error",
      url: "https://example.com/checkout",
    });

    expect(res.suggestedTitle).toBe("Checkout 500 on Pay button click");
    expect(res.summary).toContain("payment processing");
  });

  it("suggests severity based on diagnostics", async () => {
    completeMock.mockResolvedValueOnce({
      priority: "high",
      kind: "bug",
      reason: "500 Internal Server Error observed on POST /api/pay",
    });

    const res = await suggestSeverity(mockProvider, {
      body: "checkout broken",
      consoleErrors: ["Uncaught (in promise) Error: Payment failed"],
      networkErrors: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 120 }],
    });

    expect(res.priority).toBe("high");
    expect(res.kind).toBe("bug");
  });

  it("translates text to target locale", async () => {
    completeMock.mockResolvedValueOnce({
      translatedText: "Bonjour le monde",
    });

    const res = await translateText(mockProvider, {
      text: "Hello world",
      targetLocale: "fr",
    });

    expect(res).toBe("Bonjour le monde");
  });

  it("verifies duplicate candidates", async () => {
    completeMock.mockResolvedValueOnce({
      isDuplicate: true,
      candidateId: "cand-1",
      confidence: 95,
      reason: "Both report checkout button 500 error",
    });

    const res = await verifyDuplicate(mockProvider, {
      target: { title: "Pay error", body: "500 on pay" },
      candidates: [{ id: "cand-1", title: "Checkout 500", body: "error on pay button" }],
    });

    expect(res.isDuplicate).toBe(true);
    expect(res.candidateId).toBe("cand-1");
    expect(res.confidence).toBe(95);
  });

  it("returns non-duplicate immediately when candidates list is empty", async () => {
    const res = await verifyDuplicate(mockProvider, {
      target: { body: "Some unique bug" },
      candidates: [],
    });

    expect(res.isDuplicate).toBe(false);
    expect(res.candidateId).toBeNull();
  });

  it("synthesizes reproduction steps from replay and network errors", async () => {
    completeMock.mockResolvedValueOnce({
      reproductionSteps: [
        "1. Open /checkout",
        "2. Click button 'Pay Now'",
        "3. Observe 500 error on POST /api/pay",
      ],
    });

    const res = await synthesizeReproSteps(mockProvider, {
      body: "payment crashed",
      url: "https://example.com/checkout",
      replayEvents: [{ type: "click", target: "button.pay", text: "Pay Now", timeOffset: 1200 }],
      networkErrors: [{ method: "POST", url: "/api/pay", status: 500 }],
    });

    expect(res.reproductionSteps).toHaveLength(3);
    expect(res.reproductionSteps[0]).toBe("1. Open /checkout");
  });
});
