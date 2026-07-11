import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session-guard";
import { getDeliveryProofForOwner, type OcrStatus } from "@/app/actions/delivery-proofs";
import ProofStatusBadge from "@/components/ProofStatusBadge";
import ProofReviewActions from "@/components/ProofReviewActions";

const OCR_LABEL: Record<OcrStatus, { text: string; className: string }> = {
  NOT_STARTED: { text: "Not started", className: "border-line text-ink-dim" },
  PROCESSING: { text: "Processing", className: "border-warn/40 bg-warn/10 text-warn" },
  COMPLETED: { text: "Completed", className: "border-accent/40 bg-accent/10 text-accent" },
  FAILED: { text: "Failed", className: "border-danger/40 bg-danger/10 text-danger" },
};

function OcrStatusLabel({ status }: { status: OcrStatus }) {
  const label = OCR_LABEL[status] ?? OCR_LABEL.NOT_STARTED;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${label.className}`}>
      {label.text}
    </span>
  );
}

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

      {/* OCR readiness panel (D5): placeholder over persisted data only —
          no engine, no Run button, no jobs. When D6 wires extraction, its
          results appear here without changing this page's structure; the
          Odoo-match / manual-correction panel will follow as a sibling
          section. */}
      <section className="rounded-xl border border-line bg-surface-2 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Invoice Extraction (OCR)</h2>
          <OcrStatusLabel status={proof.ocrStatus} />
        </div>

        {proof.ocrStatus === "NOT_STARTED" ? (
          <p className="text-sm text-ink-dim">
            Not started — automatic invoice extraction is planned for a future
            phase. Extracted data will appear here.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {proof.ocrInvoiceNumber && (
              <>
                <dt className="text-ink-dim">Invoice number</dt>
                <dd className="text-ink">{proof.ocrInvoiceNumber}</dd>
              </>
            )}
            {proof.ocrCustomerName && (
              <>
                <dt className="text-ink-dim">Customer</dt>
                <dd className="text-ink">{proof.ocrCustomerName}</dd>
              </>
            )}
            {proof.ocrConfidence !== null && (
              <>
                <dt className="text-ink-dim">Confidence</dt>
                <dd className="text-ink">{Math.round(proof.ocrConfidence * 100)}%</dd>
              </>
            )}
            {proof.ocrProcessedAt && (
              <>
                <dt className="text-ink-dim">Processed</dt>
                <dd className="text-ink">{new Date(proof.ocrProcessedAt).toLocaleString()}</dd>
              </>
            )}
            {proof.ocrStatus === "FAILED" && (
              <>
                <dt className="text-ink-dim">Error</dt>
                <dd className="text-danger whitespace-pre-wrap">{proof.ocrError ?? "—"}</dd>
              </>
            )}
          </dl>
        )}
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
