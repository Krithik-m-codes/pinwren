import { ApiError } from "../errors";

// Thin Dodo Payments REST client (https://docs.dodopayments.com). The HTTP function is injected so tests
// never reach the network; the API key is only ever sent as the bearer token and never logged.

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type DodoClient = {
  /** POST /checkouts: a hosted checkout for one subscription product. */
  createCheckout(input: {
    productId: string;
    email: string;
    name: string;
    customerId?: string | null;
    returnUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ sessionId: string; url: string }>;
  /** POST /customers/{id}/customer-portal/session: a short-lived self-service link. */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
};

const TIMEOUT_MS = 10_000;

export function createDodoClient(opts: { apiKey: string; baseUrl: string; fetch?: Fetch }): DodoClient {
  const send = opts.fetch ?? ((url, init) => fetch(url, init));
  async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await send(`${opts.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(502, "BILLING_PROVIDER_UNREACHABLE", "The payment provider could not be reached");
    }
    if (!res.ok) {
      // The provider's error body can echo request data; only the status is surfaced.
      throw new ApiError(
        502,
        "BILLING_PROVIDER_ERROR",
        `The payment provider refused the request (${res.status})`,
      );
    }
    const json = (await res.json().catch(() => null)) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  }
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    async createCheckout(i) {
      const r = await call("/checkouts", {
        product_cart: [{ product_id: i.productId, quantity: 1 }],
        customer: i.customerId ? { customer_id: i.customerId } : { email: i.email, name: i.name },
        return_url: i.returnUrl,
        cancel_url: i.cancelUrl,
        metadata: i.metadata,
      });
      const sessionId = str(r.session_id);
      const url = str(r.checkout_url);
      if (!sessionId || !url)
        throw new ApiError(502, "BILLING_PROVIDER_ERROR", "Unexpected checkout response");
      return { sessionId, url };
    },
    async createPortalSession(customerId, returnUrl) {
      const r = await call(
        `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`,
      );
      const url = str(r.link);
      if (!url) throw new ApiError(502, "BILLING_PROVIDER_ERROR", "Unexpected portal response");
      return { url };
    },
  };
}

let override: DodoClient | undefined;
/** Tests inject a fake client; pass undefined to restore the real one. */
export const setDodoClient = (client: DodoClient | undefined) => {
  override = client;
};
export const dodoOverride = () => override;
