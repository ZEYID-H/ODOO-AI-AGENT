"use client";

import { useActionState, useState } from "react";
import {
  verifyDeliveryProofForm,
  rejectDeliveryProofForm,
  type ReviewFormState,
} from "@/app/actions/delivery-proofs";

const initialState: ReviewFormState = {};

/**
 * Verify/Reject controls for a PENDING proof (D4). Presentation only —
 * every decision, transition rule, and validation lives in the server
 * actions; this component just posts forms and shows returned errors.
 * Rendered exclusively on the owner details page, and only while the
 * proof is pending (the page re-renders from persisted data after a
 * decision, so a reviewed proof shows the audit record instead).
 */
export default function ProofReviewActions({ proofId }: { proofId: string }) {
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyDeliveryProofForm,
    initialState
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(
    rejectDeliveryProofForm,
    initialState
  );
  const [rejecting, setRejecting] = useState(false);
  const pending = verifyPending || rejectPending;
  const error = verifyState?.error ?? rejectState?.error;

  return (
    <div className="space-y-3">
      {!rejecting ? (
        <div className="flex gap-2">
          <form action={verifyAction} className="flex-1">
            <input type="hidden" name="proofId" value={proofId} />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-accent text-surface px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verifyPending ? "Verifying…" : "✓ Verify"}
            </button>
          </form>
          <button
            type="button"
            disabled={pending}
            onClick={() => setRejecting(true)}
            className="flex-1 rounded-lg border border-danger/40 text-danger px-4 py-2.5 text-sm font-medium hover:bg-danger/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✕ Reject…
          </button>
        </div>
      ) : (
        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="proofId" value={proofId} />
          <label htmlFor="rejectionReason" className="block text-sm text-ink-dim">
            Rejection reason <span className="text-danger">*</span>
          </label>
          <textarea
            id="rejectionReason"
            name="rejectionReason"
            required
            rows={2}
            maxLength={500}
            autoFocus
            placeholder="Why is this proof being rejected? The driver will see this."
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-danger text-surface px-4 py-2.5 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rejectPending ? "Rejecting…" : "Confirm Reject"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-line px-4 py-2.5 text-sm text-ink-dim hover:text-ink transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}
    </div>
  );
}
