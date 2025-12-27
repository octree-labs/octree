// Admin email whitelist
export const ADMIN_EMAILS = [
  'basilyusuf1709@gmail.com',
  'rascodes123@gmail.com',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase() as (typeof ADMIN_EMAILS)[number]);
}

