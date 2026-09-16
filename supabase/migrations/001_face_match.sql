-- Photo Match schema. Uses dedicated fm_ tables so it does not touch existing app tables.
create table if not exists public.fm_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  event_date date,
  status text not null default 'draft' check (status in ('draft','live','archived')),
  photos_count integer not null default 0,
  upi_id text,
  qr_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.fm_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fm_events(id) on delete cascade,
  original_path text not null,
  preview_path text,
  original_filename text not null,
  people_count integer not null default 1,
  price numeric(10,2) not null default 10 check (price >= 0),
  processing_status text not null default 'pending' check (processing_status in ('pending','processing','ready','failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.fm_faces (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.fm_photos(id) on delete cascade,
  embedding jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fm_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.fm_events(id) on delete cascade,
  total numeric(10,2) not null check (total >= 0),
  status text not null default 'payment_pending' check (status in ('payment_pending','payment_submitted','approved','rejected','fulfilled')),
  utr text,
  selected_photo_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fm_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.fm_events enable row level security;
alter table public.fm_photos enable row level security;
alter table public.fm_faces enable row level security;
alter table public.fm_orders enable row level security;
alter table public.fm_settings enable row level security;

drop policy if exists "fm_live_events_read" on public.fm_events;
create policy "fm_live_events_read" on public.fm_events for select using (status = 'live');

drop policy if exists "fm_live_photos_read" on public.fm_photos;
create policy "fm_live_photos_read" on public.fm_photos for select using (
  exists (select 1 from public.fm_events e where e.id = event_id and e.status = 'live')
);

drop policy if exists "fm_orders_insert" on public.fm_orders;
create policy "fm_orders_insert" on public.fm_orders for insert with check (true);

create or replace function public.fm_refresh_event_photo_count(p_event_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.fm_events
  set photos_count = (select count(*) from public.fm_photos where event_id = p_event_id)
  where id = p_event_id;
$$;

-- Storage: originals are private; previews are publicly readable but never contain originals.
insert into storage.buckets (id, name, public)
values ('fm-originals', 'fm-originals', false), ('fm-previews', 'fm-previews', true)
on conflict (id) do nothing;

-- The server upload route uses the service role, so no anonymous upload policy is needed.
drop policy if exists "fm_preview_public_read" on storage.objects;
create policy "fm_preview_public_read" on storage.objects
  for select using (bucket_id = 'fm-previews');

drop policy if exists "fm_originals_no_public_read" on storage.objects;
-- Intentionally no public SELECT policy for fm-originals.

insert into public.fm_settings(key, value)
values
  ('single_price', '10'),
  ('group_price', '30')
on conflict (key) do nothing;

insert into public.fm_events(slug, name, event_date, status, upi_id)
values ('sam-college-2026', 'SAM College · 14 September 2026', '2026-09-14', 'live', '9200010123@ybl')
on conflict (slug) do update set upi_id = excluded.upi_id;

-- Public read/insert privileges are required in addition to RLS policies.
grant select on public.fm_events to anon;
grant select on public.fm_photos to anon;
grant insert on public.fm_orders to anon;
