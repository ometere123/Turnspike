import { ImageResponse } from "next/og";

export const alt = "Turnpike: let agents pay for APIs within limits you set";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#faf9f6", color: "#14161a", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "#0b6e4f", display: "flex" }} />
          <div style={{ fontSize: 40, fontWeight: 700 }}>Turnpike</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2 }}>Let agents pay for APIs.</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2, color: "#6b6f76" }}>Within limits you set.</div>
        </div>
        <div style={{ fontSize: 30, color: "#4b4f56" }}>Per-request QUSDC payments on QIE Mainnet. Limits enforced by the contract. Unaudited.</div>
      </div>
    ),
    size,
  );
}
