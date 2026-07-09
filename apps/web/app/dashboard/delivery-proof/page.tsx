import { requireRole } from "@/lib/session-guard";
import { listAllDeliveryProofsForOwner } from "@/app/actions/delivery-proofs";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-warn/40 bg-warn/10 text-warn",
  VERIFIED: "border-accent/40 bg-accent/10 text-accent",
  REJECTED: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * Minimal owner view of uploaded delivery proofs (Delivery D3): metadata
 * plus the image, nothing else. The real review workflow — filters,
 * verify/reject with reasons, sidebar navigation — is D4's scope
 * (docs/DELIVERY_MANAGEMENT_PLAN.md §9); this page exists so D3's uploads
 * are visible to the owner without waiting for it.
 */
export default async function DeliveryProofReviewPage() {
  await requireRole("OWNER");
  const proofs = await listAllDeliveryProofsForOwner();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Delivery Proofs</h1>
        <p className="text-sm text-ink-dim">
          {proofs.length} proof{proofs.length === 1 ? "" : "s"} — review actions
          arrive in the next phase.
        </p>
      </div>

      {proofs.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
          No delivery proofs uploaded yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {proofs.map((proof) => (
            <li
              key={proof.id}
              className="rounded-xl border border-line bg-surface-2 p-4 flex gap-4"
            >
              {proof.imagePath ? (
                <a href={`/api/proofs/${proof.id}/image`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/proofs/${proof.id}/image`}
                    alt={`Delivery proof ${proof.invoiceNumber ?? proof.id}`}
                    className="h-28 w-28 rounded-lg object-cover border border-line shrink-0"
                  />
                </a>
              ) : (
                <div className="h-28 w-28 rounded-lg border border-line grid place-items-center text-xs text-ink-dim shrink-0">
                  metadata only
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[proof.status] ?? "border-line text-ink-dim"}`}
                  >
                    {proof.status}
                  </span>
                  <span className="text-sm text-ink font-medium">
                    {proof.driverUsername}
                  </span>
                  <span className="text-xs text-ink-dim">
                    {new Date(proof.uploadedAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-ink">
                  {proof.invoiceNumber ?? "No invoice number"}
                  {proof.customerName ? ` — ${proof.customerName}` : ""}
                </p>
                {proof.notes && <p className="text-xs text-ink-dim">{proof.notes}</p>}
                {proof.rejectionReason && (
                  <p className="text-xs text-danger">Reason: {proof.rejectionReason}</p>
                )}
                {proof.verifiedByUsername && (
                  <p className="text-xs text-ink-dim">
                    Reviewed by {proof.verifiedByUsername}
                    {proof.verifiedAt ? ` — ${new Date(proof.verifiedAt).toLocaleString()}` : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
