import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session-guard";
import { getDeliveryProofForOwner } from "@/app/actions/delivery-proofs";
import ProofStatusBadge from "@/components/ProofStatusBadge";
import ProofReviewActions from "@/components/ProofReviewActions";

/**
 * Dedicated review page for one proof (D4). Everything shown here comes
 * from persisted data — reviewer, timestamps, and reason render from the
 * database row, never from client state, so what the owner sees IS the
 * audit record. Review controls exist only while the proof is PENDING;
 * a decided proof is immutable and shows its decision instead.
 *
 * D5+ extension point: OCR status, extracted invoice fields, confidence,
 * and the Odoo match/manual-correction panel slot in as additional
 * sections between "Details" and "Review" without changing this page's
 * structure.
 */
export default async function DeliveryProofDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("OWNER");
  const { id } = await params;
  const proof = await getDeliveryProofForOwner(id);
  if (!proof) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Delivery Proof Review</h1>
        <Link href="/dashboard/delivery-proof" className="text-sm text-accent hover:underline">
          ← Back to queue
        </Link>
      </div>

      {proof.imagePath ? (
        <a
          href={`/api/proofs/${proof.id}/image`}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/proofs/${proof.id}/image`}
            alt={`Delivery proof ${proof.invoiceNumber ?? proof.id}`}
            className="w-full max-h-[28rem] rounded-xl object-contain border border-line bg-surface-2"
          />
        </a>
      ) : (
        <div className="rounded-xl border border-line bg-surface-2 p-8 text-center text-sm text-ink-dim">
          Metadata-only proof — no photo attached.
        </div>
      )}

      <section className="rounded-xl border border-line bg-surface-2 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ProofStatusBadge status={proof.status} />
          <h2 className="text-base font-semibold text-ink">
            {proof.invoiceNumber ?? "No invoice number"}
          </h2>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-dim">Customer</dt>
          <dd className="text-ink">{proof.customerName ?? "—"}</dd>
          <dt className="text-ink-dim">Driver</dt>
          <dd className="text-ink">{proof.driverUsername}</dd>
          <dt className="text-ink-dim">Uploaded</dt>
          <dd className="text-ink">{new Date(proof.uploadedAt).toLocaleString()}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink whitespace-pre-wrap">{proof.notes ?? "—"}</dd>
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface-2 p-4 space-y-3">
        <h2 className="text-base font-semibold text-ink">Review</h2>

        {proof.status === "PENDING" ? (
          <ProofReviewActions proofId={proof.id} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-dim">Decision</dt>
            <dd>
              <ProofStatusBadge status={proof.status} />
            </dd>
            <dt className="text-ink-dim">Reviewed by</dt>
            <dd className="text-ink">{proof.verifiedByUsername ?? "—"}</dd>
            <dt className="text-ink-dim">Reviewed at</dt>
            <dd className="text-ink">
              {proof.verifiedAt ? new Date(proof.verifiedAt).toLocaleString() : "—"}
            </dd>
            {proof.status === "REJECTED" && (
              <>
                <dt className="text-ink-dim">Reason</dt>
                <dd className="text-danger whitespace-pre-wrap">
                  {proof.rejectionReason ?? "—"}
                </dd>
              </>
            )}
          </dl>
        )}
      </section>
    </main>
  );
}
