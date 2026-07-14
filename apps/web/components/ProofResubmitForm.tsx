"use client";

import { useRef } from "react";
import { useActionState } from "react";
import {
  resubmitRejectedDeliveryProof,
  type ResubmitProofState,
} from "@/app/actions/delivery-proofs";

const initialState: ResubmitProofState = {};

/**
 * Retake-and-resubmit form for a REJECTED proof (D7). Image-only — no
 * invoice/customer/notes fields, matching resubmitRejectedDeliveryProof's
 * scope: this corrects the evidence, not the proof's metadata. Reuses the
 * same accept/capture attributes and size hint as DriverUploadForm (D3) —
 * server-side validation is identical (lib/file-storage.ts), this is UX
 * only. `disabled={pending}` on the submit button prevents a double-tap
 * from firing two resubmissions.
 */
export default function ProofResubmitForm({ proofId }: { proofId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: ResubmitProofState | undefined, formData: FormData) => {
      const result = await resubmitRejectedDeliveryProof(prev, formData);
      if (!result.error) {
        formRef.current?.reset();
      }
      return result;
    },
    initialState
  );

  return (
    <form ref={formRef} action={formAction} className="space-y-3 text-left">
      <input type="hidden" name="proofId" value={proofId} />

      <div>
        <label htmlFor="resubmit-image" className="block text-sm text-ink-dim mb-1">
          New photo <span className="text-danger">*</span>
        </label>
        <input
          id="resubmit-image"
          name="image"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-surface file:text-sm"
        />
        <p className="mt-1 text-xs text-ink-dim">JPEG, PNG, or WebP — up to 10 MB.</p>
      </div>

      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent text-surface px-4 py-3 text-base font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Resubmitting…" : "Retake & Resubmit"}
      </button>
    </form>
  );
}
