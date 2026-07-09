import Link from "next/link";
import { requireRole } from "@/lib/session-guard";
import { listAllDeliveryProofsForOwner } from "@/app/actions/delivery-proofs";
import ProofStatusBadge from "@/components/ProofStatusBadge";

const FILTERS = [
  { label: "Pending", value: "PENDING" },
  { label: "Verified", value: "VERIFIED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "All", value: "" },
] as const;

/**
 * Delivery proof review queue (D4): the owner's moderation inbox. Default
 * order puts work first — PENDING on top, newest first within each status;
 * the status filters are plain links (server-rendered, bookmarkable).
 * Each row links to the dedicated review page. Future phases (OCR status,
 * extracted data, Odoo match — D5+) add columns/panels here; the queue
 * shape itself is what they plug into.
 */
export default async function DeliveryProofQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireRole("OWNER");
  const { status } = await searchParams;
  const active = FILTERS.some((f) => f.value === status) ? (status ?? "") : "";
  const proofs = await listAllDeliveryProofsForOwner(active || undefined);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Delivery Proof Review</h1>
          <p className="text-sm text-ink-dim">
            {proofs.length} proof{proofs.length === 1 ? "" : "s"}
            {active ? ` — ${active.toLowerCase()}` : " — pending first"}
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-accent hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      <nav className="flex gap-1.5" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={f.value ? `/dashboard/delivery-proof?status=${f.value}` : "/dashboard/delivery-proof"}
            className={`text-sm px-3 py-1.5 rounded-lg border transition ${
              active === f.value
                ? "border-accent text-accent bg-accent/10"
                : "border-line text-ink-dim hover:text-ink hover:border-accent"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {proofs.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
          Nothing here — {active ? `no ${active.toLowerCase()} proofs.` : "no delivery proofs uploaded yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {proofs.map((proof) => (
            <li key={proof.id}>
              <Link
                href={`/dashboard/delivery-proof/${proof.id}`}
                className="flex gap-4 rounded-xl border border-line bg-surface-2 p-3 hover:border-accent transition"
              >
                {proof.imagePath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/proofs/${proof.id}/image`}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover border border-line shrink-0"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-line grid place-items-center text-[10px] text-ink-dim shrink-0">
                    no photo
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProofStatusBadge status={proof.status} />
                    <span className="text-sm font-medium text-ink truncate">
                      {proof.invoiceNumber ?? "No invoice number"}
                    </span>
                    {proof.customerName && (
                      <span className="text-sm text-ink-dim truncate">{proof.customerName}</span>
                    )}
                  </div>
                  <p className="text-xs text-ink-dim">
                    {proof.driverUsername} · {new Date(proof.uploadedAt).toLocaleString()}
                  </p>
                  <p className="text-xs text-ink-dim">
                    {proof.status === "PENDING"
                      ? "Awaiting review"
                      : `Reviewed by ${proof.verifiedByUsername ?? "—"}${
                          proof.verifiedAt ? ` · ${new Date(proof.verifiedAt).toLocaleString()}` : ""
                        }`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
