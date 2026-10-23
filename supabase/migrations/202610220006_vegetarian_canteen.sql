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
  if not exists (select 1 from public.profiles p where p.id = v_user_id and p.role = 'student' and p.account_status = 'active') then
    raise exception 'Active student account required' using errcode = '42501';
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
