-- RLS policies already restrict these writes to active canteen_staff/admin profiles.
grant insert, update on public.menu_items to authenticated;
