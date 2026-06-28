import type { MetadataRoute } from "next";

// PWA web app manifest. Next auto-injects the <link rel="manifest"> tag and
// serves this at /manifest.webmanifest. A single scalable SVG icon (declared
// "any maskable") satisfies installability in modern Chromium browsers; iOS
// uses the dynamically generated PNG from app/apple-icon.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FinTrack — Financial Simulation & Asset Tracking",
    short_name: "FinTrack",
    description: "Track your portfolio, net worth, and run financial simulations.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#059669",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
