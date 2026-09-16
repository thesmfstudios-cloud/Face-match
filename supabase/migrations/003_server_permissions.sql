-- Explicit privileges for the server-side upload/finalize routes.
-- These routes use the Supabase service_role key and therefore bypass RLS,
-- but explicit table/function grants keep permissions correct after fresh setup.
grant select, insert, update, delete on table public.fm_photos to service_role;
grant select, insert, update, delete on table public.fm_events to service_role;
grant select, insert, update, delete on table public.fm_faces to service_role;
grant select, insert, update, delete on table public.fm_orders to service_role;
grant select, insert, update, delete on table public.fm_settings to service_role;
grant execute on function public.fm_refresh_event_photo_count(uuid) to service_role;
