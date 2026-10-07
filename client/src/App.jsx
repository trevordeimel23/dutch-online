import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

import { useIsMobile, CardFace, CardBack, splitCard } from "./cards.jsx";
import Table from "./Table.jsx";
import Rules from "./Rules.jsx";

// Short two-tone chime (silently skipped if the browser blocks audio)
function playChime(freqs = [660, 880]) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.14 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.14);
      osc.stop(ctx.currentTime + i * 0.14 + 0.4);
    });
    setTimeout(() => ctx.close(), 1200);
  } catch { /* audio is optional */ }
}

function useWindowHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return h;
}

// ── Reusable styled components ──────────────────────────────────────────────

function Btn({ children, onClick, disabled, variant = "default", style: extra, hint }) {
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
        ...(hint && !disabled ? { outline: "3px solid #69f0ae", outlineOffset: 2, animation: "hintPulse 1.1s ease-in-out infinite" } : null),
        ...extra,
      }}
    >
      {children}
    </button>
  );
}

// Choose how long a game lasts: first to a target score, or a fixed number of rounds
function GameLengthPicker({ value, onChange, selectStyle }) {
  const row = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#c8a96e" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={row}>
        Game ends
        <select
          value={value.mode}
          onChange={(e) => onChange(e.target.value === "rounds" ? { mode: "rounds", rounds: 5 } : { mode: "score", target: 100 })}
          style={selectStyle}
        >
          <option value="score">At a target score</option>
          <option value="rounds">After a set number of rounds</option>
        </select>
      </label>
      {value.mode === "score" ? (
        <label style={row}>
          First to reach
          <select value={value.target} onChange={(e) => onChange({ mode: "score", target: Number(e.target.value) })} style={selectStyle}>
            {[25, 50, 75, 100].map((n) => <option key={n} value={n}>{n} points{n === 100 ? " (classic)" : ""}</option>)}
          </select>
        </label>
      ) : (
        <label style={row}>
          Rounds
          <select value={value.rounds} onChange={(e) => onChange({ mode: "rounds", rounds: Number(e.target.value) })} style={selectStyle}>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function lengthText(len) {
  if (!len) return "";
  return len.mode === "rounds" ? `${len.rounds} round${len.rounds === 1 ? "" : "s"}` : `first to ${len.target} points`;
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
  const [botCount, setBotCount] = useState(3);
  const [botSpeed, setBotSpeed] = useState("normal");
  const [gameLength, setGameLength] = useState({ mode: "score", target: 100 });
  const [tutorialLength, setTutorialLength] = useState({ mode: "rounds", rounds: 3 });
  const [tutorialBots, setTutorialBots] = useState(1);
  const [tutorialShowAll, setTutorialShowAll] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [coach, setCoach] = useState(null); // tutorial advice from the server
  const [botDifficulty, setBotDifficulty] = useState("medium");
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

  // Cards you've peeked at stay visible for 15s. Tracked by card (a deck has no duplicates), not slot,
  // so rearranging, removing or matching cards can't reset or re-trigger a reveal.
  const [visibleCards, setVisibleCards] = useState({});
  const [peekTimeLeft, setPeekTimeLeft] = useState(0);
  const expiryRef    = useRef({});
  const seenCardsRef = useRef(new Set());
  const tickRef      = useRef(null);

  // Highlights from table events: "playerId:slot" -> kind (swap | moved | jack | queen | penalty | fail)
  const [highlights, setHighlights] = useState({});
  const [arrows, setArrows]       = useState([]);   // arrows drawn on the table for a few seconds
  const [actions, setActions]       = useState([]);   // last few things that happened, shown above the table
  const lastDrawRef  = useRef(null);
  const playersRef   = useRef([]);
  const [banner, setBanner]       = useState(null); // full-screen pop: { kind: "turn" | "dutch", text, sub }
  const bannerTimerRef = useRef(null);
  const prevTurnRef    = useRef(null);
  const prevDutchRef   = useRef(undefined);
  const logRef         = useRef(null);
  const windowHeight   = useWindowHeight();
  playersRef.current   = room?.players ?? [];
  const [graceLeft, setGraceLeft] = useState(0);
  const [dockEl, setDockEl]     = useState(null);
  const [dockHeight, setDockHeight] = useState(140);
  useEffect(() => {
    if (!dockEl) return undefined;
    const ro = new ResizeObserver(() => setDockHeight(dockEl.offsetHeight));
    ro.observe(dockEl);
    setDockHeight(dockEl.offsetHeight);
    return () => ro.disconnect();
  }, [dockEl]);
  const [jackStep, setJackStep]     = useState(0); // which Jack target the next table tap fills in

  // Dutch window countdown
  const [dutchWindowSecondsLeft, setDutchWindowSecondsLeft] = useState(0);
  const dutchWindowTickRef = useRef(null);

  function startCardTick() {
    if (tickRef.current) return;
    tickRef.current = setInterval(() => {
      const now = Date.now();
      const expired = [];
      let minRemaining = Infinity;
      for (const [card, expiresAt] of Object.entries(expiryRef.current)) {
        if (expiresAt <= now) { expired.push(card); delete expiryRef.current[card]; }
        else minRemaining = Math.min(minRemaining, expiresAt - now);
      }
      if (expired.length > 0) {
        setVisibleCards((prev) => {
          const next = { ...prev };
          for (const card of expired) delete next[card];
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

  function addHighlights(entries) {
    setHighlights((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    setTimeout(() => {
      setHighlights((prev) => {
        const next = { ...prev };
        for (const [key, kind] of entries) if (next[key] === kind) delete next[key];
        return next;
      });
    }, 6000);
  }

  function addArrows(list) {
    const stamped = list.map((a, i) => ({ ...a, id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}` }));
    setArrows((prev) => [...prev, ...stamped]);
    setTimeout(() => setArrows((prev) => prev.filter((a) => !stamped.some((s) => s.id === a.id))), 6000);
  }

  function addAction(text, color) {
    setActions((prev) => [...prev.slice(-1), { text, color, id: Date.now() + Math.random() }]);
  }

  useEffect(() => {
    const onLog = (msg) => setLog((prev) => [...prev, msg]);

    const onRoomUpdate = (data) => {
      setRoom(data);
      if (data?.phase === "SCORING" || data?.phase === "LOBBY") {
        seenCardsRef.current.clear();
        expiryRef.current = {};
        setVisibleCards({});
        setPeekTimeLeft(0);
      }
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
        queenRevealTimerRef.current = setTimeout(() => setQueenReveal(null), 20000);
      }
      const knownCards = new Set(Object.values(data?.known ?? {}));

      for (const card of Object.keys(expiryRef.current)) {
        if (!knownCards.has(card)) delete expiryRef.current[card];
      }
      const fresh = [];
      for (const card of knownCards) {
        if (!seenCardsRef.current.has(card)) {
          seenCardsRef.current.add(card);
          expiryRef.current[card] = Date.now() + 15000;
          fresh.push(card);
        }
      }
      setVisibleCards((prev) => {
        const next = {};
        for (const card of Object.keys(prev)) if (knownCards.has(card)) next[card] = true;
        for (const card of fresh) next[card] = true;
        return next;
      });
      if (fresh.length > 0) startCardTick();
    };

    const onTableEvent = (ev) => {
      const key = (pid, i) => `${pid}:${i}`;
      const nameOf = (pid) => playersRef.current.find((p) => p.id === pid)?.name ?? "Someone";
      const label = (card) => { const { rank, suit } = splitCard(card); return `${rank}${suit}`; };
      const who = nameOf(ev.playerId);

      if (ev.type === "draw") {
        lastDrawRef.current = { playerId: ev.playerId, source: ev.source };
        addAction(`${who} drew from the ${ev.source === "DECK" ? "deck" : "discard pile"}`, "#a8c8a8");
      } else if (ev.type === "discard") {
        addAction(`${who} discarded ${label(ev.card)}`, "#ffd700");
      } else if (ev.type === "swap") {
        const src = lastDrawRef.current?.playerId === ev.playerId ? lastDrawRef.current.source : "DECK";
        addHighlights([[key(ev.playerId, ev.index), "swap"]]);
        addArrows([
          { from: src === "DECK" ? "deck" : "discard", to: key(ev.playerId, ev.index), color: "#66bb6a", label: "in" },
          { from: key(ev.playerId, ev.index), to: "discard", color: "#ffd700", label: "out" },
        ]);
        addAction(`${who} swapped the drawn card into slot #${ev.index} — old card ${label(ev.card)} was discarded`, "#ffd700");
      } else if (ev.type === "reorder") {
        addHighlights([[key(ev.playerId, ev.to), "moved"]]);
        addAction(`${who} moved card #${ev.from} to slot #${ev.to}`, "#4dd0e1");
      } else if (ev.type === "match") {
        if (ev.ok) {
          addAction(`${who} matched with ${label(ev.card)} (their slot #${ev.index}) — it goes on the discard pile`, "#66bb6a");
        } else {
          addHighlights([[key(ev.playerId, ev.index), "fail"]]);
          addAction(`${who} tried to match — wrong! Penalty card added (slot #${ev.index})`, "#ef5350");
        }
      } else if (ev.type === "jack") {
        addHighlights([[key(ev.a.playerId, ev.a.index), "jack"], [key(ev.b.playerId, ev.b.index), "jack"]]);
        addArrows([{ from: key(ev.a.playerId, ev.a.index), to: key(ev.b.playerId, ev.b.index), color: "#ce93d8", both: true, label: "swap" }]);
        addAction(`${who} used Jack: ${nameOf(ev.a.playerId)}'s #${ev.a.index} ⇄ ${nameOf(ev.b.playerId)}'s #${ev.b.index}`, "#ce93d8");
      } else if (ev.type === "queen") {
        addHighlights([[key(ev.targetPlayerId, ev.index), "queen"]]);
        addAction(`${who} peeked at ${nameOf(ev.targetPlayerId)}'s card #${ev.index}`, "#64b5f6");
      } else if (ev.type === "ace") {
        addHighlights([[key(ev.targetPlayerId, ev.index), "penalty"]]);
        addAction(`${who} gave ${nameOf(ev.targetPlayerId)} a penalty card`, "#ef5350");
      }
    };

    const onError = (e) => setLog((prev) => [...prev, `ERROR: ${e.message}`]);

    socket.on("log",         onLog);
    socket.on("room:update", onRoomUpdate);
    socket.on("me:update",   onMeUpdate);
    socket.on("error",       onError);
    socket.on("table:event", onTableEvent);
    const onCoach = (advice) => setCoach(advice);
    socket.on("coach:advice", onCoach);
    const onRoomCreated = ({ roomId: id }) => setRoomId(id);
    socket.on("room:created", onRoomCreated);

    return () => {
      socket.off("log",         onLog);
      socket.off("room:update", onRoomUpdate);
      socket.off("me:update",   onMeUpdate);
      socket.off("error",       onError);
      socket.off("table:event", onTableEvent);
      socket.off("room:created", onRoomCreated);
      socket.off("coach:advice", onCoach);
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

  function showBanner(b, ms) {
    setBanner(b);
    clearTimeout(bannerTimerRef.current);
    bannerTimerRef.current = setTimeout(() => setBanner(null), ms);
  }

  // Big pop when someone calls Dutch
  useEffect(() => {
    const caller = room?.dutchCallerId ?? null;
    if (prevDutchRef.current !== undefined && caller && prevDutchRef.current !== caller) {
      const callerName = room.players.find((p) => p.id === caller)?.name ?? "Someone";
      showBanner({ kind: "dutch", text: `${callerName} calls Dutch!`, sub: "Everyone else gets one more turn" }, 3200);
      playChime([523, 392, 262]);
    }
    prevDutchRef.current = caller;
  }, [room?.dutchCallerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pop + chime + tab title when it becomes your turn
  const myTurnNow = room?.phase === "PLAY" && room?.turnPlayerId === socket.id;
  useEffect(() => {
    if (myTurnNow && prevTurnRef.current !== true) {
      setBanner((b) => (b?.kind === "dutch" ? b : { kind: "turn", text: "Your turn!", sub: "" }));
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBanner((b) => (b?.kind === "turn" ? null : b)), 1400);
      playChime();
    }
    prevTurnRef.current = myTurnNow;
    document.title = myTurnNow ? "▶ Your turn! — Dutch" : "Dutch";
  }, [myTurnNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown for the final match window
  useEffect(() => {
    const endsAt = room?.finalGraceEndsAt;
    if (!endsAt) { setGraceLeft(0); return undefined; }
    const tick = () => setGraceLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [room?.finalGraceEndsAt]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  const playBots = () => socket.emit("room:playBots", { name, botCount, speed: botSpeed, difficulty: botDifficulty, gameLength });
  const startTutorial = () => socket.emit("room:playBots", {
    name, botCount: tutorialBots, speed: "normal", difficulty: "easy", gameLength: tutorialLength, tutorial: true, showAllCards: tutorialShowAll,
  });
  const changeBotSettings = (patch) => socket.emit("room:botSettings", { roomId, ...patch });
  const serverLen = room?.gameLength;
  useEffect(() => {
    if (room?.phase === "LOBBY" && serverLen) setGameLength({ ...serverLen });
  }, [room?.phase, serverLen?.mode, serverLen?.target, serverLen?.rounds]); // eslint-disable-line react-hooks/exhaustive-deps

  const join     = () => socket.emit("room:join",   { roomId, name });
  const start    = () => socket.emit("game:start",  { roomId, lookCount, gameLength });
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
  const myEffect      = (pendingEffect?.actorId === socket.id ? pendingEffect : null) ?? (me?.matchEffect ? { type: me.matchEffect, actorId: socket.id } : null);
  const dutchCallerId = room?.dutchCallerId ?? null;
  const dutchCallerName = room?.players?.find((p) => p.id === dutchCallerId)?.name;
  const inDutchWindow = room?.dutchWindowPlayerId === socket.id;

  const totals  = room?.totals  ?? {};

  const selIdx      = Math.min(matchIndex, Math.max(handSize - 1, 0));
  const getVisibleCard = (i) => {
    if (me?.fullHand) return me.fullHand[i] ?? null;
    const card = me?.known?.[i];
    return card && visibleCards[card] ? card : null;
  };
  // Tutorial: fill in the coach's suggested targets so you only have to confirm
  const coachKey = JSON.stringify(coach?.action ?? null);
  useEffect(() => {
    const a = coach?.action;
    if (!room?.tutorial || !a) return;
    if (a.type === "jack") { setJackA({ ...a.a }); setJackB({ ...a.b }); setJackStep(0); }
    if (a.type === "queen") setQueenTarget({ playerId: a.targetPlayerId, index: a.targetIndex });
    if (a.type === "ace") setAceTarget(a.targetPlayerId);
    if (a.type === "swap") setMatchIndex(a.index);
  }, [coachKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const canReorder  = (phase === "PLAY" || phase === "PEEK") && dutchCallerId !== socket.id && handSize > 1;
  const targetMode  = myEffect?.type ?? null;

  // Tapping cards on the table fills in Jack / Queen targets
  const onTableCardClick = (pid, idx) => {
    if (targetMode === "JACK") {
      if (jackStep === 0) { setJackA({ playerId: pid, index: idx }); setJackStep(1); }
      else { setJackB({ playerId: pid, index: idx }); setJackStep(0); }
    } else if (targetMode === "QUEEN") {
      setQueenTarget({ playerId: pid, index: idx });
    }
  };
  // header (~52) + page padding (~48) + action caption (44) + gaps (32) + the dock itself
  // On short windows drop the caption strip and padding (the sidebar log still shows the moves)
  const shortWin = windowHeight < 720;
  const tableHeight = Math.max(380, Math.min(640, windowHeight - (shortWin ? 100 : 176) - dockHeight));
  const myAttention = !!room?.finalGraceEndsAt || isMyTurn || !!myEffect || inDutchWindow || room?.revealHold === socket.id;
  const marks = {};
  const hintSeatId = room?.tutorial && coach?.action?.type === "ace" ? coach.action.targetPlayerId : null;
  if (room?.tutorial && coach?.action && phase !== "SCORING") {
    const a = coach.action;
    if (a.type === "swap") marks[`${socket.id}:${a.index}`] = "hint";
    if (a.type === "peek") for (let i = 0; i < (room.lookCount || 0); i++) marks[`${socket.id}:${i}`] = "hint";
    if (a.type === "jack") { marks[`${a.a.playerId}:${a.a.index}`] = "hint"; marks[`${a.b.playerId}:${a.b.index}`] = "hint"; }
    if (a.type === "queen") marks[`${a.targetPlayerId}:${a.targetIndex}`] = "hint";
  }
  if (room?.tutorial && coach?.matchIndex != null && phase === "PLAY") marks[`${socket.id}:${coach.matchIndex}`] = "match";
  if (phase === "PEEK" && !me?.hasPeeked) for (const i of peekPick) marks[`${socket.id}:${i}`] = "pick";
  if (targetMode === "JACK") {
    marks[`${jackA.playerId}:${jackA.index}`] = "pick";
    marks[`${jackB.playerId}:${jackB.index}`] = "pick";
  } else if (targetMode === "QUEEN") {
    marks[`${queenTarget.playerId}:${queenTarget.index}`] = "pick";
  }

  // ── Shared felt background ─────────────────────────────────────────────────
  const feltBg = {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at center, #2d6a2d 0%, #1a4a1a 60%, #0f2e0f 100%)",
    fontFamily: "Georgia, 'Times New Roman', serif",
    color: "#e8d5a3",
    padding: "0 0 40px 0",
    overflowX: "clip", // not "hidden": that would break the sticky action dock
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

      {showRules && <Rules onClose={() => setShowRules(false)} />}

      {/* ── Big pops: "Your turn!" and "X calls Dutch!" ───────────────────── */}
      {banner && (
        <div
          onClick={() => setBanner(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: banner.kind === "dutch" ? "rgba(0,0,0,0.65)" : "transparent",
            pointerEvents: banner.kind === "dutch" ? "auto" : "none",
          }}
        >
          <div key={banner.text} style={{
            textAlign: "center", padding: mobile ? "22px 26px" : "36px 64px", borderRadius: 24,
            background: banner.kind === "dutch"
              ? "linear-gradient(to bottom, #e74c3c, #a93226)"
              : "linear-gradient(to bottom, #ffd700, #e0a800)",
            color: banner.kind === "dutch" ? "#fff" : "#2a1a00",
            border: "4px solid #fff3b0",
            boxShadow: "0 0 60px rgba(255,215,0,0.7), 0 12px 40px rgba(0,0,0,0.6)",
            animation: banner.kind === "dutch" ? "bannerPop 0.5s cubic-bezier(.2,1.4,.4,1), bannerShake 0.5s 0.5s" : "bannerPop 0.35s cubic-bezier(.2,1.4,.4,1)",
            maxWidth: "90vw",
          }}>
            <div style={{ fontSize: mobile ? 34 : banner.kind === "dutch" ? 64 : 52, fontWeight: "bold", letterSpacing: "0.03em", lineHeight: 1.1 }}>
              {banner.kind === "dutch" ? "🔔 " : "▶ "}{banner.text}
            </div>
            {banner.sub && <div style={{ fontSize: mobile ? 16 : 24, marginTop: 12, opacity: 0.9 }}>{banner.sub}</div>}
          </div>
        </div>
      )}

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
        <Btn variant="ghost" onClick={() => setShowRules(true)}>📖 Rules</Btn>

      </div>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1400, width: "100%", margin: "0 auto", padding: mobile ? "12px 10px" : shortWin ? "12px 28px" : "24px 28px", boxSizing: "border-box" }}>

        {/* ── LANDING: join a room ───────────────────────────────────────── */}
        {!room && (
          <div style={{ maxWidth: 380, margin: mobile ? "24px auto" : "60px auto", textAlign: "center" }}>
            <Panel title="Join a Room">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                  style={{ ...inputStyle, width: "100%" }} />
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} placeholder="Room ID"
                  style={{ ...inputStyle, width: "100%", textTransform: "uppercase" }} />
                <Btn onClick={join} disabled={!name.trim() || !roomId.trim()}>Join Room</Btn>
              </div>
            </Panel>

            <Panel title="Play vs Computer" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={{ fontSize: 14, color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  Computer opponents
                  <select value={botCount} onChange={(e) => setBotCount(Number(e.target.value))} style={selectStyle}>
                    {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 14, color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  Difficulty
                  <select value={botDifficulty} onChange={(e) => setBotDifficulty(e.target.value)} style={selectStyle}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
                <label style={{ fontSize: 14, color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  Game speed
                  <select value={botSpeed} onChange={(e) => setBotSpeed(e.target.value)} style={selectStyle}>
                    <option value="fast">Fast</option>
                    <option value="normal">Normal</option>
                    <option value="slow">Slow</option>
                  </select>
                </label>
                <GameLengthPicker value={gameLength} onChange={setGameLength} selectStyle={selectStyle} />
                <Btn variant="success" onClick={playBots} disabled={!name.trim()}>🤖 Play vs Computer</Btn>
              </div>
            </Panel>

            <Panel title="Learn to Play" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, color: "#a89060", lineHeight: 1.4 }}>
                  A coach suggests your moves, explains why, and tells you when to match.
                </div>
                <label style={{ fontSize: 14, color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  Opponents
                  <select value={tutorialBots} onChange={(e) => setTutorialBots(Number(e.target.value))} style={selectStyle}>
                    <option value={1}>1 (heads-up)</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <label style={{ fontSize: 14, color: "#c8a96e", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={tutorialShowAll} onChange={(e) => setTutorialShowAll(e.target.checked)} />
                  Show all my cards at all times
                </label>
                <GameLengthPicker value={tutorialLength} onChange={setTutorialLength} selectStyle={selectStyle} />
                <Btn variant="success" onClick={startTutorial} disabled={!name.trim()}>🎓 Start Tutorial</Btn>
              </div>
            </Panel>

            <div style={{ marginTop: 16 }}>
              <Btn variant="ghost" onClick={() => setShowRules(true)}>📖 Read the Rules</Btn>
            </div>
          </div>
        )}

        {/* ── SCORING SCREEN ──────────────────────────────────────────────── */}
        {room && phase === "SCORING" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 32, fontWeight: "bold", color: "#f0d080", letterSpacing: "0.05em" }}>
                {room.gameOver ? "🏆 Game Over!" : "📋 Round Results"}
              </div>
              {room.gameOver && room.winnerId && (
                <div style={{ fontSize: 22, color: "#ffd700", marginTop: 8 }}>
                  {(room.winnerIds?.length ?? 1) > 1 ? "It's a tie: " : "Winner: "}
                  <b>{(room.winnerIds?.length ? room.winnerIds : [room.winnerId]).map((id) => players.find((p) => p.id === id)?.name).join(" & ")}</b> 🎉
                </div>
              )}
              {!room.gameOver && room.gameLength?.mode === "rounds" && (
                <div style={{ fontSize: 14, color: "#a89060", marginTop: 6 }}>Round {room.roundNumber} of {room.gameLength.rounds}</div>
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
        {room && phase !== "SCORING" && (
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
                  <div style={{ marginBottom: 12 }}>
                    <GameLengthPicker value={gameLength} onChange={setGameLength} selectStyle={selectStyle} />
                  </div>
                  <Btn variant="success" onClick={start} disabled={players.length < (room?.expectedPlayers ?? 1)} style={{ width: "100%" }}>
                    {players.length < (room?.expectedPlayers ?? 1) ? "Waiting for computer players…" : "Start Game"}
                  </Btn>
                </Panel>
              )}

              {room?.tutorial && (
                <Panel title="Tutorial">
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#c8a96e", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!room.tutorial.showAllCards}
                      onChange={(e) => socket.emit("room:tutorialSettings", { roomId, showAllCards: e.target.checked })}
                    />
                    Show all my cards
                  </label>
                </Panel>
              )}

              {/* Computer-player settings (host can change them any time) */}
              {room?.botSettings && (
                <Panel title="Computer Players">
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#c8a96e", marginBottom: 8 }}>
                    Speed
                    <select value={room.botSettings.speed} disabled={!isHost} onChange={(e) => changeBotSettings({ speed: e.target.value })} style={selectStyle}>
                      <option value="fast">Fast</option>
                      <option value="normal">Normal</option>
                      <option value="slow">Slow</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#c8a96e" }}>
                    Difficulty
                    <select value={room.botSettings.difficulty} disabled={!isHost} onChange={(e) => changeBotSettings({ difficulty: e.target.value })} style={selectStyle}>
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>
                </Panel>
              )}

              {/* Status banners */}
              {room && (
                <Panel title="Status">
                  <div style={{ fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: "#a89060" }}>Game: </span>
                    <b>{room.gameLength?.mode === "rounds" && room.roundNumber ? `Round ${room.roundNumber} of ${room.gameLength.rounds}` : room.roundNumber ? `Round ${room.roundNumber}` : ""}</b>
                    <span style={{ color: "#a89060" }}>{room.gameLength?.mode === "rounds" && room.roundNumber ? "" : `${room.roundNumber ? " · " : ""}${lengthText(room.gameLength)}`}</span>
                  </div>
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

              {!mobile && log.length > 0 && (
                <Panel title="Activity Log">
                  <div ref={logRef} style={{ maxHeight: 220, overflowY: "auto", fontSize: 12, color: "#a89060" }}>
                    {log.slice(-40).map((l, i) => (
                      <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{l}</div>
                    ))}
                  </div>
                </Panel>
              )}
            </div>

            {/* Right column: main game area */}
            <div style={{ flex: mobile ? "1 1 100%" : 1, order: mobile ? 1 : 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* TABLE (top-down view of everyone's cards) */}
              {room && phase !== "LOBBY" && (
                <>
                {((!mobile && !shortWin) || (mobile && actions.length > 0)) && (
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, padding: "4px 12px", background: "rgba(0,0,0,0.35)", borderRadius: 10, height: mobile ? undefined : 44, boxSizing: "border-box", overflow: "hidden" }}>
                    {actions.length === 0 && <div style={{ fontSize: 12, color: "#7fa07f" }}>Moves will show up here…</div>}
                    {actions.map((a, idx) => (
                      <div key={a.id} style={{
                        fontSize: idx === actions.length - 1 ? 14 : 11, fontWeight: idx === actions.length - 1 ? "bold" : "normal",
                        color: idx === actions.length - 1 ? a.color : "#7fa07f", opacity: idx === actions.length - 1 ? 1 : 0.8,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>{a.text}</div>
                    ))}
                  </div>
                )}
                <Table
                  arrows={arrows}
                  height={tableHeight}
                  room={room} meId={socket.id} me={me}
                  getVisibleCard={getVisibleCard}
                  highlights={highlights} marks={marks}
                  selectedIndex={phase === "PLAY" ? selIdx : -1}
                  canReorder={canReorder}
                  targetMode={targetMode} aceTarget={aceTarget} hintSeatId={hintSeatId}
                  onReorder={(from, to) => { socket.emit("hand:reorder", { roomId, from, to }); setMatchIndex(to); setPeekPick([]); }}
                  onMyCardClick={(i) => {
                    if (phase === "PLAY") setMatchIndex(i);
                    else if (phase === "PEEK" && !me?.hasPeeked) togglePeekIndex(i);
                  }}
                  onCardClick={onTableCardClick}
                  onSeatClick={(pid) => setAceTarget(pid)}
                />
                </>
              )}

              {/* ── ACTION DOCK: stays on screen so you never have to scroll for your options ── */}
              {room && phase !== "LOBBY" && (
              <div ref={setDockEl} style={{
                position: "sticky", bottom: 0, zIndex: 30,
                display: "flex", flexDirection: "column", gap: 10,
                padding: mobile ? 8 : 12,
                background: "linear-gradient(to top, rgba(6,22,8,0.98), rgba(10,34,12,0.94))",
                border: myAttention ? "2px solid #ffd700" : "1px solid rgba(255,255,255,0.15)",
                borderRadius: 14,
                boxShadow: "0 -6px 24px rgba(0,0,0,0.55)",
                maxHeight: mobile ? "55vh" : "46vh", overflowY: "auto",
                animation: myAttention ? "dockGlow 1.4s ease-in-out infinite" : undefined,
              }}>

              {/* TUTORIAL COACH */}
              {room?.tutorial && coach && (
                <div style={{
                  background: "linear-gradient(to bottom, rgba(33,150,243,0.22), rgba(33,150,243,0.12))",
                  border: "2px solid rgba(100,181,246,0.7)", borderRadius: 12, padding: mobile ? "8px 10px" : "10px 14px",
                }}>
                  <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#90caf9", marginBottom: 4 }}>🎓 Coach · {coach.headline}</div>
                  <div style={{ fontSize: mobile ? 14 : 15, lineHeight: 1.45, color: "#e3f2fd" }}>{coach.text}</div>
                  {coach.tip && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(144,202,249,0.35)", fontSize: 14, lineHeight: 1.4, color: coach.matchIndex != null ? "#a5d6a7" : "#b0bec5" }}>
                      {coach.tip}
                    </div>
                  )}
                </div>
              )}

              {/* PEEK PHASE */}
              {me && phase === "PEEK" && (
                <Panel title={`Peek Phase — Choose ${effectiveLookCount} Card${effectiveLookCount !== 1 ? "s" : ""}`}>
                  {!me.hasPeeked ? (
                    <>
                      <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>
                        Tap <b style={{ color: "#ffd700" }}>{effectiveLookCount}</b> of your cards on the table to peek at them (you'll have 15 seconds to memorize them). You can drag your cards to rearrange them first.
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
                            <div style={{ fontSize: 12, color: "#a89060", marginTop: 6 }}>Only you can see this.{room?.revealHold === socket.id ? " Scoring starts when you press Done (or in 20 seconds)." : " Hides automatically."}</div>
                      {room?.revealHold === socket.id
                        ? <Btn variant="success" style={{ marginTop: 8 }} onClick={() => { setQueenReveal(null); socket.emit("reveal:done", { roomId }); }}>Done — go to scoring</Btn>
                        : <Btn variant="ghost" style={{ marginTop: 8 }} onClick={() => setQueenReveal(null)}>Hide</Btn>}
                    </div>
                  </div>
                </Panel>
              )}

              {/* TURN BANNER + MATCH */}
              {me && phase === "PLAY" && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{
                    flex: "1 1 220px", padding: myAttention ? "10px 16px" : "6px 12px", borderRadius: 10,
                    background: myAttention ? "linear-gradient(to bottom, #ffd700, #e0a800)" : "rgba(255,255,255,0.06)",
                    color: myAttention ? "#2a1a00" : "#a89060",
                    fontWeight: "bold", fontSize: myAttention ? (mobile ? 18 : 22) : 13,
                    letterSpacing: myAttention ? "0.04em" : undefined,
                    textShadow: myAttention ? "0 1px 0 rgba(255,255,255,0.4)" : undefined,
                  }}>
                    {room?.finalGraceEndsAt
                      ? `⏳ Last chance to match! Scoring in ${graceLeft}s`
                      : room?.revealHold === socket.id
                      ? "👁 Take a look — then press Done"
                      : myEffect
                        ? `⚡ Use your ${myEffect.type}!`
                        : inDutchWindow
                          ? "🔔 Call Dutch, or pass your turn"
                          : isMyTurn
                            ? (pending ? "▶ YOUR TURN — discard it or swap it in" : "▶ YOUR TURN — draw a card")
                            : <>Waiting for <b style={{ color: "#e8d5a3" }}>{players.find((p) => p.id === room?.turnPlayerId)?.name ?? "…"}</b>…</>}
                  </div>
                  {handSize > 0 && !room?.revealHold && (
                    <Btn
                      hint={room?.tutorial && coach?.matchIndex != null && selIdx === coach.matchIndex}
                      disabled={!room?.discardTop}
                      onClick={() => socket.emit("match:attempt", { roomId, index: selIdx })}
                    >
                      ✋ Match #{selIdx}
                    </Btn>
                  )}
                  {peekTimeLeft > 0 && <span style={{ fontSize: 12, color: "#ffd700" }}>⏱ peeked cards hide in {peekTimeLeft}s</span>}
                </div>
              )}

              {/* DUTCH WINDOW */}
              {inDutchWindow && (
                <div style={{
                  padding: "12px 16px",
                  background: "rgba(255,193,7,0.18)",
                  border: "2px solid rgba(255,193,7,0.7)",
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 12, color: "#a89060" }}>Window closes in</span>
                    <span style={{ fontSize: 32, fontWeight: "bold", color: dutchWindowSecondsLeft <= 3 ? "#e74c3c" : "#ffd700", lineHeight: 1 }}>
                      {dutchWindowSecondsLeft}s
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Btn variant="danger" hint={room?.tutorial && coach?.action?.type === "dutch"} onClick={() => socket.emit("dutch:call", { roomId })}>🔔 Call Dutch</Btn>
                    <Btn variant="ghost"  hint={room?.tutorial && coach?.action?.type === "pass"} onClick={() => socket.emit("turn:end",   { roomId })}>Pass Turn</Btn>
                  </div>
                </div>
              )}

              {/* TURN CONTROLS */}
              {me && phase === "PLAY" && !myEffect && !inDutchWindow && !room?.revealHold && isMyTurn && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  {!pending && (
                    <>
                      <Btn
                        hint={room?.tutorial && coach?.action?.type === "draw" && coach.action.source === "DECK"}
                        disabled={!!pendingEffect}
                        onClick={() => socket.emit("turn:draw", { roomId, source: "DECK" })}
                        style={{ fontSize: 16, padding: mobile ? "12px 16px" : "12px 22px" }}
                      >
                        🂠 Draw from Deck
                      </Btn>
                      <Btn
                        hint={room?.tutorial && coach?.action?.type === "draw" && coach.action.source === "DISCARD"}
                        disabled={!room.discardTop || !!pendingEffect}
                        onClick={() => socket.emit("turn:draw", { roomId, source: "DISCARD" })}
                        style={{ fontSize: 16, padding: mobile ? "12px 16px" : "12px 22px" }}
                      >
                        ↑ Take Discard
                      </Btn>
                    </>
                  )}

                  {/* Drawn card options */}
                  {pending && (
                    <>
                      <div style={{ textAlign: "center" }}>
                        <CardFace card={pending.card} size="md" highlight="swap" />
                        <div style={{ fontSize: 10, color: "#a89060", marginTop: 4 }}>from {pending.source.toLowerCase()}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <Btn
                          hint={room?.tutorial && coach?.action?.type === "discard"}
                          disabled={pending.source !== "DECK"}
                          onClick={() => socket.emit("turn:discard-drawn", { roomId })}
                          style={{ fontSize: 16, padding: "10px 20px" }}
                        >
                          Discard it
                        </Btn>
                        <Btn
                          hint={room?.tutorial && coach?.action?.type === "swap"}
                          onClick={() => socket.emit("turn:swap", { roomId, index: selIdx })}
                          style={{ fontSize: 16, padding: "10px 20px" }}
                        >
                          Swap into card #{selIdx}
                        </Btn>
                      </div>
                      <div style={{ fontSize: 12, color: "#a89060", maxWidth: 200 }}>Tap one of your cards on the table to choose which one to swap.</div>
                    </>
                  )}
                </div>
              )}

              {/* JACK EFFECT */}
              {myEffect?.type === "JACK" && (
                <Panel title="♠ Jack Effect — Swap Two Cards">
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Tap two cards on the table (yours or anyone else’s) to swap them, then confirm.</div>
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
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Tap any card on the table to peek at it, then confirm.</div>
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
                <Panel title="♠ Ace Effect — Give a Penalty Card">
                  <div style={{ fontSize: 13, color: "#a89060", marginBottom: 14 }}>Tap a player on the table to give them a penalty card, then confirm.</div>
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

              </div>
              )}
            </div>{/* end right column */}
          </div>
        )}

        {/* ── Activity log ─────────────────────────────────────────────────── */}
        {(mobile || phase === "SCORING") && log.length > 0 && (
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
