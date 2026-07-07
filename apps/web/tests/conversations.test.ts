import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
// revalidatePath needs Next's real request/static-generation context, which
// doesn't exist under plain Vitest — same category as mocking redirect() in
// session-guard.test.ts. The actions' own logic (the part under test) never
// depends on what this returns.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import {
  createConversation,
  listConversations,
  loadConversation,
  renameConversation,
  deleteConversation,
  appendMessage,
  ensureInitialConversation,
} from "@/app/actions/conversations";
import { prisma } from "@/lib/db";

const mockedAuth = vi.mocked(auth);

function mockSessionFor(userId: string) {
  mockedAuth.mockResolvedValue({
    user: { id: userId, name: "Test User" },
    expires: "2099-01-01",
  } as never);
}

// Unique per test run so this suite never collides with leftover data from a
// prior (possibly interrupted) run against the same test SQLite file.
const RUN = Date.now();
const USER_A = `test-user-a-${RUN}`;
const USER_B = `test-user-b-${RUN}`;

afterAll(async () => {
  // Cascades to each user's conversations and messages via onDelete: Cascade.
  await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
});

describe("conversation CRUD", () => {
  it("creates a conversation owned by the current user", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("My First Chat");
    expect(conv.title).toBe("My First Chat");
    expect(conv.id).toBeTruthy();
    expect(Number.isNaN(new Date(conv.createdAt).getTime())).toBe(false);
  });

  it("defaults the title to 'New Chat' when none is given", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation();
    expect(conv.title).toBe("New Chat");
  });

  it("lists only the current user's conversations, newest-updated first", async () => {
    mockSessionFor(USER_A);
    const first = await createConversation("List-First");
    await new Promise((r) => setTimeout(r, 5));
    const second = await createConversation("List-Second");

    const list = await listConversations();
    const ids = list.map((c) => c.id);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it("loads a conversation with its messages in chronological order", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("With messages");
    await appendMessage(conv.id, "user", "how much does Apple Mart owe?");
    await appendMessage(conv.id, "assistant", "## Balance\n...");

    const loaded = await loadConversation(conv.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0]).toMatchObject({
      role: "user",
      content: "how much does Apple Mart owe?",
    });
    expect(loaded!.messages[1]).toMatchObject({ role: "assistant" });
  });

  it("appending a message bumps the conversation's updatedAt (sidebar re-sort)", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("Bump check");
    const before = conv.updatedAt;
    await new Promise((r) => setTimeout(r, 10));
    await appendMessage(conv.id, "user", "hi");
    const loaded = await loadConversation(conv.id);
    expect(new Date(loaded!.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("renames a conversation", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("Old Title");
    await renameConversation(conv.id, "New Title");
    const loaded = await loadConversation(conv.id);
    expect(loaded!.title).toBe("New Title");
  });

  it("rejects an empty/whitespace-only rename", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("Keep Me");
    await expect(renameConversation(conv.id, "   ")).rejects.toThrow();
  });

  it("deletes a conversation and cascades to its messages", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("To Delete");
    await appendMessage(conv.id, "user", "hello");

    await deleteConversation(conv.id);

    expect(await loadConversation(conv.id)).toBeNull();
    const orphaned = await prisma.message.findMany({
      where: { conversationId: conv.id },
    });
    expect(orphaned).toHaveLength(0);
  });

  it("persists only role/content/timestamp — no tool internals", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("Schema check");
    const saved = await appendMessage(conv.id, "assistant", "## Business Alerts\n...");
    expect(Object.keys(saved).sort()).toEqual(["content", "id", "role", "timestamp"]);
  });
});

describe("ensureInitialConversation — render-safe auto-create", () => {
  // This is the function app/dashboard/page.tsx calls during its own server
  // render. Unlike createConversation(), it must never call revalidatePath —
  // Next.js forbids revalidating the route that's currently rendering.
  it("creates a conversation when the user has none yet", async () => {
    const freshUser = `test-user-fresh-${Date.now()}`;
    mockSessionFor(freshUser);
    const result = await ensureInitialConversation();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("New Chat");
    await prisma.user.deleteMany({ where: { id: freshUser } });
  });

  it("returns the existing list unchanged when conversations already exist", async () => {
    mockSessionFor(USER_A);
    const before = await listConversations();
    const result = await ensureInitialConversation();
    expect(result.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  });
});

describe("ownership enforcement", () => {
  it("user B cannot load user A's conversation", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("A's private chat");

    mockSessionFor(USER_B);
    expect(await loadConversation(conv.id)).toBeNull();
  });

  it("user B cannot rename user A's conversation", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("A's chat");

    mockSessionFor(USER_B);
    await expect(renameConversation(conv.id, "Hijacked")).rejects.toThrow("not found");
  });

  it("user B cannot delete user A's conversation", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("A's chat to protect");

    mockSessionFor(USER_B);
    await expect(deleteConversation(conv.id)).rejects.toThrow("not found");

    mockSessionFor(USER_A);
    expect(await loadConversation(conv.id)).not.toBeNull();
  });

  it("user B cannot append messages to user A's conversation", async () => {
    mockSessionFor(USER_A);
    const conv = await createConversation("A's chat");

    mockSessionFor(USER_B);
    await expect(appendMessage(conv.id, "user", "sneaky")).rejects.toThrow("not found");
  });

  it("user B's conversation list never includes user A's conversations", async () => {
    mockSessionFor(USER_A);
    await createConversation("A only, unique marker");

    mockSessionFor(USER_B);
    const listB = await listConversations();
    expect(listB.some((c) => c.title === "A only, unique marker")).toBe(false);
  });

  it("throws when there is no session at all (no user id to own anything)", async () => {
    mockedAuth.mockResolvedValue(null);
    await expect(listConversations()).rejects.toThrow(/not authenticated/i);
  });
});
