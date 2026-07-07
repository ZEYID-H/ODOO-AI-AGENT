import { afterEach, describe, expect, it, vi } from "vitest";

// chat()/listTools() now mint a token via this Server Action before every
// call (Phase 10) — mocked so these tests exercise lib/api.ts's own fetch
// wiring, not the real Auth.js/JWT-signing module graph (same isolation
// principle as mocking @/app/actions/auth elsewhere).
vi.mock("@/app/actions/api-token", () => ({ getApiToken: vi.fn() }));

import { getApiToken } from "@/app/actions/api-token";
import { chat, getHealth, listTools, ApiError } from "../lib/api";

const mockedGetApiToken = vi.mocked(getApiToken);

function mockFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockedGetApiToken.mockReset();
  mockedGetApiToken.mockResolvedValue("test-token");
});

describe("api client — success paths", () => {
  it("getHealth returns parsed JSON", async () => {
    mockFetch({ json: async () => ({ status: "ok", service: "odoo-bi-api" }) });
    await expect(getHealth()).resolves.toEqual({ status: "ok", service: "odoo-bi-api" });
  });

  it("getHealth never fetches a token — /health stays unauthenticated for Docker's HEALTHCHECK", async () => {
    mockFetch({ json: async () => ({ status: "ok", service: "odoo-bi-api" }) });
    await getHealth();
    expect(mockedGetApiToken).not.toHaveBeenCalled();
  });

  it("listTools returns parsed JSON", async () => {
    mockFetch({ json: async () => ({ count: 14, tools: ["get_business_alerts"] }) });
    const res = await listTools();
    expect(res.count).toBe(14);
  });

  it("listTools attaches a bearer token from getApiToken", async () => {
    const fetchMock = mockFetch({ json: async () => ({ count: 14, tools: [] }) });
    await listTools();
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer test-token" });
  });

  it("chat posts { query, history } and returns the response body", async () => {
    const fetchMock = mockFetch({
      json: async () => ({
        success: true,
        tool: "get_business_alerts",
        parameters: {},
        result: "## Business Alerts",
      }),
    });
    const res = await chat("show business alerts", [{ role: "user", content: "hi" }]);

    expect(res.success).toBe(true);
    expect(res.tool).toBe("get_business_alerts");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      query: "show business alerts",
      history: [{ role: "user", content: "hi" }],
    });
  });

  it("chat attaches a bearer token AND keeps Content-Type (header-merge regression check)", async () => {
    mockedGetApiToken.mockResolvedValue("a-specific-token");
    const fetchMock = mockFetch({
      json: async () => ({ success: true, tool: null, parameters: {}, result: "ok" }),
    });
    await chat("hi");

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer a-specific-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("chat mints a fresh token per call, not a cached/reused one", async () => {
    mockedGetApiToken.mockResolvedValueOnce("token-1").mockResolvedValueOnce("token-2");
    const fetchMock = mockFetch({
      json: async () => ({ success: true, tool: null, parameters: {}, result: "ok" }),
    });

    await chat("first question");
    await chat("second question");

    expect(mockedGetApiToken).toHaveBeenCalledTimes(2);
    const firstHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(firstHeaders.Authorization).toBe("Bearer token-1");
    expect(secondHeaders.Authorization).toBe("Bearer token-2");
  });
});

describe("api client — failure paths", () => {
  it("wraps a network failure in ApiError with a clear message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(getHealth()).rejects.toBeInstanceOf(ApiError);
    await expect(getHealth()).rejects.toThrow(/Could not reach the API/);
  });

  it("surfaces FastAPI's string `detail` on a non-OK response", async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ detail: "query is required" }) });
    await expect(chat("x")).rejects.toThrow("query is required");
  });

  it("surfaces a 401 from a missing/invalid/expired token with the backend's own detail message", async () => {
    mockFetch({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Authentication token has expired" }),
    });
    await expect(chat("x")).rejects.toThrow("Authentication token has expired");
  });

  it("propagates getApiToken() failing (e.g. no session) as a rejected promise, without ever calling fetch", async () => {
    const fetchMock = mockFetch({ json: async () => ({}) });
    mockedGetApiToken.mockRejectedValue(new Error("Not authenticated."));

    await expect(chat("x")).rejects.toThrow("Not authenticated.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the first message when `detail` is a validation-error list", async () => {
    mockFetch({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ msg: "field required", loc: ["body", "query"] }] }),
    });
    await expect(chat("x")).rejects.toThrow("field required");
  });

  it("falls back to a status-based message when the error body isn't JSON", async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(getHealth()).rejects.toThrow(/failed \(500\)/);
  });

  it("throws ApiError when a 200 response body is not valid JSON", async () => {
    mockFetch({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });
    await expect(getHealth()).rejects.toThrow(/not valid JSON/);
  });
});
