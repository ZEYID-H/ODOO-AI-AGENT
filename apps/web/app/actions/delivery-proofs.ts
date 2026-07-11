"use server";

/**
 * Delivery proof persistence actions (Delivery Management D2 — see
 * docs/DELIVERY_MANAGEMENT_PLAN.md §9). Metadata only: no file handling,
 * no uploads — imagePath/mimeType/sizeBytes stay null until D3.
 *
 * Authorization (docs/PROJECT_DEVELOPMENT_GUIDE.md §4, permanent rule):
 * every action starts with requireActionRole() before any business logic.
 * Drivers create and see exclusively their own proofs — the driver id
 * always comes from the server session, never from the client. Owners see
 * everything and are the only role that can verify/reject. Error messages
 * stay generic; owner views expose the driver's username only, never
 * credential fields.
 */

import { revalidatePath } from "next/cache";
import { requireActionRole } from "@/lib/session-guard";
import { prisma } from "@/lib/db";
import { saveProofImage, deleteProofImage } from "@/lib/file-storage";

export type DeliveryProofStatus = "PENDING" | "VERIFIED" | "REJECTED";
export type OcrStatus = "NOT_STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface DeliveryProofView {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  notes: string | null;
  imagePath: string | null;
  status: DeliveryProofStatus;
  rejectionReason: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Owner-facing view: adds who uploaded and who reviewed (usernames only)
 * plus the OCR-readiness fields (D5). OCR data lives ONLY here by design —
 * DeliveryProofView, which is what drivers receive, never carries it.
 */
export interface OwnerDeliveryProofView extends DeliveryProofView {
  driverId: string;
  driverUsername: string;
  verifiedByUsername: string | null;
  ocrStatus: OcrStatus;
  ocrText: string | null;
  ocrInvoiceNumber: string | null;
  ocrCustomerName: string | null;
  ocrConfidence: number | null;
  ocrProcessedAt: string | null;
  ocrError: string | null;
}

export interface CreateDeliveryProofInput {
  invoiceNumber?: unknown;
  customerName?: unknown;
  notes?: unknown;
}

const MAX_INVOICE_NUMBER = 64;
const MAX_CUSTOMER_NAME = 128;
const MAX_NOTES = 1000;
const MAX_REJECTION_REASON = 500;

/**
 * Optional free-text field: trims, treats empty/absent as null, rejects
 * non-strings and over-length input loudly (never silently truncates —
 * what the driver typed is evidence, so it must be stored exactly or not
 * at all).
 */
function normalizeOptionalText(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function isStatus(value: string): value is DeliveryProofStatus {
  return value === "PENDING" || value === "VERIFIED" || value === "REJECTED";
}

function toView(p: {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  notes: string | null;
  imagePath: string | null;
  status: string;
  rejectionReason: string | null;
  uploadedAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): DeliveryProofView {
  return {
    id: p.id,
    invoiceNumber: p.invoiceNumber,
    customerName: p.customerName,
    notes: p.notes,
    imagePath: p.imagePath,
    status: isStatus(p.status) ? p.status : "PENDING",
    rejectionReason: p.rejectionReason,
    uploadedAt: p.uploadedAt.toISOString(),
    verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// Owner queries select the related usernames explicitly — never the full
// User rows, which carry passwordHash.
const ownerInclude = {
  driver: { select: { username: true } },
  verifiedBy: { select: { username: true } },
} as const;

function isOcrStatus(value: string): value is OcrStatus {
  return (
    value === "NOT_STARTED" ||
    value === "PROCESSING" ||
    value === "COMPLETED" ||
    value === "FAILED"
  );
}

function toOwnerView(
  p: Parameters<typeof toView>[0] & {
    driverId: string;
    driver: { username: string };
    verifiedBy: { username: string } | null;
    ocrStatus: string;
    ocrText: string | null;
    ocrInvoiceNumber: string | null;
    ocrCustomerName: string | null;
    ocrConfidence: number | null;
    ocrProcessedAt: Date | null;
    ocrError: string | null;
  }
): OwnerDeliveryProofView {
  return {
    ...toView(p),
    driverId: p.driverId,
    driverUsername: p.driver.username,
    verifiedByUsername: p.verifiedBy ? p.verifiedBy.username : null,
    ocrStatus: isOcrStatus(p.ocrStatus) ? p.ocrStatus : "NOT_STARTED",
    ocrText: p.ocrText,
    ocrInvoiceNumber: p.ocrInvoiceNumber,
    ocrCustomerName: p.ocrCustomerName,
    ocrConfidence: p.ocrConfidence,
    ocrProcessedAt: p.ocrProcessedAt ? p.ocrProcessedAt.toISOString() : null,
    ocrError: p.ocrError,
  };
}

/** DRIVER: record a delivery proof (metadata only in D2 — the photo itself
 * arrives in D3). The proof always belongs to the session's driver. */
export async function createDeliveryProofMetadata(
  input: CreateDeliveryProofInput
): Promise<DeliveryProofView> {
  const session = await requireActionRole("DRIVER");

  const data = {
    invoiceNumber: normalizeOptionalText(input?.invoiceNumber, "Invoice number", MAX_INVOICE_NUMBER),
    customerName: normalizeOptionalText(input?.customerName, "Customer name", MAX_CUSTOMER_NAME),
    notes: normalizeOptionalText(input?.notes, "Notes", MAX_NOTES),
  };

  const proof = await prisma.deliveryProof.create({
    data: { ...data, driverId: session.user.id },
  });
  return toView(proof);
}

/** DRIVER: own proofs only, newest first. */
export async function listMyDeliveryProofs(): Promise<DeliveryProofView[]> {
  const session = await requireActionRole("DRIVER");
  const proofs = await prisma.deliveryProof.findMany({
    where: { driverId: session.user.id },
    orderBy: { uploadedAt: "desc" },
  });
  return proofs.map(toView);
}

/** Review-queue precedence (D4): work that needs attention comes first;
 * decided proofs follow, grouped by outcome, newest first within each. */
const STATUS_QUEUE_RANK: Record<DeliveryProofStatus, number> = {
  PENDING: 0,
  VERIFIED: 1,
  REJECTED: 2,
};

/**
 * OWNER: the review queue (D4). With no filter: every proof, PENDING first,
 * newest first within each status. With a filter: that status only, newest
 * first. The filter is strictly validated — anything but the three known
 * statuses reads as "no filter" rather than an error, so a mistyped URL
 * degrades to the full queue instead of breaking it.
 */
export async function listAllDeliveryProofsForOwner(
  statusFilter?: string
): Promise<OwnerDeliveryProofView[]> {
  await requireActionRole("OWNER");

  const filter =
    typeof statusFilter === "string" && isStatus(statusFilter) ? statusFilter : undefined;

  const proofs = await prisma.deliveryProof.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: { uploadedAt: "desc" },
    include: ownerInclude,
  });

  const views = proofs.map(toOwnerView);
  if (!filter) {
    // Stable sort: equal ranks keep the query's newest-first order.
    views.sort((a, b) => STATUS_QUEUE_RANK[a.status] - STATUS_QUEUE_RANK[b.status]);
  }
  return views;
}

/** OWNER: one proof by id; null for unknown ids (no existence probing to
 * defend against here — owners can already list everything). */
export async function getDeliveryProofForOwner(
  proofId: string
): Promise<OwnerDeliveryProofView | null> {
  await requireActionRole("OWNER");
  if (typeof proofId !== "string" || proofId.length === 0) {
    return null;
  }
  const proof = await prisma.deliveryProof.findUnique({
    where: { id: proofId },
    include: ownerInclude,
  });
  return proof ? toOwnerView(proof) : null;
}

/**
 * The single review chokepoint for both decisions. A proof can be reviewed
 * exactly once, and only from PENDING — enforced atomically (updateMany
 * with the status in the WHERE clause), so two concurrent reviews can't
 * both win. Re-reviewing a decided proof is deliberately not supported in
 * D2; if D4's review UI needs it, that's a planned change, not a default.
 * verifiedAt records when the review happened — on rejection too.
 */
async function reviewDeliveryProof(
  proofId: unknown,
  decision: { status: "VERIFIED" | "REJECTED"; rejectionReason: string | null },
  reviewerId: string
): Promise<OwnerDeliveryProofView> {
  if (typeof proofId !== "string" || proofId.length === 0) {
    throw new Error("Delivery proof not found or already reviewed.");
  }
  const updated = await prisma.deliveryProof.updateMany({
    where: { id: proofId, status: "PENDING" },
    data: {
      status: decision.status,
      rejectionReason: decision.rejectionReason,
      verifiedAt: new Date(),
      verifiedById: reviewerId,
    },
  });
  if (updated.count === 0) {
    // Unknown id and already-reviewed look identical on purpose — the
    // caller learns the review didn't happen, nothing more.
    throw new Error("Delivery proof not found or already reviewed.");
  }
  const proof = await prisma.deliveryProof.findUniqueOrThrow({
    where: { id: proofId },
    include: ownerInclude,
  });
  return toOwnerView(proof);
}

/** OWNER: verify a pending proof. Clears any rejection reason by design. */
export async function verifyDeliveryProof(
  proofId: string
): Promise<OwnerDeliveryProofView> {
  const session = await requireActionRole("OWNER");
  return reviewDeliveryProof(
    proofId,
    { status: "VERIFIED", rejectionReason: null },
    session.user.id
  );
}

/** OWNER: reject a pending proof. A non-empty reason is required — a
 * rejection the driver can't understand is a WhatsApp argument, which is
 * exactly what this module exists to replace. */
export async function rejectDeliveryProof(
  proofId: string,
  rejectionReason: string
): Promise<OwnerDeliveryProofView> {
  const session = await requireActionRole("OWNER");

  if (typeof rejectionReason !== "string" || rejectionReason.trim().length === 0) {
    throw new Error("A rejection reason is required.");
  }
  const reason = rejectionReason.trim();
  if (reason.length > MAX_REJECTION_REASON) {
    throw new Error(`Rejection reason must be at most ${MAX_REJECTION_REASON} characters.`);
  }

  return reviewDeliveryProof(
    proofId,
    { status: "REJECTED", rejectionReason: reason },
    session.user.id
  );
}

export interface ReviewFormState {
  error?: string;
}

/**
 * Form-shaped wrappers around the D2 review actions (D4 review UI). The
 * D2 actions stay the single source of truth for transitions, atomicity,
 * and immutability — these only adapt them to useActionState: validation
 * and already-reviewed failures come back as form state; the guard runs
 * here FIRST (permanent rule) so an unauthorized caller is thrown out
 * before any form parsing, exactly like every other action.
 *
 * The proof id arrives as a hidden form field — that's resource
 * addressing, not identity: who is acting always comes from the session,
 * and the underlying action re-checks both role and state atomically.
 */
export async function verifyDeliveryProofForm(
  _prevState: ReviewFormState | undefined,
  formData: FormData
): Promise<ReviewFormState> {
  await requireActionRole("OWNER");
  try {
    await verifyDeliveryProof(String(formData.get("proofId") ?? ""));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Review failed. Please try again.",
    };
  }
  revalidatePath("/dashboard/delivery-proof");
  return {};
}

export async function rejectDeliveryProofForm(
  _prevState: ReviewFormState | undefined,
  formData: FormData
): Promise<ReviewFormState> {
  await requireActionRole("OWNER");
  try {
    await rejectDeliveryProof(
      String(formData.get("proofId") ?? ""),
      String(formData.get("rejectionReason") ?? "")
    );
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Review failed. Please try again.",
    };
  }
  revalidatePath("/dashboard/delivery-proof");
  return {};
}

export interface OcrResultInput {
  ocrStatus: unknown;
  ocrText?: unknown;
  ocrInvoiceNumber?: unknown;
  ocrCustomerName?: unknown;
  ocrConfidence?: unknown;
  ocrError?: unknown;
}

/**
 * OCR-readiness recorder (D5). No OCR engine exists yet — this is the one
 * internal, guarded write path future extraction (D6) will call, so the
 * write rules live here from day one instead of appearing with the engine:
 * strict status vocabulary, confidence clamped to [0..1], length-capped
 * text, ocrProcessedAt set server-side only for terminal states.
 *
 * OWNER-only, enforced by the guard on the first line — which is the real
 * boundary: this file is in the UI build graph, so like every exported
 * action here this one IS a registered HTTP endpoint (D5 finding: the D2
 * "unreferenced actions aren't reachable" behavior applies to whole
 * unreferenced files, not to individual unreferenced exports). No UI
 * imports or renders it; DRIVER and anonymous callers are refused before
 * any parsing, verified over the wire in D5's runtime validation.
 * DRIVER can never mutate OCR fields: there is no other write path.
 * (D6 design note: a background worker would have no session — it must
 * either mint a system identity or call the underlying logic behind its
 * own boundary. That decision belongs to D6's planning gate, not here.)
 */
export async function recordOcrResult(
  proofId: string,
  input: OcrResultInput
): Promise<OwnerDeliveryProofView> {
  await requireActionRole("OWNER");

  if (typeof proofId !== "string" || proofId.length === 0) {
    throw new Error("Delivery proof not found.");
  }
  if (typeof input?.ocrStatus !== "string" || !isOcrStatus(input.ocrStatus)) {
    throw new Error("Invalid OCR status.");
  }
  const status = input.ocrStatus;

  let confidence: number | null = null;
  if (input.ocrConfidence !== undefined && input.ocrConfidence !== null) {
    if (
      typeof input.ocrConfidence !== "number" ||
      Number.isNaN(input.ocrConfidence) ||
      input.ocrConfidence < 0 ||
      input.ocrConfidence > 1
    ) {
      throw new Error("OCR confidence must be a number between 0 and 1.");
    }
    confidence = input.ocrConfidence;
  }

  const isTerminal = status === "COMPLETED" || status === "FAILED";
  const updated = await prisma.deliveryProof.updateMany({
    where: { id: proofId },
    data: {
      ocrStatus: status,
      ocrText: normalizeOptionalText(input.ocrText, "OCR text", 20000),
      ocrInvoiceNumber: normalizeOptionalText(input.ocrInvoiceNumber, "OCR invoice number", MAX_INVOICE_NUMBER),
      ocrCustomerName: normalizeOptionalText(input.ocrCustomerName, "OCR customer name", MAX_CUSTOMER_NAME),
      ocrConfidence: confidence,
      ocrError: normalizeOptionalText(input.ocrError, "OCR error", 1000),
      ocrProcessedAt: isTerminal ? new Date() : null,
    },
  });
  if (updated.count === 0) {
    throw new Error("Delivery proof not found.");
  }

  const proof = await prisma.deliveryProof.findUniqueOrThrow({
    where: { id: proofId },
    include: ownerInclude,
  });
  return toOwnerView(proof);
}

export interface UploadDeliveryProofState {
  error?: string;
}

/**
 * DRIVER (D3): the driver portal's upload — one required image plus the
 * D2 metadata fields, in a single submission so a proof-with-photo is
 * created atomically (exactly one image per proof; there is deliberately
 * no attach-image-later or replace-image action). useActionState-shaped:
 * validation failures come back as form state, never as thrown errors.
 * The image is validated (size cap, magic-byte type sniffing) and stored
 * under a server-generated name before the row is created; if the row
 * fails, the file is cleaned up rather than orphaned.
 */
export async function uploadDeliveryProof(
  _prevState: UploadDeliveryProofState | undefined,
  formData: FormData
): Promise<UploadDeliveryProofState> {
  const session = await requireActionRole("DRIVER");

  // Validation failures carry user-facing messages by construction
  // (normalizeOptionalText / saveProofImage throw them deliberately).
  let data;
  let stored;
  try {
    data = {
      invoiceNumber: normalizeOptionalText(formData.get("invoiceNumber"), "Invoice number", MAX_INVOICE_NUMBER),
      customerName: normalizeOptionalText(formData.get("customerName"), "Customer name", MAX_CUSTOMER_NAME),
      notes: normalizeOptionalText(formData.get("notes"), "Notes", MAX_NOTES),
    };
    stored = await saveProofImage(formData.get("image"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Upload failed. Please try again.",
    };
  }

  try {
    await prisma.deliveryProof.create({
      data: {
        ...data,
        imagePath: stored.storedName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        driverId: session.user.id,
      },
    });
  } catch {
    // Database errors are never surfaced verbatim — no internals in form
    // state. The stored file is cleaned up rather than orphaned.
    await deleteProofImage(stored.storedName);
    return { error: "Upload failed. Please try again." };
  }

  revalidatePath("/driver");
  return {};
}
