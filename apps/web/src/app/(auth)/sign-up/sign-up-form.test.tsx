// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  setup: { data: undefined as Record<string, unknown> | undefined },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
  signUp: { email: mocks.signUp },
  authClient: { sendVerificationEmail: vi.fn() },
}));
vi.mock("../auth-shared", () => ({
  useNextParam: () => null,
  useSetupStatus: () => ({ data: mocks.setup.data, isLoading: false }),
  isOriginError: () => false,
  linkClass: "link",
}));
vi.mock("../other-sign-in", () => ({ OtherSignIn: () => null, SignInErrorNotice: () => null }));

import { SignUpForm } from "./sign-up-form";

const cloud = {
  needed: false,
  signupOpen: true,
  emailConfigured: true,
  appUrl: "http://localhost:3100",
  cloud: { termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy" },
};

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "correct horse battery" } });
}

afterEach(() => {
  cleanup();
  mocks.signUp.mockReset();
});

describe("SignUpForm on Cloud", () => {
  it("links the consent checkbox to the configured legal pages", () => {
    mocks.setup.data = cloud;
    render(<SignUpForm />);
    expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe(
      "https://example.test/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe(
      "https://example.test/privacy",
    );
  });

  it("does not sign up without consent", async () => {
    mocks.setup.data = cloud;
    render(<SignUpForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText(/Accept the Terms of Service/);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("sends the consent and then asks the person to check their email", async () => {
    mocks.setup.data = cloud;
    mocks.signUp.mockResolvedValue({ error: null });
    render(<SignUpForm />);
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled());
    expect(mocks.signUp.mock.calls[0]?.[0]).toMatchObject({
      email: "ada@example.com",
      termsAccepted: true,
      callbackURL: "/onboarding",
    });
    expect((await screen.findByTestId("check-email")).textContent).toContain("ada@example.com");
  });
});

describe("SignUpForm on a self-hosted server", () => {
  it("has no consent checkbox", () => {
    mocks.setup.data = { ...cloud, cloud: null };
    render(<SignUpForm />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
