export type Track = {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  audioObjectKey: string;
};

export type LibraryPlaylist = {
  id: string | null;
  name: string;
  tracks: Track[];
};
