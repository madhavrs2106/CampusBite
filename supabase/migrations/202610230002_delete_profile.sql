-- Allow authenticated users to delete their entire account & profile cleanly
-- Deletes from auth.users so the user cannot log in again and can re-register with the same email

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
