import { NextResponse } from "next/server";

import { environment } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DeleteTracksRequest = {
  deleteEntireLibrary?: boolean;
  playlistId?: string;
};

function splitIntoChunks<Item>(items: Item[], chunkSize: number) {
  return Array.from({ length: Math.ceil(items.length / chunkSize) }, (_, chunkIndex) => (
    items.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)
  ));
}

export async function DELETE(request: Request) {
  const requestBody = (await request.json()) as DeleteTracksRequest;
  const deleteEntireLibrary = requestBody.deleteEntireLibrary === true;

  if (deleteEntireLibrary === Boolean(requestBody.playlistId)) {
    return NextResponse.json(
      { error: "Specify either a playlist or the entire library to delete." },
      { status: 400 },
    );
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

  let trackIds: string[];

  if (deleteEntireLibrary) {
    const { data: tracks, error: tracksError } = await supabase
      .from("tracks")
      .select("id")
      .order("created_at", { ascending: true });

    if (tracksError) {
      return NextResponse.json({ error: tracksError.message }, { status: 500 });
    }

    trackIds = tracks.map((track) => track.id);
  } else {
    const { data: playlist, error: playlistError } = await supabase
      .from("playlists")
      .select("id")
      .eq("id", requestBody.playlistId)
      .eq("owner_id", userData.user.id)
      .single();

    if (playlistError || !playlist) {
      return NextResponse.json({ error: "Playlist not found." }, { status: 404 });
    }

    const { data: playlistTracks, error: playlistTracksError } = await supabase
      .from("playlist_tracks")
      .select("track_id")
      .eq("playlist_id", playlist.id);

    if (playlistTracksError) {
      return NextResponse.json({ error: playlistTracksError.message }, { status: 500 });
    }

    trackIds = playlistTracks.map((playlistTrack) => playlistTrack.track_id);
  }

  if (trackIds.length === 0) {
    return NextResponse.json({ deletedTrackCount: 0 });
  }

  const { data: tracks, error: tracksError } = await supabase
    .from("tracks")
    .select("id, audio_object_key")
    .in("id", trackIds);

  if (tracksError) {
    return NextResponse.json({ error: tracksError.message }, { status: 500 });
  }

  const objectKeys = tracks.map((track) => track.audio_object_key);
  for (const objectKeyChunk of splitIntoChunks(objectKeys, 100)) {
    const { error: storageDeleteError } = await supabase.storage
      .from(environment.supabaseStorageBucketName)
      .remove(objectKeyChunk);

    if (storageDeleteError) {
      console.error("[media/tracks] Failed to delete storage objects", {
        bucketName: environment.supabaseStorageBucketName,
        errorMessage: storageDeleteError.message,
        objectCount: objectKeyChunk.length,
        userId: userData.user.id,
      });
      return NextResponse.json({ error: `Unable to delete audio files: ${storageDeleteError.message}` }, { status: 500 });
    }
  }

  const { error: tracksDeleteError } = await supabase.from("tracks").delete().in("id", trackIds);

  if (tracksDeleteError) {
    return NextResponse.json({ error: tracksDeleteError.message }, { status: 500 });
  }

  if (!deleteEntireLibrary && requestBody.playlistId) {
    const { error: playlistDeleteError } = await supabase
      .from("playlists")
      .delete()
      .eq("id", requestBody.playlistId)
      .eq("owner_id", userData.user.id);

    if (playlistDeleteError) {
      return NextResponse.json({ error: playlistDeleteError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ deletedTrackCount: tracks.length });
}
