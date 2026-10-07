// Computer players for Dutch.
//
// A Bot is an ordinary socket.io client that connects back to this server, so it is limited to the
// same information a human sees: public table state, its own known cards, and what it watches happen.
// It only "remembers" other players' cards when it saw someone pick up a discard (and even then it only
// gets the slot right 70% of the time) or when it peeked with a Queen.

const { io } = require("socket.io-client");

// Multiplies every thinking delay. 1 = human-like pacing; tests set e.g. 0.02 to run fast.
const SPEED = Number(process.env.BOT_SPEED || 1);

const BOT_NAMES = ["🤖 Ada", "🤖 Bruno", "🤖 Chen", "🤖 Dara", "🤖 Eli", "🤖 Faye", "🤖 Gus", "🤖 Hana", "🤖 Ivo"];

const MISSED_MATCH_CHANCE = 0.1;  // chance a match attempt is aimed at the wrong card
const FORGET_MATCH_CHANCE = 0.1;  // chance the bot just doesn't notice a match
const DISCARD_PICKUP_MEMORY = 0.7; // chance of remembering the right slot for a picked-up discard
const AVG_UNKNOWN_VALUE = 6.5;     // expected value of a card you haven't seen

const rnd = (a, b) => a + Math.random() * (b - a);
const wait = (min, max) => rnd(min, max) * SPEED;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function rankOf(card) { return card.slice(0, -1); }
function suitOf(card) { return card.slice(-1); }
function cardValue(card) {
  const rank = rankOf(card);
  if (rank === "A") return 1;
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return (suitOf(card) === "H" || suitOf(card) === "D") ? 0 : 13;
  return parseInt(rank, 10);
}
const isBlackKing = (card) => rankOf(card) === "K" && (suitOf(card) === "S" || suitOf(card) === "C");

class Bot {
  constructor({ url, roomId, name, secret }) {
    this.roomId = roomId;
    this.name = name;
    this.room = null;     // public room view
    this.me = null;       // private view (known cards, drawn card, pending match effect, ...)
    this.beliefs = {};    // playerId -> { slot: card } what this bot thinks other players hold
    this.lastDraw = {};   // playerId -> { source } for the draw they just made
    this.phase = null;
    this.discardVersion = 0;
    this.matchPlans = {}; // discardVersion -> "match" | "forget" | "mistake"
    this.timer = null;
    this.lockUntil = 0;
    this.stopped = false;

    this.socket = io(url, { transports: ["websocket"], reconnection: false });
    this.socket.on("connect", () => {
      this.socket.emit("room:join", { roomId, name, botSecret: secret });
    });
    this.socket.on("room:update", (r) => this.onRoom(r));
    this.socket.on("me:update", (m) => this.onMe(m));
    this.socket.on("table:event", (e) => this.onTableEvent(e));
    this.socket.on("error", (e) => {
      if (process.env.BOT_DEBUG) console.log("[bot error]", this.name, e?.message);
      this.lockUntil = Date.now() + 800 * SPEED;
      this.schedule();
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket.disconnect();
  }

  get id() { return this.socket.id; }

  // ── incoming state ────────────────────────────────────────────────────────

  onRoom(room) {
    const prevPhase = this.phase;
    this.room = room;
    this.phase = room.phase;
    const newRound = (room.phase === "PEEK" || room.phase === "PLAY") && prevPhase !== room.phase &&
      (prevPhase === "SCORING" || prevPhase === "LOBBY" || prevPhase === null);
    if (newRound) {
      this.beliefs = {};
      this.lastDraw = {};
      this.matchPlans = {};
      this.discardVersion += 1;
    }
    this.schedule();
  }

  onMe(me) {
    this.me = me;
    // A Queen peek on someone else's card: remember it exactly
    if (me.queenReveal && me.queenReveal.targetPlayerId !== this.id) {
      this.setBelief(me.queenReveal.targetPlayerId, me.queenReveal.targetIndex, me.queenReveal.card);
    }
    this.schedule();
  }

  setBelief(pid, slot, card) {
    if (pid === this.id) return;
    if (!this.beliefs[pid]) this.beliefs[pid] = {};
    if (card === undefined || card === null) delete this.beliefs[pid][slot];
    else this.beliefs[pid][slot] = card;
  }

  shiftBeliefsAfterRemoval(pid, removed) {
    const old = this.beliefs[pid] || {};
    const next = {};
    for (const [k, v] of Object.entries(old)) {
      const i = Number(k);
      if (i < removed) next[i] = v;
      else if (i > removed) next[i - 1] = v;
    }
    this.beliefs[pid] = next;
  }

  onTableEvent(ev) {
    const room = this.room;
    switch (ev.type) {
      case "draw":
        this.lastDraw[ev.playerId] = { source: ev.source, card: ev.source === "DISCARD" ? room?.discardTop ?? null : null };
        break;
      case "discard":
        this.discardVersion += 1;
        break;
      case "swap": {
        this.discardVersion += 1;
        const d = this.lastDraw[ev.playerId];
        if (ev.playerId !== this.id) {
          this.setBelief(ev.playerId, ev.index, null);
          if (d?.source === "DISCARD" && d.card) {
            // Saw them pick up a discard and place it: remember where, but only mostly correctly
            let slot = ev.index;
            const size = room?.handSizes?.[ev.playerId] ?? 4;
            if (Math.random() > DISCARD_PICKUP_MEMORY && size > 1) {
              const others = [...Array(size).keys()].filter((i) => i !== ev.index);
              slot = pick(others);
            }
            this.setBelief(ev.playerId, slot, d.card);
          }
        }
        break;
      }
      case "match":
        if (ev.ok) {
          this.discardVersion += 1;
          if (ev.playerId !== this.id) this.shiftBeliefsAfterRemoval(ev.playerId, ev.index);
        }
        break;
      case "reorder": {
        if (ev.playerId === this.id) break;
        const size = room?.handSizes?.[ev.playerId] ?? 4;
        const arr = [...Array(size).keys()].map((i) => this.beliefs[ev.playerId]?.[i]);
        const [moved] = arr.splice(ev.from, 1);
        arr.splice(ev.to, 0, moved);
        const next = {};
        arr.forEach((c, i) => { if (c !== undefined) next[i] = c; });
        this.beliefs[ev.playerId] = next;
        break;
      }
      case "jack": {
        const cardAt = (side) => (side.playerId === this.id ? this.me?.known?.[side.index] : this.beliefs[side.playerId]?.[side.index]);
        const a = cardAt(ev.a), b = cardAt(ev.b);
        this.setBelief(ev.a.playerId, ev.a.index, b);
        this.setBelief(ev.b.playerId, ev.b.index, a);
        break;
      }
      default:
        break;
    }
  }

  // ── what the bot knows about its own hand ─────────────────────────────────

  get handSize() { return this.me?.handSize ?? 0; }
  known() { return this.me?.known ?? {}; }
  unknownSlots() {
    const k = this.known();
    return [...Array(this.handSize).keys()].filter((i) => k[i] === undefined);
  }
  knownSlots() {
    const k = this.known();
    return [...Array(this.handSize).keys()].filter((i) => k[i] !== undefined);
  }
  knownSum() { return this.knownSlots().reduce((sum, i) => sum + cardValue(this.known()[i]), 0); }

  // ── scheduling ────────────────────────────────────────────────────────────

  schedule() {
    if (this.stopped || this.timer) return;
    if (!this.room || !this.me) return;
    const now = Date.now();
    const act = this.decide();
    if (!act) return;
    const wait0 = Math.max(act.delay, this.lockUntil - now);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      const again = this.decide();
      if (again && again.key === act.key) {
        this.lockUntil = Date.now() + 1500 * SPEED;
        try { again.run(); } catch (e) { console.log("bot error", this.name, e.message); }
        // If the server answers, the next update re-schedules; otherwise retry after the lock expires.
        setTimeout(() => this.schedule(), 1600 * SPEED);
      } else {
        this.schedule();
      }
    }, wait0);
  }

  emit(event, payload) { this.socket.emit(event, { roomId: this.roomId, ...payload }); }

  decide() {
    const room = this.room, me = this.me;
    const phase = room.phase;

    if (phase === "PEEK") {
      if (!me.hasPeeked && room.lookCount > 0) {
        return { key: "peek", delay: wait(1500, 3500), run: () => this.doPeek() };
      }
      return null;
    }

    if (phase === "SCORING") {
      if (!room.gameOver && room.nextDealerId === this.id) {
        return { key: "newRound", delay: wait(5000, 7000), run: () => this.emit("game:newRound", { lookCount: 2 }) };
      }
      return null;
    }

    if (phase !== "PLAY") return null;

    // The round is waiting for me to finish looking at my Queen peek on the last turn
    if (room.revealHold === this.id) {
      return { key: "reveal", delay: wait(1500, 3000), run: () => this.emit("reveal:done", {}) };
    }

    // 1) A special-card power to use (from my own discard or from a match)
    const effect = this.pendingEffectType();
    if (effect) {
      return { key: `effect:${effect}:${this.discardVersion}`, delay: wait(1200, 2400), run: () => this.doEffect(effect) };
    }

    // 2) Matching the discard pile
    const m = this.matchAction();
    if (m) return m;

    if (room.finalGraceEndsAt || room.revealHold) return null;

    // 3) My turn
    if (room.turnPlayerId !== this.id) return null;
    if (me.pendingDraw) {
      return { key: `place:${me.pendingDraw.card}`, delay: wait(900, 1700), run: () => this.doPlace() };
    }
    if (room.dutchWindowPlayerId === this.id) {
      return { key: "window", delay: wait(500, 1000), run: () => this.doWindow() };
    }
    return { key: `draw:${this.discardVersion}`, delay: wait(800, 1500), run: () => this.doDraw() };
  }

  pendingEffectType() {
    const room = this.room;
    if (room.pendingEffect && room.pendingEffect.actorId === this.id && room.turnPlayerId === this.id) return room.pendingEffect.type;
    return this.me?.matchEffect ?? null;
  }

  // ── peek ──────────────────────────────────────────────────────────────────

  doPeek() {
    const n = this.room.lookCount;
    const slots = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, n);
    this.emit("game:peek", { indexes: slots });
  }

  // ── matching ──────────────────────────────────────────────────────────────

  matchAction() {
    const room = this.room, me = this.me;
    if (!room.discardTop || me.pendingDraw || room.revealHold) return null;
    const rank = rankOf(room.discardTop);
    const k = this.known();
    const slots = this.knownSlots().filter((i) => rankOf(k[i]) === rank);
    if (!slots.length) return null;

    const v = this.discardVersion;
    if (!this.matchPlans[v]) {
      const roll = Math.random();
      this.matchPlans[v] = roll < FORGET_MATCH_CHANCE ? "forget" : Math.random() < MISSED_MATCH_CHANCE ? "mistake" : "match";
    }
    const plan = this.matchPlans[v];
    if (plan === "forget") return null;

    return {
      key: `match:${v}:${slots[0]}:${plan}`,
      delay: wait(900, 2600),
      run: () => {
        if (plan === "mistake") {
          // Aims at the wrong card (a card that isn't a known match)
          const wrong = [...Array(this.handSize).keys()].filter((i) => !slots.includes(i));
          this.matchPlans[v] = "match"; // next time, go for the right card
          if (wrong.length) { this.emit("match:attempt", { index: pick(wrong) }); return; }
        }
        this.emit("match:attempt", { index: slots[0] });
        this.matchPlans[v] = "forget"; // don't try this same card twice
      },
    };
  }

  // ── drawing and placing ───────────────────────────────────────────────────

  doDraw() {
    const top = this.room.discardTop;
    let takeDiscard = false;
    if (top && !isBlackKing(top)) {
      const v = cardValue(top);
      const k = this.known();
      const worst = this.knownSlots().reduce((m, i) => Math.max(m, cardValue(k[i])), -Infinity);
      const gainKnown = worst - v;
      const gainUnknown = this.unknownSlots().length ? AVG_UNKNOWN_VALUE + 1.5 - v : -Infinity;
      if (v <= 1 || gainKnown >= 3 || gainUnknown >= 3) takeDiscard = true;
    }
    this.emit("turn:draw", { source: takeDiscard ? "DISCARD" : "DECK" });
  }

  // Best slot for a card: highest improvement; unknown slots count as an average card plus a bonus for learning it
  bestSlotFor(card) {
    const v = cardValue(card);
    const k = this.known();
    let best = null;
    for (let i = 0; i < this.handSize; i++) {
      const gain = k[i] !== undefined ? cardValue(k[i]) - v : AVG_UNKNOWN_VALUE + 1.5 - v;
      if (!best || gain > best.gain || (gain === best.gain && Math.random() < 0.5)) best = { index: i, gain };
    }
    return best;
  }

  doPlace() {
    const pd = this.me.pendingDraw;
    if (!pd) return;
    const best = this.bestSlotFor(pd.card);
    const fromDiscard = pd.source === "DISCARD";
    if (!best) { if (!fromDiscard) this.emit("turn:discard-drawn", {}); return; }

    if (isBlackKing(pd.card) && !fromDiscard) { this.emit("turn:discard-drawn", {}); return; }
    if (fromDiscard || best.gain > 0) this.emit("turn:swap", { index: best.index });
    else this.emit("turn:discard-drawn", {});
  }

  // ── Dutch ─────────────────────────────────────────────────────────────────

  doWindow() {
    if (!this.room.dutchCallerId && this.shouldCallDutch()) this.emit("dutch:call", {});
    else this.emit("turn:end", {});
  }

  shouldCallDutch() {
    if (this.unknownSlots().length > 0) return false; // only when it knows its hand for sure
    const score = this.knownSum();
    const others = this.room.players.filter((p) => p.id !== this.id);

    if (score <= 1) {
      const someoneEmpty = others.some((p) => (this.room.handSizes?.[p.id] ?? 4) === 0);
      const someoneLow = others.some((p) => {
        const size = this.room.handSizes?.[p.id] ?? 4;
        const b = this.beliefs[p.id] || {};
        const slots = [...Array(size).keys()];
        return size > 0 && slots.every((i) => b[i] !== undefined && cardValue(b[i]) <= 1);
      });
      if (!someoneEmpty && !someoneLow) return true;
    }
    if (score <= 4 && others.every((p) => (this.room.handSizes?.[p.id] ?? 4) >= 3)) return true;
    return false;
  }

  // ── special powers ────────────────────────────────────────────────────────

  targets() {
    // Other players that can be targeted (not me, not the Dutch caller)
    return this.room.players.filter((p) => p.id !== this.id && p.id !== this.room.dutchCallerId);
  }

  doEffect(type) {
    if (type === "ACE") return this.doAce();
    if (type === "JACK") return this.doJack();
    return this.doQueen();
  }

  doAce() {
    const cands = this.targets();
    if (!cands.length) { this.emit("effect:ace", { targetPlayerId: this.id }); return; }
    const totals = this.room.totals || {};
    const total = (p) => totals[p.id] ?? 0;
    const lowest = Math.min(...cands.map(total));
    const close = cands.filter((p) => total(p) <= lowest + 4); // "very similar" scores
    const size = (p) => this.room.handSizes?.[p.id] ?? 4;
    const fewest = Math.min(...close.map(size));
    const target = pick(close.filter((p) => size(p) === fewest));
    this.emit("effect:ace", { targetPlayerId: target.id });
  }

  doJack() {
    const k = this.known();
    const ownSlots = this.knownSlots();
    const cands = this.targets();

    // Try to improve my own hand: trade my worst known card for a card I believe is much lower
    if (ownSlots.length) {
      const worstSlot = ownSlots.reduce((a, b) => (cardValue(k[a]) >= cardValue(k[b]) ? a : b));
      const worstVal = cardValue(k[worstSlot]);
      let bestTrade = null;
      for (const p of cands) {
        for (const [slot, card] of Object.entries(this.beliefs[p.id] || {})) {
          if (Number(slot) >= (this.room.handSizes?.[p.id] ?? 4)) continue;
          const gain = worstVal - cardValue(card);
          if (gain >= 6 && (!bestTrade || gain > bestTrade.gain)) bestTrade = { pid: p.id, slot: Number(slot), gain };
        }
      }
      if (bestTrade) {
        this.emit("effect:jack", { a: { playerId: this.id, index: worstSlot }, b: { playerId: bestTrade.pid, index: bestTrade.slot } });
        return;
      }
    }

    // Otherwise confuse people: shuffle two cards belonging to the players with the lowest scores
    const totals = this.room.totals || {};
    const ranked = [...cands].sort((x, y) => (totals[x.id] ?? 0) - (totals[y.id] ?? 0));
    const sizeOf = (p) => this.room.handSizes?.[p.id] ?? 4;
    const withCards = ranked.filter((p) => sizeOf(p) > 0);
    if (withCards.length >= 2) {
      const [p1, p2] = withCards;
      this.emit("effect:jack", { a: { playerId: p1.id, index: Math.floor(Math.random() * sizeOf(p1)) }, b: { playerId: p2.id, index: Math.floor(Math.random() * sizeOf(p2)) } });
      return;
    }
    if (withCards.length === 1 && sizeOf(withCards[0]) >= 2) {
      const p = withCards[0];
      const n = sizeOf(p);
      const a = Math.floor(Math.random() * n);
      let b = Math.floor(Math.random() * (n - 1));
      if (b >= a) b += 1;
      this.emit("effect:jack", { a: { playerId: p.id, index: a }, b: { playerId: p.id, index: b } });
      return;
    }
    // Nothing sensible to do: swap two of my own cards
    const n = Math.max(this.handSize, 1);
    this.emit("effect:jack", { a: { playerId: this.id, index: 0 }, b: { playerId: this.id, index: Math.min(1, n - 1) } });
  }

  doQueen() {
    const unknown = this.unknownSlots();
    if (unknown.length) {
      this.emit("effect:queen", { targetPlayerId: this.id, targetIndex: pick(unknown) });
      return;
    }
    // Know everything I own: look at someone else's card, usually whoever has the fewest cards
    const cands = this.targets().filter((p) => (this.room.handSizes?.[p.id] ?? 4) > 0);
    if (!cands.length) { this.emit("effect:queen", { targetPlayerId: this.id, targetIndex: 0 }); return; }
    const size = (p) => this.room.handSizes?.[p.id] ?? 4;
    const fewest = Math.min(...cands.map(size));
    const pool = Math.random() < 0.8 ? cands.filter((p) => size(p) === fewest) : cands;
    const target = pick(pool);
    this.emit("effect:queen", { targetPlayerId: target.id, targetIndex: Math.floor(Math.random() * size(target)) });
  }
}

module.exports = { Bot, BOT_NAMES };
