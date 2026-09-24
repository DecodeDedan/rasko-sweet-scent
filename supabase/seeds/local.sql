-- Local environment wiring for `supabase db reset`. No business data lives here
-- (the database starts empty and real); see config.toml [db.seed].
--
-- The database reaches the edge runtime through the API gateway on the Docker
-- network. A hosted project sets its own URL instead: docs/email-setup.md.
update app.email_dispatch
   set function_url = 'http://supabase_kong_rasko-sweetscent:8000/functions/v1/send-email';
