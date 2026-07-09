"use client";

import { useRef } from "react";
import { useActionState } from "react";
import {
  uploadDeliveryProof,
  type UploadDeliveryProofState,
} from "@/app/actions/delivery-proofs";

const initialState: UploadDeliveryProofState = {};

/**
 * Mobile-first upload form (Delivery D3): one photo per proof, camera
 * capture preferred on phones, big touch targets. All real validation is
 * server-side (lib/file-storage.ts) — the accept attribute is UX, not
 * security.
 */
export default function DriverUploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: UploadDeliveryProofState | undefined, formData: FormData) => {
      const result = await uploadDeliveryProof(prev, formData);
      if (!result.error) {
        formRef.current?.reset();
      }
      return result;
    },
    initialState
  );

  const inputClass =
    "w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent";

  return (
    <form ref={formRef} action={formAction} className="space-y-3 text-left">
      <div>
        <label htmlFor="image" className="block text-sm text-ink-dim mb-1">
          Invoice photo <span className="text-danger">*</span>
        </label>
        <input
          id="image"
          name="image"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-surface file:text-sm`}
        />
        <p className="mt-1 text-xs text-ink-dim">JPEG, PNG, or WebP — up to 10 MB.</p>
      </div>

      <div>
        <label htmlFor="invoiceNumber" className="block text-sm text-ink-dim mb-1">
          Invoice number (optional)
        </label>
        <input
          id="invoiceNumber"
          name="invoiceNumber"
          type="text"
          maxLength={64}
          autoComplete="off"
          className={inputClass}
          placeholder="e.g. INV-1001"
        />
      </div>

      <div>
        <label htmlFor="customerName" className="block text-sm text-ink-dim mb-1">
          Customer (optional)
        </label>
        <input
          id="customerName"
          name="customerName"
          type="text"
          maxLength={128}
          autoComplete="off"
          className={inputClass}
          placeholder="e.g. APPLE MART"
        />
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm text-ink-dim mb-1">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={1000}
          className={inputClass}
          placeholder="e.g. left at reception"
        />
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
        {pending ? "Uploading…" : "Upload Delivery Proof"}
      </button>
    </form>
  );
}
