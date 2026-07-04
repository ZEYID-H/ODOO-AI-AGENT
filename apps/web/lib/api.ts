/**
 * Thin fetch wrapper around the FastAPI backend (apps/api). No business
 * logic, no tool logic — every question is answered by the backend's
 * /chat endpoint, which itself only calls the existing route_query().
 */

import type { HistoryMessage } from "./history";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ??
  "http://localhost:8000";

export interface HealthResponse {
  status: string;
  service: string;
}

export interface ToolsResponse {
  count: number;
  tools: string[];
}

export interface ChatResponse {
  success: boolean;
  tool: string | null;
  parameters: Record<string, unknown>;
  result: string;
}

class ApiError extends Error {}

/** Best-effort extraction of a readable message from a non-OK response body.
 * Handles FastAPI's validation-error shape ({"detail": [...] | "..."}) and
 * falls back to the raw status if the body isn't JSON or doesn't match. */
async function describeErrorResponse(res: Response, path: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail) && detail.length > 0) {
        const first = detail[0];
        if (first && typeof first === "object" && "msg" in first) {
          return String((first as { msg: unknown }).msg);
        }
      }
    }
  } catch {
    // Body wasn't JSON (or was empty) — fall through to the generic message.
  }
  return `API request to ${path} failed (${res.status})`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Could not reach the API. Is the backend running at " + API_BASE_URL + "?"
    );
  }
  if (!res.ok) {
    throw new ApiError(await describeErrorResponse(res, path));
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`API response from ${path} was not valid JSON.`);
  }
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function listTools(): Promise<ToolsResponse> {
  return request<ToolsResponse>("/tools");
}

export function chat(
  query: string,
  history: HistoryMessage[] = []
): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ query, history }),
  });
}

export { ApiError, API_BASE_URL };
