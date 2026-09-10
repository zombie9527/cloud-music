import Link from "next/link";

import { MusicPlayer } from "@/components/music-player";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LibraryPlaylist, Track } from "@/lib/types";

function mapTrack(track: {
  album_title: string | null;
  artist_name: string;
  audio_object_key: string;
  duration_seconds: number | null;
  id: string;
  title: string;
}): Track {
  return {
    id: track.id,
    title: track.title,
    artistName: track.artist_name,
    albumTitle: track.album_title,
    durationSeconds: track.duration_seconds,
    artworkUrl: null,
    audioObjectKey: track.audio_object_key,
  };
}

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const [{ data: tracksData }, { data: dislikedTracksData }, { data: playlistsData }, { data: playlistTracksData }, { data: profileData }] = await Promise.all([
    userId
      ? supabase
        .from("tracks")
        .select("id, title, artist_name, album_title, duration_seconds, audio_object_key")
        .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from("disliked_tracks").select("track_id").eq("user_id", userId)
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from("playlists").select("id, name").eq("owner_id", userId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from("playlist_tracks").select("playlist_id, track_id, position").order("position", { ascending: true })
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from("profiles").select("is_admin").eq("id", userId).single()
      : Promise.resolve({ data: null }),
  ]);

  const dislikedTrackIds = new Set(dislikedTracksData?.map((track) => track.track_id));
  const tracks = (tracksData ?? [])
    .filter((track) => !dislikedTrackIds.has(track.id))
    .map(mapTrack);
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const playlistTracksByPlaylistId = new Map<string, Track[]>();

  for (const playlistTrack of playlistTracksData ?? []) {
    const track = tracksById.get(playlistTrack.track_id);
    if (!track) {
      continue;
    }

    const playlistTracks = playlistTracksByPlaylistId.get(playlistTrack.playlist_id) ?? [];
    playlistTracks.push(track);
    playlistTracksByPlaylistId.set(playlistTrack.playlist_id, playlistTracks);
  }

  const assignedTrackIds = new Set((playlistTracksData ?? []).map((playlistTrack) => playlistTrack.track_id));
  const playlists: LibraryPlaylist[] = (playlistsData ?? []).map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    tracks: playlistTracksByPlaylistId.get(playlist.id) ?? [],
  }));
  const unassignedTracks = tracks.filter((track) => !assignedTrackIds.has(track.id));
  if (unassignedTracks.length > 0) {
    playlists.push({ id: null, name: "未分类", tracks: unassignedTracks });
  }

  return (
    <main className="app-shell player-shell">
      <nav className="top-navigation">
        <Link className="wordmark" href="/">cloud<span>music</span></Link>
        <div className="navigation-actions">
          {userId ? <Link href="/admin">管理</Link> : <Link href="/login">登录</Link>}
        </div>
      </nav>

      <section className="library-section player-library">
        <div className="section-heading">
          <div><p className="eyebrow">私人曲库</p><h1>现在播放</h1></div>
          <span className="status-badge">{tracks.length} 首</span>
        </div>
        {userId ? (
          <MusicPlayer canManageTracks={profileData?.is_admin ?? false} playlists={playlists} />
        ) : (
          <p className="empty-state-note">登录后即可查看并播放你的私人曲库。</p>
        )}
      </section>
    </main>
  );
}
