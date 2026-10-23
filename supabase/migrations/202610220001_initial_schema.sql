-- CampusBite initial schema. Apply with Supabase CLI after linking a project.
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  student_id text check (student_id is null or char_length(student_id) <= 50),
  role text not null default 'student' check (role in ('student','canteen_staff','admin')),
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

-- A signup can only create a student profile. Privileged roles are assigned by a protected admin workflow.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, student_id, role, account_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'student_id', ''),
    'student',
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
