import Link from "next/link";

import { MusicPlayer } from "@/components/music-player";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Track } from "@/lib/types";

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

  const [{ data: tracksData }, { data: dislikedTracksData }, { data: profileData }] = await Promise.all([
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
      ? supabase.from("profiles").select("is_admin").eq("id", userId).single()
      : Promise.resolve({ data: null }),
  ]);

  const dislikedTrackIds = new Set(dislikedTracksData?.map((track) => track.track_id));
  const tracks = (tracksData ?? [])
    .filter((track) => !dislikedTrackIds.has(track.id))
    .map(mapTrack);

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
          <MusicPlayer canManageTracks={profileData?.is_admin ?? false} tracks={tracks} />
        ) : (
          <p className="empty-state-note">登录后即可查看并播放你的私人曲库。</p>
        )}
      </section>
    </main>
  );
}
