create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  artist_name text not null default '未知歌手',
  album_title text,
  duration_seconds integer check (duration_seconds > 0),
  artwork_object_key text,
  audio_object_key text not null unique,
  mime_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table public.disliked_tracks (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.playlist_tracks (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  position integer not null check (position >= 0),
  added_at timestamptz not null default now(),
  primary key (playlist_id, track_id),
  unique (playlist_id, position)
);

alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.favorites enable row level security;
alter table public.disliked_tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music',
  'music',
  false,
  52428800,
  array[
    'audio/aac',
    'audio/flac',
    'audio/m4a',
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/webm'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can view their profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);

create policy "Signed-in users can read tracks" on public.tracks for select to authenticated using (true);
create policy "Admins can manage tracks" on public.tracks for all to authenticated using ((select is_admin from public.profiles where id = (select auth.uid()))) with check ((select is_admin from public.profiles where id = (select auth.uid())));

create policy "Signed-in users can read music storage objects" on storage.objects for select to authenticated using (bucket_id = 'music');
create policy "Admins can upload music storage objects" on storage.objects for insert to authenticated with check (bucket_id = 'music' and (storage.foldername(name))[1] = 'audio' and (select is_admin from public.profiles where id = (select auth.uid())));
create policy "Admins can delete music storage objects" on storage.objects for delete to authenticated using (bucket_id = 'music' and (select is_admin from public.profiles where id = (select auth.uid())));

create policy "Users manage their own favorites" on public.favorites for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their own disliked tracks" on public.disliked_tracks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their own playlists" on public.playlists for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Playlist owners manage playlist tracks" on public.playlist_tracks for all to authenticated using (exists (select 1 from public.playlists where id = playlist_id and owner_id = (select auth.uid()))) with check (exists (select 1 from public.playlists where id = playlist_id and owner_id = (select auth.uid())));

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();
