import { NextResponse } from "next/server";

import { environment } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(request: Request) {
  const requestBody = (await request.json()) as { trackId?: string };

  if (!requestBody.trackId) {
    return NextResponse.json({ error: "A track ID is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return NextResponse.json({ error: "Sign in to delete music." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.is_admin) {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const { data: track, error: trackError } = await supabase
    .from("tracks")
    .select("audio_object_key")
    .eq("id", requestBody.trackId)
    .single();

  if (trackError || !track) {
    return NextResponse.json({ error: "Track not found." }, { status: 404 });
  }

  const { error: databaseDeleteError } = await supabase
    .from("tracks")
    .delete()
    .eq("id", requestBody.trackId);

  if (databaseDeleteError) {
    return NextResponse.json({ error: databaseDeleteError.message }, { status: 500 });
  }

  const { error: storageDeleteError } = await supabase.storage
    .from(environment.supabaseStorageBucketName)
    .remove([track.audio_object_key]);

  if (storageDeleteError) {
    return NextResponse.json({
      warning: "歌曲资料已删除，但音频文件清理失败。请稍后在 Supabase Storage 中手动删除该文件。",
    });
  }

  return NextResponse.json({ success: true });
}
