-- Admin-only account/report functions and category/settings maintenance grants.
grant insert, update on public.categories to authenticated;
grant update on public.canteen_settings to authenticated;
create policy "admin_manage_canteen_settings" on public.canteen_settings for update to authenticated
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

create or replace function public.admin_list_accounts(
  p_query text default null,
  p_role text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  id uuid,
  email text,
  full_name text,
  student_id text,
  role text,
  account_status text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_any_role(array['admin']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'Invalid pagination values' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('student', 'canteen_staff', 'admin') then
    raise exception 'Invalid role filter' using errcode = '22023';
  end if;
  return query
    select p.id, u.email::text, p.full_name, p.student_id, p.role, p.account_status, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where (p_role is null or p.role = p_role)
      and (nullif(btrim(p_query), '') is null
        or p.full_name ilike '%' || btrim(p_query) || '%'
        or coalesce(p.student_id, '') ilike '%' || btrim(p_query) || '%'
        or coalesce(u.email, '') ilike '%' || btrim(p_query) || '%')
    order by p.created_at desc, p.id
    limit p_limit offset p_offset;
end;
$$;
revoke all on function public.admin_list_accounts(text, text, integer, integer) from public, anon;
grant execute on function public.admin_list_accounts(text, text, integer, integer) to authenticated;

create or replace function public.admin_update_profile(p_target_user_id uuid, p_new_role text, p_new_status text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform public.admin_assign_profile(p_target_user_id, p_new_role, p_new_status);
  select jsonb_build_object('id', p.id, 'email', u.email, 'full_name', p.full_name,
    'student_id', p.student_id, 'role', p.role, 'account_status', p.account_status,
    'created_at', p.created_at)
    into v_result
    from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_target_user_id;
  return v_result;
end;
$$;
revoke all on function public.admin_update_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_update_profile(uuid, text, text) to authenticated;

create or replace function public.admin_daily_report(p_start_date date, p_end_date date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not public.has_any_role(array['admin']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date
    or p_end_date - p_start_date > 365 then
    raise exception 'Report date range must be valid and no longer than 366 days' using errcode = '22023';
  end if;
  v_start := p_start_date::timestamp at time zone 'UTC';
  v_end := (p_end_date + 1)::timestamp at time zone 'UTC';

  with scoped as (
    select o.* from public.orders o where o.created_at >= v_start and o.created_at < v_end
  ), metrics as (
    select count(*)::integer as orders_received,
      count(*) filter (where status in ('accepted','preparing','ready','collected'))::integer as accepted_orders,
      count(*) filter (where status = 'cancelled')::integer as cancelled_orders,
      count(*) filter (where status = 'collected' and payment_status = 'paid')::integer as completed_orders,
      coalesce(sum(total_paise) filter (where status = 'collected' and payment_status = 'paid'), 0)::bigint as gross_sales_paise,
      count(*) filter (where payment_method = 'online')::integer as online_orders,
      count(*) filter (where payment_method = 'pay_at_pickup')::integer as pay_at_pickup_orders
    from scoped
  ), daily as (
    select (created_at at time zone 'UTC')::date as report_date,
      count(*)::integer as orders_received,
      count(*) filter (where status = 'collected' and payment_status = 'paid')::integer as completed_orders,
      coalesce(sum(total_paise) filter (where status = 'collected' and payment_status = 'paid'), 0)::bigint as collected_paise
    from scoped group by (created_at at time zone 'UTC')::date order by report_date
  ), popular as (
    select oi.menu_item_id, oi.item_name, sum(oi.quantity)::bigint as quantity_sold,
      sum(oi.line_total_paise)::bigint as sales_paise
    from public.order_items oi join scoped o on o.id = oi.order_id
    where o.status = 'collected' and o.payment_status = 'paid'
    group by oi.menu_item_id, oi.item_name
    order by quantity_sold desc, oi.item_name limit 10
  )
  select jsonb_build_object(
    'timezone', 'UTC',
    'start_date', p_start_date,
    'end_date', p_end_date,
    'orders_received', m.orders_received,
    'accepted_orders', m.accepted_orders,
    'cancelled_orders', m.cancelled_orders,
    'completed_orders', m.completed_orders,
    'gross_sales_paise', m.gross_sales_paise,
    'collected_payments_paise', coalesce((select sum(p.amount_paise)::bigint from public.payments p
      join scoped o on o.id = p.order_id where p.status = 'paid' and o.status = 'collected' and o.payment_status = 'paid'), 0),
    'online_orders', m.online_orders,
    'pay_at_pickup_orders', m.pay_at_pickup_orders,
    'daily_totals', coalesce((select jsonb_agg(to_jsonb(d) order by d.report_date) from daily d), '[]'::jsonb),
    'popular_items', coalesce((select jsonb_agg(to_jsonb(pop) order by pop.quantity_sold desc, pop.item_name) from popular pop), '[]'::jsonb)
  ) into v_result from metrics m;
  return v_result;
end;
$$;
revoke all on function public.admin_daily_report(date, date) from public, anon;
grant execute on function public.admin_daily_report(date, date) to authenticated;

-- Collection at the counter is itself the authorized receipt of payment.
create or replace function public.record_counter_payment()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.payment_status is distinct from new.payment_status
    and new.payment_method = 'pay_at_pickup' and new.payment_status = 'paid' then
    insert into public.payments(order_id, provider, provider_payment_id, amount_paise, status)
      values (new.id, 'counter', 'counter:' || new.id::text, new.total_paise, 'paid')
      on conflict (provider, provider_payment_id) do nothing;
    insert into public.audit_logs(actor_user_id, action, target_type, target_id, details)
      values (auth.uid(), 'counter_payment_recorded', 'order', new.id::text,
        jsonb_build_object('amount_paise', new.total_paise));
  end if;
  return new;
end;
$$;
revoke all on function public.record_counter_payment() from public, anon, authenticated;
create trigger orders_record_counter_payment
  after update of payment_status on public.orders
  for each row execute function public.record_counter_payment();
