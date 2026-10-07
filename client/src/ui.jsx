import { useEffect } from "react";

// Small shared UI pieces. All styling lives in styles.css (using tokens.css variables).

export function Btn({ children, onClick, disabled, variant = "secondary", hint, block, className = "", ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn btn--${variant}${hint && !disabled ? " btn--hint" : ""}${block ? " btn--block" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconBtn({ children, onClick, label, active, ...rest }) {
  return (
    <button type="button" className={`iconbtn${active ? " iconbtn--active" : ""}`} onClick={onClick} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

export function Pill({ children, tone = "neutral", className = "", ...rest }) {
  return <span className={`pill pill--${tone} ${className}`} {...rest}>{children}</span>;
}

export function Panel({ children, title, className = "" }) {
  return (
    <div className={`panel ${className}`}>
      {title && <div className="panel__title">{title}</div>}
      {children}
    </div>
  );
}

// Avatar circle: initial letter (or a robot for computer players) on a stable color
const PALETTE = ["var(--av-1)", "var(--av-2)", "var(--av-3)", "var(--av-4)", "var(--av-5)", "var(--av-6)", "var(--av-7)", "var(--av-8)"];
export function avatarColor(player) {
  let h = 0;
  for (const ch of player.name || "?") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function Avatar({ player, className = "", children, ...rest }) {
  const clean = (player.name || "?").replace(/^🤖\s*/, "");
  return (
    <div className={`avatar ${className}`} style={{ "--avc": avatarColor(player) }} {...rest}>
      <span className="avatar__letter">{clean.charAt(0).toUpperCase()}</span>
      {player.isBot && <span className="avatar__bot" aria-label="computer player">🤖</span>}
      {children}
    </div>
  );
}

// Bottom sheet (phone) / centered dialog (desktop)
export function Sheet({ open, onClose, title, children, side, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className={`sheet${side ? " sheet--side" : ""}${wide ? " sheet--wide" : ""}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <div className="sheet__title">{title}</div>
          <button type="button" className="iconbtn iconbtn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}

// How long a game lasts: first to a target score, or a fixed number of rounds
export function GameLengthPicker({ value, onChange }) {
  return (
    <div className="stack">
      <Field label="Game ends">
        <select
          className="select"
          value={value.mode}
          onChange={(e) => onChange(e.target.value === "rounds" ? { mode: "rounds", rounds: 5 } : { mode: "score", target: 100 })}
        >
          <option value="score">At a target score</option>
          <option value="rounds">After a set number of rounds</option>
        </select>
      </Field>
      {value.mode === "score" ? (
        <Field label="First to reach">
          <select className="select" value={value.target} onChange={(e) => onChange({ mode: "score", target: Number(e.target.value) })}>
            {[25, 50, 75, 100].map((n) => <option key={n} value={n}>{n} points{n === 100 ? " (classic)" : ""}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Rounds">
          <select className="select" value={value.rounds} onChange={(e) => onChange({ mode: "rounds", rounds: Number(e.target.value) })}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

export function lengthText(len) {
  if (!len) return "";
  return len.mode === "rounds" ? `${len.rounds} round${len.rounds === 1 ? "" : "s"}` : `first to ${len.target} points`;
}
