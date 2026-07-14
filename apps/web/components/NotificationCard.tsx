import Link from "next/link";
import type { DeliveryNotification } from "@/app/actions/delivery-notifications";

/**
 * One notification card (D8) — pure presentation over a derived event.
 * Every field is already computed server-side; this component just makes
 * the three event types visually distinct with large, mobile-first touch
 * targets. No animation, matching the driver portal's existing minimal
 * style (ProofStatusBadge, DriverSummary).
 */
const TYPE_STYLE: Record<
  DeliveryNotification["type"],
  { label: string; badgeClass: string; cardClass: string }
> = {
  VERIFIED: {
    label: "Verified",
    badgeClass: "border-accent/40 bg-accent/10 text-accent",
    cardClass: "border-line",
  },
  REJECTED: {
    label: "Rejected",
    badgeClass: "border-danger/40 bg-danger/10 text-danger",
    cardClass: "border-danger/40",
  },
  RESUBMITTED_PENDING: {
    label: "Resubmitted — Pending",
    badgeClass: "border-warn/40 bg-warn/10 text-warn",
    cardClass: "border-line",
  },
};

export default function NotificationCard({
  notification,
}: {
  notification: DeliveryNotification;
}) {
  const style = TYPE_STYLE[notification.type];
  const title = notification.invoiceNumber ?? "No invoice number";

  return (
    <Link
      href={`/driver/${notification.deliveryProofId}`}
      className={`block rounded-xl border ${style.cardClass} bg-surface-2 p-4 space-y-1.5 hover:border-accent transition ${
        notification.read ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs px-2 py-0.5 rounded-full border ${style.badgeClass}`}>
          {style.label}
        </span>
        {!notification.read && (
          <span className="h-2 w-2 rounded-full bg-accent" aria-label="unread" />
        )}
        <span className="text-xs text-ink-dim">Attempt {notification.attemptNumber}</span>
      </div>

      <p className="text-sm font-medium text-ink">
        {title}
        {notification.customerName ? ` — ${notification.customerName}` : ""}
      </p>

      {notification.type === "REJECTED" && notification.rejectionReason && (
        <p className="text-sm text-danger">Reason: {notification.rejectionReason}</p>
      )}

      <p className="text-xs text-ink-dim">{new Date(notification.eventAt).toLocaleString()}</p>
    </Link>
  );
}
