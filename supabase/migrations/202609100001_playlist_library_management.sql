-- A chosen upload folder is represented by one user-owned playlist.
create unique index if not exists playlists_owner_name_unique
on public.playlists (owner_id, name);
