import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CardBack, CardFace, useIsMobile } from "./cards.jsx";
import { Avatar } from "./ui.jsx";

// Top-down view of the table. Opponents sit around the rim as avatars with their score; the deck and
// discard pile are in the middle. Your own hand is a separate row below the table (see <Hand />).
// When someone places, swaps, matches or rearranges a card, the affected slot (or avatar) is highlighted.

// Seat positions (percent of the felt) for n opponents, clockwise from your left, over the top.
// Seats are spaced evenly along the oval's actual (pixel) outline, so a wide table and a tall one both look balanced.
function seatPositions(n, w, h, mobile) {
  const rx = (mobile ? 0.37 : 0.41) * w;
  const ry = (mobile ? 0.38 : 0.40) * h;
  const a0 = (165 * Math.PI) / 180, a1 = (375 * Math.PI) / 180;
  const steps = 360;
  const pts = [];
  let len = 0;
  for (let s = 0; s <= steps; s++) {
    const a = a0 + ((a1 - a0) * s) / steps;
    const p = { x: rx * Math.cos(a), y: ry * Math.sin(a) };
    if (s > 0) len += Math.hypot(p.x - pts[s - 1].x, p.y - pts[s - 1].y);
    pts.push({ ...p, len });
  }
  return Array.from({ length: n }, (_, k) => {
    const target = (len * (k + 0.5)) / n;
    let idx = pts.findIndex((p) => p.len >= target);
    if (idx <= 0) idx = 1;
    const p0 = pts[idx - 1], p1 = pts[idx];
    const f = p1.len === p0.len ? 0 : (target - p0.len) / (p1.len - p0.len);
    const x = p0.x + (p1.x - p0.x) * f, y = p0.y + (p1.y - p0.y) * f;
    return { x: 50 + (x / w) * 100, y: 50 + (y / h) * 100 };
  });
}

// How much detail an opponent seat shows: 0 = full card row, 1 = small card row, 2 = just a card count
function detailLevel(n, mobile) {
  if (mobile) return n <= 3 ? 0 : n <= 5 ? 1 : 2;
  return n <= 5 ? 0 : n <= 7 ? 1 : 2;
}

function shortName(name) {
  return name.replace(/^🤖\s*/, "");
}

function OpponentSeat({ mobile, player, room, level, highlights, marks, targetMode, onCardClick, onSeatClick, isAceTarget, isHint, pos }) {
  const count = room.handSizes?.[player.id] ?? 0;
  const held = room.drawn?.playerId === player.id ? room.drawn : null;
  const isTurn = player.id === room.turnPlayerId;
  const isDutch = player.id === room.dutchCallerId;
  const reorders = room.reorders?.[player.id] ?? 0;
  const total = room.totals?.[player.id];
  const cardTargets = targetMode === "JACK" || targetMode === "QUEEN";
  const seatHl = Object.keys(highlights).find((k) => k.startsWith(`${player.id}:`));
  const hl = seatHl ? highlights[seatHl] : null;
  const cardSize = level === 0 ? "opp" : "oppS";

  const ringClass = [
    isTurn ? "avatar--turn" : "", isDutch ? "avatar--dutch" : "",
    isAceTarget ? "avatar--target" : "", isHint ? "avatar--hint" : "",
    cardTargets || targetMode === "ACE" ? "avatar--tappable" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={`seat${level === 2 ? " seat--tight" : ""}${level === 2 && mobile ? " seat--noname" : ""}`} data-seat={player.id} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <div className="seat__head" onClick={cardTargets || targetMode === "ACE" ? () => onSeatClick(player.id) : undefined}>
        <Avatar player={player} className={ringClass} data-hl={hl || undefined}>
          {held && (
            <span className="seat__held" title="holding a card">
              {held.card ? <CardFace card={held.card} size="oppS" /> : <CardBack size="oppS" />}
            </span>
          )}
        </Avatar>
        <div className={`seat__pill${isTurn ? " seat__pill--turn" : ""}`}>
          <span className="seat__name">{shortName(player.name)}</span>
          {total !== undefined && <span className="seat__score">{total}</span>}
          {isDutch && <span aria-label="called Dutch">🔔</span>}
          {reorders > 0 && <span className="seat__shuffle" title={`Rearranged their cards ${reorders} time(s) this round`}>🔀{reorders}</span>}
          {level === 2 && <span className="seat__count-in" title="cards in hand">🂠{count}</span>}
        </div>
      </div>
      {level < 2 ? (
        <div className="seat__cards">
          {Array.from({ length: count }).map((_, i) => (
            <CardBack
              key={i}
              size={cardSize}
              highlight={highlights[`${player.id}:${i}`] ?? marks[`${player.id}:${i}`]}
              data-slot={`${player.id}:${i}`}
              onClick={cardTargets ? () => onCardClick(player.id, i) : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Table({ room, meId, highlights, marks, targetMode, aceTarget, hintSeatId, onCardClick, onSeatClick, discardTarget, onDiscardClick, children }) {
  const mobile = useIsMobile();
  const players = room.players ?? [];
  const meIdx = players.findIndex((p) => p.id === meId);
  // Everyone else, clockwise starting from your left
  const others = meIdx === -1 ? players : [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];
  const n = others.length;
  const level = detailLevel(n, mobile);
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 400 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSize({ w: el.clientWidth || 360, h: el.clientHeight || 400 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const positions = seatPositions(n, size.w, size.h, mobile);

  return (
    <div className="table" ref={ref}>
      <div className="table__felt" />
      {others.map((p, k) => (
        <OpponentSeat
          key={p.id}
          mobile={mobile}
          player={p}
          room={room}
          level={level}
          highlights={highlights}
          marks={marks}
          targetMode={targetMode}
          onCardClick={onCardClick}
          onSeatClick={onSeatClick}
          isAceTarget={targetMode === "ACE" && aceTarget === p.id}
          isHint={!!hintSeatId && hintSeatId === p.id}
          pos={positions[k]}
        />
      ))}
      <div className="table__center">
        <div className="pile" data-slot="deck">
          <CardBack size="pile" />
          <div className="pile__label">Deck <b>{room.deckCount}</b></div>
        </div>
        <div className={`pile${discardTarget ? " pile--target" : ""}`} data-slot="discard" onClick={discardTarget ? onDiscardClick : undefined}>
          {room.discardTop
            ? <CardFace key={room.discardTop} card={room.discardTop} size="pile" className="card--pop" />
            : <div className="pile__empty" />}
          <div className="pile__label">Discard</div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ── Your hand (a row below the table). Drag a card onto another slot to rearrange. ──────────────
export function Hand({
  room, meId, me, getVisibleCard, highlights, marks, selectedIndex,
  canReorder, onReorder, onMyCardClick, targetMode, onCardClick,
  drawnActive, armed, onDrawnTap, onSwapTo, onDiscardDrawn, onDragDrawn,
}) {
  const handSize = me?.handSize ?? 0;
  const myDrawn = me?.pendingDraw;
  // drag: a card is being carried. settle: it was just dropped and is sliding into its new slot while we wait
  // for the server to confirm the new order.
  const [drag, setDrag] = useState(null);
  const [settle, setSettle] = useState(null);
  const [dragDrawn, setDragDrawn] = useState(null); // the drawn card is being carried: { dx, dy, target }
  const dragRef = useRef(null);

  // The settle offsets only apply to the hand they were made for. The moment the server sends the new order (a new `me`),
  // the cards are already in their final slots, so drop the offsets in that same render (no flash, no animation).
  const settleLive = settle && settle.me === me ? settle : null;
  const settleStale = !!settle && settle.me !== me;
  useEffect(() => { if (settleStale) setSettle(null); }, [settleStale]);
  useEffect(() => {
    if (!settle) return undefined;
    const id = setTimeout(() => setSettle(null), 900);
    return () => clearTimeout(id);
  }, [settle]);

  const measureStep = () => {
    const els = document.querySelectorAll("[data-myslot]");
    if (els.length >= 2) return els[1].getBoundingClientRect().left - els[0].getBoundingClientRect().left;
    return els[0] ? els[0].getBoundingClientRect().width + 8 : 80;
  };

  // One drag controller shared by mouse/pen (pointer events) and fingers (touch events). It reads the latest props
  // through a ref so the touch listeners, which are attached once, never act on stale data.
  const cardsRef = useRef(null);
  const latest = useRef({});
  latest.current = { canReorder, handSize, onReorder, onMyCardClick, targetMode, onCardClick, meId, me, drawnActive, onDrawnTap, onSwapTo, onDiscardDrawn, onDragDrawn };

  // What is under the finger / cursor: one of my cards (swap into it) or the discard pile (throw the card away)
  const dropTargetAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const slot = el.closest?.("[data-myslot]")?.getAttribute("data-myslot");
      if (slot !== null && slot !== undefined) return { slot: Number(slot) };
      if (el.closest?.('[data-slot="discard"]')) return { discard: true };
    }
    return null;
  };

  const beginDrag = (from, x, y, kind = "slot") => {
    dragRef.current = { kind, from, sx: x, sy: y, active: false, step: kind === "slot" ? measureStep() : 0, n: latest.current.handSize };
  };
  const moveDrag = (x, y) => {
    const d = dragRef.current;
    if (d && d.kind === "drawn") {
      if (!latest.current.drawnActive) return false;
      const dx = x - d.sx, dy = y - d.sy;
      if (!d.active && Math.hypot(dx, dy) > 8) { d.active = true; latest.current.onDragDrawn?.(true); }
      if (d.active) setDragDrawn({ dx, dy, target: dropTargetAt(x, y) });
      return d.active;
    }
    if (!d || !latest.current.canReorder) return false;
    const dx = x - d.sx, dy = y - d.sy;
    if (!d.active && Math.hypot(dx, dy) > 8) d.active = true;
    if (d.active) {
      // Where the card would land if you let go now: the slot its centre is over (it can go before the first / after the last)
      const insertAt = Math.max(0, Math.min(d.n - 1, Math.round(d.from + dx / d.step)));
      setDrag({ from: d.from, dx, dy, insertAt, step: d.step });
    }
    return d.active;
  };
  const endDrag = (x, y) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) { setDrag(null); setDragDrawn(null); return; }
    const L = latest.current;
    if (d.kind === "drawn") {
      setDragDrawn(null);
      L.onDragDrawn?.(false);
      if (!d.active) { L.onDrawnTap?.(); return; } // a tap picks the card up; the next tap chooses where it goes
      const target = dropTargetAt(x, y);
      if (target?.slot !== undefined) L.onSwapTo(target.slot);
      else if (target?.discard) L.onDiscardDrawn();
      return;
    }
    if (d.active) {
      const insertAt = Math.max(0, Math.min(d.n - 1, Math.round(d.from + (x - d.sx) / d.step)));
      setDrag(null);
      if (insertAt !== d.from) {
        L.onReorder(d.from, insertAt);
        setSettle({ from: d.from, to: insertAt, step: d.step, me: L.me });
      }
    } else {
      setDrag(null);
      if (L.targetMode === "JACK" || L.targetMode === "QUEEN") L.onCardClick(L.meId, d.from);
      else L.onMyCardClick(d.from);
    }
  };
  const cancel = () => { dragRef.current = null; setDrag(null); setDragDrawn(null); latest.current.onDragDrawn?.(false); };

  // Mouse / pen
  const down = (e, i) => {
    if (e.pointerType === "touch") return;
    beginDrag(i, e.clientX, e.clientY);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer may already be gone */ }
  };
  const move = (e) => { if (e.pointerType !== "touch") moveDrag(e.clientX, e.clientY); };
  const up = (e) => { if (e.pointerType !== "touch") endDrag(e.clientX, e.clientY); };
  const downDrawn = (e) => {
    if (e.pointerType === "touch" || !latest.current.drawnActive) return;
    beginDrag(null, e.clientX, e.clientY, "drawn");
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer may already be gone */ }
  };

  // Touch: listeners must be non-passive so the page can't scroll or cancel the gesture while a card is being carried
  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return undefined;
    let touchId = null;
    const find = (e) => [...e.changedTouches].find((t) => t.identifier === touchId);
    const onStart = (e) => {
      if (touchId !== null) return;
      const t = e.changedTouches[0];
      if (e.target.closest?.("[data-drawn]")) {
        if (!latest.current.drawnActive) return;
        touchId = t.identifier;
        beginDrag(null, t.clientX, t.clientY, "drawn");
        return;
      }
      const slot = e.target.closest?.("[data-myslot]");
      if (!slot) return;
      touchId = t.identifier;
      beginDrag(Number(slot.getAttribute("data-myslot")), t.clientX, t.clientY);
    };
    const onMove = (e) => {
      const t = find(e);
      if (!t || !dragRef.current) return;
      moveDrag(t.clientX, t.clientY);
      if (latest.current.canReorder || latest.current.drawnActive) e.preventDefault();
    };
    const onEnd = (e) => {
      const t = find(e);
      if (!t) return;
      touchId = null;
      endDrag(t.clientX, t.clientY);
      if (e.cancelable) e.preventDefault(); // we handled the tap ourselves; no ghost click afterwards
    };
    const onCancel = () => { touchId = null; cancel(); };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const meP = room.players.find((p) => p.id === meId);
  const reorders = room.reorders?.[meId] ?? 0;
  const total = room.totals?.[meId];

  // Where each card should visually sit right now (others slide aside to open a gap at the drop position)
  const layout = drag
    ? { from: drag.from, to: drag.insertAt, step: drag.step, dragging: true }
    : settleLive ? { from: settleLive.from, to: settleLive.to, step: settleLive.step, dragging: false } : null;
  const offsetFor = (i) => {
    if (!layout) return 0;
    const { from, to, step } = layout;
    if (from < to && i > from && i <= to) return -step;
    if (from > to && i < from && i >= to) return step;
    return 0;
  };

  return (
    <div className="hand" style={{ "--n": Math.max(handSize + (myDrawn ? 1 : 0), 1) }}>
      <div className="hand__meta">
        <span className="hand__name">{meP ? meP.name : "You"}</span>
        {total !== undefined && <span className="seat__score">{total}</span>}
        {reorders > 0 && <span className="seat__shuffle">🔀{reorders}</span>}
        {drawnActive
          ? <span className="hand__hint hand__hint--go">{armed ? "Tap a card to swap, or the pile to discard" : "Drag the new card onto a card or the pile"}</span>
          : canReorder && handSize > 1 && <span className="hand__hint">{drag ? `slot ${drag.insertAt}` : "slide a card to move it"}</span>}
      </div>
      <div className="hand__cards" ref={cardsRef} style={{ touchAction: canReorder || drawnActive ? "none" : "manipulation" }}>
        {Array.from({ length: handSize }).map((_, i) => {
          const card = getVisibleCard(i);
          const isDragging = drag?.from === i;
          const isSettling = !drag && settleLive?.from === i;
          const hl = (dragDrawn?.target?.slot === i ? "pick" : undefined) ?? highlights[`${meId}:${i}`] ?? marks[`${meId}:${i}`];
          let transform;
          let transition;
          if (isDragging) { transform = `translate(${drag.dx}px, ${drag.dy}px) scale(1.06)`; transition = "none"; }
          else if (isSettling) { transform = `translateX(${(settleLive.to - settleLive.from) * settleLive.step}px)`; transition = "transform var(--t-med) var(--ease)"; }
          else if (layout) { transform = `translateX(${offsetFor(i)}px)`; transition = "transform var(--t-med) var(--ease)"; }
          if (settleStale) { transform = "none"; transition = "none"; }
          const common = {
            size: "handFit",
            selected: (selectedIndex === i && !layout) || dragDrawn?.target?.slot === i,
            highlight: hl,
            label: i,
            "data-myslot": i,
            "data-slot": `${meId}:${i}`,
            onPointerDown: (e) => down(e, i),
            onPointerMove: move,
            onPointerUp: up,
            onPointerCancel: (e) => { if (e.pointerType !== "touch") cancel(); },
            style: {
              touchAction: canReorder ? "none" : "manipulation",
              cursor: canReorder ? "grab" : "pointer",
              zIndex: isDragging || isSettling ? 20 : undefined,
              transform, transition,
              boxShadow: isDragging ? "var(--shadow-3)" : undefined,
            },
          };
          return card ? <CardFace key={i} card={card} {...common} /> : <CardBack key={i} {...common} />;
        })}
        {myDrawn && (
          <div className="hand__drawn" data-drawn>
            <CardFace
              card={myDrawn.card} size="handFit" highlight="swap" label="drawn"
              selected={!!armed || !!dragDrawn}
              onPointerDown={downDrawn} onPointerMove={move} onPointerUp={up}
              onPointerCancel={(e) => { if (e.pointerType !== "touch") cancel(); }}
              style={{
                touchAction: drawnActive ? "none" : "manipulation",
                cursor: drawnActive ? "grab" : "default",
                zIndex: dragDrawn ? 30 : undefined,
                transform: dragDrawn ? `translate(${dragDrawn.dx}px, ${dragDrawn.dy}px) scale(1.08)` : undefined,
                transition: dragDrawn ? "none" : undefined,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Arrows between slots / piles, so it's obvious which cards moved where ───────────────────────
export function ArrowLayer({ rootRef, arrows, dep }) {
  const [geo, setGeo] = useState([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const rr = root.getBoundingClientRect();
      const center = (key) => {
        // Slot not on screen (compact seat)? Fall back to that player's avatar.
        const pid = key.includes(":") ? key.slice(0, key.lastIndexOf(":")) : null;
        const el = root.querySelector(`[data-slot="${CSS.escape(key)}"]`) ?? (pid ? root.querySelector(`[data-seat="${CSS.escape(pid)}"] .avatar`) : null);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 };
      };
      setGeo(arrows.map((a) => ({ ...a, p1: center(a.from), p2: center(a.to) })).filter((a) => a.p1 && a.p2));
    };
    measure();
    const id = setTimeout(measure, 150); // positions settle once the new state has rendered
    return () => clearTimeout(id);
  }, [arrows, dep, rootRef]);

  if (!geo.length) return null;
  const colors = [...new Set(geo.map((g) => g.color))];
  const markerId = (col) => `ah-${col.replace(/[^a-z]/gi, "")}`;
  return (
    <svg className="arrows">
      <defs>
        {colors.map((col) => (
          <marker key={col} id={markerId(col)} markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" refX="10" refY="7" orient="auto">
            <path d="M0,0 L14,7 L0,14 z" style={{ fill: col }} />
          </marker>
        ))}
      </defs>
      {geo.map((a) => {
        const mx = (a.p1.x + a.p2.x) / 2, my = (a.p1.y + a.p2.y) / 2;
        const dx = a.p2.x - a.p1.x, dy = a.p2.y - a.p1.y;
        const len = Math.hypot(dx, dy) || 1;
        const bend = Math.min(50, len * 0.22);
        const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
        const d = `M${a.p1.x},${a.p1.y} Q${cx},${cy} ${a.p2.x},${a.p2.y}`;
        const mid = markerId(a.color);
        return (
          <g key={a.id} className="arrows__g">
            <path d={d} className="arrows__shadow" />
            <path d={d} className="arrows__line" style={{ stroke: a.color }} markerEnd={`url(#${mid})`} markerStart={a.both ? `url(#${mid})` : undefined} />
            {a.label && <text x={cx} y={cy} textAnchor="middle" className="arrows__label">{a.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}
