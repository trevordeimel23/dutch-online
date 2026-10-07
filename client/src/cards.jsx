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

// ── Card helpers ────────────────────────────────────────────────────────────

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

// Short tags shown above a card when something just happened to it
export const HIGHLIGHT_TAGS = {
  swap: "placed", moved: "moved", match: "matched", fail: "wrong", jack: "swapped",
  queen: "peeked", penalty: "penalty", pick: "", hint: "try this",
};

// Card width comes from a CSS variable (so it scales with the viewport); height is 1.4x the width.
const SIZE_VAR = {
  hand: "var(--card-hand)", pile: "var(--card-pile)", opp: "var(--card-opp)", oppS: "var(--card-opp-s)",
  big: "clamp(64px, 22vw, 120px)",
  handFit: "var(--hand-w, var(--card-hand))",
  // legacy names
  xxs: "var(--card-opp-s)", xs: "var(--card-opp)", sm: "var(--card-opp)", md: "var(--card-hand)", lg: "var(--card-pile)",
};

function cardStyle(size, extra) {
  return { "--w": SIZE_VAR[size] || SIZE_VAR.hand, ...extra };
}

function classes(base, { selected, highlight, onClick, dimmed }) {
  return [
    "card", base,
    selected ? "card--selected" : "",
    highlight ? "card--hl" : "",
    onClick ? "card--tap" : "",
    dimmed ? "card--dim" : "",
  ].filter(Boolean).join(" ");
}

function Tag({ highlight }) {
  const text = highlight ? HIGHLIGHT_TAGS[highlight] : "";
  if (!text) return null;
  return <div className="card__tag">{text}</div>;
}

function SlotLabel({ label }) {
  if (label === undefined) return null;
  return <div className="card__slot">{label}</div>;
}

export function CardFace({ card, size = "hand", selected, onClick, label, dimmed, highlight, style, className = "", ...rest }) {
  const { rank, suit } = splitCard(card);
  return (
    <div
      onClick={onClick}
      data-hl={highlight || undefined}
      {...rest}
      className={classes("card--face", { selected, highlight, onClick, dimmed }) + (isRed(card) ? " card--red" : "") + (className ? ` ${className}` : "")}
      style={cardStyle(size, style)}
    >
      <Tag highlight={highlight} />
      <div className="card__corner">{rank}<span>{suit}</span></div>
      <div className="card__pip">{suit}</div>
      <SlotLabel label={label} />
    </div>
  );
}

export function CardBack({ size = "hand", selected, onClick, label, highlight, style, className = "", ...rest }) {
  return (
    <div
      onClick={onClick}
      data-hl={highlight || undefined}
      {...rest}
      className={classes("card--back", { selected, highlight, onClick }) + (className ? ` ${className}` : "")}
      style={cardStyle(size, style)}
    >
      <Tag highlight={highlight} />
      <div className="card__back-inner" />
      <SlotLabel label={label} />
    </div>
  );
}
