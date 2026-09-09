"use client";

import { useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Track } from "@/lib/types";

type MusicPlayerProps = {
  canManageTracks: boolean;
  tracks: Track[];
};

function formatDuration(durationSeconds: number | null) {
  if (!durationSeconds) {
    return "--:--";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MusicPlayer({ canManageTracks, tracks: initialTracks }: MusicPlayerProps) {
  const audioElement = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState(initialTracks);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [trackPendingDeletion, setTrackPendingDeletion] = useState<Track | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [playerMessage, setPlayerMessage] = useState("选择一首歌开始播放");

  async function playTrack(track: Track) {
    setIsLoading(true);
    setPlayerMessage("正在准备播放...");

    try {
      const response = await fetch("/api/media/play-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: track.id }),
      });
      const responseBody = (await response.json()) as {
        error?: string;
        playbackUrl?: string;
      };

      if (!response.ok || !responseBody.playbackUrl) {
        throw new Error(responseBody.error ?? "Unable to start playback.");
      }

      if (!audioElement.current) {
        return;
      }

      audioElement.current.src = responseBody.playbackUrl;
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

  async function markTrackAsDisliked(track: Track) {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.from("disliked_tracks").insert({ track_id: track.id });

    if (error) {
      setPlayerMessage(`无法标记不喜欢：${error.message}`);
      return;
    }

    setTracks((currentTracks) => currentTracks.filter((currentTrack) => currentTrack.id !== track.id));

    if (currentTrack?.id === track.id) {
      audioElement.current?.pause();
      setCurrentTrack(null);
      setPlayerMessage("已标记为不喜欢，并从当前列表隐藏");
    }
  }

  async function deleteTrackPermanently() {
    if (!trackPendingDeletion) {
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch("/api/media/track", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: trackPendingDeletion.id }),
      });
      const responseBody = (await response.json()) as { error?: string; warning?: string };

      if (!response.ok) {
        throw new Error(responseBody.error ?? "无法删除歌曲。");
      }

      setTracks((currentTracks) => currentTracks.filter((track) => track.id !== trackPendingDeletion.id));
      if (currentTrack?.id === trackPendingDeletion.id) {
        audioElement.current?.pause();
        setCurrentTrack(null);
      }
      setPlayerMessage(responseBody.warning ?? "歌曲已从曲库永久删除");
      setTrackPendingDeletion(null);
    } catch (error) {
      setPlayerMessage(error instanceof Error ? error.message : "删除歌曲时发生未知错误。");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <section className="track-list" aria-label="歌曲列表">
        {tracks.length === 0 ? (
          <p className="empty-state-note">曲库还是空的。请从管理页面上传音乐。</p>
        ) : tracks.map((track, index) => (
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
                  onClick={() => setTrackPendingDeletion(track)}
                  title="永久删除"
                  type="button"
                >
                  ×
                </button>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="now-playing" aria-live="polite">
        <div className="now-playing-artwork" aria-hidden="true">♫</div>
        <div className="now-playing-details">
          <span className="eyebrow">{playerMessage}</span>
          <strong>{currentTrack?.title ?? "你的私人音乐库"}</strong>
          <small>{currentTrack?.artistName ?? "登录后即可播放自己的音乐"}</small>
        </div>
        <span className="player-state">{isLoading ? "加载中" : currentTrack ? "播放" : "待机"}</span>
        <audio controls className="audio-controls" ref={audioElement} />
      </section>

      {trackPendingDeletion && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-describedby="delete-track-description"
            aria-labelledby="delete-track-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <p className="eyebrow">永久删除</p>
            <h2 id="delete-track-title">删除《{trackPendingDeletion.title}》？</h2>
            <p id="delete-track-description">歌曲资料和 Supabase Storage 中的音频文件将被永久删除，无法恢复。</p>
            <div className="dialog-actions">
              <button className="button button-secondary" disabled={isDeleting} onClick={() => setTrackPendingDeletion(null)} type="button">取消</button>
              <button className="button button-danger" disabled={isDeleting} onClick={() => void deleteTrackPermanently()} type="button">
                {isDeleting ? "删除中..." : "永久删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
