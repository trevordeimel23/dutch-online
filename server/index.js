const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: true, credentials: true }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const rooms = new Map();
const roomTimers = new Map(); // roomId -> setTimeout handle for dutch window

function makeDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(`${r}${s}`);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
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

function getRoomOrThrow(roomId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error("Room not found");
  return room;
}

function isPlayersTurn(room, playerId) {
  const g = room.game;
  if (!g || g.phase !== "PLAY") return false;
  return room.players[g.turnIndex]?.id === playerId;
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
  if (callerId) {
    const callerScore = scores[callerId];
    const otherScores = Object.entries(scores)
      .filter(([id]) => id !== callerId)
      .map(([, s]) => s);
    const minOtherScore = otherScores.length ? Math.min(...otherScores) : Infinity;
    const callerWins = callerScore < minOtherScore || callerScore === 0;

    if (callerWins) {
      scores[callerId] = 0;
      const name = room.players.find((p) => p.id === callerId)?.name ?? "Caller";
      io.to(roomId).emit("log", `${name} called Dutch and had the lowest score — 0 points!`);
    } else {
      let penaltyTotal = 0;
      const penaltyCards = [];
      for (let i = 0; i < 2; i++) {
        if (g.deck.length > 0) {
          const c = g.deck.pop();
          penaltyCards.push(c);
          penaltyTotal += cardValue(c);
        }
      }
      scores[callerId] += penaltyTotal;
      const name = room.players.find((p) => p.id === callerId)?.name ?? "Caller";
      io.to(roomId).emit("log", `${name} called Dutch but didn't have the lowest — penalty +${penaltyTotal} pts (${penaltyCards.join(", ")})`);
    }
  }

  if (!room.totals) room.totals = {};
  for (const p of room.players) {
    room.totals[p.id] = (room.totals[p.id] ?? 0) + scores[p.id];
  }

  const gameOver = Object.values(room.totals).some((t) => t >= 100);
  let winnerId = null;
  if (gameOver) {
    winnerId = Object.entries(room.totals).sort((a, b) => a[1] - b[1])[0][0];
    const winnerName = room.players.find((p) => p.id === winnerId)?.name ?? "Someone";
    io.to(roomId).emit("log", `Game over! ${winnerName} wins!`);
  }

  g.phase = "SCORING";
  g.roundScores = scores;
  g.revealedHands = revealedHands;
  g.gameOver = gameOver;
  g.winnerId = winnerId;
}

function nextTurn(room, roomId) {
  const g = room.game;
  if (!g) return;
  g.pendingEffect = null;

  if (g.dutchCallerId !== null) {
    g.dutchTurnsLeft = (g.dutchTurnsLeft ?? 0) - 1;
    if (g.dutchTurnsLeft <= 0) {
      scoreRound(room, roomId);
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

function publicRoomView(room) {
  const g = room.game;
  const base = {
    hostId: room.hostId,
    players: room.players.map((p) => ({ id: p.id, name: p.name })),
    phase: g?.phase ?? "LOBBY",
    lookCount: g?.lookCount ?? 0,
    discardTop: g?.discardTop ?? null,
    deckCount: g?.deck?.length ?? 0,
    turnPlayerId: g?.phase === "PLAY" ? room.players[g.turnIndex]?.id ?? null : null,
    pendingEffect: g?.pendingEffect ?? null,
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
  }

  return base;
}

function privateViewFor(room, playerId) {
  const g = room.game;
  return {
    handSize: g?.hands?.get(playerId)?.length ?? 0,
    known: g?.known?.get(playerId) ?? {},
    hasPeeked: g?.hasPeeked?.has(playerId) ?? false,
    pendingDraw: g?.pendingDraw?.get(playerId) ?? null,
  };
}

function broadcastRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room:update", publicRoomView(room));
  for (const p of room.players) {
    io.to(p.id).emit("me:update", privateViewFor(room, p.id));
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

function checkAndSetSpecialEffect(room, card, actorId) {
  const g = room.game;
  const r = rankOf(card);
  if (r === "J" || r === "Q" || r === "A") {
    g.pendingEffect = { type: r === "J" ? "JACK" : r === "Q" ? "QUEEN" : "ACE", actorId };
    return true;
  }
  return false;
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
    hands,
    known,
    hasPeeked,
    pendingDraw,
    pendingEffect: null,
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

  socket.on("room:join", ({ roomId, name }) => {
    if (!roomId || !name) return;
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { hostId: socket.id, players: [], game: { phase: "LOBBY" }, totals: {}, dealerIndex: 0 });
    }
    const room = rooms.get(roomId);
    room.players = room.players.filter((p) => p.id !== socket.id);
    room.players.push({ id: socket.id, name });
    if (!room.hostId) room.hostId = socket.id;
    io.to(roomId).emit("log", `${name} joined room ${roomId}`);
    broadcastRoom(roomId);
  });

  socket.on("game:start", ({ roomId, lookCount }) => {
    try {
      const room = getRoomOrThrow(roomId);
      if (room.hostId !== socket.id) return;
      const lc = Number(lookCount);
      if (![0, 1, 2, 3, 4].includes(lc)) return;
      if (room.players.length < 1) return;
      room.totals = {};
      room.dealerIndex = 0;
      clearDutchWindow(room, roomId);
      room.game = freshGameState(room, lc);
      io.to(roomId).emit("log", `Game started! Each player may peek ${lc} card(s).`);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("game:newRound", ({ roomId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      if (room.hostId !== socket.id) return;
      if (room.game?.phase !== "SCORING" || room.game?.gameOver) return;
      const lc = room.game.lookCount;
      room.dealerIndex = ((room.dealerIndex ?? 0) + 1) % room.players.length;
      clearDutchWindow(room, roomId);
      room.game = freshGameState(room, lc);
      io.to(roomId).emit("log", `New round! Dealer rotated to ${room.players[room.dealerIndex]?.name}.`);
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

      const inWindow = g.dutchWindowPlayerId === socket.id;
      const atStartOfTurn = isPlayersTurn(room, socket.id) && !g.pendingDraw?.get(socket.id);

      if (!inWindow && !atStartOfTurn) {
        emitError(socket.id, "You can only call Dutch on your turn before drawing, or right after discarding.");
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

  socket.on("match:attempt", ({ roomId, index }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
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
        g.discardTop = candidate;
        const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
        io.to(roomId).emit("log", `${name} MATCHED and discarded!`);
        broadcastRoom(roomId);
      } else {
        if (g.deck.length > 0) {
          hand.push(g.deck.pop());
          const name = room.players.find((p) => p.id === socket.id)?.name ?? "Someone";
          io.to(roomId).emit("log", `${name} tried to match — wrong! Penalty card added.`);
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
        if (!g.deck.length) { emitError(socket.id, "Deck is empty."); return; }
        card = g.deck.pop();
      } else if (source === "DISCARD") {
        if (!g.discardTop) { emitError(socket.id, "Discard pile is empty."); return; }
        card = g.discardTop;
        g.discardTop = null;
      } else return;

      g.pendingDraw.set(socket.id, { card, source });
      io.to(roomId).emit("log", `${room.players[g.turnIndex].name} drew from ${source}.`);
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
      if (pending.source !== "DECK") { emitError(socket.id, "Can't immediately discard a card taken from the discard pile."); return; }

      const wasSpecial = checkAndSetSpecialEffect(room, pending.card, socket.id);
      g.discardTop = pending.card;
      g.pendingDraw.set(socket.id, null);

      const name = room.players[g.turnIndex].name;
      io.to(roomId).emit("log", `${name} discarded ${pending.card}.${wasSpecial ? ` ${rankOf(pending.card)} effect!` : ""}`);

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
      g.discardTop = replaced;
      g.pendingDraw.set(socket.id, null);

      const name = room.players[g.turnIndex].name;
      io.to(roomId).emit("log", `${name} swapped into [${i}]. Discarded: ${replaced}.${wasSpecial ? ` ${rankOf(replaced)} effect!` : ""}`);

      if (!wasSpecial) completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:jack", ({ roomId, a, b }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }
      if (!g.pendingEffect || g.pendingEffect.type !== "JACK" || g.pendingEffect.actorId !== socket.id) {
        emitError(socket.id, "No Jack effect to resolve."); return;
      }
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

      completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:queen", ({ roomId, targetPlayerId, targetIndex }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }
      if (!g.pendingEffect || g.pendingEffect.type !== "QUEEN" || g.pendingEffect.actorId !== socket.id) {
        emitError(socket.id, "No Queen effect to resolve."); return;
      }
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
      g.peekRevealFor[socket.id] = { card, targetPlayerId, targetIndex: ti };

      if (targetPlayerId === socket.id) {
        const myKnown = g.known.get(socket.id) ?? {};
        myKnown[ti] = card;
        g.known.set(socket.id, myKnown);
      }

      const actor = room.players.find((p) => p.id === socket.id)?.name ?? "?";
      const tName = room.players.find((p) => p.id === targetPlayerId)?.name ?? targetPlayerId;
      io.to(roomId).emit("log", `${actor} used Queen to peek a card from ${tName}.`);
      io.to(socket.id).emit("log", `Queen peek result: ${tName}[${ti}] = ${card}`);

      completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("effect:ace", ({ roomId, targetPlayerId }) => {
    try {
      const room = getRoomOrThrow(roomId);
      const g = room.game;
      if (!g || g.phase !== "PLAY") return;
      if (!isPlayersTurn(room, socket.id)) { emitError(socket.id, "Not your turn."); return; }
      if (!g.pendingEffect || g.pendingEffect.type !== "ACE" || g.pendingEffect.actorId !== socket.id) {
        emitError(socket.id, "No Ace effect to resolve."); return;
      }
      if (g.dutchCallerId && targetPlayerId === g.dutchCallerId) {
        emitError(socket.id, "Cannot give a penalty card to the Dutch caller."); return;
      }

      const target = room.players.find((p) => p.id === targetPlayerId);
      if (!target) { emitError(socket.id, "Target not found."); return; }

      if (g.deck.length > 0) {
        const penalty = g.deck.pop();
        const targetHand = g.hands.get(targetPlayerId);
        targetHand.push(penalty);
        g.hands.set(targetPlayerId, targetHand);
        const actor = room.players.find((p) => p.id === socket.id)?.name ?? "?";
        io.to(roomId).emit("log", `${actor} used Ace: ${target.name} gets a penalty card.`);
      }

      completeTurnAction(room, roomId, socket.id);
      broadcastRoom(roomId);
    } catch (e) { emitError(socket.id, e.message); }
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms.entries()) {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.id !== socket.id);
      if (room.hostId === socket.id) room.hostId = room.players[0]?.id ?? null;
      if (room.players.length !== before) broadcastRoom(roomId);
      if (room.players.length === 0) {
        clearDutchWindow(room, roomId);
        rooms.delete(roomId);
      }
    }
  });
});

app.get("/", (req, res) => res.send("Dutch server running"));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));