"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { LibraryPlaylist, Track } from "@/lib/types";

type MusicPlayerProps = {
  canManageTracks: boolean;
  playlists: LibraryPlaylist[];
};

function formatDuration(durationSeconds: number | null) {
  if (!durationSeconds) {
    return "--:--";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type DeleteRequest =
  | { kind: "library" }
  | { kind: "playlist"; playlist: LibraryPlaylist }
  | { kind: "track"; track: Track };

function getDeleteDialogDetails(deleteRequest: DeleteRequest) {
  if (deleteRequest.kind === "track") {
    return { description: "歌曲资料和 Supabase Storage 中的音频文件将被永久删除，无法恢复。", title: `删除《${deleteRequest.track.title}》？` };
  }

  if (deleteRequest.kind === "playlist") {
    return { description: `“${deleteRequest.playlist.name}”中的全部歌曲及音频文件将被永久删除，无法恢复。`, title: `清空“${deleteRequest.playlist.name}”？` };
  }

  return { description: "全部播放列表、歌曲资料和 Supabase Storage 中的音频文件将被永久删除，无法恢复。", title: "清空整个曲库？" };
}

export function MusicPlayer({ canManageTracks, playlists: initialPlaylists }: MusicPlayerProps) {
  const audioElement = useRef<HTMLAudioElement>(null);
  const [playlists, setPlaylists] = useState(initialPlaylists);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [playerMessage, setPlayerMessage] = useState("选择一首歌开始播放");
  const preloadedUrls = useRef(new Map<string, string>());
  const tracks = useMemo(() => playlists.flatMap((playlist) => playlist.tracks), [playlists]);

  useEffect(() => {
    if (!currentTrack) {
      return;
    }

    const currentTrackIndex = tracks.findIndex((track) => track.id === currentTrack.id);
    const nextTrack = tracks[currentTrackIndex + 1];
    if (!nextTrack || preloadedUrls.current.has(nextTrack.id)) {
      return;
    }

    void fetch("/api/media/play-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: nextTrack.id }),
    })
      .then(async (response) => {
        const responseBody = (await response.json()) as { playbackUrl?: string };
        if (response.ok && responseBody.playbackUrl) {
          preloadedUrls.current.set(nextTrack.id, responseBody.playbackUrl);
        }
      })
      .catch(() => undefined);
  }, [currentTrack, tracks]);

  async function playTrack(track: Track) {
    setIsLoading(true);
    setPlayerMessage("正在准备播放...");

    try {
      let playbackUrl = preloadedUrls.current.get(track.id);
      if (!playbackUrl) {
        const response = await fetch("/api/media/play-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackId: track.id }),
        });
        const responseBody = (await response.json()) as { error?: string; playbackUrl?: string };

        if (!response.ok || !responseBody.playbackUrl) {
          throw new Error(responseBody.error ?? "Unable to start playback.");
        }

        playbackUrl = responseBody.playbackUrl;
      }

      if (!audioElement.current) {
        return;
      }

      audioElement.current.src = playbackUrl;
      await audioElement.current.play();
      setCurrentTrack(track);
      setPlayerMessage("正在播放");
    } catch (error) {
      const message = error instanceof Error ? error.message : "播放失败。";
      setPlayerMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function playNextTrack() {
    if (!currentTrack) {
      return;
    }

    const currentTrackIndex = tracks.findIndex((track) => track.id === currentTrack.id);
    const nextTrack = tracks[currentTrackIndex + 1];

    if (!nextTrack) {
      setPlayerMessage("播放列表已结束");
      return;
    }

    await playTrack(nextTrack);
  }

  async function markTrackAsDisliked(track: Track) {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("disliked_tracks").insert({ track_id: track.id });

    if (error) {
      setPlayerMessage(`无法标记不喜欢：${error.message}`);
      return;
    }

    setPlaylists((currentPlaylists) => currentPlaylists.map((playlist) => ({
      ...playlist,
      tracks: playlist.tracks.filter((currentTrack) => currentTrack.id !== track.id),
    })));

    if (currentTrack?.id === track.id) {
      audioElement.current?.pause();
      setCurrentTrack(null);
      setPlayerMessage("已标记为不喜欢，并从当前列表隐藏");
    }
  }

  async function deletePermanently() {
    if (!deleteRequest) {
      return;
    }

    setIsDeleting(true);

    try {
      const endpoint = deleteRequest.kind === "track" ? "/api/media/track" : "/api/media/tracks";
      const requestBody = deleteRequest.kind === "track"
        ? { trackId: deleteRequest.track.id }
        : deleteRequest.kind === "playlist"
          ? { playlistId: deleteRequest.playlist.id ?? undefined }
          : { deleteEntireLibrary: true };
      const response = await fetch(endpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const responseBody = (await response.json()) as { error?: string; warning?: string };

      if (!response.ok) {
        throw new Error(responseBody.error ?? "无法删除歌曲。");
      }

      const deletedTrackIds = deleteRequest.kind === "track"
        ? new Set([deleteRequest.track.id])
        : deleteRequest.kind === "playlist"
          ? new Set(deleteRequest.playlist.tracks.map((track) => track.id))
          : new Set(tracks.map((track) => track.id));
      setPlaylists((currentPlaylists) => currentPlaylists
        .filter((playlist) => deleteRequest.kind !== "playlist" || playlist.id !== deleteRequest.playlist.id)
        .map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter((track) => !deletedTrackIds.has(track.id)) })));
      if (currentTrack && deletedTrackIds.has(currentTrack.id)) {
        audioElement.current?.pause();
        setCurrentTrack(null);
      }
      setPlayerMessage(responseBody.warning ?? "歌曲已永久删除");
      setDeleteRequest(null);
    } catch (error) {
      setPlayerMessage(error instanceof Error ? error.message : "删除歌曲时发生未知错误。");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <section className="playlist-list" aria-label="播放列表">
        {tracks.length === 0 ? (
          <p className="empty-state-note">曲库还是空的。请从管理页面上传音乐。</p>
        ) : playlists.map((playlist) => playlist.tracks.length > 0 && (
          <section className="playlist-section" key={playlist.id ?? playlist.name}>
            <header className="playlist-heading">
              <div><p className="eyebrow">播放列表</p><h2>{playlist.name}</h2><small>{playlist.tracks.length} 首</small></div>
              {canManageTracks && playlist.id && <button className="button button-secondary button-compact" onClick={() => setDeleteRequest({ kind: "playlist", playlist })} type="button">清空</button>}
            </header>
            <div className="track-list">
            {playlist.tracks.map((track, index) => (
          <article className="track-row" key={track.id}>
            <button className="track-play-button" onClick={() => void playTrack(track)} type="button">
              <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="track-artwork" aria-hidden="true">
                {track.artworkUrl ? "♪" : "♫"}
              </span>
              <span className="track-details">
                <strong>{track.title}</strong>
                <small>{track.artistName}{track.albumTitle ? ` · ${track.albumTitle}` : ""}</small>
              </span>
              <span className="track-duration">{formatDuration(track.durationSeconds)}</span>
            </button>
            <div className="track-actions">
              <button
                aria-label={`标记 ${track.title} 为不喜欢`}
                className="icon-button"
                onClick={() => void markTrackAsDisliked(track)}
                title="不喜欢并隐藏"
                type="button"
              >
                ♡
              </button>
              {canManageTracks && (
                <button
                  aria-label={`删除 ${track.title}`}
                  className="icon-button icon-button-danger"
                  onClick={() => setDeleteRequest({ kind: "track", track })}
                  title="永久删除"
                  type="button"
                >
                  ×
                </button>
              )}
            </div>
          </article>
            ))}
            </div>
          </section>
        ))}
      </section>

      <section className="now-playing floating-player" aria-live="polite">
        <div className="now-playing-artwork" aria-hidden="true">♫</div>
        <div className="now-playing-details">
          <span className="eyebrow">{playerMessage}</span>
          <strong>{currentTrack?.title ?? "你的私人音乐库"}</strong>
          <small>{currentTrack?.artistName ?? "登录后即可播放自己的音乐"}</small>
        </div>
        <span className="player-state">{isLoading ? "加载中" : currentTrack ? "播放" : "待机"}</span>
        <audio
          className="audio-controls"
          controls
          onEnded={() => void playNextTrack()}
          preload="metadata"
          ref={audioElement}
        />
      </section>

      {canManageTracks && tracks.length > 0 && <button className="button button-danger clear-library-button" onClick={() => setDeleteRequest({ kind: "library" })} type="button">清空全部曲库</button>}

      {deleteRequest && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-describedby="delete-track-description"
            aria-labelledby="delete-track-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <p className="eyebrow">永久删除</p>
            <h2 id="delete-track-title">{getDeleteDialogDetails(deleteRequest).title}</h2>
            <p id="delete-track-description">{getDeleteDialogDetails(deleteRequest).description}</p>
            <div className="dialog-actions">
              <button className="button button-secondary" disabled={isDeleting} onClick={() => setDeleteRequest(null)} type="button">取消</button>
              <button className="button button-danger" disabled={isDeleting} onClick={() => void deletePermanently()} type="button">
                {isDeleting ? "删除中..." : "永久删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
