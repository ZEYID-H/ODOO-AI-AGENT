import Link from "next/link";
import { requireRole } from "@/lib/session-guard";
import {
  listMyDeliveryProofs,
  getMyDeliveryProofSummary,
} from "@/app/actions/delivery-proofs";
import DriverUploadForm from "@/components/DriverUploadForm";
import DriverSummary from "@/components/DriverSummary";
import ProofStatusBadge from "@/components/ProofStatusBadge";

/**
 * Driver dashboard (Delivery D6): a daily workspace, not just an upload
 * page. Today's Summary answers "where do my deliveries stand" at a
 * glance; the upload form stays front and centre; recent uploads are
 * cards that open a read-only detail view. requireRole is the page gate;
 * every action and the image route enforce authorization independently
 * (docs/PROJECT_DEVELOPMENT_GUIDE.md §4). Nothing here exposes OCR or
 * reviewer-identity fields — the driver view type carries neither.
 */
export default async function DriverPage() {
  const session = await requireRole("DRIVER");
  const [summary, proofs] = await Promise.all([
    getMyDeliveryProofSummary(),
    listMyDeliveryProofs(),
  ]);

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <p className="text-sm text-ink-dim">
        Signed in as <span className="text-ink font-medium">{session.user.name}</span>
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Today&apos;s Summary</h2>
        <DriverSummary summary={summary} />
      </section>

      <section className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
        <h2 className="text-base font-semibold text-ink">Upload Delivery Proof</h2>
        <DriverUploadForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Recent Uploads</h2>

        {proofs.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink-dim">
            No uploads yet — your submitted delivery proofs and their review
            status will appear here.
          </p>
        ) : (
          <ul className="space-y-3">
            {proofs.map((proof) => (
              <li key={proof.id}>
                <Link
                  href={`/driver/${proof.id}`}
                  className="flex gap-3 rounded-xl border border-line bg-surface-2 p-3 hover:border-accent transition"
                >
                  {proof.imagePath ? (
                    // Served only through the authenticated image route —
                    // the filesystem is never exposed.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/proofs/${proof.id}/image`}
                      alt=""
                      className="h-20 w-20 rounded-lg object-cover border border-line shrink-0"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-lg border border-line grid place-items-center text-xs text-ink-dim shrink-0">
                      no photo
                    </div>
                  )}

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <ProofStatusBadge status={proof.status} />
                      <span className="text-xs text-ink-dim">
                        {new Date(proof.uploadedAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-ink truncate">
                      {proof.invoiceNumber ?? "No invoice number"}
                      {proof.customerName ? ` — ${proof.customerName}` : ""}
                    </p>
                    {proof.status === "REJECTED" && proof.rejectionReason && (
                      <p className="text-xs text-danger truncate">
                        Reason: {proof.rejectionReason}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
