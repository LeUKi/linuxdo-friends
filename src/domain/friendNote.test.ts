import { describe, expect, it } from "vitest";
import { friendNoteLength, isValidFriendNoteInput, MAX_FRIEND_NOTE_LENGTH, normalizeFriendNoteInput } from "./friendNote";

describe("friend note constraints", () => {
  it("normalizes surrounding whitespace and line breaks", () => {
    expect(normalizeFriendNoteInput("  NAS\nlab\r\nfriend  ")).toBe("NAS lab friend");
  });

  it("counts Unicode code points", () => {
    expect(friendNoteLength("佬友👋")).toBe(3);
  });

  it("accepts normalized notes up to 80 characters", () => {
    expect(isValidFriendNoteInput("")).toBe(true);
    expect(isValidFriendNoteInput(" ".repeat(120))).toBe(true);
    expect(isValidFriendNoteInput("中".repeat(MAX_FRIEND_NOTE_LENGTH))).toBe(true);
    expect(isValidFriendNoteInput("👋".repeat(MAX_FRIEND_NOTE_LENGTH))).toBe(true);
    expect(isValidFriendNoteInput("中".repeat(MAX_FRIEND_NOTE_LENGTH + 1))).toBe(false);
    expect(isValidFriendNoteInput("👋".repeat(MAX_FRIEND_NOTE_LENGTH + 1))).toBe(false);
  });
});
