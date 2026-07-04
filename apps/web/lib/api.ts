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
    throw new ApiError(`API request to ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
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
