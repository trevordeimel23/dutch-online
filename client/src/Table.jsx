import { useRef, useState } from "react";
import { CardBack, CardFace, useIsMobile } from "./cards.jsx";

// Top-down view of the table: you are always at the bottom, the other players sit around the top.
// Everyone's cards stay in their slots; when someone places, swaps, matches or rearranges a card,
// the affected slot is highlighted for a few seconds.

function SeatHeader({ player, isMe, isTurn, total, reorders, isDutch, isTarget, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap",
        marginBottom: 8, padding: "3px 10px", borderRadius: 14, fontSize: 13,
        background: isTurn ? "rgba(255,215,0,0.25)" : "rgba(0,0,0,0.35)",
        border: isTarget ? "2px solid #ffffff" : isTurn ? "1px solid rgba(255,215,0,0.7)" : "1px solid rgba(255,255,255,0.12)",
        cursor: onClick ? "pointer" : "default",
        color: isMe ? "#ffd700" : "#e8d5a3",
      }}
    >
      {isTurn && <span style={{ color: "#ffd700" }}>▶</span>}
      <b>{player.name}</b>
      {isMe && <span style={{ fontSize: 11, color: "#a89060" }}>(you)</span>}
      {isDutch && <span>🔔</span>}
      {total !== undefined && <span style={{ fontSize: 11, color: "#a89060" }}>{total} pts</span>}
      <span
        title={reorders ? `Rearranged their cards ${reorders} time(s) this round` : "Hasn't rearranged their cards"}
        style={{ fontSize: 11, color: reorders ? "#4dd0e1" : "#6d7d6d" }}
      >
        🔀 {reorders ? `×${reorders}` : "no"}
      </span>
    </div>
  );
}

function OpponentSeat({ player, room, size, highlights, marks, targetMode, onCardClick, onSeatClick, isAceTarget }) {
  const count = room.handSizes?.[player.id] ?? 0;
  const held = room.drawn?.playerId === player.id ? room.drawn : null;
  const clickable = targetMode === "JACK" || targetMode === "QUEEN";
  return (
    <div style={{ textAlign: "center", maxWidth: 260 }}>
      <SeatHeader
        player={player}
        isTurn={player.id === room.turnPlayerId}
        total={room.totals?.[player.id]}
        reorders={room.reorders?.[player.id]}
        isDutch={player.id === room.dutchCallerId}
        isTarget={isAceTarget}
        onClick={targetMode === "ACE" ? () => onSeatClick(player.id) : undefined}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", paddingTop: 18 }}>
        {Array.from({ length: count }).map((_, i) => (
          <CardBack
            key={i}
            size={size}
            highlight={highlights[`${player.id}:${i}`] ?? marks[`${player.id}:${i}`]}
            onClick={clickable ? () => onCardClick(player.id, i) : undefined}
          />
        ))}
        {held && (
          <div style={{ marginLeft: 8, textAlign: "center" }}>
            {held.card ? <CardFace card={held.card} size={size} highlight="swap" /> : <CardBack size={size} highlight="swap" />}
            <div style={{ fontSize: 10, color: "#ffd700", marginTop: 4 }}>holding</div>
          </div>
        )}
      </div>
    </div>
  );
}

function MySeat({
  compact, player, meId, room, me, getVisibleCard, highlights, marks, selectedIndex,
  canReorder, onReorder, onMyCardClick, targetMode, onCardClick,
}) {
  const handSize = me?.handSize ?? 0;
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);

  const slotAt = (x, y, ignore) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const slot = el.closest?.("[data-myslot]")?.getAttribute("data-myslot");
      if (slot !== null && slot !== undefined && Number(slot) !== ignore) return Number(slot);
    }
    return null;
  };

  const down = (e, i) => {
    dragRef.current = { from: i, sx: e.clientX, sy: e.clientY, active: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer may already be gone */ }
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d || !canReorder) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.active && Math.hypot(dx, dy) > 8) d.active = true;
    if (d.active) setDrag({ from: d.from, dx, dy, over: slotAt(e.clientX, e.clientY, d.from) });
  };
  const up = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.active) {
      const to = slotAt(e.clientX, e.clientY, d.from);
      if (to !== null && to !== d.from) onReorder(d.from, to);
    } else if (targetMode === "JACK" || targetMode === "QUEEN") {
      onCardClick(meId, d.from);
    } else {
      onMyCardClick(d.from);
    }
  };
  const cancel = () => { dragRef.current = null; setDrag(null); };

  const myDrawn = me?.pendingDraw;

  return (
    <div style={{ textAlign: "center" }}>
      <SeatHeader
        player={player}
        isMe
        isTurn={player.id === room.turnPlayerId}
        total={room.totals?.[player.id]}
        reorders={room.reorders?.[player.id]}
        isDutch={player.id === room.dutchCallerId}
      />
      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", paddingTop: 18, paddingBottom: 22 }}>
        {Array.from({ length: handSize }).map((_, i) => {
          const card = getVisibleCard(i);
          const isDragging = drag?.from === i;
          const hl = highlights[`${meId}:${i}`] ?? marks[`${meId}:${i}`] ?? (drag && drag.over === i ? "moved" : undefined);
          const common = {
            size: "md",
            selected: selectedIndex === i,
            highlight: hl,
            label: i,
            "data-myslot": i,
            onPointerDown: (e) => down(e, i),
            onPointerMove: move,
            onPointerUp: up,
            onPointerCancel: cancel,
            style: {
              touchAction: canReorder ? "none" : "manipulation",
              cursor: canReorder ? "grab" : "pointer",
              zIndex: isDragging ? 20 : undefined,
              transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px) scale(1.08)` : undefined,
              transition: isDragging ? "none" : undefined,
              boxShadow: isDragging ? "0 10px 24px rgba(0,0,0,0.6)" : undefined,
            },
          };
          return card ? <CardFace key={i} card={card} {...common} /> : <CardBack key={i} {...common} />;
        })}
        {myDrawn && (
          <div style={{ marginLeft: 12, textAlign: "center" }}>
            <CardFace card={myDrawn.card} size="md" highlight="swap" />
            <div style={{ fontSize: 10, color: "#ffd700", marginTop: 4 }}>in hand</div>
          </div>
        )}
      </div>
      {canReorder && handSize > 1 && !compact && (
        <div style={{ fontSize: 11, color: "#7fa07f", marginTop: 2 }}>Drag your cards to rearrange them — everyone can see that you did</div>
      )}
    </div>
  );
}

export default function Table(props) {
  const { room, meId, me, highlights, marks, targetMode, aceTarget } = props;
  const mobile = useIsMobile();
  const players = room.players ?? [];
  const meIdx = players.findIndex((p) => p.id === meId);
  const meP = players[meIdx];
  // Seat everyone else clockwise starting from your left
  const others = meIdx === -1 ? players : [...players.slice(meIdx + 1), ...players.slice(0, meIdx)];
  const n = others.length;
  const tableHeight = props.height ?? 620;
  const compact = tableHeight < 580;
  const oppSize = mobile || n >= 4 || compact ? "xs" : "sm";

  const center = (
    <div style={{ display: "flex", gap: mobile ? 18 : 28, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <CardBack size={mobile || compact ? "md" : "lg"} />
        <div style={{ fontSize: 11, color: "#a8c8a8", marginTop: 6 }}>Deck · {room.deckCount}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        {room.discardTop
          ? <CardFace key={room.discardTop} card={room.discardTop} size={mobile || compact ? "md" : "lg"} style={{ animation: "cardPop 0.35s ease-out" }} />
          : <div style={{ width: mobile || compact ? 58 : 88, height: mobile || compact ? 82 : 124, border: "2px dashed rgba(255,255,255,0.25)", borderRadius: 8 }} />}
        <div style={{ fontSize: 11, color: "#a8c8a8", marginTop: 6 }}>Discard</div>
      </div>
    </div>
  );

  const seatProps = (p) => ({
    player: p, room, size: oppSize, highlights, marks, targetMode,
    onCardClick: props.onCardClick, onSeatClick: props.onSeatClick,
    isAceTarget: targetMode === "ACE" && aceTarget === p.id,
  });

  const mySeat = meP && (
    <MySeat
      compact={compact} player={meP} meId={meId} room={room} me={me}
      getVisibleCard={props.getVisibleCard} highlights={highlights} marks={marks}
      selectedIndex={props.selectedIndex} canReorder={props.canReorder} onReorder={props.onReorder}
      onMyCardClick={props.onMyCardClick} targetMode={targetMode} onCardClick={props.onCardClick}
    />
  );

  if (mobile) {
    return (
      <div style={{ background: "radial-gradient(ellipse at center, #1f5c2c, #123a1b)", border: "3px solid #5a3d1e", borderRadius: 24, padding: "14px 6px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "center" }}>
          {others.map((p) => <OpponentSeat key={p.id} {...seatProps(p)} />)}
        </div>
        {center}
        {mySeat}
      </div>
    );
  }

  // Desktop: oval table, other players spread along the top arc
  return (
    <div style={{
      position: "relative", height: tableHeight, borderRadius: "50% / 42%",
      background: "radial-gradient(ellipse at center, #236b32 0%, #17482100 100%), radial-gradient(ellipse at center, #1f5c2c, #123a1b)",
      border: "6px solid #5a3d1e", boxShadow: "inset 0 0 60px rgba(0,0,0,0.5), 0 6px 18px rgba(0,0,0,0.5)",
    }}>
      {others.map((p, k) => {
        const theta = Math.PI + ((k + 1) / (n + 1)) * Math.PI;
        const x = 50 + 36 * Math.cos(theta);
        const y = 30 + 22 * Math.sin(theta) + 10;
        return (
          <div key={p.id} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)" }}>
            <OpponentSeat {...seatProps(p)} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: "50%", top: compact ? "44%" : "47%", transform: "translate(-50%, -50%)" }}>{center}</div>
      <div style={{ position: "absolute", left: "50%", bottom: 8, transform: "translateX(-50%)", width: "80%" }}>{mySeat}</div>
    </div>
  );
}
