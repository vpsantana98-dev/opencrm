import { describe, it, expect } from "vitest";
import { mergeConversations } from "./merge-conversations";
import type { Conversation } from "@/types";

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeConversations", () => {
  it("adds a new conversation coming from the refetch", () => {
    const existing = makeConversation({ id: "c1" });
    const incoming = [existing, makeConversation({ id: "c2" })];

    const result = mergeConversations([existing], incoming, null);

    expect(result.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("keeps the same object reference for an unchanged existing conversation", () => {
    const existing = makeConversation({ id: "c1" });
    const incoming = makeConversation({ id: "c1" }); // different object, same fields

    const result = mergeConversations([existing], [incoming], null);

    expect(result[0]).toBe(existing);
    expect(result[0]).not.toBe(incoming);
  });

  it("uses the new object when a field actually changed", () => {
    const existing = makeConversation({ id: "c1", last_message_text: "oi" });
    const incoming = makeConversation({ id: "c1", last_message_text: "tudo bem?" });

    const result = mergeConversations([existing], [incoming], null);

    expect(result[0]).toBe(incoming);
    expect(result[0].last_message_text).toBe("tudo bem?");
  });

  it("never lets unread_count go back up on the active conversation", () => {
    const existing = makeConversation({ id: "c1", unread_count: 0 });
    // Server still hasn't converged to 0 — a stale UPDATE arrives during
    // the refetch.
    const incoming = makeConversation({ id: "c1", unread_count: 3 });

    const result = mergeConversations([existing], [incoming], "c1");

    expect(result[0].unread_count).toBe(0);
  });

  it("keeps unread_count as-is for conversations that are not active", () => {
    const existing = makeConversation({ id: "c1", unread_count: 0 });
    const incoming = makeConversation({ id: "c1", unread_count: 3 });

    const result = mergeConversations([existing], [incoming], "other-id");

    expect(result[0].unread_count).toBe(3);
  });

  it("does not wipe existing state when incoming is empty", () => {
    const existing = [makeConversation({ id: "c1" }), makeConversation({ id: "c2" })];

    const result = mergeConversations(existing, [], null);

    expect(result).toBe(existing);
  });
});
