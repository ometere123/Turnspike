import { ImageResponse } from "next/og";

export const alt = "Turnspike: agents pay at the gate, owners set the toll";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const stripes = "repeating-linear-gradient(-45deg, #F2B705 0 22px, #1B1F24 22px 44px)";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#E9EDE6", color: "#1B1F24", fontFamily: "sans-serif" }}>
        <div style={{ height: 22, background: stripes, display: "flex" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 72px" }}>
          <div style={{ fontSize: 40, fontWeight: 800 }}>Turnspike</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1, letterSpacing: -3 }}>Agents pay at the gate.</div>
            <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1, letterSpacing: -3 }}>Owners set the toll.</div>
          </div>
          <div style={{ fontSize: 28, color: "#4A525A" }}>Per-request QUSDC payments on QIE Mainnet. Limits enforced by the contract. Unaudited.</div>
        </div>
      </div>
    ),
    size,
  );
}
