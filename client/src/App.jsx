import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// ── Responsive helper ───────────────────────────────────────────────────────
function useIsMobile(breakpoint = 700) {
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

function splitCard(card) {
  if (!card) return { rank: "", suit: "" };
  // Object form: { rank: "A", suit: "h" } or { rank: "A", suit: "♥" }
  if (typeof card === "object" && card.rank !== undefined) {
    return { rank: String(card.rank), suit: SUIT_SYMBOL[card.suit] || card.suit || "" };
  }
  // String form: "Ah", "A♥", "10s", etc.
  const s = String(card);
  // Suit could be last 1 char (symbol) or last 1 char (letter abbrev)
  const rawSuit = s.slice(-1);
  const rank    = s.slice(0, -1);
  return { rank, suit: SUIT_SYMBOL[rawSuit] || rawSuit };
}

function isRed(card) {
  const { suit } = splitCard(card);
  return suit === "♥" || suit === "♦";
}

function cardStr(card) {
  if (!card) return null;
  const { rank, suit } = splitCard(card);
  return rank + suit;
}

function CardFace({ card, size = "md", selected, onClick, label, dimmed }) {
  const { rank, suit } = splitCard(card);
  const red = isRed(card);
  const mobile = useIsMobile();
  const sizes = mobile ? {
    sm: { width: 40, height: 56, center: 16, corner: 9 },
    md: { width: 58, height: 82, center: 22, corner: 11 },
    lg: { width: 72, height: 102, center: 28, corner: 12 },
  } : {
    sm: { width: 48, height: 68, center: 18, corner: 10 },
    md: { width: 70, height: 98, center: 26, corner: 12 },
    lg: { width: 88, height: 124, center: 32, corner: 14 },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div
      onClick={onClick}
      style={{
        width: s.width, height: s.height,
        background: dimmed ? "#e8e8e8" : "#fffef8",
        border: selected ? "3px solid #ffd700" : "2px solid #bbb",
        borderRadius: 8,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: onClick ? "pointer" : "default",
        color: red ? "#c0392b" : "#1a1a1a",
        boxShadow: selected
          ? "0 0 12px #ffd700, 2px 3px 8px rgba(0,0,0,0.5)"
          : "2px 3px 8px rgba(0,0,0,0.5)",
        position: "relative",
        userSelect: "none",
        fontFamily: "Georgia, 'Times New Roman', serif",
        flexShrink: 0,
        opacity: dimmed ? 0.6 : 1,
        transform: selected ? "translateY(-6px)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
    >
      <div style={{ position: "absolute", top: 3, left: 5, fontSize: s.corner, lineHeight: 1.1, fontWeight: "bold" }}>
        {rank}<br />{suit}
      </div>
      <div style={{ fontSize: s.center, lineHeight: 1 }}>{suit}</div>
      <div style={{ position: "absolute", bottom: 3, right: 5, fontSize: s.corner, lineHeight: 1.1, fontWeight: "bold", transform: "rotate(180deg)" }}>
        {rank}<br />{suit}
      </div>
      {label !== undefined && (
        <div style={{ position: "absolute", bottom: -20, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#aed6f1", fontFamily: "sans-serif" }}>
          #{label}
        </div>
      )}
    </div>
  );
}

function CardBack({ size = "md", selected, onClick, label }) {
  const mobile = useIsMobile();
  const sizes = mobile ? {
    sm: { width: 40, height: 56 },
    md: { width: 58, height: 82 },
    lg: { width: 72, height: 102 },
  } : {
    sm: { width: 48, height: 68 },
    md: { width: 70, height: 98 },
    lg: { width: 88, height: 124 },
  };
  const s = sizes[size] || sizes.md;
  return (
    <div
      onClick={onClick}
      style={{
        width: s.width, height: s.height,
        background: "repeating-linear-gradient(45deg, #1a237e, #1a237e 4px, #283593 4px, #283593 8px)",
        border: selected ? "3px solid #ffd700" : "2px solid #555",
        borderRadius: 8,
        cursor: onClick ? "pointer" : "default",
        boxShadow: selected
          ? "0 0 12px #ffd700, 2px 3px 8px rgba(0,0,0,0.5)"
          : "2px 3px 8px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        position: "relative",
        flexShrink: 0,
        transform: selected ? "translateY(-6px)" : "none",
        transition: "transform 0.15s",
      }}
    >
      <div style={{ width: "76%", height: "80%", border: "2px solid rgba(255,255,255,0.25)", borderRadius: 4 }} />
      {label !== undefined && (
        <div style={{ position: "absolute", bottom: -20, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#aed6f1", fontFamily: "sans-serif" }}>
          #{label}
        </div>
      )}
    </div>
  );
}

// ── Reusable styled components ──────────────────────────────────────────────

function Btn({ children, onClick, disabled, variant = "default", style: extra }) {
  const variants = {
    default: { background: "linear-gradient(to bottom, #c8a96e, #a0793a)", color: "#1a0a00", border: "1px solid #7a5522" },
    danger:  { background: "linear-gradient(to bottom, #e74c3c, #c0392b)", color: "#fff",    border: "1px solid #922b21" },
    success: { background: "linear-gradient(to bottom, #27ae60, #1e8449)", color: "#fff",    border: "1px solid #196f3d" },
    ghost:   { background: "rgba(255,255,255,0.1)",                         color: "#e8d5a3", border: "1px solid rgba(255,255,255,0.3)" },
  };
  const v = variants[variant] || variants.default;
  const mobile = useIsMobile();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...v,
        padding: mobile ? "10px 14px" : "8px 18px",
        minHeight: mobile ? 44 : undefined,
        touchAction: "manipulation",
        borderRadius: 6,
        fontFamily: "Georgia, serif",
        fontSize: mobile ? 15 : 14,
        fontWeight: "bold",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        boxShadow: disabled ? "none" : "0 2px 4px rgba(0,0,0,0.4)",
        letterSpacing: "0.02em",
        ...extra,
      }}
    >
      {children}
    </button>
  );
}

function Panel({ children, style: extra, title }) {
  const mobile = useIsMobile();
  return (
    <div style={{
      background: "rgba(0,0,0,0.25)",
      border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 10,
      padding: mobile ? "12px 12px" : "14px 18px",
      ...extra,
    }}>
      {title && (
        <div style={{ fontSize: 12, fontWeight: "bold", letterSpacing: "0.12em", textTransform: "uppercase", color: "#c8a96e", marginBottom: 10, borderBottom: "1px solid rgba(200,169,110,0.3)", paddingBottom: 6 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  const socket = useMemo(() => io(SERVER_URL), []);
  const mobile = useIsMobile();

  const [roomId, setRoomId]   = useState("TEST");
  const [name, setName]       = useState("Trevor");
  const [log, setLog]         = useState([]);
  const [room, setRoom]       = useState(null);
  const [me, setMe]           = useState(null);
  const [queenReveal, setQueenReveal] = useState(null); // private: card the player just peeked with a Queen
  const queenRevealTimerRef = useRef(null);

  const [lookCount, setLookCount]   = useState(2);
  const [peekPick, setPeekPick]     = useState([]);
  const [swapIndex, setSwapIndex]   = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [jackA, setJackA]           = useState({ playerId: "", index: 0 });
  const [jackB, setJackB]           = useState({ playerId: "", index: 0 });
  const [queenTarget, setQueenTarget] = useState({ playerId: "", index: 0 });
  const [aceTarget, setAceTarget]   = useState("");

  // 15-second card visibility timer
  const [visibleKnown, setVisibleKnown]   = useState({});
  const [peekTimeLeft, setPeekTimeLeft]   = useState(0);
  const expiryRef    = useRef({});
  const tickRef      = useRef(null);
  const prevKnownRef = useRef({});

  // Dutch window countdown
  const [dutchWindowSecondsLeft, setDutchWindowSecondsLeft] = useState(0);
  const dutchWindowTickRef = useRef(null);

  function startCardTick() {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      const now = Date.now();
      const expired = [];
      let minRemaining = Infinity;
      for (const [idx, expiresAt] of Object.entries(expiryRef.current)) {
        if (expiresAt <= now) { expired.push(idx); delete expiryRef.current[idx]; }
        else minRemaining = Math.min(minRemaining, expiresAt - now);
      }
      if (expired.length > 0) {
        setVisibleKnown((prev) => {
          const next = { ...prev };
          for (const idx of expired) delete next[idx];
          return next;
        });
      }
      if (Object.keys(expiryRef.current).length === 0) {
        clearInterval(tickRef.current);
        tickRef.current = null;
        setPeekTimeLeft(0);
      } else {
        setPeekTimeLeft(Math.ceil(minRemaining / 1000));
      }
    }, 500);
  }

  useEffect(() => {
    const onLog = (msg) => setLog((prev) => [...prev, msg]);

    const onRoomUpdate = (data) => {
      setRoom(data);
      if (data?.players?.length > 0) {
        const firstId = data.players[0].id;
        setJackA((p) => (p.playerId ? p : { playerId: firstId, index: 0 }));
        setJackB((p) => (p.playerId ? p : { playerId: firstId, index: 0 }));
        setQueenTarget((p) => (p.playerId ? p : { playerId: firstId, index: 0 }));
        setAceTarget((p) => p || firstId);
      }
    };

    const onMeUpdate = (data) => {
      setMe(data);
      if (data?.queenReveal) {
        setQueenReveal(data.queenReveal);
        clearTimeout(queenRevealTimerRef.current);
        queenRevealTimerRef.current = setTimeout(() => setQueenReveal(null), 15000);
      }
      const newKnown  = data?.known ?? {};
      const prevKnown = prevKnownRef.current;

      for (const idx of Object.keys(expiryRef.current)) {
        if (newKnown[idx] === undefined) delete expiryRef.current[idx];
      }

      const newlyRevealed = {};
      for (const [idx, card] of Object.entries(newKnown)) {
        if (prevKnown[idx] === undefined || prevKnown[idx] !== card) {
          newlyRevealed[idx] = card;
          expiryRef.current[idx] = Date.now() + 15000;
        }
      }

      setVisibleKnown((prev) => {
        const next = {};
        for (const [idx, card] of Object.entries(prev)) {
          if (newKnown[idx] !== undefined) next[idx] = card;
        }
        for (const [idx, card] of Object.entries(newlyRevealed)) {
          next[idx] = card;
        }
        return next;
      });

      if (Object.keys(newlyRevealed).length > 0) startCardTick();
      prevKnownRef.current = newKnown;
    };

    const onError = (e) => setLog((prev) => [...prev, `ERROR: ${e.message}`]);

    socket.on("log",         onLog);
    socket.on("room:update", onRoomUpdate);
    socket.on("me:update",   onMeUpdate);
    socket.on("error",       onError);

    return () => {
      socket.off("log",         onLog);
      socket.off("room:update", onRoomUpdate);
      socket.off("me:update",   onMeUpdate);
      socket.off("error",       onError);
      if (tickRef.current)          clearInterval(tickRef.current);
      if (dutchWindowTickRef.current) clearInterval(dutchWindowTickRef.current);
    };
  }, [socket]);

  // Dutch window countdown tick
  useEffect(() => {
    const endsAt      = room?.dutchWindowEndsAt;
    const windowPlayer = room?.dutchWindowPlayerId;

    if (endsAt && windowPlayer === socket.id) {
      if (dutchWindowTickRef.current) clearInterval(dutchWindowTickRef.current);
      dutchWindowTickRef.current = setInterval(() => {
        const remaining = Math.ceil((endsAt - Date.now()) / 1000);
        setDutchWindowSecondsLeft(remaining > 0 ? remaining : 0);
        if (remaining <= 0) {
          clearInterval(dutchWindowTickRef.current);
          dutchWindowTickRef.current = null;
        }
      }, 200);
    } else {
      if (dutchWindowTickRef.current) clearInterval(dutchWindowTickRef.current);
      setDutchWindowSecondsLeft(0);
    }

    return () => { if (dutchWindowTickRef.current) clearInterval(dutchWindowTickRef.current); };
  }, [room?.dutchWindowEndsAt, room?.dutchWindowPlayerId, socket.id]);

  const join     = () => socket.emit("room:join",   { roomId, name });
  const start    = () => socket.emit("game:start",  { roomId, lookCount });
  const newRound = () => socket.emit("game:newRound", { roomId, lookCount });

  const players = room?.players ?? [];
  const phase          = room?.phase ?? "LOBBY";
  const isNextDealer   = room?.nextDealerId === socket.id;
  const nextDealerName = players.find((p) => p.id === room?.nextDealerId)?.name;
  const isHost         = room?.hostId === socket.id;
  const isMyTurn       = room?.turnPlayerId === socket.id;
  const effectiveLookCount = room?.lookCount ?? lookCount;

  const togglePeekIndex = (i) => {
    setPeekPick((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      return [...prev, i].slice(0, effectiveLookCount);
    });
  };

  const submitPeek   = () => socket.emit("game:peek",  { roomId, indexes: peekPick });
  const pending       = me?.pendingDraw ?? null;
  const handSize      = me?.handSize ?? 0;
  const pendingEffect = room?.pendingEffect ?? null;
  const myEffect      = pendingEffect?.actorId === socket.id ? pendingEffect : null;
  const dutchCallerId = room?.dutchCallerId ?? null;
  const dutchCallerName = room?.players?.find((p) => p.id === dutchCallerId)?.name;
  const inDutchWindow = room?.dutchWindowPlayerId === socket.id;

  const canCallDutch = phase === "PLAY" && !dutchCallerId && !pendingEffect &&
    (inDutchWindow || (isMyTurn && !pending));

  const totals  = room?.totals  ?? {};

  // ── Shared felt background ─────────────────────────────────────────────────
  const feltBg = {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at center, #2d6a2d 0%, #1a4a1a 60%, #0f2e0f 100%)",
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: "#e8d5a3",
    padding: "0 0 40px 0",
    overflowX: "hidden",
  };

  // ── INPUT style ─────────────────────────────────────────────────────────────
  const inputStyle = {
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(200,169,110,0.5)",
    borderRadius: 6,
    color: "#e8d5a3",
    padding: "8px 12px",
    fontFamily: "Georgia, serif",
    fontSize: mobile ? 16 : 14, // 16px stops iOS zooming into inputs
    minHeight: mobile ? 40 : undefined,
    boxSizing: "border-box",
    outline: "none",
    width: 140,
  };

  const selectStyle = {
    ...inputStyle,
    width: "auto",
    cursor: "pointer",
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={feltBg}>

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(0,0,0,0.5)",
        borderBottom: "2px solid rgba(200,169,110,0.4)",
        padding: mobile ? "10px 12px" : "12px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 28 }}>🃏</span>
          <span style={{ fontSize: mobile ? 20 : 24, fontWeight: "bold", letterSpacing: "0.06em", color: "#f0d080" }}>DUTCH</span>
          {room && <span style={{ fontSize: 13, color: "#a89060", marginLeft: 8 }}>Room: <b style={{ color: "#e8d5a3" }}>{roomId.toUpperCase()}</b></span>}
        </div>

        {/* Join controls — always visible so player can change name/room */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", width: mobile ? "100%" : undefined }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{ ...inputStyle, width: mobile ? undefined : 120, flex: mobile ? "1 1 90px" : undefined, minWidth: 0 }}
          />
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            placeholder="Room ID"
            style={{ ...inputStyle, width: mobile ? undefined : 90, flex: mobile ? "1 1 70px" : undefined, minWidth: 0, textTransform: "uppercase" }}
          />
          <Btn onClick={join}>Join Room</Btn>
        </div>
      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1400, width: "100%", margin: "0 auto", padding: mobile ? "12px 10px" : "24px 28px", boxSizing: "border-box" }}>

        {/* ── SCORING SCREEN ──────────────────────────────────────────────── */}
        {phase === "SCORING" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, fontWeight: "bold", color: "#f0d080", letterSpacing: "0.05em" }}>
                {room.gameOver ? "🏆 Game Over!" : "📋 Round Results"}
              </div>
              {room.gameOver && room.winnerId && (
                <div style={{ fontSize: 22, color: "#ffd700", marginTop: 8 }}>
                  Winner: <b>{players.find((p) => p.id === room.winnerId)?.name}</b> 🎉
                </div>
              )}
            </div>

            <Panel>
              <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "#c8a96e", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    <th style={scoreThStyle}>Player</th>
                    <th style={scoreThStyle}>Hand</th>
                    <th style={scoreThStyle}>Round</th>
                    <th style={scoreThStyle}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => {
                    const hand       = room.revealedHands?.[p.id] ?? [];
                    const roundScore = room.roundScores?.[p.id] ?? 0;
                    const total      = totals[p.id] ?? 0;
                    const isDutch    = p.id === dutchCallerId;
                    const isWinner   = p.id === room.winnerId;
                    return (
                      <tr key={p.id} style={{
                        background: isDutch ? "rgba(255,215,0,0.1)" : "transparent",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                      }}>
                        <td style={scoreTdStyle}>
                          {isDutch && "🔔 "}{isWinner && "🏆 "}
                          <b style={{ color: p.id === socket.id ? "#ffd700" : "#e8d5a3" }}>{p.name}</b>
                          {p.id === socket.id && <span style={{ color: "#a89060", fontSize: 12 }}> (You)</span>}
                        </td>
                        <td style={{ ...scoreTdStyle, fontSize: 13, color: "#ccc" }}>{hand.join("  ")}</td>
                        <td style={{ ...scoreTdStyle, fontWeight: "bold", color: roundScore === 0 ? "#4caf50" : "#e8d5a3" }}>{roundScore}</td>
                        <td style={{ ...scoreTdStyle, fontWeight: "bold", color: total >= 80 ? "#e74c3c" : total >= 60 ? "#ff9800" : "#e8d5a3" }}>{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </Panel>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
              {isNextDealer && !room.gameOver && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                  <label style={{ fontSize: 14, color: "#c8a96e" }}>
                    You deal next — cards to peek
                    <select value={lookCount} onChange={(e) => setLookCount(Number(e.target.value))} style={{ ...selectStyle, marginLeft: 8 }}>
                      {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <Btn variant="success" onClick={newRound}>▶ Start Next Round</Btn>
                </div>
              )}
              {!isNextDealer && !room.gameOver && <span style={{ color: "#a89060", fontStyle: "italic" }}>Waiting for dealer {nextDealerName ?? ""} to choose peek cards and start the next round…</span>}
              {room.gameOver && isHost && <Btn variant="success" onClick={start}>🔄 New Game</Btn>}
            </div>
          </div>
        )}

        {/* ── ACTIVE GAME ─────────────────────────────────────────────────── */}
        {phase !== "SCORING" && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>

            {/* Left column: players + status */}
            <div style={{ flex: mobile ? "1 1 100%" : "0 0 240px", order: mobile ? 2 : 0, display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Players list */}
              {players.length > 0 && (
                <Panel title="Players">
                  {players.map((p) => {
                    const isTurn   = p.id === room?.turnPlayerId;
                    const isYou    = p.id === socket.id;
                    const isDutch  = p.id === dutchCallerId;
                    return (
                      <div key={p.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 8px",
                        borderRadius: 6,
                        background: isTurn ? "rgba(255,215,0,0.15)" : "transparent",
                        border: isTurn ? "1px solid rgba(255,215,0,0.4)" : "1px solid transparent",
                        marginBottom: 4,
                      }}>
                        <span>
                          {isTurn && <span style={{ color: "#ffd700", marginRight: 4 }}>▶</span>}
                          <b style={{ color: isYou ? "#ffd700" : "#e8d5a3" }}>{p.name}</b>
                          {isYou && <span style={{ color: "#a89060", fontSize: 11, marginLeft: 4 }}>(You)</span>}
                          {p.id === room?.hostId && <span style={{ color: "#a89060", fontSize: 11, marginLeft: 4 }}>♛</span>}
                          {isDutch && <span style={{ marginLeft: 4 }}>🔔</span>}
                        </span>
                        {totals[p.id] !== undefined && (
                          <span style={{ fontSize: 12, color: "#a89060" }}>{totals[p.id]}</span>
                        )}
                      </div>
                    );
                  })}
                </Panel>
              )}

              {/* Lobby / host controls */}
              {isHost && phase === "LOBBY" && (
                <Panel title="Host Controls">
                  <label style={{ display: "block", marginBottom: 10, fontSize: 13, color: "#c8a96e" }}>
                    Cards to peek
                    <input
                      type="number" min="0" max="4" value={lookCount}
                      onChange={(e) => setLookCount(Number(e.target.value))}
                      style={{ ...inputStyle, width: 50, marginLeft: 8, display: "inline" }}
                    />
                  </label>
                  <Btn variant="success" onClick={start} style={{ width: "100%" }}>Start Game</Btn>
                </Panel>
              )}

              {/* Status banners */}
              {room && (
                <Panel title="Status">
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: "#a89060" }}>Phase: </span>
                    <b style={{ color: "#ffd700" }}>{phase}</b>
                  </div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: "#a89060" }}>Deck: </span>
                    <b>{room.deckCount}</b> cards
                  </div>
                  {dutchCallerId && (
                    <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(255,215,0,0.15)", border: "1px solid rgba(255,215,0,0.4)", borderRadius: 6, fontSize: 13 }}>
                      🔔 <b>{dutchCallerName}</b> called Dutch!<br />
                      <span style={{ color: "#a89060" }}>{room.dutchTurnsLeft} turn(s) left</span>
                    </div>
                  )}
                  {pendingEffect && (
                    <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(33,150,243,0.15)", border: "1px solid rgba(33,150,243,0.4)", borderRadius: 6, fontSize: 13 }}>
                      ⚡ <b>{pendingEffect.type}</b> effect<br />
                      <span style={{ color: "#a89060" }}>{players.find((p) => p.id === pendingEffect.actorId)?.name} resolving</span>
                    </div>
                  )}
                </Panel>
              )}
            </div>

            {/* Right column: main game area */}
            <div style={{ flex: mobile ? "1 1 100%" : 1, order: mobile ? 1 : 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Discard pile */}
              {room && phase !== "LOBBY" && (
                <Panel title="Discard Pile">
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#a89060", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>Top card</div>
                      {room.discardTop
                        ? <CardFace card={room.discardTop} size="lg" />
                        : <div style={{ width: 88, height: 124, border: "2px dashed rgba(255,255,255,0.2)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 12 }}>empty</div>
                      }
                    </div>
                    <div style={{ fontSize: 12, color: "#a89060" }}>
                      Deck has <b style={{ color: "#e8d5a3" }}>{room.deckCount}</b> cards remaining
                    </div>
                  </div>
                </Panel>
              )}

              {/* PEEK PHASE */}
              {me && phase === "PEEK" && (
                <Panel title={`Peek Phase — Choose ${effectiveLookCount} Card${effectiveLookCount !== 1 ? "s" : ""}`}>
                  {!me.hasPeeked ? (
                    <>
                      <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>
                        Select <b style={{ color: "#ffd700" }}>{effectiveLookCount}</b> card(s) to peek at. You'll have 15 seconds to memorize them.
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                        {[0, 1, 2, 3].map((i) => (
                          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                            <CardBack
                              size="md"
                              selected={peekPick.includes(i)}
                              onClick={() => togglePeekIndex(i)}
                              label={i}
                            />
                          </div>
                        ))}
                      </div>
                      <Btn
                        variant="success"
                        disabled={peekPick.length !== effectiveLookCount}
                        onClick={submitPeek}
                      >
                        ✓ Confirm Peek ({peekPick.length}/{effectiveLookCount})
                      </Btn>
                    </>
                  ) : (
                    <div style={{ padding: "10px 14px", background: "rgba(76,175,80,0.15)", border: "1px solid rgba(76,175,80,0.4)", borderRadius: 6, fontSize: 14, color: "#81c784" }}>
                      ✓ Peek confirmed! Waiting for other players…
                    </div>
                  )}
                </Panel>
              )}

              {/* QUEEN PEEK RESULT (private to the player who used the Queen) */}
              {queenReveal && (
                <Panel title="♛ Queen Peek Result">
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <CardFace card={queenReveal.card} size="lg" />
                    <div style={{ fontSize: 14 }}>
                      <b style={{ color: "#ffd700" }}>{queenReveal.targetName}</b>'s card #{queenReveal.targetIndex}
                      <div style={{ fontSize: 12, color: "#a89060", marginTop: 6 }}>Only you can see this. Hides in 15 seconds.</div>
                      <Btn variant="ghost" style={{ marginTop: 8 }} onClick={() => setQueenReveal(null)}>Hide</Btn>
                    </div>
                  </div>
                </Panel>
              )}

              {/* YOUR HAND */}
              {me && phase !== "LOBBY" && (
                <Panel title={`Your Hand${peekTimeLeft > 0 ? ` — Cards hidden in ${peekTimeLeft}s` : ""}`}>
                  {peekTimeLeft > 0 && (
                    <div style={{ marginBottom: 10, padding: "4px 10px", background: "rgba(255,193,7,0.15)", border: "1px solid rgba(255,193,7,0.4)", borderRadius: 5, display: "inline-block", fontSize: 12, color: "#ffd700" }}>
                      ⏱ Cards hidden in <b>{peekTimeLeft}s</b>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", paddingBottom: 24 }}>
                    {Array.from({ length: handSize }).map((_, idx) => {
                      const knownCard = visibleKnown[idx];
                      const isMatchSelected = matchIndex === idx;
                      return knownCard ? (
                        <CardFace
                          key={idx}
                          card={knownCard}
                          size="md"
                          selected={phase === "PLAY" && isMatchSelected}
                          onClick={() => phase === "PLAY" && setMatchIndex(idx)}
                          label={idx}
                        />
                      ) : (
                        <CardBack
                          key={idx}
                          size="md"
                          selected={phase === "PLAY" && isMatchSelected}
                          onClick={() => phase === "PLAY" && setMatchIndex(idx)}
                          label={idx}
                        />
                      );
                    })}
                  </div>

                  {/* Match out of turn */}
                  {phase === "PLAY" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                      <span style={{ fontSize: 12, color: "#a89060" }}>Match card #{matchIndex} to discard:</span>
                      <Btn
                        disabled={!room?.discardTop || handSize === 0}
                        onClick={() => socket.emit("match:attempt", { roomId, index: matchIndex })}
                      >
                        Attempt Match
                      </Btn>
                    </div>
                  )}
                </Panel>
              )}

              {/* DUTCH WINDOW */}
              {inDutchWindow && (
                <div style={{
                  padding: "16px 20px",
                  background: "rgba(255,193,7,0.18)",
                  border: "2px solid rgba(255,193,7,0.7)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}>
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: 16, color: "#ffd700", marginBottom: 4 }}>Call Dutch?</div>
                    <div style={{ fontSize: 12, color: "#a89060" }}>Window closes in</div>
                    <div style={{ fontSize: 36, fontWeight: "bold", color: dutchWindowSecondsLeft <= 3 ? "#e74c3c" : "#ffd700", lineHeight: 1 }}>
                      {dutchWindowSecondsLeft}s
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Btn variant="danger" onClick={() => socket.emit("dutch:call", { roomId })}>🔔 Call Dutch</Btn>
                    <Btn variant="ghost"  onClick={() => socket.emit("turn:end",   { roomId })}>Pass Turn</Btn>
                  </div>
                </div>
              )}

              {/* TURN CONTROLS */}
              {me && phase === "PLAY" && !myEffect && !inDutchWindow && (
                <Panel title={isMyTurn ? "Your Turn" : "Waiting…"}>
                  {isMyTurn
                    ? <div style={{ fontSize: 13, color: "#81c784", marginBottom: 12 }}>▶ It's your turn! Draw a card or call Dutch.</div>
                    : <div style={{ fontSize: 13, color: "#a89060", marginBottom: 12 }}>Waiting for <b style={{ color: "#e8d5a3" }}>{players.find(p => p.id === room?.turnPlayerId)?.name ?? "..."}</b> to play.</div>
                  }

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                    <Btn
                      disabled={!isMyTurn || !!pending || !!pendingEffect}
                      onClick={() => socket.emit("turn:draw", { roomId, source: "DECK" })}
                    >
                      🂠 Draw from Deck
                    </Btn>
                    <Btn
                      disabled={!isMyTurn || !!pending || !room.discardTop || !!pendingEffect}
                      onClick={() => socket.emit("turn:draw", { roomId, source: "DISCARD" })}
                    >
                      ↑ Take Discard
                    </Btn>
                    <Btn
                      variant={canCallDutch ? "danger" : "ghost"}
                      disabled={!canCallDutch}
                      onClick={() => socket.emit("dutch:call", { roomId })}
                    >
                      🔔 Call Dutch
                    </Btn>
                  </div>

                  {/* Drawn card options */}
                  {pending && (
                    <div style={{ marginTop: 4, padding: "12px 14px", background: "rgba(0,0,0,0.2)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }}>
                      <div style={{ fontSize: 13, color: "#a89060", marginBottom: 10 }}>
                        Drawn from <b style={{ color: "#e8d5a3" }}>{pending.source}</b>:
                      </div>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, flexWrap: "wrap" }}>
                        <div>
                          <CardFace card={pending.card} size="lg" />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          <Btn
                            disabled={!isMyTurn || pending.source !== "DECK"}
                            onClick={() => socket.emit("turn:discard-drawn", { roomId })}
                          >
                            Discard it
                          </Btn>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, color: "#a89060" }}>Swap into slot</span>
                            <select
                              value={swapIndex}
                              onChange={(e) => setSwapIndex(Number(e.target.value))}
                              style={selectStyle}
                            >
                              {Array.from({ length: handSize }).map((_, i) => <option key={i} value={i}>#{i}</option>)}
                            </select>
                            <Btn
                              disabled={!isMyTurn}
                              onClick={() => socket.emit("turn:swap", { roomId, index: swapIndex })}
                            >
                              Swap
                            </Btn>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </Panel>
              )}

              {/* JACK EFFECT */}
              {myEffect?.type === "JACK" && (
                <Panel title="♠ Jack Effect — Swap Two Cards">
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Choose any two cards from any players to swap.</div>
                  <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
                    {[["Card A", jackA, setJackA], ["Card B", jackB, setJackB]].map(([label, val, setter]) => (
                      <div key={label} style={{ background: "rgba(0,0,0,0.2)", padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }}>
                        <div style={{ fontWeight: "bold", color: "#c8a96e", marginBottom: 10, fontSize: 13 }}>{label}</div>
                        <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "#a89060" }}>
                          Player:&nbsp;
                          <select value={val.playerId} onChange={(e) => setter((p) => ({ ...p, playerId: e.target.value }))} style={selectStyle}>
                            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </label>
                        <label style={{ display: "block", fontSize: 13, color: "#a89060" }}>
                          Slot:&nbsp;
                          <input type="number" min="0" max="10" value={val.index}
                            onChange={(e) => setter((p) => ({ ...p, index: Number(e.target.value) }))}
                            style={{ ...inputStyle, width: 55, display: "inline" }} />
                        </label>
                      </div>
                    ))}
                  </div>
                  <Btn variant="success" onClick={() => socket.emit("effect:jack", { roomId, a: jackA, b: jackB })}>✓ Confirm Swap</Btn>
                </Panel>
              )}

              {/* QUEEN EFFECT */}
              {myEffect?.type === "QUEEN" && (
                <Panel title="♛ Queen Effect — Peek Any Card">
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Peek at any one card from any player's hand.</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
                    <label style={{ fontSize: 13, color: "#a89060" }}>
                      Player:&nbsp;
                      <select value={queenTarget.playerId} onChange={(e) => setQueenTarget((p) => ({ ...p, playerId: e.target.value }))} style={selectStyle}>
                        {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <label style={{ fontSize: 13, color: "#a89060" }}>
                      Slot:&nbsp;
                      <input type="number" min="0" max="10" value={queenTarget.index}
                        onChange={(e) => setQueenTarget((p) => ({ ...p, index: Number(e.target.value) }))}
                        style={{ ...inputStyle, width: 55, display: "inline" }} />
                    </label>
                  </div>
                  <Btn variant="success" onClick={() => socket.emit("effect:queen", { roomId, targetPlayerId: queenTarget.playerId, targetIndex: queenTarget.index })}>
                    👁 Confirm Peek
                  </Btn>
                </Panel>
              )}

              {/* ACE EFFECT */}
              {myEffect?.type === "ACE" && (
                <Panel title="♠ Ace Effect — Peek Your Own Card">
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Peek at one of your own cards.</div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
                    <label style={{ fontSize: 13, color: "#a89060" }}>
                      Target:&nbsp;
                      <select value={aceTarget} onChange={(e) => setAceTarget(e.target.value)} style={selectStyle}>
                        {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                  </div>
                  <Btn variant="success" onClick={() => socket.emit("effect:ace", { roomId, targetPlayerId: aceTarget })}>
                    Give Penalty Card
                  </Btn>
                </Panel>
              )}

            </div>{/* end right column */}
          </div>
        )}

        {/* ── Activity log ─────────────────────────────────────────────────── */}
        {log.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <Panel title="Activity Log">
              <div style={{ maxHeight: 130, overflowY: "auto", fontSize: 12, color: "#a89060" }}>
                {log.slice(-25).map((l, i) => (
                  <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ color: "#666", marginRight: 6 }}>{log.length - 25 + i + 1}.</span>{l}
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

      </div>{/* end max-width wrapper */}
    </div>
  );
}

// ── Score table cell styles ────────────────────────────────────────────────
const scoreThStyle = {
  padding: "8px 14px",
  textAlign: "left",
  fontWeight: "bold",
  borderBottom: "1px solid rgba(200,169,110,0.3)",
};
const scoreTdStyle = {
  padding: "10px 14px",
  verticalAlign: "middle",
};
