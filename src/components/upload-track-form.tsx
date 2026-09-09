"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const MAX_FREE_PLAN_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type UploadQueueItem = {
  albumTitle: string;
  artistName: string;
  durationSeconds: number | null;
  file: File;
  id: string;
  status: "ready" | "uploading" | "uploaded" | "failed" | "too-large";
  title: string;
};

type SignedUploadResponse = {
  bucketName?: string;
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
    const filesOverFreePlanLimit = queueItems.filter((item) => item.status === "too-large").length;
    setQueue(queueItems);
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

  async function uploadTrack(queueItem: UploadQueueItem) {
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
        { contentType: queueItem.file.type || "audio/mpeg" },
      );

    if (uploadError) {
      throw new Error(`文件上传至 Supabase Storage 失败：${uploadError.message}`);
    }

    const { error: insertError } = await supabase.from("tracks").insert({
      title: queueItem.title.trim() || getTitleFromFileName(queueItem.file.name),
      artist_name: queueItem.artistName.trim() || "未知歌手",
      album_title: queueItem.albumTitle.trim() || null,
      duration_seconds: queueItem.durationSeconds,
      audio_object_key: uploadLinkData.objectKey,
      mime_type: queueItem.file.type || "audio/mpeg",
    });

    if (insertError) {
      throw new Error(`音乐文件已上传，但保存资料失败：${insertError.message}`);
    }
  }

  async function uploadQueue() {
    const uploadableItems = queue.filter((item) => item.status === "ready" || item.status === "failed");

    if (uploadableItems.length === 0) {
      setStatusMessage("没有可上传的文件。请检查超过大小限制的文件。");
      return;
    }

    setIsUploading(true);
    let uploadedCount = 0;

    for (const queueItem of uploadableItems) {
      setQueue((currentQueue) => currentQueue.map((item) => (
        item.id === queueItem.id ? { ...item, status: "uploading" } : item
      )));
      setStatusMessage(`正在上传 ${uploadedCount + 1} / ${uploadableItems.length}：${queueItem.title}`);

      try {
        await uploadTrack(queueItem);
        uploadedCount += 1;
        setQueue((currentQueue) => currentQueue.map((item) => (
          item.id === queueItem.id ? { ...item, status: "uploaded" } : item
        )));
      } catch {
        setQueue((currentQueue) => currentQueue.map((item) => (
          item.id === queueItem.id ? { ...item, status: "failed" } : item
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
