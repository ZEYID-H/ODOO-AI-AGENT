"use server";

/**
 * Conversation persistence — pure storage/CRUD, no AI logic. Nothing here
 * calls route_query(), the FastAPI backend, or any tool. That stays exactly
 * where it already was (lib/api.ts, called client-side from
 * components/DashboardClient.tsx); these actions only save/load what was
 * said, keyed to the authenticated user.
 *
 * Every action re-derives the user id from the server-side session and
 * every read/write is scoped to it — a client can never pass a userId, and
 * a conversation ID that exists but belongs to someone else is treated
 * identically to one that doesn't exist at all (see findOwnedConversation).
 */

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ConversationWithMessages extends ConversationSummary {
  messages: PersistedMessage[];
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated.");
  }
  return session.user.id;
}

/** Idempotent: creates the User row on first use for the current session. */
async function ensureUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });
}

function toSummary(c: {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function toMessage(m: {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
}): PersistedMessage {
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    timestamp: m.timestamp.toISOString(),
  };
}

/**
 * The single ownership chokepoint. Returns null both when the conversation
 * doesn't exist and when it belongs to a different user — callers must
 * never be able to tell those two cases apart, or a conversation ID becomes
 * a probe for other users' data.
 */
async function findOwnedConversation(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
}

async function insertConversation(
  userId: string,
  title: string
): Promise<ConversationSummary> {
  await ensureUser(userId);
  const conversation = await prisma.conversation.create({
    data: { title, userId },
  });
  return toSummary(conversation);
}

export async function createConversation(
  title: string = "New Chat"
): Promise<ConversationSummary> {
  const userId = await requireUserId();
  const summary = await insertConversation(userId, title);
  revalidatePath("/dashboard");
  return summary;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const userId = await requireUserId();
  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return conversations.map(toSummary);
}

/**
 * Used only by app/dashboard/page.tsx during its own server render. Next.js
 * forbids calling revalidatePath while the route it targets is rendering
 * ("used during render") — and there's nothing to revalidate anyway, since
 * the page already has the fresh row it just created for this request.
 * createConversation() (above) stays the one used by client-triggered
 * "New Chat" clicks, where revalidatePath is the correct, supported call.
 */
export async function ensureInitialConversation(): Promise<ConversationSummary[]> {
  const userId = await requireUserId();
  const existing = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  if (existing.length > 0) {
    return existing.map(toSummary);
  }
  const created = await insertConversation(userId, "New Chat");
  return [created];
}

export async function loadConversation(
  conversationId: string
): Promise<ConversationWithMessages | null> {
  const userId = await requireUserId();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { timestamp: "asc" } } },
  });
  if (!conversation) return null;
  return {
    ...toSummary(conversation),
    messages: conversation.messages.map(toMessage),
  };
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<void> {
  const userId = await requireUserId();
  const owned = await findOwnedConversation(conversationId, userId);
  if (!owned) {
    throw new Error("Conversation not found.");
  }
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Title cannot be empty.");
  }
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title: trimmed },
  });
  revalidatePath("/dashboard");
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const userId = await requireUserId();
  const owned = await findOwnedConversation(conversationId, userId);
  if (!owned) {
    throw new Error("Conversation not found.");
  }
  await prisma.conversation.delete({ where: { id: conversationId } });
  revalidatePath("/dashboard");
}

/**
 * Persists exactly role/content/timestamp — deliberately no tool name, no
 * parameters, no formatted-vs-lightweight distinction. Those are UI/API
 * concerns (see lib/history.ts), not persistence concerns. Also bumps the
 * conversation's updatedAt so the sidebar list re-sorts by recency.
 */
export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string
): Promise<PersistedMessage> {
  const userId = await requireUserId();
  const owned = await findOwnedConversation(conversationId, userId);
  if (!owned) {
    throw new Error("Conversation not found.");
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({ data: { conversationId, role, content } }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    }),
  ]);
  return toMessage(message);
}
