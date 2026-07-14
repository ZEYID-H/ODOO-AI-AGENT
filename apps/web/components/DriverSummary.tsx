import type { DriverProofSummary } from "@/app/actions/delivery-proofs";

/**
 * Today's Summary for the driver dashboard (D6, fully day-scoped in D6.2)
 * — pure presentation over counts the server action already computed. All
 * four cards describe proofs uploaded today: labels say "today" explicitly
 * so the semantics match (pending/verified/rejected here are NOT the
 * driver's all-time standing). Mobile-first: a 2×2 grid of large, readable
 * stat cards. Status colors match ProofStatusBadge so "pending / verified /
 * rejected" reads the same everywhere.
 */
const CARDS: {
  key: keyof DriverProofSummary;
  label: string;
  className: string;
}[] = [
  { key: "uploadedToday", label: "Uploaded today", className: "text-ink" },
  { key: "pending", label: "Pending today", className: "text-warn" },
  { key: "verified", label: "Verified today", className: "text-accent" },
  { key: "rejected", label: "Rejected today", className: "text-danger" },
];

export default function DriverSummary({ summary }: { summary: DriverProofSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="rounded-xl border border-line bg-surface-2 p-4 text-center"
        >
          <div className={`text-2xl font-semibold ${card.className}`}>
            {summary[card.key]}
          </div>
          <div className="text-xs text-ink-dim mt-1">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
