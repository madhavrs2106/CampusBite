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
