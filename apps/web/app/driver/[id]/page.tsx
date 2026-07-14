import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session-guard";
import { getMyDeliveryProof } from "@/app/actions/delivery-proofs";
import ProofStatusBadge from "@/components/ProofStatusBadge";

/**
 * Driver's read-only detail view of one of THEIR OWN uploads (D6).
 * getMyDeliveryProof scopes to the session driver, so another driver's id
 * (or an unknown one) is a 404 — never a data leak, never a probe. The
 * driver view type carries no OCR and no reviewer-identity fields, so
 * there is nothing owner-only to expose here even by accident. Drivers
 * cannot modify anything: this is display only (no delete, no replace,
 * no re-upload — deferred).
 */
export default async function DriverProofDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("DRIVER");
  const { id } = await params;
  const proof = await getMyDeliveryProof(id);
  if (!proof) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">Delivery Proof</h1>
        <Link href="/driver" className="text-sm text-accent hover:underline">
          ← Back
        </Link>
      </div>

      {proof.imagePath ? (
        <a href={`/api/proofs/${proof.id}/image`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/proofs/${proof.id}/image`}
            alt={`Delivery proof ${proof.invoiceNumber ?? proof.id}`}
            className="w-full max-h-[24rem] rounded-xl object-contain border border-line bg-surface-2"
          />
        </a>
      ) : (
        <div className="rounded-xl border border-line bg-surface-2 p-8 text-center text-sm text-ink-dim">
          No photo attached.
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
          <dt className="text-ink-dim">Uploaded</dt>
          <dd className="text-ink">{new Date(proof.uploadedAt).toLocaleString()}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink whitespace-pre-wrap">{proof.notes ?? "—"}</dd>
        </dl>
      </section>

      {proof.status === "REJECTED" && (
        <section className="rounded-xl border border-danger/40 bg-danger/10 p-4 space-y-1">
          <h2 className="text-sm font-semibold text-danger">Rejected</h2>
          <p className="text-sm text-danger whitespace-pre-wrap">
            {proof.rejectionReason ?? "No reason provided."}
          </p>
        </section>
      )}
    </div>
  );
}
