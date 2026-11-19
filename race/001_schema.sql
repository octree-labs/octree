-- Minimal DDL mirroring the tables the webhook writes to (with this change applied).
CREATE TABLE user_usage(user_id text PRIMARY KEY,is_pro boolean NOT NULL DEFAULT false,subscription_status text DEFAULT 'inactive',stripe_event_created bigint);
CREATE FUNCTION skip_stale_stripe_subscription_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.stripe_event_created IS NOT NULL AND NEW.stripe_event_created IS NOT NULL AND NEW.stripe_event_created < OLD.stripe_event_created THEN RETURN NULL; END IF; RETURN NEW; END $$;
CREATE TRIGGER skip_stale_stripe_subscription_event BEFORE UPDATE ON user_usage FOR EACH ROW EXECUTE FUNCTION skip_stale_stripe_subscription_event();
