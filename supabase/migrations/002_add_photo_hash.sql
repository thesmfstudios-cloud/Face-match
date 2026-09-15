alter table public.fm_photos add column if not exists file_hash text;
create index if not exists fm_photos_event_file_hash_idx on public.fm_photos(event_id, file_hash) where file_hash is not null;
create unique index if not exists fm_photos_event_file_hash_unique on public.fm_photos(event_id, file_hash) where file_hash is not null;
