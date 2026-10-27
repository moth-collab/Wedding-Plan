-- OUR DAY · Supabase schema (applied as migration 20261027024417_our_day_core)
-- A shared wedding workspace for a couple. Every record belongs to one workspace;
-- Row Level Security lets only that workspace's members (max 2) read or write it.
-- Guests submit RSVPs anonymously only through submit_rsvp(), which never returns data.

create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  settings jsonb not null default '{}'::jsonb,
  invite_code text not null unique,
  rsvp_token text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_size check (octet_length(settings::text) < 65536)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  partner text check (partner in ('A','B')),
  email text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

-- One table for all app collections (tasks, expenses with payments, vendors, guests, ...).
-- `data` holds the record body; (workspace_id, col, id) is the stable key.
create table public.records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  col text not null check (col in ('tasks','expenses','vendors','guests','events','ideas','polls','memories','quests','answers','activity','wday','gifts')),
  id text not null check (id ~ '^[A-Za-z0-9_.:@+~-]{1,120}$'),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, col, id),
  constraint data_size check (octet_length(data::text) < 262144)
);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger records_touch before update on public.records for each row execute function public.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces for each row execute function public.touch_updated_at();

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;
revoke all on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.records enable row level security;

create policy ws_select on public.workspaces for select to authenticated using (public.is_member(id));
create policy ws_update on public.workspaces for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy ws_delete on public.workspaces for delete to authenticated using (public.is_member(id));

create policy wm_select on public.workspace_members for select to authenticated using (public.is_member(workspace_id));
create policy wm_update_self on public.workspace_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wm_delete_self on public.workspace_members for delete to authenticated using (user_id = auth.uid());

create policy rec_select on public.records for select to authenticated using (public.is_member(workspace_id));
create policy rec_insert on public.records for insert to authenticated with check (public.is_member(workspace_id));
create policy rec_update on public.records for update to authenticated using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy rec_delete on public.records for delete to authenticated using (public.is_member(workspace_id));

revoke update (invite_code, rsvp_token, created_by, id) on public.workspaces from authenticated;

create or replace function public.gen_code(n int) returns text language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
  from (select extensions.gen_random_bytes(n) b) x, generate_series(0, n - 1) i;
$$;

create or replace function public.create_workspace(p_settings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if (select count(*) from public.workspace_members where user_id = uid) >= 3 then raise exception 'too_many_workspaces'; end if;
  insert into public.workspaces(settings, invite_code, rsvp_token, created_by)
    values (coalesce(p_settings, '{}'::jsonb), public.gen_code(8), lower(public.gen_code(24)), uid)
    returning id into ws;
  insert into public.workspace_members(workspace_id, user_id, partner, email)
    values (ws, uid, 'A', auth.jwt() ->> 'email');
  return ws;
end $$;

create or replace function public.join_workspace(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select id into ws from public.workspaces where invite_code = upper(trim(p_code));
  if ws is null then raise exception 'bad_code'; end if;
  if exists (select 1 from public.workspace_members where workspace_id = ws and user_id = uid) then return ws; end if;
  if (select count(*) from public.workspace_members where workspace_id = ws) >= 2 then raise exception 'workspace_full'; end if;
  insert into public.workspace_members(workspace_id, user_id, partner, email)
    values (ws, uid, case when exists (select 1 from public.workspace_members where workspace_id = ws and partner = 'B') then null else 'B' end, auth.jwt() ->> 'email');
  return ws;
end $$;

create or replace function public.rotate_invite_code(p_ws uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_member(p_ws) then raise exception 'forbidden'; end if;
  c := public.gen_code(8);
  update public.workspaces set invite_code = c where id = p_ws;
  return c;
end $$;

-- Public RSVP: match an existing guest by email, phone or name and update; otherwise add a guest.
create or replace function public.submit_rsvp(p_token text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ws uuid; nm text; em text; ph text; rs text; pl int; existing record; gid text; body jsonb; msg text; digits text;
begin
  select id into ws from public.workspaces where rsvp_token = lower(trim(coalesce(p_token,'')));
  if ws is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  if coalesce(p ->> 'website', '') <> '' then return jsonb_build_object('ok', true); end if;
  if (select count(*) from public.records where workspace_id = ws and col = 'guests' and data ->> 'rsvpAt' > (now() - interval '10 minutes')::text) > 40
    then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  if (select count(*) from public.records where workspace_id = ws and col = 'guests') > 3000 then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  nm := left(regexp_replace(trim(coalesce(p ->> 'name','')), '[[:cntrl:]]', ' ', 'g'), 120);
  if char_length(nm) < 2 then return jsonb_build_object('ok', false, 'error', 'name'); end if;
  em := lower(left(trim(coalesce(p ->> 'email','')), 120));
  if em <> '' and em !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'error', 'email'); end if;
  rs := p ->> 'rsvp';
  if rs is null or rs not in ('yes','no','maybe') then return jsonb_build_object('ok', false, 'error', 'rsvp'); end if;
  pl := case when rs = 'no' then 0 else greatest(0, least(10, coalesce((p ->> 'plus')::int, 0))) end;
  ph := left(trim(coalesce(p ->> 'phone','')), 40);
  digits := regexp_replace(ph, '\D', '', 'g');
  msg := left(regexp_replace(trim(coalesce(p ->> 'message','')), '[[:cntrl:]]', ' ', 'g'), 500);

  select r.id, r.data into existing from public.records r
   where r.workspace_id = ws and r.col = 'guests' and (
     (em <> '' and lower(r.data ->> 'email') = em)
     or (em = '' and length(digits) >= 9 and regexp_replace(coalesce(r.data ->> 'phone',''), '\D', '', 'g') = digits)
     or (lower(trim(r.data ->> 'name')) = lower(nm) and (em = '' or coalesce(r.data ->> 'email','') = ''))
   )
   order by (lower(r.data ->> 'email') = em) desc nulls last
   limit 1;

  body := jsonb_build_object('rsvp', rs, 'plus', pl, 'rsvpAt', now()::text, 'source', 'rsvp',
           'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  if coalesce(p ->> 'diet','') <> '' then body := body || jsonb_build_object('diet', left(p ->> 'diet', 120)); end if;
  if coalesce(p ->> 'side','') in ('A','B','both') then body := body || jsonb_build_object('side', p ->> 'side'); end if;
  if em <> '' then body := body || jsonb_build_object('email', em); end if;
  if ph <> '' then body := body || jsonb_build_object('phone', ph); end if;
  if msg <> '' then body := body || jsonb_build_object('message', msg); end if;

  if existing.id is not null then
    update public.records set data = existing.data || body where workspace_id = ws and col = 'guests' and id = existing.id;
    gid := existing.id;
  else
    gid := 'r' || lower(public.gen_code(12));
    insert into public.records(workspace_id, col, id, data) values (ws, 'guests', gid,
      jsonb_build_object('id', gid, 'name', nm, 'group', 'other', 'side', 'both', 'table', '', 'notes', '',
        'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) || body);
  end if;
  insert into public.records(workspace_id, col, id, data) values (ws, 'activity', 'a' || lower(public.gen_code(12)),
    jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', '', 'ref', gid,
      'text', nm || case rs when 'yes' then ' ตอบรับว่าจะมาร่วมงาน' when 'no' then ' ตอบว่าไม่สะดวกมา' else ' ตอบว่ายังไม่แน่ใจ' end || ' (ฟอร์มแขก)'));
  return jsonb_build_object('ok', true, 'updated', existing.id is not null);
end $$;

revoke all on function public.create_workspace(jsonb) from public, anon;
revoke all on function public.join_workspace(text) from public, anon;
revoke all on function public.rotate_invite_code(uuid) from public, anon;
revoke all on function public.gen_code(int) from public, anon, authenticated;
grant execute on function public.create_workspace(jsonb) to authenticated;
grant execute on function public.join_workspace(text) to authenticated;
grant execute on function public.rotate_invite_code(uuid) to authenticated;
revoke all on function public.submit_rsvp(text, jsonb) from public;
grant execute on function public.submit_rsvp(text, jsonb) to anon, authenticated;

alter publication supabase_realtime add table public.records, public.workspaces, public.workspace_members;

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 20971520) on conflict (id) do nothing;
create policy files_select on storage.objects for select to authenticated using (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy files_insert on storage.objects for insert to authenticated with check (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy files_delete on storage.objects for delete to authenticated using (bucket_id = 'files' and public.is_member(((storage.foldername(name))[1])::uuid));
