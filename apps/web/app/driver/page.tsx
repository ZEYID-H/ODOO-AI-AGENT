import { requireRole } from "@/lib/session-guard";

/**
 * Driver portal (Delivery D1) — placeholder only. Upload arrives in D3,
 * the uploads list in D3/D4 (see docs/DELIVERY_MANAGEMENT_PLAN.md §9).
 * What D1 establishes is the boundary: this page exists, only DRIVERs
 * reach it, and DRIVERs reach nothing else.
 */
export default async function DriverPage() {
  const session = await requireRole("DRIVER");

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <p className="text-sm text-ink-dim">
        Signed in as <span className="text-ink font-medium">{session.user.name}</span>
      </p>

      <section className="rounded-xl border border-line bg-surface-2 p-6 text-center space-y-2">
        <h2 className="text-base font-semibold text-ink">Upload Delivery Proof</h2>
        <p className="text-sm text-ink-dim">
          Photo uploads for delivered invoices arrive in the next phase. This
          portal is where you&apos;ll take or select a photo and submit it.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-surface-2 p-6 text-center space-y-2">
        <h2 className="text-base font-semibold text-ink">My Uploads</h2>
        <p className="text-sm text-ink-dim">
          Your submitted delivery proofs and their review status will appear
          here.
        </p>
      </section>
    </div>
  );
}
