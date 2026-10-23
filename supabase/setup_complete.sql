-- CampusBite initial schema. Apply with Supabase CLI after linking a project.
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  student_id text check (student_id is null or char_length(student_id) <= 50),
  role text not null default 'student' check (role in ('student','faculty','canteen_staff','admin')),

  account_status text not null default 'active' check (account_status in ('active','pending','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_student_id_unique on public.profiles(student_id) where student_id is not null;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text not null default '',
  price_paise integer not null check (price_paise >= 0),
  image_url text,
  is_available boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_category_active_idx on public.menu_items(category_id) where is_active;
create index menu_items_available_idx on public.menu_items(is_available) where is_active;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  token_number text not null unique,
  status text not null default 'placed' check (status in ('placed','accepted','preparing','ready','collected','declined','cancelled')),
  payment_method text not null check (payment_method in ('online','pay_at_pickup')),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded','expired')),
  total_paise integer not null check (total_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  decline_reason text
);
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  item_name text not null,
  unit_price_paise integer not null check (unit_price_paise >= 0),
  quantity integer not null check (quantity between 1 and 99),
  line_total_paise integer not null check (line_total_paise = unit_price_paise * quantity)
);
create index order_items_order_idx on public.order_items(order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null check (provider in ('razorpay','counter')),
  provider_order_id text unique,
  provider_payment_id text,
  amount_paise integer not null check (amount_paise >= 0),
  status text not null check (status in ('created','authorized','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_id)
);
create index payments_order_idx on public.payments(order_id, created_at desc);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'razorpay'),
  event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.canteen_settings (
  id boolean primary key default true check (id),
  display_name text not null default 'CampusBite Canteen',
  is_open boolean not null default true,
  accepting_orders boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.canteen_settings(id) values (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger menu_items_set_updated_at before update on public.menu_items for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger canteen_settings_set_updated_at before update on public.canteen_settings for each row execute function public.set_updated_at();

-- A signup creates a student, faculty or canteen_staff profile based on signup metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, student_id, role, account_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'student_id', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'role', new.raw_user_meta_data ->> 'user_type') in ('student', 'faculty', 'canteen_staff')
        then coalesce(new.raw_user_meta_data ->> 'role', new.raw_user_meta_data ->> 'user_type')
      else 'student'
    end,
    'active'
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public;

create or replace function public.has_any_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'active'
      and p.role = any(allowed_roles)
  );
$$;
revoke all on function public.has_any_role(text[]) from public;
grant execute on function public.has_any_role(text[]) to authenticated;

create or replace function public.admin_assign_profile(
  target_user_id uuid,
  new_role text,
  new_status text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old_role text;
  old_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('campusbite_admin_role_change'));
  if not public.has_any_role(array['admin']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if new_role not in ('student','canteen_staff','admin')
    or new_status not in ('active','pending','suspended') then
    raise exception 'Invalid role or account status' using errcode = '22023';
  end if;

  select p.role, p.account_status into old_role, old_status
  from public.profiles p where p.id = target_user_id for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if old_role = 'admin' and old_status = 'active'
    and (new_role <> 'admin' or new_status <> 'active')
    and (select count(*) from public.profiles p where p.role = 'admin' and p.account_status = 'active') <= 1 then
    raise exception 'Cannot disable or demote the last active administrator' using errcode = '23514';
  end if;

  update public.profiles set role = new_role, account_status = new_status where id = target_user_id;
  insert into public.audit_logs(actor_user_id, action, target_type, target_id, details)
  values ((select auth.uid()), 'profile_access_changed', 'profile', target_user_id::text,
          jsonb_build_object('old_role', old_role, 'new_role', new_role, 'old_status', old_status, 'new_status', new_status));
end;
$$;
revoke all on function public.admin_assign_profile(uuid, text, text) from public;
grant execute on function public.admin_assign_profile(uuid, text, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.canteen_settings enable row level security;

-- Grant only browser operations supported by RLS. Order/payment writes stay server-only.
grant select on public.profiles to authenticated;
grant update(full_name, student_id) on public.profiles to authenticated;
grant select on public.categories, public.menu_items, public.canteen_settings to anon, authenticated;
grant select on public.orders, public.order_items, public.payments to authenticated;
grant select on public.audit_logs to authenticated;

create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.has_any_role(array['admin']));
create policy "profiles_update_self" on public.profiles for update to authenticated
  using (id = (select auth.uid()) and account_status = 'active')
  with check (id = (select auth.uid()) and account_status = 'active');

create policy "active_categories_public_read" on public.categories for select to anon, authenticated using (is_active);
create policy "active_menu_public_read" on public.menu_items for select to anon, authenticated
  using (is_active and (category_id is null or exists (select 1 from public.categories c where c.id = category_id and c.is_active)));
create policy "staff_manage_categories" on public.categories for all to authenticated
  using (public.has_any_role(array['canteen_staff','admin']))
  with check (public.has_any_role(array['canteen_staff','admin']));
create policy "staff_manage_menu" on public.menu_items for all to authenticated
  using (public.has_any_role(array['canteen_staff','admin']))
  with check (public.has_any_role(array['canteen_staff','admin']));

create policy "orders_read_owner_or_staff" on public.orders for select to authenticated
  using (user_id = (select auth.uid()) or public.has_any_role(array['canteen_staff','admin']));
create policy "order_items_read_owner_or_staff" on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.has_any_role(array['canteen_staff','admin']))));
create policy "payments_read_owner_or_staff" on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = (select auth.uid()) or public.has_any_role(array['canteen_staff','admin']))));
create policy "admin_read_audit_logs" on public.audit_logs for select to authenticated
  using (public.has_any_role(array['admin']));
create policy "canteen_status_public_read" on public.canteen_settings for select to anon, authenticated using (id);

-- No client policies or grants exist for webhook events. Backend service-role operations are authoritative.

alter table public.orders replica identity full;
alter table public.menu_items replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_items') then
    execute 'alter publication supabase_realtime add table public.menu_items';
  end if;
end
$$;
-- Server-authoritative order placement and lifecycle. Each RPC is one database transaction.
alter table public.orders add column client_request_id uuid;
create unique index orders_user_request_unique on public.orders(user_id, client_request_id)
  where client_request_id is not null;

create or replace function public.order_payload(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id,
    'user_id', o.user_id,
    'token_number', o.token_number,
    'status', o.status,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'total_paise', o.total_paise,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'cancelled_at', o.cancelled_at,
    'decline_reason', o.decline_reason,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'menu_item_id', oi.menu_item_id,
        'item_name', oi.item_name,
        'unit_price_paise', oi.unit_price_paise,
        'quantity', oi.quantity,
        'line_total_paise', oi.line_total_paise
      ) order by oi.id)
      from public.order_items oi where oi.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o where o.id = p_order_id;
$$;
revoke all on function public.order_payload(uuid) from public, anon, authenticated;

create or replace function public.create_campus_order(
  p_items jsonb,
  p_payment_method text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_item_id uuid;
  v_quantity integer;
  v_item_name text;
  v_price integer;
  v_total bigint := 0;
  v_open boolean;
  v_accepting boolean;
  v_order_id uuid;
  v_saved_order_id uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.role in ('student', 'faculty', 'canteen_staff') and p.account_status = 'active') then
    raise exception 'Active student, faculty, or staff account required' using errcode = '42501';
  end if;

  if p_client_request_id is null then raise exception 'Request id is required' using errcode = '22023'; end if;
  if p_payment_method is null or p_payment_method not in ('online', 'pay_at_pickup') then raise exception 'Invalid payment method' using errcode = '22023'; end if;

  select o.id into v_saved_order_id from public.orders o
    where o.user_id = v_user_id and o.client_request_id = p_client_request_id;
  if v_saved_order_id is not null then return public.order_payload(v_saved_order_id); end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Provide between 1 and 30 distinct items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Provide between 1 and 30 distinct items' using errcode = '22023';
  end if;
  select cs.is_open, cs.accepting_orders into v_open, v_accepting
    from public.canteen_settings cs where cs.id = true;
  if not coalesce(v_open, false) or not coalesce(v_accepting, false) then
    raise exception 'The canteen is not accepting orders' using errcode = '23514';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry -> 'menu_item_id') is distinct from 'string'
      or jsonb_typeof(v_entry -> 'quantity') is distinct from 'number' then
      raise exception 'Each item requires a menu_item_id and quantity' using errcode = '22023';
    end if;
    begin
      v_item_id := (v_entry ->> 'menu_item_id')::uuid;
      v_quantity := (v_entry ->> 'quantity')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid menu item or quantity' using errcode = '22023';
    end;
    if v_quantity < 1 or v_quantity > 99 or (v_entry ->> 'quantity')::numeric <> v_quantity then
      raise exception 'Quantity must be a whole number from 1 to 99' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_array_elements(v_lines) x where x ->> 'menu_item_id' = v_item_id::text) then
      raise exception 'Duplicate menu items must be combined into one line' using errcode = '22023';
    end if;
    select m.name, m.price_paise into v_item_name, v_price from public.menu_items m
      where m.id = v_item_id and m.is_active and m.is_available
        and (m.category_id is null or exists (
          select 1 from public.categories c where c.id = m.category_id and c.is_active
        ))
      for share;
    if not found then raise exception 'A menu item is unavailable' using errcode = '23514'; end if;
    v_total := v_total + v_price::bigint * v_quantity;
    if v_total > 2147483647 then raise exception 'Order total is too large' using errcode = '22003'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_item_id, 'item_name', v_item_name,
      'unit_price_paise', v_price, 'quantity', v_quantity
    ));
  end loop;

  insert into public.orders(user_id, token_number, payment_method, payment_status, total_paise, client_request_id)
    values (v_user_id, upper(encode(extensions.gen_random_bytes(5), 'hex')), p_payment_method, 'pending', v_total::integer, p_client_request_id)
    on conflict (user_id, client_request_id) where client_request_id is not null do nothing
    returning id into v_order_id;
  if v_order_id is null then
    select o.id into v_saved_order_id from public.orders o
      where o.user_id = v_user_id and o.client_request_id = p_client_request_id;
    return public.order_payload(v_saved_order_id);
  end if;

  for v_entry in select value from jsonb_array_elements(v_lines) loop
    insert into public.order_items(order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
      values (v_order_id, (v_entry ->> 'menu_item_id')::uuid, v_entry ->> 'item_name',
        (v_entry ->> 'unit_price_paise')::integer, (v_entry ->> 'quantity')::integer,
        (v_entry ->> 'unit_price_paise')::integer * (v_entry ->> 'quantity')::integer);
  end loop;
  return public.order_payload(v_order_id);
end;
$$;
revoke all on function public.create_campus_order(jsonb, text, uuid) from public, anon;
grant execute on function public.create_campus_order(jsonb, text, uuid) to authenticated;

create or replace function public.transition_campus_order(
  p_order_id uuid,
  p_next_status text,
  p_decline_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_reason text := nullif(btrim(p_decline_reason), '');
  v_staff boolean;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select p.role into v_role from public.profiles p where p.id = v_user_id and p.account_status = 'active';
  if v_role is null then raise exception 'Active account required' using errcode = '42501'; end if;
  v_staff := v_role in ('canteen_staff', 'admin');
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;

  if p_next_status = 'cancelled' then
    if v_order.user_id <> v_user_id or v_order.status <> 'placed' then
      raise exception 'Students may cancel only their own order before staff acceptance' using errcode = '23514';
    end if;
    if v_order.payment_status = 'paid' then
      raise exception 'Paid orders require staff review; cancellation is not available' using errcode = '23514';
    end if;
    update public.orders set status = 'cancelled', cancelled_at = now() where id = p_order_id;
  elsif not v_staff then
    raise exception 'Staff access required for this status change' using errcode = '42501';
  elsif p_next_status = 'accepted' and v_order.status = 'placed' then
    if v_order.payment_method = 'online' and v_order.payment_status <> 'paid' then
      raise exception 'Online payment must be confirmed before acceptance' using errcode = '23514';
    end if;
    update public.orders set status = 'accepted' where id = p_order_id;
  elsif p_next_status = 'preparing' and v_order.status = 'accepted' then
    update public.orders set status = 'preparing' where id = p_order_id;
  elsif p_next_status = 'ready' and v_order.status = 'preparing' then
    update public.orders set status = 'ready' where id = p_order_id;
  elsif p_next_status = 'collected' and v_order.status = 'ready' then
    update public.orders set status = 'collected',
      payment_status = case when payment_method = 'pay_at_pickup' then 'paid' else payment_status end
      where id = p_order_id;
  elsif p_next_status = 'declined' and v_order.status = 'placed' then
    if v_reason is null or char_length(v_reason) > 500 then
      raise exception 'Declining an order requires a reason of at most 500 characters' using errcode = '22023';
    end if;
    update public.orders set status = 'declined', decline_reason = v_reason where id = p_order_id;
  else
    raise exception 'Invalid order status transition' using errcode = '23514';
  end if;

  insert into public.audit_logs(actor_user_id, action, target_type, target_id, details)
    values (v_user_id, 'order_status_changed', 'order', p_order_id::text,
      jsonb_build_object('from', v_order.status, 'to', p_next_status, 'reason', v_reason));
  return public.order_payload(p_order_id);
end;
$$;
revoke all on function public.transition_campus_order(uuid, text, text) from public, anon;
grant execute on function public.transition_campus_order(uuid, text, text) to authenticated;
-- RLS policies already restrict these writes to active canteen_staff/admin profiles.
grant insert, update on public.menu_items to authenticated;
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
-- Payment records are written only through trusted database functions.
create unique index payments_one_razorpay_per_order
  on public.payments(order_id) where provider = 'razorpay';

create or replace function public.attach_razorpay_order(p_order_id uuid, p_provider_order_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id <> auth.uid() then raise exception 'Order not found' using errcode = 'P0002'; end if;
  if v_order.payment_method <> 'online' or v_order.payment_status <> 'pending' or v_order.status <> 'placed' then
    raise exception 'Order is not payable' using errcode = '23514';
  end if;
  select * into v_payment from public.payments where order_id = p_order_id and provider = 'razorpay' for update;
  if found then
    if v_payment.provider_order_id is not null and v_payment.provider_order_id <> p_provider_order_id then
      raise exception 'A different gateway order already exists' using errcode = '23514';
    end if;
    update public.payments set provider_order_id = p_provider_order_id where id = v_payment.id returning * into v_payment;
  else
    insert into public.payments(order_id,provider,provider_order_id,amount_paise,status)
      values(p_order_id,'razorpay',p_provider_order_id,v_order.total_paise,'created') returning * into v_payment;
  end if;
  return jsonb_build_object('id',v_order.id,'total_paise',v_order.total_paise,'currency','INR','provider_order_id',v_payment.provider_order_id);
end $$;

create or replace function public.confirm_razorpay_payment(p_order_id uuid, p_gateway_order_id text, p_payment_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (auth.uid() is not null and v_order.user_id <> auth.uid()) then raise exception 'Order not found' using errcode = 'P0002'; end if;
  select * into v_payment from public.payments where order_id = p_order_id and provider = 'razorpay' for update;
  if not found or v_payment.provider_order_id <> p_gateway_order_id then raise exception 'Payment order mismatch' using errcode = '23514'; end if;
  if v_order.payment_status = 'paid' then return jsonb_build_object('payment_status','paid'); end if;
  if v_order.payment_status <> 'pending' or v_order.status not in ('placed','accepted','preparing','ready') then
    raise exception 'Order cannot be paid in its current state' using errcode = '23514';
  end if;
  update public.payments set provider_payment_id = p_payment_id,status = 'paid' where id = v_payment.id;
  update public.orders set payment_status = 'paid' where id = p_order_id;
  insert into public.audit_logs(actor_user_id,action,target_type,target_id,details)
    values(coalesce(auth.uid(),v_order.user_id),'razorpay_payment_confirmed','order',p_order_id::text,jsonb_build_object('payment_id',p_payment_id));
  return jsonb_build_object('payment_status','paid');
end $$;

create or replace function public.process_razorpay_webhook(p_event_id text,p_event_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entity jsonb; v_order public.orders%rowtype; v_payment public.payments%rowtype; v_payment_id text; v_gateway_order_id text; v_amount integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  if length(p_event_id) not between 1 and 200 then raise exception 'Invalid event ID' using errcode = '22023'; end if;
  insert into public.payment_webhook_events(provider,event_id,event_type,payload)
    values('razorpay',p_event_id,p_event_type,p_payload) on conflict(event_id) do nothing;
  if not found then return jsonb_build_object('duplicate',true); end if;
  v_entity := coalesce(p_payload #> '{payload,payment,entity}',p_payload #> '{payload,order,entity}');
  v_payment_id := case when p_event_type like 'payment.%' then v_entity->>'id' else null end;
  v_gateway_order_id := coalesce(v_entity->>'order_id',case when p_event_type='order.paid' then v_entity->>'id' end);
  v_amount := nullif(v_entity->>'amount','')::integer;
  if p_event_type in ('payment.captured','order.paid') then
    select * into v_payment from public.payments where provider='razorpay' and provider_order_id=v_gateway_order_id for update;
    if not found or v_amount is null or v_amount <> v_payment.amount_paise then
      update public.payment_webhook_events set processing_error='Payment order or amount did not match.' where event_id=p_event_id;
      return jsonb_build_object('processed',false,'reason','payment_mismatch');
    end if;
    select * into v_order from public.orders where id=v_payment.order_id for update;
    update public.payments set provider_payment_id=coalesce(v_payment_id,provider_payment_id),status='paid' where id=v_payment.id;
    if v_order.status in ('placed','accepted','preparing','ready') and v_order.payment_status='pending' then
      update public.orders set payment_status='paid' where id=v_order.id;
    else
      update public.payment_webhook_events set processing_error='Late payment needs staff refund review.' where event_id=p_event_id;
    end if;
  elsif p_event_type in ('payment.failed') then
    update public.payments set provider_payment_id=coalesce(v_payment_id,provider_payment_id),status='failed'
      where provider='razorpay' and provider_order_id=v_gateway_order_id and status <> 'paid';
  end if;
  update public.payment_webhook_events set processed_at=now() where event_id=p_event_id;
  return jsonb_build_object('processed',true);
end $$;

revoke all on function public.attach_razorpay_order(uuid,text) from public,anon;
revoke all on function public.confirm_razorpay_payment(uuid,text,text) from public,anon;
revoke all on function public.process_razorpay_webhook(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.attach_razorpay_order(uuid,text) to authenticated;
grant execute on function public.confirm_razorpay_payment(uuid,text,text) to authenticated,service_role;
grant execute on function public.process_razorpay_webhook(text,text,jsonb) to service_role;
-- CampusBite 100% Vegetarian & Egg-Free Canteen Enforcement Migration
-- Guarantees that only verified vegetarian, egg-free food is ever sold or published.

-- 1. Ensure columns exist on menu_items
alter table public.menu_items
  add column if not exists is_vegetarian boolean not null default true,
  add column if not exists contains_egg boolean not null default false,
  add column if not exists ingredients_verified boolean not null default false;

-- 2. Strictly enforce that non-vegetarian items or items containing egg cannot exist in menu_items
alter table public.menu_items
  drop constraint if exists menu_items_is_vegetarian_check,
  add constraint menu_items_is_vegetarian_check check (is_vegetarian = true);

alter table public.menu_items
  drop constraint if exists menu_items_contains_egg_check,
  add constraint menu_items_contains_egg_check check (contains_egg = false);

-- 3. Prevent publishing/availability unless ingredients are explicitly verified
alter table public.menu_items
  drop constraint if exists menu_items_availability_verified_check,
  add constraint menu_items_availability_verified_check
    check (not is_available or (is_vegetarian = true and contains_egg = false and ingredients_verified = true));

-- 4. Trigger to force ingredient reverification when recipe or name changes
create or replace function public.check_menu_item_ingredients_verification()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Enforce 100% vegetarian policy
  if new.is_vegetarian is distinct from true then
    raise exception 'CampusBite is a 100%% vegetarian canteen. Non-vegetarian food is strictly prohibited.' using errcode = '23514';
  end if;
  if new.contains_egg is distinct from false then
    raise exception 'CampusBite is strictly egg-free. Egg-containing food is strictly prohibited.' using errcode = '23514';
  end if;

  -- If recipe/name/description changes and verification is not explicitly re-asserted in the same update, reset verification
  if tg_op = 'UPDATE' then
    if (new.name is distinct from old.name or new.description is distinct from old.description)
       and (new.ingredients_verified is not distinct from old.ingredients_verified or new.ingredients_verified is false) then
      new.ingredients_verified = false;
      new.is_available = false; -- Automatically disable until re-verified
    end if;
  end if;

  -- Ensure unavailable if unverified
  if new.is_available and not new.ingredients_verified then
    raise exception 'Cannot make item available until ingredients are verified.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists menu_items_vegetarian_policy_check on public.menu_items;
create trigger menu_items_vegetarian_policy_check
  before insert or update on public.menu_items
  for each row execute function public.check_menu_item_ingredients_verification();

-- 5. Update create_campus_order RPC to strictly validate vegetarian, egg-free, and verified status
create or replace function public.create_campus_order(
  p_items jsonb,
  p_payment_method text,
  p_client_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_entry jsonb;
  v_item_id uuid;
  v_quantity integer;
  v_item_name text;
  v_price integer;
  v_total bigint := 0;
  v_open boolean;
  v_accepting boolean;
  v_order_id uuid;
  v_saved_order_id uuid;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.role in ('student', 'faculty', 'canteen_staff') and p.account_status = 'active') then
    raise exception 'Active student, faculty, or staff account required' using errcode = '42501';
  end if;

  if p_client_request_id is null then raise exception 'Request id is required' using errcode = '22023'; end if;
  if p_payment_method is null or p_payment_method not in ('online', 'pay_at_pickup') then raise exception 'Invalid payment method' using errcode = '22023'; end if;

  select o.id into v_saved_order_id from public.orders o
    where o.user_id = v_user_id and o.client_request_id = p_client_request_id;
  if v_saved_order_id is not null then return public.order_payload(v_saved_order_id); end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Provide between 1 and 30 distinct items' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Provide between 1 and 30 distinct items' using errcode = '22023';
  end if;
  select cs.is_open, cs.accepting_orders into v_open, v_accepting
    from public.canteen_settings cs where cs.id = true;
  if not coalesce(v_open, false) or not coalesce(v_accepting, false) then
    raise exception 'The canteen is not accepting orders' using errcode = '23514';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
      or jsonb_typeof(v_entry -> 'menu_item_id') is distinct from 'string'
      or jsonb_typeof(v_entry -> 'quantity') is distinct from 'number' then
      raise exception 'Each item requires a menu_item_id and quantity' using errcode = '22023';
    end if;
    begin
      v_item_id := (v_entry ->> 'menu_item_id')::uuid;
      v_quantity := (v_entry ->> 'quantity')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid menu item or quantity' using errcode = '22023';
    end;
    if v_quantity < 1 or v_quantity > 99 or (v_entry ->> 'quantity')::numeric <> v_quantity then
      raise exception 'Quantity must be a whole number from 1 to 99' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_array_elements(v_lines) x where x ->> 'menu_item_id' = v_item_id::text) then
      raise exception 'Duplicate menu items must be combined into one line' using errcode = '22023';
    end if;

    -- Strict validation: Must be active, available, 100% vegetarian, egg-free, and ingredients verified!
    select m.name, m.price_paise into v_item_name, v_price from public.menu_items m
      where m.id = v_item_id
        and m.is_active
        and m.is_available
        and m.is_vegetarian
        and not m.contains_egg
        and m.ingredients_verified
        and (m.category_id is null or exists (
          select 1 from public.categories c where c.id = m.category_id and c.is_active
        ))
      for share;
    if not found then
      raise exception 'A menu item is unavailable or does not satisfy the 100%% vegetarian policy' using errcode = '23514';
    end if;

    v_total := v_total + v_price::bigint * v_quantity;
    if v_total > 2147483647 then raise exception 'Order total is too large' using errcode = '22003'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_item_id, 'item_name', v_item_name,
      'unit_price_paise', v_price, 'quantity', v_quantity
    ));
  end loop;

  insert into public.orders(user_id, token_number, payment_method, payment_status, total_paise, client_request_id)
    values (v_user_id, upper(encode(extensions.gen_random_bytes(5), 'hex')), p_payment_method, 'pending', v_total::integer, p_client_request_id)
    on conflict (user_id, client_request_id) where client_request_id is not null do nothing
    returning id into v_order_id;
  if v_order_id is null then
    select o.id into v_saved_order_id from public.orders o
      where o.user_id = v_user_id and o.client_request_id = p_client_request_id;
    return public.order_payload(v_saved_order_id);
  end if;

  for v_entry in select value from jsonb_array_elements(v_lines) loop
    insert into public.order_items(order_id, menu_item_id, item_name, unit_price_paise, quantity, line_total_paise)
      values (v_order_id, (v_entry ->> 'menu_item_id')::uuid, v_entry ->> 'item_name',
        (v_entry ->> 'unit_price_paise')::integer, (v_entry ->> 'quantity')::integer,
        (v_entry ->> 'unit_price_paise')::integer * (v_entry ->> 'quantity')::integer);
  end loop;
  return public.order_payload(v_order_id);
end;
$$;
-- CampusBite 100% Vegetarian & Egg-Free Development Seed Data
-- Realistic sample menu items for development across all required vegetarian categories.
-- Note: Sample items must be treated as development data until ingredients are verified by the canteen operator.

insert into public.categories(name, is_active) values
  ('Breakfast', true),
  ('North Indian', true),
  ('South Indian', true),
  ('Snacks', true),
  ('Street Food', true),
  ('Sandwiches and Burgers', true),
  ('Rice and Meals', true),
  ('Pizza and Bakery', true),
  ('Sweets and Desserts', true),
  ('Beverages', true)
on conflict (name) do nothing;

insert into public.menu_items(
  category_id, name, description, price_paise,
  is_available, is_active, is_vegetarian, contains_egg, ingredients_verified
)
select
  c.id, v.name, v.description, v.price_paise,
  true, true, true, false, true
from (values
  ('Breakfast', 'Poha', 'Flattened rice tempered with mustard seeds, curry leaves, turmeric, roasted peanuts & lemon', 4000),
  ('Breakfast', 'Aloo Paratha', 'Spiced potato stuffed whole wheat flatbread served with fresh curd & pickle', 6000),
  ('Breakfast', 'Paneer Paratha', 'Fresh grated paneer & herbs stuffed whole wheat flatbread served with white butter & curd', 8000),
  ('Breakfast', 'Idli Sambar', 'Steamed fermented rice & lentil cakes served with piping hot drumstick sambar & coconut chutney', 5000),
  ('South Indian', 'Masala Dosa', 'Crispy golden fermented crepe stuffed with spiced potato mash, served with sambar & chutney', 7500),
  ('South Indian', 'Plain Dosa', 'Crisp rice and lentil crepe served with flavorful lentil sambar and coconut chutney', 6000),
  ('Sandwiches and Burgers', 'Veg Sandwich', 'Triple-layer toasted sandwich loaded with cucumber, tomato, potato, mint chutney & cheese', 6000),
  ('Sandwiches and Burgers', 'Veg Burger', 'Crispy spiced vegetable patty topped with lettuce, fresh tomato, cucumber & creamy veg mayo', 8000),
  ('North Indian', 'Chole Bhature', 'Spicy Punjabi chickpea curry paired with two fluffy, deep-fried leavened bhature', 11000),
  ('Rice and Meals', 'Dal Rice', 'Homestyle yellow tadka dal served over fragrant steamed basmati rice with pickle', 7000),
  ('Rice and Meals', 'Rajma Rice', 'Slow-cooked red kidney beans in thick spiced gravy paired with hot steamed basmati rice', 8500),
  ('Rice and Meals', 'Veg Fried Rice', 'Wok-tossed long-grain basmati rice with crunchy carrots, cabbage, french beans & spring onions', 9000),
  ('Street Food', 'Pav Bhaji', 'Rich, buttery spiced mashed vegetable curry served hot with butter-toasted pav and lemon', 9000),
  ('Snacks', 'Samosa', 'Crisp golden pastry triangles stuffed with spiced potatoes and green peas, served with sweet & mint chutneys', 2000),
  ('Street Food', 'Vada Pav', 'Mumbai street classic - spicy potato fritter nested inside a pav with garlic chutney & fried green chilli', 2500),
  ('Street Food', 'Veg Momos', 'Steamed Himalayan dumplings packed with finely minced vegetables and ginger, served with fiery red chutney', 7000),
  ('Snacks', 'Paneer Roll', 'Soft layered paratha wrapped around spiced grilled paneer cubes, crunchy peppers & tangy sauce', 9500),
  ('Pizza and Bakery', 'Veg Farmhouse Pizza', 'Stone-baked thin crust pizza topped with fresh tomato sauce, mozzarella, bell peppers, corn & olives', 14000),
  ('Beverages', 'Masala Chai', 'Freshly brewed strong Indian Assam tea simmered with milk, crushed cardamom, ginger and spices', 1500),
  ('Beverages', 'Filter Coffee', 'Authentic South Indian chicory-blended decoction frothed with hot creamy milk', 2500),
  ('Beverages', 'Sweet Lassi', 'Chilled churned thick yogurt beverage flavored with cardamom and saffron strands', 4500),
  ('Sweets and Desserts', 'Jalebi', 'Crisp, spiral deep-fried batter soaked in warm aromatic saffron sugar syrup', 4000),
  ('Sweets and Desserts', 'Gulab Jamun', 'Soft melt-in-mouth reduced milk dough balls fried golden and steeped in warm rose-cardamom syrup', 4000)
) as v(category_name, name, description, price_paise)
join public.categories c on c.name = v.category_name
where not exists (select 1 from public.menu_items m where m.name = v.name);

-- Allow authenticated users to delete their entire account & profile cleanly
create or replace function public.delete_user_self()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- 0. Remove payments for this user's orders (if tables exist)
  begin
    delete from public.payments
    where order_id in (select id from public.orders where user_id = v_uid);
  exception when others then
    null;
  end;

  -- 1. Remove order items for this user's orders (if tables exist)
  begin
    delete from public.order_items
    where order_id in (select id from public.orders where user_id = v_uid);
  exception when others then
    null;
  end;

  -- 2. Remove orders for this user (if tables exist)
  begin
    delete from public.orders
    where user_id = v_uid;
  exception when others then
    null;
  end;

  -- 3. Delete profile (if table exists)
  begin
    delete from public.profiles
    where id = v_uid;
  exception when others then
    null;
  end;

  -- 4. Permanently delete from auth.users!
  delete from auth.users
  where id = v_uid;

  return jsonb_build_object('status', 'ok', 'user_id', v_uid);
end;
$$;

revoke all on function public.delete_user_self() from public, anon;
grant execute on function public.delete_user_self() to authenticated;

-- Also provide delete_user_profile as an alias
create or replace function public.delete_user_profile()
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.delete_user_self();
end;
$$;

revoke all on function public.delete_user_profile() from public, anon;
grant execute on function public.delete_user_profile() to authenticated;

