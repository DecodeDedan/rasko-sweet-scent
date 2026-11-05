-- ============================================================================
-- Actor attribution for role-scoped records.
--
-- A client can submit any JSON value to an INSERT policy.  The sales
-- predicates for clients, orders and invoices rely on created_by, so accepting
-- a caller-supplied value would let a sales user hide a record from their own
-- scope or attribute it to another user.  The same issue would weaken payment
-- ownership and audit history.
--
-- Service-role and migration writes have no JWT and keep their supplied value.
-- ============================================================================

create or replace function app.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function app.stamp_actor_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger clients_stamp_actor
  before insert or update on public.clients
  for each row execute function app.stamp_actor();

create trigger orders_stamp_actor
  before insert or update on public.orders
  for each row execute function app.stamp_actor();

create trigger invoices_stamp_actor
  before insert or update on public.invoices
  for each row execute function app.stamp_actor();

create trigger payments_stamp_actor
  before insert on public.payments
  for each row execute function app.stamp_actor_append_only();
