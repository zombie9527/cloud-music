-- Run this migration for projects created before batch upload and dislike support.
create table if not exists public.disliked_tracks (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.disliked_tracks enable row level security;

update storage.buckets
set file_size_limit = 52428800
where id = 'music';

drop policy if exists "Admins can delete music storage objects" on storage.objects;
create policy "Admins can delete music storage objects" on storage.objects for delete to authenticated using (
  bucket_id = 'music'
  and (select is_admin from public.profiles where id = (select auth.uid()))
);

drop policy if exists "Users manage their own disliked tracks" on public.disliked_tracks;
create policy "Users manage their own disliked tracks" on public.disliked_tracks for all to authenticated using (
  (select auth.uid()) = user_id
) with check (
  (select auth.uid()) = user_id
);
