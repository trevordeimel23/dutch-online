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

// Gameplay speed: how much slower than the original ("fast") pacing the bots think and move
const SPEED_MULTIPLIER = { fast: 1, normal: 2, slow: 4 };
// Difficulty: forget = chance the bot doesn't notice a match, wrong = chance an attempt is aimed at the wrong card
const DIFFICULTY = {
  easy:   { forget: 0.5,  wrong: 0.25 },
  medium: { forget: 0.25, wrong: 0.15 },
  hard:   { forget: 0.1,  wrong: 0.1 },
};
const DISCARD_PICKUP_MEMORY = 0.7; // chance of remembering the right slot for a picked-up discard
const AVG_UNKNOWN_VALUE = 6.5;     // expected value of a card you haven't seen

const rnd = (a, b) => a + Math.random() * (b - a);

// How many cards a computer dealer lets everyone peek at: 0 (10%), 1 (20%), 2 (40%), 3 (20%), 4 (10%)
function pickLookCount() {
  const roll = Math.random();
  if (roll < 0.1) return 0;
  if (roll < 0.3) return 1;
  if (roll < 0.7) return 2;
  if (roll < 0.9) return 3;
  return 4;
}
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
const SUIT_SYMBOL = { S: "♠", H: "♥", D: "♦", C: "♣" };
const label = (card) => `${rankOf(card)}${SUIT_SYMBOL[suitOf(card)] ?? suitOf(card)}`;
const isBlackKing = (card) => rankOf(card) === "K" && (suitOf(card) === "S" || suitOf(card) === "C");

class Bot {
  // offline: no socket — used by the tutorial coach, which is fed the human player's views by the server
  constructor({ url, roomId, name, secret, settings, offline, playerId }) {
    this.offline = !!offline;
    this.fakeId = playerId;
    this.settings = settings || { speed: "fast", difficulty: "hard" };
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

    if (this.offline) return;
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
    if (this.socket) this.socket.disconnect();
  }

  get id() { return this.offline ? this.fakeId : this.socket.id; }

  wait(min, max) { return rnd(min, max) * SPEED * (SPEED_MULTIPLIER[this.settings.speed] ?? 1); }
  get difficulty() { return DIFFICULTY[this.settings.difficulty] ?? DIFFICULTY.hard; }

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
  // In tutorial "show all my cards" mode the coach knows the whole hand, like the player does
  known() {
    if (this.me?.fullHand) return Object.fromEntries(this.me.fullHand.map((c, i) => [i, c]));
    return this.me?.known ?? {};
  }
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
    if (this.offline || this.stopped || this.timer) return;
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
        return { key: "peek", delay: this.wait(1500, 3500), run: () => this.doPeek() };
      }
      return null;
    }

    if (phase === "SCORING") {
      if (!room.gameOver && room.nextDealerId === this.id) {
        return { key: "newRound", delay: this.wait(5000, 7000), run: () => this.emit("game:newRound", { lookCount: pickLookCount() }) };
      }
      return null;
    }

    if (phase !== "PLAY") return null;

    // The round is waiting for me to finish looking at my Queen peek on the last turn
    if (room.revealHold === this.id) {
      return { key: "reveal", delay: this.wait(1500, 3000), run: () => this.emit("reveal:done", {}) };
    }

    // 1) A special-card power to use (from my own discard or from a match)
    const effect = this.pendingEffectType();
    if (effect) {
      return { key: `effect:${effect}:${this.discardVersion}`, delay: this.wait(1200, 2400), run: () => this.doEffect(effect) };
    }

    // 2) Matching the discard pile
    const m = this.matchAction();
    if (m) return m;

    if (room.finalGraceEndsAt || room.revealHold) return null;

    // 3) My turn
    if (room.turnPlayerId !== this.id) return null;
    if (me.pendingDraw) {
      return { key: `place:${me.pendingDraw.card}`, delay: this.wait(900, 1700), run: () => this.doPlace() };
    }
    if (room.dutchWindowPlayerId === this.id) {
      return { key: "window", delay: this.wait(500, 1000), run: () => this.doWindow() };
    }
    return { key: `draw:${this.discardVersion}`, delay: this.wait(800, 1500), run: () => this.doDraw() };
  }

  pendingEffectType() {
    const pe = this.room?.pendingEffect;
    return pe && pe.actorId === this.id ? pe.type : null;
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
      this.matchPlans[v] = roll < this.difficulty.forget ? "forget" : Math.random() < this.difficulty.wrong ? "mistake" : "match";
    }
    const plan = this.matchPlans[v];
    if (plan === "forget") return null;

    return {
      key: `match:${v}:${slots[0]}:${plan}`,
      delay: this.wait(900, 2600),
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

  // Each plan*() returns what to do plus a plain-English reason. Bots act on the plan; the tutorial coach shows the reason.

  planDraw() {
    const top = this.room.discardTop;
    if (this.handSize === 0) return { source: "DECK", reason: "You have no cards left, so just draw from the deck and discard it." };
    if (!top) return { source: "DECK", reason: "The discard pile is empty, so draw from the deck." };
    if (isBlackKing(top)) return { source: "DECK", reason: `Never take a black king (${label(top)}) — it's worth 13 points, the worst card. Draw from the deck instead.` };
    const v = cardValue(top);
    const k = this.known();
    const knownSlots = this.knownSlots();
    let worstSlot = null;
    for (const i of knownSlots) if (worstSlot === null || cardValue(k[i]) > cardValue(k[worstSlot])) worstSlot = i;
    const worst = worstSlot === null ? -Infinity : cardValue(k[worstSlot]);
    const gainKnown = worst - v;
    const hasUnknown = this.unknownSlots().length > 0;
    const gainUnknown = hasUnknown ? AVG_UNKNOWN_VALUE + 1.5 - v : -Infinity;

    if (v <= 1) return { source: "DISCARD", reason: `The ${label(top)} on the discard pile is worth only ${v} point${v === 1 ? "" : "s"} — take it!` };
    if (gainKnown >= 3) return { source: "DISCARD", reason: `Take the ${label(top)} (${v}): you can swap it for your card #${worstSlot} (${label(k[worstSlot])}, ${worst}) and save ${gainKnown} points.` };
    if (gainUnknown >= 3) return { source: "DISCARD", reason: `Take the ${label(top)} (${v}): an unseen card averages about 6.5, so swapping it in should lower your score — and you'll learn what you were holding.` };
    return { source: "DECK", reason: `The ${label(top)} on the discard pile (${v}) wouldn't improve your hand much, so draw from the deck.` };
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

  planPlace() {
    const pd = this.me.pendingDraw;
    if (!pd) return null;
    const card = pd.card;
    const v = cardValue(card);
    const fromDiscard = pd.source === "DISCARD";
    const best = this.bestSlotFor(card);
    const power = { J: "Jack", Q: "Queen", A: "Ace" }[rankOf(card)];

    if (!best) return { kind: "discard", reason: "Discard it." };
    if (isBlackKing(card) && !fromDiscard) {
      return { kind: "discard", reason: `${label(card)} is a black king — worth 13 points, the worst card. Discard it right away.` };
    }
    if (fromDiscard || best.gain > 0) {
      const k = this.known();
      const slot = best.index;
      const reason = k[slot] !== undefined
        ? `Swap it with your card #${slot} (${label(k[slot])}, ${cardValue(k[slot])} points) — that saves ${cardValue(k[slot]) - v} points.`
        : `Swap it with your unknown card #${slot}. Your ${label(card)} (${v}) is probably lower than an unseen card (about 6.5 on average), and the card you replace is shown on the pile so you learn what it was.`;
      return { kind: "swap", index: slot, reason: fromDiscard ? `You took it from the discard pile, so it must go into your hand. ${reason}` : reason };
    }
    return {
      kind: "discard",
      reason: `${label(card)} (${v}) isn't better than what you have, so discard it.${power ? ` Bonus: discarding a ${power} lets you use its power!` : ""}`,
    };
  }

  // ── Dutch ─────────────────────────────────────────────────────────────────

  planWindow() {
    const d = this.dutchCheck();
    return { dutch: d.call, reason: d.reason };
  }

  dutchCheck() {
    const unknown = this.unknownSlots();
    if (unknown.length > 0) {
      return { call: false, reason: `You don't know all your cards yet (card${unknown.length > 1 ? "s" : ""} ${unknown.map((i) => "#" + i).join(", ")} unknown), so calling Dutch is too risky. Pass.` };
    }
    const score = this.knownSum();
    // Nothing can beat 0 (and a score of 0 always wins the Dutch call), so with an empty hand or only red kings: call it
    if (score === 0) return { call: true, reason: "Your hand is worth 0 — nothing can beat that. Call Dutch!" };
    const others = this.room.players.filter((p) => p.id !== this.id);
    const size = (p) => this.room.handSizes?.[p.id] ?? 4;

    if (score <= 1) {
      const someoneEmpty = others.some((p) => size(p) === 0);
      const someoneLow = others.some((p) => {
        const b = this.beliefs[p.id] || {};
        const slots = [...Array(size(p)).keys()];
        return size(p) > 0 && slots.every((i) => b[i] !== undefined && cardValue(b[i]) <= 1);
      });
      if (!someoneEmpty && !someoneLow) return { call: true, reason: `You know every card and your total is only ${score} — call Dutch!` };
    }
    if (score <= 4 && others.every((p) => size(p) >= 3)) {
      return { call: true, reason: `You know every card, your total is just ${score}, and everyone else still has 3+ cards — call Dutch!` };
    }
    return { call: false, reason: score > 4 ? `Your known total is ${score} — too high to risk Dutch (if anyone beats or ties you, you take 2 penalty cards). Pass.` : "Someone else could have an equal or lower score, so calling Dutch is risky. Pass." };
  }

  shouldCallDutch() { return this.dutchCheck().call; }

  doWindow() {
    if (!this.room.dutchCallerId && this.shouldCallDutch()) this.emit("dutch:call", {});
    else this.emit("turn:end", {});
  }

  doDraw() { this.emit("turn:draw", { source: this.planDraw().source }); }

  doPlace() {
    const plan = this.planPlace();
    if (!plan) return;
    if (plan.kind === "swap") this.emit("turn:swap", { index: plan.index });
    else this.emit("turn:discard-drawn", {});
  }

  // ── special powers ────────────────────────────────────────────────────────

  targets() {
    // Other players that can be targeted (not me, not the Dutch caller)
    return this.room.players.filter((p) => p.id !== this.id && p.id !== this.room.dutchCallerId);
  }

  nameOf(pid) { return this.room.players.find((p) => p.id === pid)?.name ?? "someone"; }

  planEffect(type) {
    if (type === "ACE") return this.planAce();
    if (type === "JACK") return this.planJack();
    return this.planQueen();
  }

  doEffect(type) {
    const plan = this.planEffect(type);
    if (plan.skip) this.emit("effect:skip", {});
    else if (type === "ACE") this.emit("effect:ace", { targetPlayerId: plan.targetPlayerId });
    else if (type === "JACK") this.emit("effect:jack", { a: plan.a, b: plan.b });
    else this.emit("effect:queen", { targetPlayerId: plan.targetPlayerId, targetIndex: plan.targetIndex });
  }

  planAce() {
    const cands = this.targets();
    if (!cands.length) return { targetPlayerId: this.id, reason: "Nobody else can be targeted." };
    const totals = this.room.totals || {};
    const total = (p) => totals[p.id] ?? 0;
    const lowest = Math.min(...cands.map(total));
    const close = cands.filter((p) => total(p) <= lowest + 4); // "very similar" scores
    const size = (p) => this.room.handSizes?.[p.id] ?? 4;
    const fewest = Math.min(...close.map(size));
    const target = pick(close.filter((p) => size(p) === fewest));
    const why = close.length > 1
      ? `${target.name} has the fewest cards (${size(target)}) among the players with the lowest scores`
      : `${target.name} has the lowest overall score (${total(target)})`;
    return { targetPlayerId: target.id, reason: `Give the Ace's penalty card to ${target.name}: ${why}. Slow down the leader!` };
  }

  planJack() {
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
          if (gain >= 6 && (!bestTrade || gain > bestTrade.gain)) bestTrade = { pid: p.id, slot: Number(slot), gain, card };
        }
      }
      if (bestTrade) {
        return {
          a: { playerId: this.id, index: worstSlot }, b: { playerId: bestTrade.pid, index: bestTrade.slot },
          reason: `Swap your card #${worstSlot} (${label(k[worstSlot])}, ${worstVal}) with ${this.nameOf(bestTrade.pid)}'s card #${bestTrade.slot}, which you saw was a ${label(bestTrade.card)} (${cardValue(bestTrade.card)}) — a big improvement.`,
        };
      }
    }

    // Otherwise confuse people: shuffle two cards belonging to the players with the lowest scores
    const totals = this.room.totals || {};
    const ranked = [...cands].sort((x, y) => (totals[x.id] ?? 0) - (totals[y.id] ?? 0));
    const sizeOf = (p) => this.room.handSizes?.[p.id] ?? 4;
    const withCards = ranked.filter((p) => sizeOf(p) > 0);
    const why = "You don't know of a good trade, so scramble the leaders: anything they memorized about these cards is now wrong.";
    if (withCards.length >= 2) {
      const [p1, p2] = withCards;
      const i1 = Math.floor(Math.random() * sizeOf(p1)), i2 = Math.floor(Math.random() * sizeOf(p2));
      return { a: { playerId: p1.id, index: i1 }, b: { playerId: p2.id, index: i2 }, reason: `Swap ${p1.name}'s card #${i1} with ${p2.name}'s card #${i2}. ${why}` };
    }
    if (withCards.length === 1 && sizeOf(withCards[0]) >= 2) {
      const p = withCards[0];
      const n = sizeOf(p);
      const a = Math.floor(Math.random() * n);
      let b = Math.floor(Math.random() * (n - 1));
      if (b >= a) b += 1;
      return { a: { playerId: p.id, index: a }, b: { playerId: p.id, index: b }, reason: `Swap two of ${p.name}'s cards (#${a} and #${b}). ${why}` };
    }
    // Nothing sensible to do: swap any two cards on the table (never the Dutch caller's); the same card twice is a harmless no-op
    const pool = this.room.players
      .filter((p) => p.id !== this.room.dutchCallerId)
      .flatMap((p) => Array.from({ length: this.room.handSizes?.[p.id] ?? 0 }, (_, i) => ({ playerId: p.id, index: i })));
    if (pool.length >= 2) return { a: pool[0], b: pool[1], reason: "There's nobody useful to target — swap any two cards." };
    if (pool.length === 1) return { a: pool[0], b: pool[0], reason: "Only one card is on the table, so the swap changes nothing." };
    return { skip: true, reason: "There are no cards to swap, so this power is skipped." };
  }

  planQueen() {
    const unknown = this.unknownSlots();
    if (unknown.length) {
      const slot = pick(unknown);
      return { targetPlayerId: this.id, targetIndex: slot, reason: `Peek at your own unknown card #${slot} — knowing your hand is how you lower your score.` };
    }
    // Know everything I own: look at someone else's card, usually whoever has the fewest cards
    const cands = this.targets().filter((p) => (this.room.handSizes?.[p.id] ?? 4) > 0);
    if (!cands.length) {
      if (this.handSize > 0) return { targetPlayerId: this.id, targetIndex: 0, reason: "Peek at one of your own cards." };
      return { skip: true, reason: "There are no cards to peek at, so this power is skipped." };
    }
    const size = (p) => this.room.handSizes?.[p.id] ?? 4;
    const fewest = Math.min(...cands.map(size));
    const pool = Math.random() < 0.8 ? cands.filter((p) => size(p) === fewest) : cands;
    const target = pick(pool);
    const slot = Math.floor(Math.random() * size(target));
    return { targetPlayerId: target.id, targetIndex: slot, reason: `You know all your own cards, so spy on ${target.name}'s card #${slot} — they have few cards, so each one matters.` };
  }

  // ── tutorial coach ────────────────────────────────────────────────────────
  // Used offline (no socket) on behalf of the human player: turns the same planning code into advice.

  matchTip() {
    const room = this.room, me = this.me;
    if (!room || !me || room.phase !== "PLAY" || !room.discardTop || room.revealHold) return null;
    const top = room.discardTop;
    const k = this.known();
    const slots = this.knownSlots().filter((i) => rankOf(k[i]) === rankOf(top));
    if (slots.length) {
      return {
        match: slots[0],
        text: `✋ You can match! The discard pile shows ${label(top)} and your card #${slots[0]} is ${label(k[slots[0]])} — same rank. Select card #${slots[0]} and press Match (or double-tap it). You get rid of that card without drawing one.`,
      };
    }
    return {
      match: null,
      text: `✋ Don't match the ${label(top)}: none of your cards that you know about has that rank. A wrong guess costs you a penalty card.`,
    };
  }

  advice() {
    const room = this.room, me = this.me;
    if (!room || !me) return null;
    const key = JSON.stringify([
      room.phase, room.turnPlayerId, me.pendingDraw, room.dutchWindowPlayerId, room.pendingEffect, me.matchEffect,
      room.discardTop, this.discardVersion, me.handSize, me.known, me.hasPeeked, room.finalGraceEndsAt, room.revealHold,
      room.dutchCallerId, room.handSizes,
    ]);
    if (this._adviceCache?.key === key) return this._adviceCache.advice;
    const advice = this.computeAdvice();
    this._adviceCache = { key, advice };
    return advice;
  }

  computeAdvice() {
    const room = this.room, me = this.me;
    const tip = this.matchTip();
    const base = { tip: tip?.text ?? null, matchIndex: tip?.match ?? null };

    if (room.phase === "PEEK") {
      if (!me.hasPeeked && room.lookCount > 0) {
        return { ...base, tip: null, headline: "Peek phase", text: `Pick ${room.lookCount} of your 4 cards to look at, then memorize them — you can't look again later. Knowing your cards is the key to a low score. (You can also drag your cards to rearrange them first.)`, action: { type: "peek" } };
      }
      return { ...base, tip: null, headline: "Peek phase", text: "Waiting for the other players to finish peeking.", action: null };
    }
    if (room.phase !== "PLAY") return null;

    if (room.finalGraceEndsAt) {
      return { ...base, headline: "Last chance!", text: "Everyone has had their final turn. For a few seconds you can still match the discard pile if you know a card of the same rank.", action: null };
    }
    if (room.revealHold === this.id) {
      return { ...base, tip: null, headline: "Take a look", text: "You peeked with your Queen on the last turn. Press Done when you've seen it.", action: null };
    }

    const effect = this.pendingEffectType();
    if (effect) {
      const plan = this.planEffect(effect);
      const names = { ACE: "Ace", JACK: "Jack", QUEEN: "Queen" };
      const action = plan.skip ? { type: "skip" }
        : effect === "ACE" ? { type: "ace", targetPlayerId: plan.targetPlayerId }
        : effect === "JACK" ? { type: "jack", a: plan.a, b: plan.b }
        : { type: "queen", targetPlayerId: plan.targetPlayerId, targetIndex: plan.targetIndex };
      return { ...base, headline: `Use your ${names[effect]}!`, text: plan.reason, action };
    }

    if (room.turnPlayerId === this.id) {
      if (me.pendingDraw) {
        const plan = this.planPlace();
        const action = plan.kind === "swap" ? { type: "swap", index: plan.index } : { type: "discard" };
        return { ...base, headline: `You drew ${label(me.pendingDraw.card)}`, text: plan.reason, action };
      }
      if (room.dutchWindowPlayerId === this.id) {
        const plan = this.planWindow();
        return { ...base, headline: plan.dutch ? "Call Dutch?" : "Pass your turn", text: plan.reason, action: { type: plan.dutch ? "dutch" : "pass" } };
      }
      const plan = this.planDraw();
      return { ...base, headline: "Your turn: draw a card", text: plan.reason + " Every turn you must draw one card and then discard one.", action: { type: "draw", source: plan.source } };
    }

    const who = room.players.find((p) => p.id === room.turnPlayerId)?.name;
    return { ...base, headline: who ? `${who} is playing` : "Waiting…", text: "Watch what gets discarded and picked up. You can match the discard pile at any time, even on someone else's turn.", action: null };
  }
}

module.exports = { Bot, BOT_NAMES, SPEED_MULTIPLIER, DIFFICULTY, pickLookCount };
