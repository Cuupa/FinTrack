import { ImageResponse } from "next/og";

// iOS does not support SVG apple-touch-icons, so generate a real PNG at build
// time. Next serves this at /apple-icon and injects the <link rel="apple-touch-icon">.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#059669",
          color: "#ffffff",
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        F
      </div>
    ),
    size,
  );
}
