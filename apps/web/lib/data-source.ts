/**
 * Honest data-source resolution. The workspace must never advertise a live
 * Odoo connection it doesn't have — AG4 live validation is blocked, and the
 * default backend is bundled demo data. The claim "Connected to Odoo" is
 * only ever shown when the operator has explicitly wired a real instance
 * (NEXT_PUBLIC_DATA_BACKEND=odoo) AND the API is actually reachable.
 *
 * This is frontend display only: it reads no secrets, exposes no endpoints,
 * and changes no API contract.
 */

export type DataBackend = "mock" | "odoo";

/** Health of the FastAPI backend (from GET /health). */
export type ConnectionStatus = "checking" | "online" | "offline";

/** What the UI honestly shows the user about where answers come from. */
export type DataSourceState = "connecting" | "demo" | "odoo" | "api-unavailable";

/** Read once from the public env; anything but "odoo" is treated as demo. */
export const DATA_BACKEND: DataBackend =
  process.env.NEXT_PUBLIC_DATA_BACKEND === "odoo" ? "odoo" : "mock";

export function resolveDataSource(
  status: ConnectionStatus,
  backend: DataBackend = DATA_BACKEND
): DataSourceState {
  if (status === "checking") return "connecting";
  if (status === "offline") return "api-unavailable";
  // Online: report the truth about the backend. Mock can never read as Odoo.
  return backend === "odoo" ? "odoo" : "demo";
}
