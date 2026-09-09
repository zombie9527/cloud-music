export type Track = {
  id: string;
  title: string;
  artistName: string;
  albumTitle: string | null;
  durationSeconds: number | null;
  artworkUrl: string | null;
  audioObjectKey: string;
};

export type LibrarySection = {
  title: string;
  description: string;
  tracks: Track[];
};
