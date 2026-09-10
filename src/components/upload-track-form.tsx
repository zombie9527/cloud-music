"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const MAX_FREE_PLAN_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type UploadQueueItem = {
  albumTitle: string;
  artistName: string;
  durationSeconds: number | null;
  file: File;
  errorMessage?: string;
  id: string;
  status: "ready" | "uploading" | "uploaded" | "failed" | "too-large";
  title: string;
};

type SignedUploadResponse = {
  bucketName?: string;
  contentType?: string;
  error?: string;
  objectKey?: string;
  signedUploadToken?: string;
};

function getTitleFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function getMetadataArtist(metadataArtist: string | undefined) {
  const trimmedArtist = metadataArtist?.trim();

  if (!trimmedArtist || /公众号|资源库/i.test(trimmedArtist)) {
    return null;
  }

  return trimmedArtist;
}

function parseTitleAndArtistFromFileName(fileName: string) {
  const fileNameWithoutExtension = getTitleFromFileName(fileName);
  const separatorMatch = fileNameWithoutExtension.match(/^(.+?)\s*[-－—–]\s*(.+)$/);

  if (!separatorMatch) {
    return { title: fileNameWithoutExtension, artistName: null };
  }

  return {
    title: separatorMatch[1].trim(),
    artistName: separatorMatch[2].trim() || null,
  };
}

function formatFileSize(fileSizeBytes: number) {
  return `${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadTrackForm() {
  const folderInput = useRef<HTMLInputElement>(null);
  const [isPreparingQueue, setIsPreparingQueue] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("选择音乐文件或一个音乐文件夹。");

  useEffect(() => {
    // Chromium browsers use this non-standard attribute for folder selection.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  async function createQueueItem(file: File): Promise<UploadQueueItem> {
    const fileNameMetadata = parseTitleAndArtistFromFileName(file.name);
    const queueItem: UploadQueueItem = {
      id: crypto.randomUUID(),
      file,
      title: fileNameMetadata.title,
      artistName: fileNameMetadata.artistName ?? "未知歌手",
      albumTitle: "",
      durationSeconds: null,
      status: file.size > MAX_FREE_PLAN_FILE_SIZE_BYTES ? "too-large" : "ready",
    };

    try {
      const { parseBlob } = await import("music-metadata");
      const metadata = await parseBlob(file, { duration: true });

      return {
        ...queueItem,
        title: metadata.common.title?.trim() || fileNameMetadata.title,
        artistName: getMetadataArtist(metadata.common.artist) ?? fileNameMetadata.artistName ?? "未知歌手",
        albumTitle: metadata.common.album?.trim() || "",
        durationSeconds: metadata.format.duration ? Math.round(metadata.format.duration) : null,
      };
    } catch {
      return queueItem;
    }
  }

  async function prepareQueue(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("audio/"));
    event.target.value = "";

    if (files.length === 0) {
      setStatusMessage("没有找到可上传的音频文件。");
      return;
    }

    setIsPreparingQueue(true);
    setStatusMessage(`正在读取 ${files.length} 个文件的音频信息...`);

    const queueItems = await Promise.all(files.map(createQueueItem));
    const selectedFolderName = files[0]?.webkitRelativePath.split("/")[0];
    const filesOverFreePlanLimit = queueItems.filter((item) => item.status === "too-large").length;
    setQueue(queueItems);
    setPlaylistName(selectedFolderName || "新播放列表");
    setStatusMessage(
      filesOverFreePlanLimit > 0
        ? `已识别 ${queueItems.length} 首；${filesOverFreePlanLimit} 首超过免费版 50 MB 单文件限制。`
        : `已识别 ${queueItems.length} 首。检查并修改信息后即可开始上传。`,
    );
    setIsPreparingQueue(false);
  }

  function updateQueueItem(itemId: string, fieldName: "title" | "artistName" | "albumTitle", value: string) {
    setQueue((currentQueue) => currentQueue.map((item) => (
      item.id === itemId ? { ...item, [fieldName]: value } : item
    )));
  }

  async function uploadTrack(queueItem: UploadQueueItem, playlistId: string, position: number) {
    const uploadLinkResponse = await fetch("/api/media/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentType: queueItem.file.type || "audio/mpeg",
        fileName: queueItem.file.name,
      }),
    });
    const uploadLinkData = (await uploadLinkResponse.json()) as SignedUploadResponse;

    if (
      !uploadLinkResponse.ok
      || !uploadLinkData.bucketName
      || !uploadLinkData.contentType
      || !uploadLinkData.objectKey
      || !uploadLinkData.signedUploadToken
    ) {
      throw new Error(uploadLinkData.error ?? "无法生成上传链接。");
    }

    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage
      .from(uploadLinkData.bucketName)
      .uploadToSignedUrl(
        uploadLinkData.objectKey,
        uploadLinkData.signedUploadToken,
        queueItem.file,
        { contentType: uploadLinkData.contentType },
      );

    if (uploadError) {
      throw new Error(`文件上传至 Supabase Storage 失败：${uploadError.message}`);
    }

    const { data: track, error: insertError } = await supabase
      .from("tracks")
      .insert({
        title: queueItem.title.trim() || getTitleFromFileName(queueItem.file.name),
        artist_name: queueItem.artistName.trim() || "未知歌手",
        album_title: queueItem.albumTitle.trim() || null,
        duration_seconds: queueItem.durationSeconds,
        audio_object_key: uploadLinkData.objectKey,
        mime_type: uploadLinkData.contentType,
      })
      .select("id")
      .single();

    if (insertError || !track) {
      throw new Error(`音乐文件已上传，但保存资料失败：${insertError?.message ?? "未知错误"}`);
    }

    const { error: playlistTrackError } = await supabase.from("playlist_tracks").insert({
      playlist_id: playlistId,
      track_id: track.id,
      position,
    });

    if (playlistTrackError) {
      throw new Error(`音乐文件已上传，但无法加入播放列表：${playlistTrackError.message}`);
    }
  }

  async function getOrCreatePlaylistId() {
    const normalizedPlaylistName = playlistName.trim();
    if (!normalizedPlaylistName) {
      throw new Error("请填写播放列表名称。");
    }

    const supabase = createSupabaseBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      throw new Error("请先登录后再上传音乐。");
    }

    const { data: existingPlaylist, error: existingPlaylistError } = await supabase
      .from("playlists")
      .select("id")
      .eq("owner_id", userData.user.id)
      .eq("name", normalizedPlaylistName)
      .maybeSingle();

    if (existingPlaylistError) {
      throw new Error(`无法读取播放列表：${existingPlaylistError.message}`);
    }

    if (existingPlaylist) {
      const { count, error: countError } = await supabase
        .from("playlist_tracks")
        .select("*", { count: "exact", head: true })
        .eq("playlist_id", existingPlaylist.id);

      if (countError) {
        throw new Error(`无法读取播放列表歌曲数量：${countError.message}`);
      }

      return { playlistId: existingPlaylist.id, nextPosition: count ?? 0 };
    }

    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .insert({ name: normalizedPlaylistName, owner_id: userData.user.id })
      .select("id")
      .single();

    if (playlistError || !playlist) {
      throw new Error(`无法创建播放列表：${playlistError?.message ?? "未知错误"}`);
    }

    return { playlistId: playlist.id, nextPosition: 0 };
  }

  async function uploadQueue() {
    const uploadableItems = queue.filter((item) => item.status === "ready" || item.status === "failed");

    if (uploadableItems.length === 0) {
      setStatusMessage("没有可上传的文件。请检查超过大小限制的文件。");
      return;
    }

    setIsUploading(true);
    let uploadedCount = 0;

    let uploadPlaylist: { nextPosition: number; playlistId: string };
    try {
      uploadPlaylist = await getOrCreatePlaylistId();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "无法创建播放列表。");
      setIsUploading(false);
      return;
    }

    for (const [queueIndex, queueItem] of uploadableItems.entries()) {
      setQueue((currentQueue) => currentQueue.map((item) => (
        item.id === queueItem.id ? { ...item, status: "uploading" } : item
      )));
      setStatusMessage(`正在上传 ${uploadedCount + 1} / ${uploadableItems.length}：${queueItem.title}`);

      try {
        await uploadTrack(queueItem, uploadPlaylist.playlistId, uploadPlaylist.nextPosition + queueIndex);
        uploadedCount += 1;
        setQueue((currentQueue) => currentQueue.map((item) => (
          item.id === queueItem.id ? { ...item, status: "uploaded" } : item
        )));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "上传时发生未知错误。";
        console.error("[upload-queue] Failed to upload track", {
          errorMessage,
          fileName: queueItem.file.name,
        });
        setQueue((currentQueue) => currentQueue.map((item) => (
          item.id === queueItem.id ? { ...item, errorMessage, status: "failed" } : item
        )));
      }
    }

    setStatusMessage(`上传完成：成功 ${uploadedCount} 首，失败 ${uploadableItems.length - uploadedCount} 首。`);
    setIsUploading(false);
  }

  return (
    <section className="upload-form" aria-label="批量上传音乐">
      <div className="file-dropzone">
        <span className="upload-icon" aria-hidden="true">↑</span>
        <strong>选择音乐文件或整个文件夹</strong>
        <small>自动读取曲名、歌手、专辑和时长；上传前可以修改。</small>
        <div className="file-picker-actions">
          <label className="button button-secondary" htmlFor="audioFiles">选择文件</label>
          <button className="button button-secondary" onClick={() => folderInput.current?.click()} type="button">选择文件夹</button>
        </div>
        <input accept="audio/*" id="audioFiles" multiple onChange={prepareQueue} type="file" />
        <input accept="audio/*" multiple onChange={prepareQueue} ref={folderInput} type="file" />
      </div>

      {queue.length > 0 && (
        <div className="upload-queue">
          <div className="upload-queue-heading">
            <strong>上传队列</strong>
            <span>{queue.length} 首</span>
          </div>
          <label className="playlist-name-field">
            所属播放列表 / 文件夹
            <input disabled={isUploading} onChange={(event) => setPlaylistName(event.target.value)} value={playlistName} />
          </label>
          {queue.map((queueItem) => (
            <article className="queue-item" key={queueItem.id}>
              <div className="queue-file-summary">
                <strong>{queueItem.file.name}</strong>
                <small>{formatFileSize(queueItem.file.size)}{queueItem.durationSeconds ? ` · ${Math.floor(queueItem.durationSeconds / 60)}:${String(queueItem.durationSeconds % 60).padStart(2, "0")}` : ""}</small>
              </div>
              <div className="queue-fields">
                <label>曲名<input disabled={isUploading || queueItem.status === "uploaded"} onChange={(event) => updateQueueItem(queueItem.id, "title", event.target.value)} value={queueItem.title} /></label>
                <label>歌手<input disabled={isUploading || queueItem.status === "uploaded"} onChange={(event) => updateQueueItem(queueItem.id, "artistName", event.target.value)} value={queueItem.artistName} /></label>
                <label>专辑<input disabled={isUploading || queueItem.status === "uploaded"} onChange={(event) => updateQueueItem(queueItem.id, "albumTitle", event.target.value)} value={queueItem.albumTitle} /></label>
              </div>
              <span className={`queue-status queue-status-${queueItem.status}`}>
                {queueItem.status === "ready" && "待上传"}
                {queueItem.status === "uploading" && "上传中"}
                {queueItem.status === "uploaded" && "已完成"}
                {queueItem.status === "failed" && "失败，可重试"}
                {queueItem.status === "too-large" && "超过 50 MB"}
              </span>
              {queueItem.errorMessage && <p className="queue-error" role="alert">失败原因：{queueItem.errorMessage}</p>}
            </article>
          ))}
        </div>
      )}

      <div className="upload-footer">
        <p aria-live="polite">{statusMessage}</p>
        <button className="button button-primary" disabled={isPreparingQueue || isUploading || queue.length === 0} onClick={() => void uploadQueue()} type="button">
          {isPreparingQueue ? "识别中..." : isUploading ? "上传中..." : "开始上传"}
        </button>
      </div>
    </section>
  );
}
