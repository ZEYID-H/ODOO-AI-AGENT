import { requireSession } from "@/lib/session-guard";
import DashboardClient from "@/components/DashboardClient";
import { createConversation, listConversations, loadConversation } from "@/app/actions/conversations";

export default async function DashboardPage() {
  // Server-side gate — the actual protection. Not client-side hiding: an
  // unauthenticated request never receives the dashboard markup at all.
  await requireSession();

  let conversations = await listConversations();
  if (conversations.length === 0) {
    const first = await createConversation();
    conversations = [first];
  }

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
