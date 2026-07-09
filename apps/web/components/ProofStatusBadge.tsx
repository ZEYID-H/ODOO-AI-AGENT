/**
 * The one place a proof status becomes a badge (D4) — driver portal and
 * owner review UI render identical colors, so "what state is this in" reads
 * the same everywhere. Pure presentation: the status always comes from
 * persisted data, never client state.
 */

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-warn/40 bg-warn/10 text-warn",
  VERIFIED: "border-accent/40 bg-accent/10 text-accent",
  REJECTED: "border-danger/40 bg-danger/10 text-danger",
};

export default function ProofStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[status] ?? "border-line text-ink-dim"}`}
    >
      {status}
    </span>
  );
}
