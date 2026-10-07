import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

import { splitCard } from "./cards.jsx";
import GameScreen from "./GameScreen.jsx";
import Rules from "./Rules.jsx";
import { Landing, Lobby, Results } from "./screens.jsx";

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

// ── Main App: all game state and socket wiring; the screens only render ──────

export default function App() {
  const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
  const socket = useMemo(() => io(SERVER_URL), []);

  const [roomId, setRoomId]   = useState("TEST");
  const [botCount, setBotCount] = useState(3);
  const [botSpeed, setBotSpeed] = useState("normal");
  const [botDifficulty, setBotDifficulty] = useState("medium");
  const [gameLength, setGameLength] = useState({ mode: "score", target: 100 });
  const [tutorialLength, setTutorialLength] = useState({ mode: "rounds", rounds: 3 });
  const [tutorialBots, setTutorialBots] = useState(1);
  const [tutorialShowAll, setTutorialShowAll] = useState(true);
  const [showRules, setShowRules] = useState(false);
  const [coach, setCoach] = useState(null); // tutorial advice from the server
  const [name, setName]       = useState("Trevor");
  const [log, setLog]         = useState([]);
  const [room, setRoom]       = useState(null);
  const [me, setMe]           = useState(null);
  const [queenReveal, setQueenReveal] = useState(null); // private: card the player just peeked with a Queen
  const queenRevealTimerRef = useRef(null);

  const [lookCount, setLookCount]   = useState(2);
  const [peekPick, setPeekPick]     = useState([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [jackA, setJackA]           = useState({ playerId: "", index: 0 });
  const [jackB, setJackB]           = useState({ playerId: "", index: 0 });
  const [queenTarget, setQueenTarget] = useState({ playerId: "", index: 0 });
  const [aceTarget, setAceTarget]   = useState("");
  const [jackStep, setJackStep]     = useState(0); // which Jack target the next tap fills in

  // Cards you've peeked at stay visible for 15s. Tracked by card (a deck has no duplicates), not slot,
  // so rearranging, removing or matching cards can't reset or re-trigger a reveal.
  const [visibleCards, setVisibleCards] = useState({});
  const [peekTimeLeft, setPeekTimeLeft] = useState(0);
  const expiryRef    = useRef({});
  const seenCardsRef = useRef(new Set());
  const phaseRef     = useRef("LOBBY");
  const roundRef     = useRef(0);
  const tickRef      = useRef(null);

  // Highlights from table events: "playerId:slot" -> kind (swap | moved | jack | queen | penalty | fail)
  const [highlights, setHighlights] = useState({});
  const [arrows, setArrows]       = useState([]);
  const [toast, setToast]         = useState(null); // latest event, shown briefly on the table
  const toastTimerRef = useRef(null);
  const lastDrawRef   = useRef(null);
  const playersRef    = useRef([]);
  const [banner, setBanner]       = useState(null); // full-screen pop when someone calls Dutch
  const bannerTimerRef = useRef(null);
  const prevTurnRef    = useRef(null);
  const prevDutchRef   = useRef(undefined);
  playersRef.current   = room?.players ?? [];
  const [graceLeft, setGraceLeft] = useState(0);
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

  function showToast(text, tone = "neutral", ms = 3200) {
    setToast({ id: Date.now() + Math.random(), text, tone });
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), ms);
  }

  useEffect(() => {
    const onLog = (msg) => setLog((prev) => [...prev, msg]);

    const onRoomUpdate = (data) => {
      setRoom(data);
      phaseRef.current = data?.phase ?? "LOBBY";
      // A new round (or leaving a game) starts with a clean slate: nothing is "already seen" and no stale peek picks.
      const roundKey = data?.roundNumber ?? 0;
      const newRound = roundKey !== roundRef.current;
      roundRef.current = roundKey;
      if (newRound || data?.phase === "SCORING" || data?.phase === "LOBBY") {
        seenCardsRef.current.clear();
        expiryRef.current = {};
        setVisibleCards({});
        setPeekTimeLeft(0);
      }
      if (newRound) {
        setPeekPick([]);
        setMatchIndex(0);
        setQueenReveal(null);
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
      // Between rounds the server still lists last round's known cards; ignore them so they can't be mistaken for new ones
      const idle = phaseRef.current === "SCORING" || phaseRef.current === "LOBBY";
      const knownCards = new Set(idle ? [] : Object.values(data?.known ?? {}));

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
      const nameOf = (pid) => (playersRef.current.find((p) => p.id === pid)?.name ?? "Someone").replace(/^🤖\s*/, "");
      const label = (card) => { const { rank, suit } = splitCard(card); return `${rank}${suit}`; };
      const who = nameOf(ev.playerId);

      if (ev.type === "draw") {
        lastDrawRef.current = { playerId: ev.playerId, source: ev.source };
        showToast(`${who} drew from the ${ev.source === "DECK" ? "deck" : "discard pile"}`);
      } else if (ev.type === "discard") {
        showToast(`${who} discarded ${label(ev.card)}`, "info");
      } else if (ev.type === "swap") {
        const src = lastDrawRef.current?.playerId === ev.playerId ? lastDrawRef.current.source : "DECK";
        addHighlights([[key(ev.playerId, ev.index), "swap"]]);
        addArrows([
          { from: src === "DECK" ? "deck" : "discard", to: key(ev.playerId, ev.index), color: "var(--ok)", label: "in" },
          { from: key(ev.playerId, ev.index), to: "discard", color: "var(--hl-swap)", label: "out" },
        ]);
        showToast(`${who} swapped into #${ev.index} · discarded ${label(ev.card)}`, "info");
      } else if (ev.type === "reorder") {
        addHighlights([[key(ev.playerId, ev.to), "moved"]]);
        showToast(`${who} moved card #${ev.from} to #${ev.to}`, "info");
      } else if (ev.type === "match") {
        if (ev.ok) {
          showToast(`${who} matched with ${label(ev.card)}`, "ok");
        } else {
          addHighlights([[key(ev.playerId, ev.index), "fail"]]);
          showToast(`${who} missed a match · penalty card`, "danger");
        }
      } else if (ev.type === "jack") {
        addHighlights([[key(ev.a.playerId, ev.a.index), "jack"], [key(ev.b.playerId, ev.b.index), "jack"]]);
        addArrows([{ from: key(ev.a.playerId, ev.a.index), to: key(ev.b.playerId, ev.b.index), color: "var(--hl-jack)", both: true, label: "swap" }]);
        showToast(`${who} used Jack: ${nameOf(ev.a.playerId)} #${ev.a.index} ⇄ ${nameOf(ev.b.playerId)} #${ev.b.index}`, "info");
      } else if (ev.type === "queen") {
        addHighlights([[key(ev.targetPlayerId, ev.index), "queen"]]);
        showToast(`${who} peeked at ${nameOf(ev.targetPlayerId)} #${ev.index}`, "info");
      } else if (ev.type === "ace") {
        addHighlights([[key(ev.targetPlayerId, ev.index), "penalty"]]);
        showToast(`${who} gave ${nameOf(ev.targetPlayerId)} a penalty card`, "danger");
      }
    };

    const onError = (e) => { setLog((prev) => [...prev, `ERROR: ${e.message}`]); showToast(e.message, "danger"); };
    const onCoach = (advice) => setCoach(advice);
    const onRoomCreated = ({ roomId: id }) => setRoomId(id);

    socket.on("log",          onLog);
    socket.on("room:update",  onRoomUpdate);
    socket.on("me:update",    onMeUpdate);
    socket.on("error",        onError);
    socket.on("table:event",  onTableEvent);
    socket.on("coach:advice", onCoach);
    socket.on("room:created", onRoomCreated);

    return () => {
      socket.off("log",          onLog);
      socket.off("room:update",  onRoomUpdate);
      socket.off("me:update",    onMeUpdate);
      socket.off("error",        onError);
      socket.off("table:event",  onTableEvent);
      socket.off("coach:advice", onCoach);
      socket.off("room:created", onRoomCreated);
      if (tickRef.current)            clearInterval(tickRef.current);
      if (dutchWindowTickRef.current) clearInterval(dutchWindowTickRef.current);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dutch window countdown tick
  useEffect(() => {
    const endsAt       = room?.dutchWindowEndsAt;
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

  // Big pop when someone calls Dutch
  useEffect(() => {
    const caller = room?.dutchCallerId ?? null;
    if (prevDutchRef.current !== undefined && caller && prevDutchRef.current !== caller) {
      const callerName = (room.players.find((p) => p.id === caller)?.name ?? "Someone").replace(/^🤖\s*/, "");
      setBanner({ text: `${callerName} calls Dutch!`, sub: "Everyone else gets one more turn" });
      clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBanner(null), 3200);
      playChime([523, 392, 262]);
    }
    prevDutchRef.current = caller;
  }, [room?.dutchCallerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Short toast + chime + tab title when it becomes your turn
  const myTurnNow = room?.phase === "PLAY" && room?.turnPlayerId === socket.id;
  useEffect(() => {
    if (myTurnNow && prevTurnRef.current !== true) {
      showToast("Your turn", "accent", 2200);
      playChime();
    }
    prevTurnRef.current = myTurnNow;
    document.title = myTurnNow ? "▶ Your turn — Dutch" : "Dutch";
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

  // ── actions ────────────────────────────────────────────────────────────────
  const emit = (event, payload = {}) => socket.emit(event, { roomId, ...payload });
  const playBots = () => socket.emit("room:playBots", { name, botCount, speed: botSpeed, difficulty: botDifficulty, gameLength });
  const startTutorial = () => socket.emit("room:playBots", {
    name, botCount: tutorialBots, speed: "normal", difficulty: "easy", gameLength: tutorialLength, tutorial: true, showAllCards: tutorialShowAll,
  });
  const changeBotSettings = (patch) => emit("room:botSettings", patch);
  const setShowAllCards = (showAllCards) => emit("room:tutorialSettings", { showAllCards });
  const join     = () => socket.emit("room:join", { roomId, name });
  const start    = () => emit("game:start", { lookCount, gameLength });
  const newRound = () => emit("game:newRound", { lookCount });

  // The lobby shows the length chosen at creation (primitives only, so host edits aren't overwritten)
  const serverLen = room?.gameLength;
  useEffect(() => {
    if (room?.phase === "LOBBY" && serverLen) setGameLength({ ...serverLen });
  }, [room?.phase, serverLen?.mode, serverLen?.target, serverLen?.rounds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived values ─────────────────────────────────────────────────────────
  const meId           = socket.id;
  const players        = room?.players ?? [];
  const phase          = room?.phase ?? "LOBBY";
  const isNextDealer   = room?.nextDealerId === meId;
  const nextDealerName = players.find((p) => p.id === room?.nextDealerId)?.name;
  const isHost         = room?.hostId === meId;
  const isMyTurn       = room?.turnPlayerId === meId;
  const effectiveLookCount = room?.lookCount ?? lookCount;

  const togglePeekIndex = (i) => {
    setPeekPick((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      return [...prev, i].slice(0, effectiveLookCount);
    });
  };

  const submitPeek    = () => emit("game:peek", { indexes: peekPick });
  const pending       = me?.pendingDraw ?? null;
  const handSize      = me?.handSize ?? 0;
  const pendingEffect = room?.pendingEffect ?? null;
  const myEffect      = (pendingEffect?.actorId === meId ? pendingEffect : null) ?? (me?.matchEffect ? { type: me.matchEffect, actorId: meId } : null);
  const dutchCallerId = room?.dutchCallerId ?? null;
  const inDutchWindow = room?.dutchWindowPlayerId === meId;
  const totals        = room?.totals ?? {};

  const selIdx = Math.min(matchIndex, Math.max(handSize - 1, 0));
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

  const canReorder = (phase === "PLAY" || phase === "PEEK") && dutchCallerId !== meId && handSize > 1;
  const targetMode = myEffect?.type ?? null;

  // Tapping cards fills in Jack / Queen targets
  const onTableCardClick = (pid, idx) => {
    if (targetMode === "JACK") {
      if (jackStep === 0) { setJackA({ playerId: pid, index: idx }); setJackStep(1); }
      else { setJackB({ playerId: pid, index: idx }); setJackStep(0); }
    } else if (targetMode === "QUEEN") {
      setQueenTarget({ playerId: pid, index: idx });
    }
  };

  const myAttention = !!room?.finalGraceEndsAt || isMyTurn || !!myEffect || inDutchWindow || room?.revealHold === meId;

  const marks = {};
  const hintSeatId = room?.tutorial && coach?.action?.type === "ace" ? coach.action.targetPlayerId : null;
  if (room?.tutorial && coach?.action && phase !== "SCORING") {
    const a = coach.action;
    if (a.type === "swap") marks[`${meId}:${a.index}`] = "hint";
    if (a.type === "peek") for (let i = 0; i < (room.lookCount || 0); i++) marks[`${meId}:${i}`] = "hint";
    if (a.type === "jack") { marks[`${a.a.playerId}:${a.a.index}`] = "hint"; marks[`${a.b.playerId}:${a.b.index}`] = "hint"; }
    if (a.type === "queen") marks[`${a.targetPlayerId}:${a.targetIndex}`] = "hint";
  }
  if (room?.tutorial && coach?.matchIndex != null && phase === "PLAY") marks[`${meId}:${coach.matchIndex}`] = "match";
  if (phase === "PEEK" && !me?.hasPeeked) for (const i of peekPick) marks[`${meId}:${i}`] = "pick";
  if (targetMode === "JACK") {
    marks[`${jackA.playerId}:${jackA.index}`] = "pick";
    marks[`${jackB.playerId}:${jackB.index}`] = "pick";
  } else if (targetMode === "QUEEN") {
    marks[`${queenTarget.playerId}:${queenTarget.index}`] = "pick";
  }

  // ── render ─────────────────────────────────────────────────────────────────
  const screenState = {
    meId, name, setName, roomId, setRoomId,
    botCount, setBotCount, botDifficulty, setBotDifficulty, botSpeed, setBotSpeed,
    gameLength, setGameLength, tutorialLength, setTutorialLength, tutorialBots, setTutorialBots, tutorialShowAll, setTutorialShowAll,
    playBots, startTutorial, join, start, newRound, lookCount, setLookCount, changeBotSettings, setShowAllCards,
    onRules: () => setShowRules(true),
  };

  let screen;
  if (!room) {
    screen = <Landing s={screenState} onRules={() => setShowRules(true)} />;
  } else if (phase === "LOBBY") {
    screen = <Lobby s={screenState} room={room} players={players} isHost={isHost} onRules={() => setShowRules(true)} />;
  } else if (phase === "SCORING") {
    screen = (
      <Results s={screenState} room={room} players={players} totals={totals} dutchCallerId={dutchCallerId}
        isHost={isHost} isNextDealer={isNextDealer} nextDealerName={nextDealerName} />
    );
  } else {
    const ctx = {
      room, me, meId, phase, players, roomId, isHost, coach, toast, banner, log, marks, highlights, arrows,
      pending, handSize, selIdx, myEffect, isMyTurn, inDutchWindow, myAttention, targetMode, hintSeatId,
      aceTarget, jackA, jackB, queenTarget, peekPick, lookCount: effectiveLookCount,
      dutchWindowSecondsLeft, graceLeft, canReorder, queenReveal, peekTimeLeft,
      emit, submitPeek, changeBotSettings, setShowAllCards, getVisibleCard,
      onRules: () => setShowRules(true),
      onCardClick: onTableCardClick,
      onSeatClick: (pid) => setAceTarget(pid),
      onMyCardClick: (i) => {
        if (phase === "PLAY") setMatchIndex(i);
        else if (phase === "PEEK" && !me?.hasPeeked) togglePeekIndex(i);
      },
      onReorder: (from, to) => { emit("hand:reorder", { from, to }); setMatchIndex(to); setPeekPick([]); },
      hideQueenReveal: () => setQueenReveal(null),
      doneReveal: () => { setQueenReveal(null); emit("reveal:done"); },
      dismissBanner: () => setBanner(null),
    };
    screen = <GameScreen c={ctx} />;
  }

  return (
    <>
      {screen}
      {showRules && <Rules onClose={() => setShowRules(false)} />}
    </>
  );
}
