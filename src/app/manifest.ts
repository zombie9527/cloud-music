import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "cloudmusic",
    short_name: "cloudmusic",
    description: "你的私有云端音乐播放器。",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5ef",
    theme_color: "#17201d",
    icons: [
      {
        src: "/icons/app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
