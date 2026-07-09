import { requireRole } from "@/lib/session-guard";
import { listMyDeliveryProofs } from "@/app/actions/delivery-proofs";
import DriverUploadForm from "@/components/DriverUploadForm";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-warn/40 bg-warn/10 text-warn",
  VERIFIED: "border-accent/40 bg-accent/10 text-accent",
  REJECTED: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * Driver portal (Delivery D3): photograph a delivered invoice, upload it,
 * and see your own uploads with their review status. requireRole is the
 * page gate; every action and the image route enforce authorization
 * independently (docs/PROJECT_DEVELOPMENT_GUIDE.md §4).
 */
export default async function DriverPage() {
  const session = await requireRole("DRIVER");
  const proofs = await listMyDeliveryProofs();

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <p className="text-sm text-ink-dim">
        Signed in as <span className="text-ink font-medium">{session.user.name}</span>
      </p>

      <section className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
        <h2 className="text-base font-semibold text-ink">Upload Delivery Proof</h2>
        <DriverUploadForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">My Uploads</h2>

        {proofs.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
            No uploads yet — your submitted delivery proofs and their review
            status will appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {proofs.map((proof) => (
              <li
                key={proof.id}
                className="rounded-xl border border-line bg-surface-2 p-3 flex gap-3"
              >
                {proof.imagePath ? (
                  // Served only through the authenticated image route —
                  // the filesystem is never exposed.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/proofs/${proof.id}/image`}
                    alt={`Delivery proof ${proof.invoiceNumber ?? proof.id}`}
                    className="h-20 w-20 rounded-lg object-cover border border-line shrink-0"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-lg border border-line grid place-items-center text-xs text-ink-dim shrink-0">
                    no photo
                  </div>
                )}

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[proof.status] ?? "border-line text-ink-dim"}`}
                    >
                      {proof.status}
                    </span>
                    <span className="text-xs text-ink-dim">
                      {new Date(proof.uploadedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-ink truncate">
                    {proof.invoiceNumber ?? "No invoice number"}
                    {proof.customerName ? ` — ${proof.customerName}` : ""}
                  </p>
                  {proof.notes && (
                    <p className="text-xs text-ink-dim truncate">{proof.notes}</p>
                  )}
                  {proof.status === "REJECTED" && proof.rejectionReason && (
                    <p className="text-xs text-danger">
                      Reason: {proof.rejectionReason}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
