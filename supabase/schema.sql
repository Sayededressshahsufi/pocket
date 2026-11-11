-- Pocket: shared budgets.
-- One row per household holds the whole budget as JSON; members are linked to
-- it. Clients never write tables directly: every write goes through the
-- SECURITY DEFINER functions below, and Row Level Security limits reads to
-- members. Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our budget',
  invite_code text not null unique,
  state       jsonb not null default '{}'::jsonb,
  version     bigint not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_idx on public.household_members(user_id);

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- Membership check used by policies and functions.
create or replace function public.is_member(p_household uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household and user_id = auth.uid()
  );
$$;

drop policy if exists "members read household" on public.households;
create policy "members read household" on public.households
  for select to authenticated using (public.is_member(id));

drop policy if exists "members read members" on public.household_members;
create policy "members read members" on public.household_members
  for select to authenticated using (public.is_member(household_id));

revoke all on public.households, public.household_members from anon;
revoke insert, update, delete on public.households, public.household_members from authenticated;
grant select on public.households, public.household_members to authenticated;

-- 8 characters from an unambiguous alphabet (no 0/O, 1/I): ~1e12 combinations.
create or replace function public.gen_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end $$;

create or replace function public.create_household(p_name text, p_display_name text, p_state jsonb)
returns table (id uuid, invite_code text, version bigint)
language plpgsql security definer set search_path = public as $$
declare h public.households;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if pg_column_size(p_state) > 5000000 then raise exception 'budget too large' using errcode = '54000'; end if;
  loop
    begin
      insert into public.households (name, invite_code, state, updated_by)
      values (left(coalesce(nullif(trim(p_name), ''), 'Our budget'), 60), public.gen_invite_code(),
              coalesce(p_state, '{}'::jsonb), auth.uid())
      returning * into h;
      exit;
    exception when unique_violation then
      -- invite code collision: try another
    end;
  end loop;
  insert into public.household_members (household_id, user_id, display_name)
  values (h.id, auth.uid(), left(coalesce(p_display_name, ''), 40));
  return query select h.id, h.invite_code, h.version;
end $$;

create or replace function public.join_household(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select h.id into hid from public.households h
  where h.invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if hid is null then raise exception 'invalid invite code' using errcode = 'P0002'; end if;
  insert into public.household_members (household_id, user_id, display_name)
  values (hid, auth.uid(), left(coalesce(p_display_name, ''), 40))
  on conflict (household_id, user_id) do update set display_name = excluded.display_name;
  return hid;
end $$;

-- Optimistic concurrency: only writes if nobody else saved in between.
-- Returns the new version, or NULL if the caller must re-read and merge.
create or replace function public.save_state(p_household uuid, p_state jsonb, p_expected bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.is_member(p_household) then raise exception 'not a member' using errcode = '42501'; end if;
  if pg_column_size(p_state) > 5000000 then raise exception 'budget too large' using errcode = '54000'; end if;
  update public.households
     set state = p_state, version = version + 1, updated_at = now(), updated_by = auth.uid()
   where id = p_household and version = p_expected
  returning version into v;
  return v;
end $$;

create or replace function public.leave_household(p_household uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.household_members where household_id = p_household and user_id = auth.uid();
  -- Last one out removes the shared data.
  delete from public.households h
   where h.id = p_household
     and not exists (select 1 from public.household_members m where m.household_id = h.id);
end $$;

create or replace function public.rename_member(p_household uuid, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.household_members set display_name = left(coalesce(p_display_name, ''), 40)
   where household_id = p_household and user_id = auth.uid();
end $$;

revoke all on function public.is_member(uuid), public.gen_invite_code(),
  public.create_household(text, text, jsonb), public.join_household(text, text),
  public.save_state(uuid, jsonb, bigint), public.leave_household(uuid),
  public.rename_member(uuid, text) from public, anon;
grant execute on function public.is_member(uuid), public.create_household(text, text, jsonb),
  public.join_household(text, text), public.save_state(uuid, jsonb, bigint),
  public.leave_household(uuid), public.rename_member(uuid, text) to authenticated;

-- Live updates to the other phone.
do $$ begin
  alter publication supabase_realtime add table public.households;
exception when duplicate_object then null; end $$;
