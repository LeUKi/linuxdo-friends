export const MAX_FRIEND_NOTE_LENGTH = 80;

export function friendNoteLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeFriendNoteInput(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function isValidFriendNoteInput(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return friendNoteLength(normalizeFriendNoteInput(value)) <= MAX_FRIEND_NOTE_LENGTH;
}
