-- Allow authenticated users to delete their own profile cleanly
-- Handles foreign key relations with orders and order items

create or replace function public.delete_user_profile()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Remove order items for this user's orders
  delete from public.order_items
  where order_id in (select id from public.orders where user_id = v_uid);

  -- Remove orders for this user
  delete from public.orders
  where user_id = v_uid;

  -- Delete profile
  delete from public.profiles
  where id = v_uid;

  return jsonb_build_object('status', 'ok', 'user_id', v_uid);
end;
$$;

revoke all on function public.delete_user_profile() from public, anon;
grant execute on function public.delete_user_profile() to authenticated;
