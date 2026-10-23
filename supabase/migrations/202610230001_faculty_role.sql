-- Migration: Add faculty role and support Student, Faculty, Staff registration

-- 1. Update profiles table constraint to allow 'faculty'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'faculty', 'canteen_staff', 'admin'));

-- 2. Update handle_new_user trigger to honor role/user_type metadata
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
