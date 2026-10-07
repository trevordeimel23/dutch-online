const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: true, credentials: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const crypto = require("crypto");
const { Bot, BOT_NAMES, SPEED_MULTIPLIER, DIFFICULTY } = require("./bot");

const PORT = process.env.PORT || 3001;
const BOT_SECRET = crypto.randomBytes(12).toString("hex"); // lets the server's own bots identify themselves

const rooms = new Map();
const roomBots = new Map(); // roomId -> Bot[] (computer players, which connect back to this server like any client)
const roomTimers = new Map(); // roomId -> setTimeout handle for dutch window

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
  return shuffle(deck);
}

// Cards that were discarded earlier are kept so the deck can be reshuffled when it runs out
// (needed with up to 10 players, where the deck is quickly used up by the deal and penalty cards).
function setDiscardTop(g, card) {
  if (g.discardTop) g.discarded.push(g.discardTop);
  g.discardTop = card;
}
function deckHasCards(g) { return g.deck.length + g.discarded.length > 0; }
function takeFromDeck(g) {
  if (!g.deck.length && g.discarded.length) g.deck = shuffle(g.discarded.splice(0));
  return g.deck.pop();
}

function rankOf(card) { return card.slice(0, -1); }
function suitOf(card) { return card.slice(-1); }

function cardValue(card) {
  const rank = rankOf(card);
  const suit = suitOf(card);
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return (suit === "H" || suit === "D") ? 0 : 13;
  return parseInt(rank);
}

// How long a game lasts: a fixed number of rounds (1–20), or until someone reaches a target score
const SCORE_TARGETS = [25, 50, 75, 100];
const DEFAULT_GAME_LENGTH = { mode: "score", target: 100 };

function cleanGameLength(input) {
  if (input?.mode === "rounds") {
    const rounds = Math.floor(Number(input.rounds));
    if (rounds >= 1 && rounds <= 20) return { mode: "rounds", rounds };
  } else if (input?.mode === "score") {
    const target = Number(input.target);
    if (SCORE_TARGETS.includes(target)) return { mode: "score", target };
  }
  return null;
}

function getRoomOrThrow(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  return room;
}

function isPlayersTurn(room, playerId) {
  const g = room.game;
  if (!g || g.phase !== "PLAY") return false;
  if (g.finalGraceEndsAt) return false; // last turn is over; only matching is still allowed
  if (g.revealHold) return false; // round is waiting for the last player to look at their Queen peek
  return room.players[g.turnIndex]?.id === playerId;
}

// Last turn after Dutch ended with a Queen peek: give the player time to look before scoring
function holdForReveal(room, roomId, playerId) {
  const g = room.game;
  syncPending(g);
  g.revealHold = playerId;
  clearDutchWindow(room, roomId);
  const timer = setTimeout(() => releaseRevealHold(roomId), 20000);
  roomTimers.set(roomId, timer);
}

function releaseRevealHold(roomId) {
  const room = rooms.get(roomId);
  const g = room?.game;
  if (!g?.revealHold) return;
  clearDutchWindow(room, roomId);
  g.revealHold = null;
  nextTurn(room, roomId);
  broadcastRoom(roomId);
}

// Start a 10-second window where the current player can call Dutch before turn advances
function startDutchWindow(room, roomId, playerId) {
  const g = room.game;
  if (!g) return;

  // Clear any existing window timer
  if (roomTimers.has(roomId)) {
    clearTimeout(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }

  g.dutchWindowPlayerId = playerId;
  g.dutchWindowEndsAt = Date.now() + 10000;

  const timer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (r?.game?.dutchWindowPlayerId === playerId) {
      r.game.dutchWindowPlayerId = null;
      r.game.dutchWindowEndsAt = null;
      nextTurn(r, roomId);
      broadcastRoom(roomId);
    }
    roomTimers.delete(roomId);
  }, 10000);

  roomTimers.set(roomId, timer);
}

function clearDutchWindow(room, roomId) {
  if (roomTimers.has(roomId)) {
    clearTimeout(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }
  if (room.game) {
    room.game.dutchWindowPlayerId = null;
    room.game.dutchWindowEndsAt = null;
  }
}

function scoreRound(room, roomId) {
  const g = room.game;
  const scores = {};
  const revealedHands = {};

  for (const p of room.players) {
    const hand = g.hands.get(p.id) ?? [];
    scores[p.id] = hand.reduce((sum, card) => sum + cardValue(card), 0);
    revealedHands[p.id] = [...hand];
  }

  const callerId = g.dutchCallerId;
  g.dutchResult = null;
  if (callerId) {
    const callerScore = scores[callerId];
    const others = Object.entries(scores).filter(([id]) => id !== callerId);
    const minOtherScore = others.length ? Math.min(...others.map(([, s]) => s)) : Infinity;
    const bestOtherId = others.find(([, s]) => s === minOtherScore)?.[0] ?? null;
    const callerWins = callerScore < minOtherScore || callerScore === 0;
    g.dutchResult = {
      callerId, won: callerWins, handScore: callerScore,
      lowestOtherId: bestOtherId, lowestOtherScore: Number.isFinite(minOtherScore) ? minOtherScore : null,
      tied: !callerWins && callerScore === minOtherScore,
      penaltyCards: [], penaltyTotal: 0,
    };

    if (callerWins) {
      scores[callerId] = 0;
      const name = room.players.find((p) => p.id === callerId)?.name ?? "Caller";
      io.to(roomId).emit("log", `${name} called Dutch and had the lowest score — 0 points!`);
    } else {
      let penaltyTotal = 0;
      const penaltyCards = [];
      for (let i = 0; i < 2; i++) {
        if (deckHasCards(g)) {
          const c = takeFromDeck(g);
          penaltyCards.push(c);
          penaltyTotal += cardValue(c);
        }
      }
      scores[callerId] += penaltyTotal;
      g.dutchResult.penaltyCards = penaltyCards;
      g.dutchResult.penaltyTotal = penaltyTotal;
      const name = room.players.find((p) => p.id === callerId)?.name ?? "Caller";
      io.to(roomId).emit("log", `${name} called Dutch but didn't have the lowest — penalty +${penaltyTotal} pts (${penaltyCards.join(", ")})`);
    }
  }

  if (!room.totals) room.totals = {};
  for (const p of room.players) {
    room.totals[p.id] = (room.totals[p.id] ?? 0) + scores[p.id];
  }

  const length = room.gameLength ?? DEFAULT_GAME_LENGTH;
  const gameOver = length.mode === "rounds"
    ? (room.roundNumber ?? 1) >= length.rounds
    : Object.values(room.totals).some((t) => t >= length.target);
  let winnerId = null;
  let winnerIds = [];
  if (gameOver) {
    // The lowest total wins (a tie is shared)
    const lowest = Math.min(...room.players.map((p) => room.totals[p.id] ?? 0));
    winnerIds = room.players.filter((p) => (room.totals[p.id] ?? 0) === lowest).map((p) => p.id);
    winnerId = winnerIds[0] ?? null;
    const names = winnerIds.map((id) => room.players.find((p) => p.id === id)?.name ?? "Someone");
    io.to(roomId).emit("log", names.length > 1 ? `Game over! It's a tie between ${names.join(" and ")}.` : `Game over! ${names[0]} wins!`);
  }

  g.effectQueue = [];
  g.pendingEffect = null;
  g.phase = "SCORING";
  g.roundScores = scores;
  g.revealedHands = revealedHands;
  g.gameOver = gameOver;
  g.winnerId = winnerId;
  g.winnerIds = winnerIds;
}

const FINAL_GRACE_MS = 10000;

// Last turn after Dutch is done: everyone gets a short window for last-second matches before scoring
function startFinalGrace(room, roomId) {
  const g = room.game;
  syncPending(g);
  g.finalGraceEndsAt = Date.now() + FINAL_GRACE_MS;
  clearDutchWindow(room, roomId);
  const timer = setTimeout(() => {
    const r = rooms.get(roomId);
    if (!r?.game?.finalGraceEndsAt) return;
    r.game.finalGraceEndsAt = null;
    roomTimers.delete(roomId);
    scoreRound(r, roomId);
    broadcastRoom(roomId);
  }, FINAL_GRACE_MS);
  roomTimers.set(roomId, timer);
  io.to(roomId).emit("log", "That was the last turn! 10 seconds for any last-second matches…");
}

function nextTurn(room, roomId) {
  const g = room.game;
  if (!g) return;
  syncPending(g);

  if (g.dutchCallerId !== null) {
    g.dutchTurnsLeft = (g.dutchTurnsLeft ?? 0) - 1;
    if (g.dutchTurnsLeft <= 0) {
      startFinalGrace(room, roomId);
      return;
    }
  }

  g.turnIndex = (g.turnIndex + 1) % room.players.length;
  const nextName = room.players[g.turnIndex]?.name ?? "?";
  io.to(roomId).emit("log", `It's now ${nextName}'s turn.${g.dutchCallerId ? ` (${g.dutchTurnsLeft} turn(s) left after Dutch)` : ""}`);
}

// After a turn action completes: start dutch window if Dutch not yet called, else just next turn
function completeTurnAction(room, roomId, playerId) {
  if (room.game?.dutchCallerId) {
    nextTurn(room, roomId);
  } else {
    startDutchWindow(room, roomId, playerId);
  }
}

// The card a player is currently holding (drawn, not yet placed). Only face-up if it came from the discard pile.
function publicDrawnCard(g) {
  if (!g?.pendingDraw) return null;
  for (const [playerId, pd] of g.pendingDraw) {
    if (pd) return { playerId, source: pd.source, card: pd.source === "DISCARD" ? pd.card : null };
  }
  return null;
}

// Public, card-free description of what just happened at the table (drives highlights on every client)
function emitTable(roomId, event) {
  io.to(roomId).emit("table:event", event);
  rooms.get(roomId)?.coach?.onTableEvent(event);
}

function publicRoomView(room) {
  const g = room.game;
  const base = {
    hostId: room.hostId,
    nextDealerId: room.players.length ? room.players[((room.dealerIndex ?? 0) + 1) % room.players.length]?.id ?? null : null,
    players: room.players.map((p) => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
    phase: g?.phase ?? "LOBBY",
    lookCount: g?.lookCount ?? 0,
    discardTop: g?.discardTop ?? null,
    deckCount: g?.deck?.length ?? 0,
    turnPlayerId: g?.phase === "PLAY" && !g.finalGraceEndsAt ? room.players[g.turnIndex]?.id ?? null : null,
    pendingEffect: g?.pendingEffect ?? null,
    effectQueue: (g?.effectQueue ?? []).map((e) => ({ type: e.type, actorId: e.actorId })),
    revealHold: g?.revealHold ?? null,
    finalGraceEndsAt: g?.finalGraceEndsAt ?? null,
    gameLength: room.gameLength ?? DEFAULT_GAME_LENGTH,
    roundNumber: room.roundNumber ?? 0,
    tutorial: room.tutorial ?? null,
    botSettings: room.botSettings ?? null,
    expectedPlayers: room.expectedPlayers ?? null, // set in play-vs-computer rooms until all bots have joined
    handSizes: Object.fromEntries(room.players.map((p) => [p.id, g?.hands?.get(p.id)?.length ?? 0])),
    reorders: g?.reorders ?? {},
    drawn: publicDrawnCard(g),
    dutchCallerId: g?.dutchCallerId ?? null,
    dutchTurnsLeft: g?.dutchTurnsLeft ?? null,
    dutchWindowPlayerId: g?.dutchWindowPlayerId ?? null,
    dutchWindowEndsAt: g?.dutchWindowEndsAt ?? null,
    totals: room.totals ?? {},
  };

  if (g?.phase === "SCORING") {
    base.roundScores = g.roundScores ?? {};
    base.revealedHands = g.revealedHands ?? {};
    base.gameOver = g.gameOver ?? false;
    base.winnerId = g.winnerId ?? null;
    base.winnerIds = g.winnerIds ?? [];
    base.dutchResult = g.dutchResult ?? null;
  }

  return base;
}

function privateViewFor(room, playerId) {
  const g = room.game;
  const showAll = room.tutorial?.showAllCards && playerId === room.tutorialHumanId;
  return {
    // Tutorial "show all my cards" mode: the player's whole hand, always visible
    fullHand: showAll ? [...(g?.hands?.get(playerId) ?? [])] : undefined,
    handSize: g?.hands?.get(playerId)?.length ?? 0,
    known: g?.known?.get(playerId) ?? {},
    hasPeeked: g?.hasPeeked?.has(playerId) ?? false,
    pendingDraw: g?.pendingDraw?.get(playerId) ?? null,
    // One-shot Queen result, only ever sent to the player who used the Queen
    matchEffect: g?.pendingEffect?.source === "match" && g.pendingEffect.actorId === playerId ? g.pendingEffect.type : null,
    queenReveal: g?.peekRevealFor?.[playerId] ?? null,
  };
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:update", publicRoomView(room));
  for (const p of room.players) {
    io.to(p.id).emit("me:update", privateViewFor(room, p.id));
  }
  // Tutorial: a coach (running the computer players' decision code on the human's own view) advises the player
  if (room.tutorial && room.coach && room.tutorialHumanId) {
    room.coach.onRoom(publicRoomView(room));
    room.coach.onMe(privateViewFor(room, room.tutorialHumanId));
    io.to(room.tutorialHumanId).emit("coach:advice", room.coach.advice());
  }
  if (room.game?.peekRevealFor) room.game.peekRevealFor = {};
}

function emitError(socketId, message) {
  io.to(socketId).emit("error", { message });
}

function shiftKnownAfterRemoval(knownObj, removedIndex) {
  const out = {};
  for (const [k, v] of Object.entries(knownObj)) {
    const idx = Number(k);
    if (!Number.isFinite(idx)) continue;
    if (idx < removedIndex) out[idx] = v;
    else if (idx > removedIndex) out[idx - 1] = v;
  }
  return out;
}

// Powers are used strictly in the order the cards hit the pile: g.effectQueue is first-in-first-out, and only the
// player at the head may use their power. g.pendingEffect always mirrors the head (null when the queue is empty).
// While anything is queued nobody can start a new turn (draw / call Dutch are blocked), but matching still works.
function syncPending(g) {
  const head = g.effectQueue?.[0];
  g.pendingEffect = head ? { type: head.type, actorId: head.actorId, source: head.source } : null;
}

function enqueueEffect(g, type, actorId, source) {
  g.effectQueue.push({ type, actorId, source });
  syncPending(g);
}

function shiftEffect(g) {
  g.effectQueue.shift();
  syncPending(g);
}

function checkAndSetSpecialEffect(room, card, actorId) {
  const g = room.game;
  const r = rankOf(card);
  if (r === "J" || r === "Q" || r === "A") {
    enqueueEffect(g, r === "J" ? "JACK" : r === "Q" ? "QUEEN" : "ACE", actorId, "turn");
    return true;
  }
  return false;
}

// Is this player allowed to use this power right now? Only the head of the queue. Returns its source:
// "turn" = they discarded it on their own turn, "match" = they matched it.
function effectSource(room, playerId, type) {
  const g = room.game;
  if (!g || g.phase !== "PLAY" || g.revealHold) return null;
  const head = g.effectQueue?.[0];
  if (head && head.type === type && head.actorId === playerId) return head.source;
  return null;
}

function finishEffect(room, roomId, playerId, source) {
  shiftEffect(room.game);
  if (source === "turn") completeTurnAction(room, roomId, playerId);
}

function freshGameState(room, lookCount) {
  const deck = makeDeck();
  const hands = new Map();
  const known = new Map();
  const hasPeeked = new Set();
  const pendingDraw = new Map();

  for (const p of room.players) {
    hands.set(p.id, [deck.pop(), deck.pop(), deck.pop(), deck.pop()]);
    known.set(p.id, {});
    pendingDraw.set(p.id, null);
  }

  const gameState = {
    phase: "PEEK",
    lookCount,
    turnIndex: room.dealerIndex ?? 0,
    deck,
    discardTop: deck.pop(),
    discarded: [],
    hands,
    known,
    hasPeeked,
    pendingDraw,
    pendingEffect: null,
    reorders: {}, // playerId -> times they rearranged their hand this round
    effectQueue: [], // special-card powers waiting to be used, oldest first
    peekRevealFor: {},
    dutchCallerId: null,
    dutchTurnsLeft: null,
    dutchWindowPlayerId: null,
    dutchWindowEndsAt: null,
  };

  if (lookCount === 0) gameState.phase = "PLAY";
  return gameState;
}

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  function joinRoom(roomId, name, isBot) {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { hostId: socket.id, players: [], game: { phase: "LOBBY" }, totals: {}, dealerIndex: 0 });
    }
    const room = rooms.get(roomId);
    room.players = room.players.filter((p) => p.id !== socket.id);
    room.players.push({ id: socket.id, name, isBot });
    if (!room.hostId) room.hostId = socket.id;
    io.to(roomId).emit("log", `${name} joined room ${roomId}`);
    broadcastRoom(roomId);
  }

  socket.on("room:join", ({ roomId, name, botSecret }) => {
    if (!roomId || !name) return;
    joinRoom(roomId, name, botSecret === BOT_SECRET);
  });

  // Start a private room against 2–9 computer players
  // Tutorial: toggle seeing all your own cards
  socket.on("room:tutorialSettings", ({ roomId, showAllCards }) => {
    const room = rooms.get(roomId);
    if (!room?.tutorial || room.tutorialHumanId !== socket.id) return;
    room.tutorial.showAllCards = !!showAllCards;
    broadcastRoom(roomId);
  });

  // Host can change the computer players' speed / difficulty at any time (the bots read the same object)
  socket.on("room:botSettings", ({ roomId, speed, difficulty }) => {
    const room = rooms.get(roomId);
    if (!room?.botSettings || room.hostId !== socket.id) return;
    if (Object.hasOwn(SPEED_MULTIPLIER, speed)) room.botSettings.speed = speed;
    if (Object.hasOwn(DIFFICULTY, difficulty)) room.botSettings.difficulty = difficulty;
    broadcastRoom(roomId);
  });

  socket.on("room:playBots", ({ name, botCount, speed, difficulty, gameLength, tutorial, showAllCards }) => {
    if (!name) return;
    const minBots = tutorial ? 1 : 2;
    const n = Math.min(tutorial ? 3 : 9, Math.max(minBots, Math.floor(Number(botCount)) || (tutorial ? 1 : 3)));
    let roomId;
    do { roomId = "BOT-" + crypto.randomBytes(2).toString("hex").toUpperCase(); } while (rooms.has(roomId));
    joinRoom(roomId, name, false);
    const room = rooms.get(roomId);
    room.expectedPlayers = n + 1;
    room.gameLength = cleanGameLength(gameLength) ?? DEFAULT_GAME_LENGTH;
    if (tutorial) {
      room.tutorial = { showAllCards: !!showAllCards };
      room.tutorialHumanId = socket.id;
      room.coach = new Bot({ offline: true, playerId: socket.id, roomId, name });
    }
    room.botSettings = {
      speed: Object.hasOwn(SPEED_MULTIPLIER, speed) ? speed : "normal",
      difficulty: Object.hasOwn(DIFFICULTY, difficulty) ? difficulty : "medium",
    };
    socket.emit("room:created", { roomId });

    const bots = [];
    roomBots.set(roomId, bots);
    BOT_NAMES.slice(0, n).forEach((botName, i) => {
      setTimeout(() => {
        if (!rooms.has(roomId)) return; // human already left
        const bot = new Bot({ url: `http://127.0.0.1:${PORT}`, roomId, name: botName, secret: BOT_SECRET, settings: room.botSettings });
        bots.push(bot);
      }, 150 * (i + 1));
    });
  });

  socket.on("game:start", ({ roomId, lookCount, gameLength }) => {
    try {
      const room = getRoomOrThrow(roomId);
      if (room.hostId !== socket.id) return;
      const lc = Number(lookCount);
      if (![0, 1, 2, 3, 4].includes(lc)) return;
      if (room.players.length < 1) return;
      room.totals = {};
      room.dealerIndex = 0;
      room.roundNumber = 1;
      room.gameLength = cleanGameLength(gameLength) ?? room.gameLength ?? DEFAULT_GAME_LENGTH;
      clearDutchWindow(room, roomId);
      room.game = freshGameState(room, lc);
      const len = room.gameLength;
      io.to(roomId).emit("log", `Game started (${len.mode === "rounds" ? `${len.rounds} round${len.rounds === 1 ? "" : "s"}` : `first to ${len.target} points`})! Each player may peek ${lc} card(s).`);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("game:newRound", ({ roomId, lookCount }) => {
    try {
      const room = getRoomOrThrow(roomId);
      if (room.game?.phase !== "SCORING" || room.game?.gameOver) return;
      if (!room.players.length) return;
      // The incoming dealer chooses how many cards everyone peeks at this round
      const nextDealerIndex = ((room.dealerIndex ?? 0) + 1) % room.players.length;
      if (room.players[nextDealerIndex].id !== socket.id) return;
      const lc = lookCount === undefined ? room.game.lookCount : Number(lookCount);
      if (![0, 1, 2, 3, 4].includes(lc)) return;
      room.dealerIndex = nextDealerIndex;
      room.roundNumber = (room.roundNumber ?? 1) + 1;
      clearDutchWindow(room, roomId);
      room.game = freshGameState(room, lc);
      io.to(roomId).emit("log", `New round! ${room.players[room.dealerIndex]?.name} is dealer and chose ${lc} peek card(s).`);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("game:peek", ({ roomId, indexes }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PEEK") return;
      if (g.hasPeeked.has(socket.id)) return;

      const unique = [...new Set(Array.isArray(indexes) ? indexes : [])]
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 3);

      if (unique.length !== g.lookCount) {
        emitError(socket.id, `Pick exactly ${g.lookCount} index(es): 0,1,2,3`);
        return;
      }

      const hand = g.hands.get(socket.id);
      const myKnown = g.known.get(socket.id) ?? {};
      for (const i of unique) myKnown[i] = hand[i];
      g.known.set(socket.id, myKnown);
      g.hasPeeked.add(socket.id);

      io.to(socket.id).emit("log", `You peeked at position(s) ${unique.join(", ")}.`);
      broadcastRoom(roomId);

      const everyoneDone = g.lookCount === 0 || room.players.every((p) => g.hasPeeked.has(p.id));
      if (everyoneDone) {
        g.phase = "PLAY";
        io.to(roomId).emit("log", `Peek phase over. ${room.players[g.turnIndex].name} goes first.`);
        broadcastRoom(roomId);
      }
    } catch (e) { emitError(socket.id, e.message); }
  });

  // Dutch can be called: (a) at start of turn before drawing, or (b) during the 10-second dutch window
  socket.on("dutch:call", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (g.dutchCallerId) { emitError(socket.id, "Dutch already called."); return; }
      if (g.pendingEffect) { emitError(socket.id, "Resolve the pending effect first."); return; }

      // You must draw and discard first; Dutch can only be called in the window right after your discard
      if (g.dutchWindowPlayerId !== socket.id) {
        emitError(socket.id, "You must draw and discard a card first. Then you can call Dutch.");
        return;
      }

      clearDutchWindow(room, roomId);

      const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
      g.dutchCallerId = socket.id;
      g.dutchTurnsLeft = room.players.length - 1;

      io.to(roomId).emit("log", `🔔 ${name} called DUTCH! Each other player gets one more turn.`);

      if (g.dutchTurnsLeft <= 0) {
        scoreRound(room, roomId);
      } else {
        g.turnIndex = (g.turnIndex + 1) % room.players.length;
        const nextName = room.players[g.turnIndex]?.name ?? "?";
        io.to(roomId).emit("log", `It's now ${nextName}'s turn. (${g.dutchTurnsLeft} turn(s) remaining)`);
      }

      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  // Player explicitly ends their turn (skipping the dutch window)
  socket.on("turn:end", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (g.dutchWindowPlayerId !== socket.id) { emitError(socket.id, "No active dutch window for you."); return; }
      clearDutchWindow(room, roomId);
      nextTurn(room, roomId);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  // Move one of your own cards to a new slot (like rearranging cards on the table).
  // Hand and known-card memory are permuted together so slot numbers stay the same for everyone.
  socket.on("hand:reorder", ({ roomId, from, to }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || (g.phase !== "PLAY" && g.phase !== "PEEK")) return;
      if (g.finalGraceEndsAt) return;
      if (g.dutchCallerId === socket.id) { emitError(socket.id, "You can't rearrange your cards after calling Dutch."); return; }
      const hand = g.hands.get(socket.id);
      const f = Number(from), t = Number(to);
      if (!hand || !Number.isInteger(f) || !Number.isInteger(t)) return;
      if (f < 0 || t < 0 || f >= hand.length || t >= hand.length || f === t) return;

      const known = g.known.get(socket.id) ?? {};
      const entries = hand.map((card, idx) => ({ card, known: known[idx] }));
      const [moved] = entries.splice(f, 1);
      entries.splice(t, 0, moved);
      g.hands.set(socket.id, entries.map((e) => e.card));
      const newKnown = {};
      entries.forEach((e, idx) => { if (e.known !== undefined) newKnown[idx] = e.known; });
      g.known.set(socket.id, newKnown);

      g.reorders[socket.id] = (g.reorders[socket.id] ?? 0) + 1;
      const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
      io.to(roomId).emit("log", `${name} rearranged their cards.`);
      emitTable(roomId, { type: "reorder", playerId: socket.id, from: f, to: t });
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("reveal:done", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      if (room.game?.revealHold !== socket.id) return;
      releaseRevealHold(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("match:attempt", ({ roomId, index }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (g?.revealHold) return;
      if (!g || g.phase !== "PLAY") return;
      if (!g.discardTop) { emitError(socket.id, "No discard card to match."); return; }

      const i = Number(index);
      const hand = g.hands.get(socket.id);
      if (!hand || !Number.isInteger(i) || i < 0 || i >= hand.length) {
        emitError(socket.id, "Invalid index."); return;
      }

      const candidate = hand[i];
      if (rankOf(candidate) === rankOf(g.discardTop)) {
        hand.splice(i, 1);
        g.known.set(socket.id, shiftKnownAfterRemoval(g.known.get(socket.id) ?? {}, i));
        setDiscardTop(g, candidate);
        const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
        const effectType = { J: "JACK", Q: "QUEEN", A: "ACE" }[rankOf(candidate)];
        if (effectType) enqueueEffect(g, effectType, socket.id, "match");
        emitTable(roomId, { type: "match", ok: true, playerId: socket.id, index: i, card: candidate });
        io.to(roomId).emit("log", `${name} MATCHED and discarded!${effectType ? ` ${rankOf(candidate)} effect!` : ""}`);
        broadcastRoom(roomId);
      } else {
        if (deckHasCards(g)) {
          hand.push(takeFromDeck(g));
          const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
          io.to(roomId).emit("log", `${name} tried to match — wrong! Penalty card added.`);
          emitTable(roomId, { type: "match", ok: false, playerId: socket.id, index: hand.length - 1 });
          broadcastRoom(roomId);
        } else {
          emitError(socket.id, "Wrong match. Deck empty, no penalty.");
        }
      }
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("turn:draw", ({ roomId, source }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }
      if (g.pendingDraw.get(socket.id)) { emitError(socket.id, "Already drew a card."); return; }
      if (g.pendingEffect) { emitError(socket.id, "Resolve the pending effect first."); return; }
      if (g.dutchWindowPlayerId === socket.id) { emitError(socket.id, "You're in the Dutch window — call Dutch or pass your turn."); return; }

      let card;
      if (source === "DECK") {
        if (!deckHasCards(g)) { emitError(socket.id, "Deck is empty."); return; }
        card = takeFromDeck(g);
      } else if (source === "DISCARD") {
        if (!g.discardTop) { emitError(socket.id, "Discard pile is empty."); return; }
        card = g.discardTop;
        g.discardTop = null;
      } else return;

      g.pendingDraw.set(socket.id, { card, source });
      io.to(roomId).emit("log", `${room.players[g.turnIndex].name} drew from ${source}.`);
      emitTable(roomId, { type: "draw", playerId: socket.id, source });
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("turn:discard-drawn", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }

      const pending = g.pendingDraw.get(socket.id);
      if (!pending) { emitError(socket.id, "No drawn card."); return; }
      // A card taken from the discard pile must go into your hand, unless you have no cards left to swap it with
      const handLeft = g.hands.get(socket.id)?.length ?? 0;
      if (pending.source !== "DECK" && handLeft > 0) { emitError(socket.id, "Can't immediately discard a card taken from the discard pile."); return; }

      const wasSpecial = checkAndSetSpecialEffect(room, pending.card, socket.id);
      setDiscardTop(g, pending.card);
      g.pendingDraw.set(socket.id, null);

      const name = room.players[g.turnIndex].name;
      io.to(roomId).emit("log", `${name} discarded ${pending.card}.${wasSpecial ? ` ${rankOf(pending.card)} effect!` : ""}`);
      emitTable(roomId, { type: "discard", playerId: socket.id, card: pending.card });

      if (!wasSpecial) completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("turn:swap", ({ roomId, index }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }

      const pending = g.pendingDraw.get(socket.id);
      if (!pending) { emitError(socket.id, "No drawn card."); return; }

      const i = Number(index);
      const hand = g.hands.get(socket.id);
      if (!hand || !Number.isInteger(i) || i < 0 || i >= hand.length) {
        emitError(socket.id, "Invalid index."); return;
      }

      const replaced = hand[i];
      hand[i] = pending.card;
      const myKnown = g.known.get(socket.id) ?? {};
      myKnown[i] = pending.card;
      g.known.set(socket.id, myKnown);

      const wasSpecial = checkAndSetSpecialEffect(room, replaced, socket.id);
      setDiscardTop(g, replaced);
      g.pendingDraw.set(socket.id, null);

      const name = room.players[g.turnIndex].name;
      io.to(roomId).emit("log", `${name} swapped into [${i}]. Discarded: ${replaced}.${wasSpecial ? ` ${rankOf(replaced)} effect!` : ""}`);
      emitTable(roomId, { type: "swap", playerId: socket.id, index: i, card: replaced });

      if (!wasSpecial) completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:jack", ({ roomId, a, b }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      const source = effectSource(room, socket.id, "JACK");
      if (!source) { emitError(socket.id, "No Jack effect to resolve."); return; }
      if (g.dutchCallerId && (a.playerId === g.dutchCallerId || b.playerId === g.dutchCallerId)) {
        emitError(socket.id, "Cannot swap the Dutch caller's cards."); return;
      }

      const handA = g.hands.get(a.playerId);
      const handB = g.hands.get(b.playerId);
      const ai = Number(a.index), bi = Number(b.index);

      if (!handA || ai < 0 || ai >= handA.length || !handB || bi < 0 || bi >= handB.length) {
        emitError(socket.id, "Invalid targets."); return;
      }

      [handA[ai], handB[bi]] = [handB[bi], handA[ai]];
      g.hands.set(a.playerId, handA);
      g.hands.set(b.playerId, handB);

      for (const [pid, idx] of [[a.playerId, ai], [b.playerId, bi]]) {
        const k = g.known.get(pid) ?? {};
        delete k[idx];
        g.known.set(pid, k);
      }

      const actor = room.players.find((p) => p.id === socket.id)?.name ?? "?";
      const nA = room.players.find((p) => p.id === a.playerId)?.name ?? a.playerId;
      const nB = room.players.find((p) => p.id === b.playerId)?.name ?? b.playerId;
      io.to(roomId).emit("log", `${actor} used Jack: swapped ${nA}[${ai}] and ${nB}[${bi}].`);
      emitTable(roomId, { type: "jack", playerId: socket.id, a: { playerId: a.playerId, index: ai }, b: { playerId: b.playerId, index: bi } });

      finishEffect(room, roomId, socket.id, source);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:queen", ({ roomId, targetPlayerId, targetIndex }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      const source = effectSource(room, socket.id, "QUEEN");
      if (!source) { emitError(socket.id, "No Queen effect to resolve."); return; }
      if (g.dutchCallerId && targetPlayerId === g.dutchCallerId) {
        emitError(socket.id, "Cannot peek the Dutch caller's cards."); return;
      }

      const hand = g.hands.get(targetPlayerId);
      const ti = Number(targetIndex);
      if (!hand || !Number.isInteger(ti) || ti < 0 || ti >= hand.length) {
        emitError(socket.id, "Invalid target."); return;
      }

      const card = hand[ti];
      if (!g.peekRevealFor) g.peekRevealFor = {};
      const targetName = room.players.find((p) => p.id === targetPlayerId)?.name ?? "?";
      g.peekRevealFor[socket.id] = { card, targetPlayerId, targetName, targetIndex: ti };

      if (targetPlayerId === socket.id) {
        const myKnown = g.known.get(socket.id) ?? {};
        myKnown[ti] = card;
        g.known.set(socket.id, myKnown);
      }

      const actor = room.players.find((p) => p.id === socket.id)?.name ?? "?";
      const tName = room.players.find((p) => p.id === targetPlayerId)?.name ?? targetPlayerId;
      io.to(roomId).emit("log", `${actor} used Queen to peek a card from ${tName}.`);
      emitTable(roomId, { type: "queen", playerId: socket.id, targetPlayerId, index: ti });

      shiftEffect(g);
      if (source === "turn") {
        if (g.dutchCallerId && (g.dutchTurnsLeft ?? 0) <= 1) {
          holdForReveal(room, roomId, socket.id); // this was the final turn: let them look before scoring
        } else {
          completeTurnAction(room, roomId, socket.id);
        }
      }
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  // A Jack or Queen needs a card to act on. If there is none (everyone else's hand is empty), the power is simply skipped.
  socket.on("effect:skip", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      const head = g.effectQueue[0];
      if (!head || head.actorId !== socket.id) { emitError(socket.id, "No power to skip."); return; }
      const cards = room.players
        .filter((p) => p.id !== g.dutchCallerId)
        .reduce((sum, p) => sum + (g.hands.get(p.id)?.length ?? 0), 0);
      if (head.type === "ACE" || cards > 0) { emitError(socket.id, "There is a valid target, so this power can't be skipped."); return; }
      const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
      io.to(roomId).emit("log", `${name}'s ${head.type.toLowerCase()} has no cards to target and is skipped.`);
      finishEffect(room, roomId, socket.id, head.source);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:ace", ({ roomId, targetPlayerId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      const source = effectSource(room, socket.id, "ACE");
      if (!source) { emitError(socket.id, "No Ace effect to resolve."); return; }
      if (g.dutchCallerId && targetPlayerId === g.dutchCallerId) {
        emitError(socket.id, "Cannot give a penalty card to the Dutch caller."); return;
      }

      const target = room.players.find((p) => p.id === targetPlayerId);
      if (!target) { emitError(socket.id, "Target not found."); return; }

      if (deckHasCards(g)) {
        const penalty = takeFromDeck(g);
        const targetHand = g.hands.get(targetPlayerId);
        targetHand.push(penalty);
        g.hands.set(targetPlayerId, targetHand);
        const actor = room.players.find((p) => p.id === socket.id)?.name ?? "?";
        io.to(roomId).emit("log", `${actor} used Ace: ${target.name} gets a penalty card.`);
        emitTable(roomId, { type: "ace", playerId: socket.id, targetPlayerId, index: targetHand.length - 1 });
      }

      finishEffect(room, roomId, socket.id, source);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms.entries()) {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.hostId === socket.id) room.hostId = room.players[0]?.id ?? null;
      const humansLeft = room.players.some((p) => !p.isBot);
      if (!humansLeft && roomBots.has(roomId)) {
        for (const bot of roomBots.get(roomId)) bot.stop();
        roomBots.delete(roomId);
        room.players = [];
      }
      if (room.players.length !== before && room.players.length > 0) broadcastRoom(roomId);
      if (room.players.length === 0) {
        clearDutchWindow(room, roomId);
        rooms.delete(roomId);
      }
    }
  });
});

app.get("/", (req, res) => res.send("Dutch server running"));
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));