const UNLIMITED_EDIT_EMAILS = [
  'rascodes123@gmail.com',
  'basilyusuf1709@gmail.com',
  'zainsajidnust@gmail.com',
  'faizmustansar10@gmail.com',
  'boriskurikhin@gmail.com',
] as const;

const unlimitedEmailSet = new Set(
  UNLIMITED_EDIT_EMAILS.map((email) => email.toLowerCase())
);

export function hasUnlimitedEdits(email?: string | null): boolean {
  if (!email) {
    return false;
  }

  return unlimitedEmailSet.has(email.toLowerCase());
}

export const unlimitedEditEmails = UNLIMITED_EDIT_EMAILS;
