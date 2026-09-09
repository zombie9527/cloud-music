import { NextResponse } from "next/server";

import { environment } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PLAYBACK_URL_LIFETIME_SECONDS = 15 * 60;

export async function POST(request: Request) {
  const requestBody = (await request.json()) as { trackId?: string };

  if (!requestBody.trackId) {
    return NextResponse.json({ error: "A track ID is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Sign in to play music." }, { status: 401 });
  }

  const { data: track, error: trackError } = await supabase
    .from("tracks")
    .select("audio_object_key")
    .eq("id", requestBody.trackId)
    .single();

  if (trackError || !track) {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(environment.supabaseStorageBucketName)
    .createSignedUrl(track.audio_object_key, PLAYBACK_URL_LIFETIME_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    return NextResponse.json(
      { error: signedUrlError?.message ?? "Unable to create a Supabase Storage playback URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({ playbackUrl: signedUrlData.signedUrl });
}
