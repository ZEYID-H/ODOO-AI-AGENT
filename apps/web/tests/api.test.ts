import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, getHealth, listTools, ApiError } from "../lib/api";

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
});

describe("api client — success paths", () => {
  it("getHealth returns parsed JSON", async () => {
    mockFetch({ json: async () => ({ status: "ok", service: "odoo-bi-api" }) });
    await expect(getHealth()).resolves.toEqual({ status: "ok", service: "odoo-bi-api" });
  });

  it("listTools returns parsed JSON", async () => {
    mockFetch({ json: async () => ({ count: 14, tools: ["get_business_alerts"] }) });
    const res = await listTools();
    expect(res.count).toBe(14);
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
