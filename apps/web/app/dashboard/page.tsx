import { requireSession } from "@/lib/session-guard";
import DashboardClient from "@/components/DashboardClient";
import { ensureInitialConversation, loadConversation } from "@/app/actions/conversations";

export default async function DashboardPage() {
  // Server-side gate — the actual protection. Not client-side hiding: an
  // unauthenticated request never receives the dashboard markup at all.
  await requireSession();

  // Not createConversation() here deliberately — that action calls
  // revalidatePath("/dashboard"), which Next.js forbids while /dashboard
  // itself is rendering.
  const conversations = await ensureInitialConversation();
  const activeId = conversations[0].id;
  const active = await loadConversation(activeId);

  return (
    <DashboardClient
      initialConversations={conversations}
      initialActiveId={activeId}
      initialMessages={active?.messages ?? []}
    />
  );
}
