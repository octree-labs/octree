-- Billing recovery emails (dunning and abandoned checkout), PR feat/billing-recovery.
--
-- The lifecycle ledger (20261018130000_lifecycle_emails.sql) keyed one row
-- per (user, template): fine for the four scheduled templates, which go out
-- at most once per person, but a payment-failed notice must go out once per
-- *invoice* and a checkout-recovery email once per *Checkout Session*. So:
--
--   ref      the Stripe object the send is about: the invoice id for
--            payment_failed / payment_failed_reminder, the Checkout Session
--            id for checkout_recovery / checkout_recovery_offer. '' for the
--            scheduled templates, which keeps them one-per-user.
--   payload  what the follow-up needs at send time (recovery url, plan,
--            amount, subscription id), so the cron can send the 48h / 5d
--            reminder without re-deriving it.
--
-- The unique key becomes (user_id, template, ref). Existing rows get
-- ref = '' and stay unique under the new key. Everything here is idempotent;
-- the user_usage column guard (20261018110000) is untouched.
--
-- Until this is applied, app code that writes the new columns fails: the
-- Stripe webhook logs and continues (no email, never a 500), and the
-- lifecycle cron refuses a live run with "lifecycle tables missing", exactly
-- as it does without the ledger table.

alter table public.lifecycle_emails add column if not exists ref text not null default '';
alter table public.lifecycle_emails add column if not exists payload jsonb;

alter table public.lifecycle_emails drop constraint if exists lifecycle_emails_user_id_template_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lifecycle_emails_user_id_template_ref_key'
      and conrelid = 'public.lifecycle_emails'::regclass
  ) then
    alter table public.lifecycle_emails
      add constraint lifecycle_emails_user_id_template_ref_key unique (user_id, template, ref);
  end if;
end
$$;

-- The follow-up selection reads sent rows by template; small table, but the
-- cron runs daily over all of it.
create index if not exists lifecycle_emails_template_sent_at_idx
  on public.lifecycle_emails (template, sent_at);

-- Retry claim, now keyed on ref as well. The 4-argument version is dropped
-- rather than overloaded: PostgREST (and Postgres) could not pick between
-- the two for a call that omits p_ref.
drop function if exists public.claim_lifecycle_retry(uuid, text, text, integer);

create or replace function public.claim_lifecycle_retry(
  p_user_id uuid,
  p_template text,
  p_email text,
  p_max_attempts integer,
  p_ref text default ''
) returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    update public.lifecycle_emails
       set error = null,
           attempts = attempts + 1,
           sent_at = now(),
           email = p_email
     where user_id = p_user_id
       and template = p_template
       and ref = coalesce(p_ref, '')
       and resend_id is null
       and error is not null
       and attempts < p_max_attempts
    returning id
  )
  select exists (select 1 from taken);
$$;

revoke execute on function public.claim_lifecycle_retry(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.claim_lifecycle_retry(uuid, text, text, integer, text) to service_role;
