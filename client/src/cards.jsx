import { useEffect, useState } from "react";

// ── Responsive helper ───────────────────────────────────────────────────────
export function useIsMobile(breakpoint = 700) {
  const query = `(max-width: ${breakpoint}px)`;
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return mobile;
}

// ── Card display helpers ────────────────────────────────────────────────────

// Normalize any suit representation to a Unicode symbol
const SUIT_SYMBOL = {
  s: "♠", S: "♠", spades:   "♠",
  c: "♣", C: "♣", clubs:    "♣",
  h: "♥", H: "♥", hearts:   "♥",
  d: "♦", D: "♦", diamonds: "♦",
  "♠": "♠", "♣": "♣", "♥": "♥", "♦": "♦",
};

export function splitCard(card) {
  if (!card) return { rank: "", suit: "" };
  if (typeof card === "object" && card.rank !== undefined) {
    return { rank: String(card.rank), suit: SUIT_SYMBOL[card.suit] || card.suit || "" };
  }
  const s = String(card);
  const rawSuit = s.slice(-1);
  const rank    = s.slice(0, -1);
  return { rank, suit: SUIT_SYMBOL[rawSuit] || rawSuit };
}

function isRed(card) {
  const { suit } = splitCard(card);
  return suit === "♥" || suit === "♦";
}

// Highlight kinds drawn around cards when something happens at the table
const HIGHLIGHTS = {
  swap:    { color: "#ffd700", tag: "placed" },
  moved:   { color: "#4dd0e1", tag: "moved" },
  match:   { color: "#66bb6a", tag: "matched" },
  fail:    { color: "#ef5350", tag: "wrong!" },
  jack:    { color: "#ce93d8", tag: "swapped" },
  queen:   { color: "#64b5f6", tag: "peeked" },
  penalty: { color: "#ef5350", tag: "penalty" },
  pick:    { color: "#ffffff", tag: "" },
  hint:    { color: "#69f0ae", tag: "try this" },
};

const SIZES = {
  desktop: {
    xxs: { width: 24, height: 34, center: 9, corner: 6 },
    xs: { width: 34, height: 48, center: 13, corner: 8 },
    sm: { width: 48, height: 68, center: 18, corner: 10 },
    md: { width: 70, height: 98, center: 26, corner: 12 },
    lg: { width: 88, height: 124, center: 32, corner: 14 },
  },
  mobile: {
    xxs: { width: 22, height: 31, center: 9, corner: 6 },
    xs: { width: 30, height: 42, center: 12, corner: 7 },
    sm: { width: 40, height: 56, center: 16, corner: 9 },
    md: { width: 58, height: 82, center: 22, corner: 11 },
    lg: { width: 72, height: 102, center: 28, corner: 12 },
  },
};

export function cardDims(size, mobile) {
  const set = mobile ? SIZES.mobile : SIZES.desktop;
  return set[size] || set.md;
}

function frameStyle(s, { selected, highlight, onClick, dimmed, lifted }) {
  const h = highlight ? HIGHLIGHTS[highlight] : null;
  const ring = h ? h.color : selected ? "#ffd700" : null;
  return {
    width: s.width, height: s.height,
    borderRadius: 8,
    border: ring ? `3px solid ${ring}` : "2px solid #bbb",
    boxSizing: "border-box",
    cursor: onClick ? "pointer" : "default",
    boxShadow: ring
      ? `0 0 14px ${ring}, 2px 3px 8px rgba(0,0,0,0.5)`
      : "2px 3px 8px rgba(0,0,0,0.5)",
    position: "relative",
    userSelect: "none",
    flexShrink: 0,
    opacity: dimmed ? 0.6 : 1,
    transform: selected || lifted ? "translateY(-6px)" : "none",
    transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
    animation: h && highlight !== "pick" ? "cardPulse 0.9s ease-in-out 3" : undefined,
  };
}

function Tag({ highlight }) {
  const h = highlight ? HIGHLIGHTS[highlight] : null;
  if (!h || !h.tag) return null;
  return (
    <div style={{
      position: "absolute", top: -17, left: "50%", transform: "translateX(-50%)",
      background: h.color, color: "#111", fontSize: 10, fontWeight: "bold", fontFamily: "sans-serif",
      padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap", zIndex: 3, pointerEvents: "none",
    }}>{h.tag}</div>
  );
}

function SlotLabel({ label }) {
  if (label === undefined) return null;
  return (
    <div style={{ position: "absolute", bottom: -18, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#aed6f1", fontFamily: "sans-serif", pointerEvents: "none" }}>
      #{label}
    </div>
  );
}

export function CardFace({ card, size = "md", selected, onClick, label, dimmed, highlight, ...rest }) {
  const mobile = useIsMobile();
  const { rank, suit } = splitCard(card);
  const s = cardDims(size, mobile);
  const red = isRed(card);
  return (
    <div
      onClick={onClick}
      {...rest}
      style={{
        ...frameStyle(s, { selected, highlight, onClick, dimmed }),
        background: dimmed ? "#e8e8e8" : "#fffef8",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        color: red ? "#c0392b" : "#1a1a1a",
        fontFamily: "Georgia, 'Times New Roman', serif",
        ...rest.style,
      }}
    >
      <Tag highlight={highlight} />
      <div style={{ position: "absolute", top: 3, left: 5, fontSize: s.corner, lineHeight: 1.1, fontWeight: "bold" }}>
        {rank}<br />{suit}
      </div>
      <div style={{ fontSize: s.center, lineHeight: 1 }}>{suit}</div>
      <div style={{ position: "absolute", bottom: 3, right: 5, fontSize: s.corner, lineHeight: 1.1, fontWeight: "bold", transform: "rotate(180deg)" }}>
        {rank}<br />{suit}
      </div>
      <SlotLabel label={label} />
    </div>
  );
}

export function CardBack({ size = "md", selected, onClick, label, highlight, ...rest }) {
  const mobile = useIsMobile();
  const s = cardDims(size, mobile);
  return (
    <div
      onClick={onClick}
      {...rest}
      style={{
        ...frameStyle(s, { selected, highlight, onClick }),
        background: "repeating-linear-gradient(45deg, #1a237e, #1a237e 4px, #283593 4px, #283593 8px)",
        border: highlight || selected ? frameStyle(s, { selected, highlight }).border : "2px solid #555",
        display: "flex", alignItems: "center", justifyContent: "center",
        ...rest.style,
      }}
    >
      <Tag highlight={highlight} />
      <div style={{ width: "76%", height: "80%", border: "2px solid rgba(255,255,255,0.25)", borderRadius: 4, pointerEvents: "none" }} />
      <SlotLabel label={label} />
    </div>
  );
}
