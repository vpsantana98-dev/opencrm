import { describe, it, expect } from "vitest";
import { mergeMessages } from "./merge-messages";
import type { Message } from "@/types";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    content_text: "oi",
    status: "sent",
    created_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("mergeMessages", () => {
  it("adds a new message in the right chronological order", () => {
    const m1 = makeMessage({ id: "m1", created_at: "2026-01-01T10:00:00.000Z" });
    const m2 = makeMessage({ id: "m2", created_at: "2026-01-01T09:00:00.000Z" });

    const result = mergeMessages([m1], [m1, m2]);

    expect(result.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("keeps the same object reference for an unchanged existing message", () => {
    const existing = makeMessage({ id: "m1" });
    const incoming = makeMessage({ id: "m1" }); // different object, same fields

    const result = mergeMessages([existing], [incoming]);

    expect(result[0]).toBe(existing);
    expect(result[0]).not.toBe(incoming);
  });

  it("uses the new object when a field actually changed", () => {
    const existing = makeMessage({ id: "m1", status: "sent" });
    const incoming = makeMessage({ id: "m1", status: "delivered" });

    const result = mergeMessages([existing], [incoming]);

    expect(result[0]).toBe(incoming);
    expect(result[0].status).toBe("delivered");
  });

  it("keeps a temp- bubble alive across a merge that doesn't contain it", () => {
    const temp = makeMessage({
      id: "temp-1",
      sender_type: "agent",
      content_text: "ainda enviando",
      status: "sending",
    });
    const other = makeMessage({ id: "m2", content_text: "outra mensagem" });

    const result = mergeMessages([temp], [other]);

    expect(result.some((m) => m.id === "temp-1")).toBe(true);
    expect(result.some((m) => m.id === "m2")).toBe(true);
  });

  it("replaces a temp- bubble once the matching real message arrives", () => {
    const temp = makeMessage({
      id: "temp-1",
      sender_type: "agent",
      content_type: "text",
      content_text: "oi cliente",
      status: "sending",
    });
    const real = makeMessage({
      id: "real-1",
      sender_type: "agent",
      content_type: "text",
      content_text: "oi cliente",
      status: "sent",
    });

    const result = mergeMessages([temp], [real]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(real);
    expect(result.some((m) => m.id === "temp-1")).toBe(false);
  });

  it("does not wipe existing state when incoming is empty", () => {
    const existing = [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })];

    const result = mergeMessages(existing, []);

    expect(result).toBe(existing);
  });
});
