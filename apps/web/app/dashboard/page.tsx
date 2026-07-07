import { requireSession } from "@/lib/session-guard";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
  // Server-side gate — the actual protection. Not client-side hiding: an
  // unauthenticated request never receives the dashboard markup at all.
  await requireSession();
  return <DashboardClient />;
}
