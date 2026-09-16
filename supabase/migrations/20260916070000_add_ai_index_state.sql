alter table public.fm_photos
  add column if not exists ai_indexed_at timestamptz null,
  add column if not exists ai_indexed_faces integer not null default 0,
  add column if not exists ai_index_error text null;

create index if not exists fm_photos_event_ai_index_idx
  on public.fm_photos (event_id, ai_indexed_at)
  where processing_status = 'ready';
