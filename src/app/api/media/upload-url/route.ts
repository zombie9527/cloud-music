import { NextResponse } from "next/server";

import { environment } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const acceptedAudioTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

const audioTypeAliases = new Map([
  ["audio/x-m4a", "audio/m4a"],
  ["audio/x-aac", "audio/aac"],
  ["audio/x-wav", "audio/wav"],
  ["audio/vnd.wav", "audio/wav"],
]);

function normalizeAudioType(contentType: string) {
  return audioTypeAliases.get(contentType.toLowerCase()) ?? contentType.toLowerCase();
}

const audioTypesByExtension = new Map([
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["m4a", "audio/m4a"],
  ["mp3", "audio/mpeg"],
  ["mp4", "audio/mp4"],
  ["ogg", "audio/ogg"],
  ["wav", "audio/wav"],
  ["webm", "audio/webm"],
]);

function getFileExtension(fileName: string) {
  const fileExtension = fileName.split(".").pop()?.toLowerCase();
  return fileExtension && /^[a-z0-9]{1,8}$/.test(fileExtension)
    ? fileExtension
    : "audio";
}

function getAudioType(contentType: string | undefined, fileName: string) {
  const normalizedContentType = contentType && normalizeAudioType(contentType);
  if (normalizedContentType && acceptedAudioTypes.has(normalizedContentType)) {
    return normalizedContentType;
  }

  return audioTypesByExtension.get(getFileExtension(fileName));
}

export async function POST(request: Request) {
  const requestBody = (await request.json()) as {
    contentType?: string;
    fileName?: string;
  };

  if (!requestBody.fileName) {
    return NextResponse.json({ error: "A file name is required." }, { status: 400 });
  }

  const contentType = getAudioType(requestBody.contentType, requestBody.fileName);
  if (!contentType) {
    console.warn("[media/upload-url] Unsupported audio type", {
      contentType: requestBody.contentType,
      fileName: requestBody.fileName,
    });
    return NextResponse.json({ error: "Unsupported audio type." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Sign in to upload music." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const objectKey = `audio/${userData.user.id}/${crypto.randomUUID()}.${getFileExtension(requestBody.fileName)}`;
  const { data: signedUploadData, error: signedUploadError } = await supabase.storage
    .from(environment.supabaseStorageBucketName)
    .createSignedUploadUrl(objectKey);

  if (signedUploadError || !signedUploadData?.token) {
    console.error("[media/upload-url] Failed to create a signed upload URL", {
      bucketName: environment.supabaseStorageBucketName,
      errorCode: signedUploadError?.name,
      errorMessage: signedUploadError?.message,
      objectKey,
      userId: userData.user.id,
    });

    return NextResponse.json(
      { error: signedUploadError?.message ?? "Unable to create a Supabase Storage upload URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    bucketName: environment.supabaseStorageBucketName,
    contentType,
    objectKey: signedUploadData.path ?? objectKey,
    signedUploadToken: signedUploadData.token,
  });
}
