import { useRef, useState } from "react";
import { CardBack, CardFace } from "./cards.jsx";
import Table, { ArrowLayer, Hand } from "./Table.jsx";
import { Btn, Field, IconBtn, Pill, Sheet, lengthText } from "./ui.jsx";

// The in-game screen: one fixed, full-viewport grid (top bar / table / my hand / action dock) that never scrolls.

export default function GameScreen({ c }) {
  const { room, me, meId, phase, players } = c;
  const gameRef = useRef(null);
  const [logOpen, setLogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [sheetPid, setSheetPid] = useState(null); // opponent whose cards are shown big (Jack / Queen targeting)

  const nameOf = (pid) => (players.find((p) => p.id === pid)?.name ?? "someone").replace(/^🤖\s*/, "");
  const selText = (sel) => `${nameOf(sel.playerId)} #${sel.index}`;
  const waitingName = nameOf(room.turnPlayerId);

  const onSeatClick = (pid) => {
    if (c.targetMode === "ACE") c.onSeatClick(pid);
    else if (c.targetMode === "JACK" || c.targetMode === "QUEEN") setSheetPid(pid);
  };

  // ── top bar ──────────────────────────────────────────────────────────────
  const len = room.gameLength;
  const roundText = len?.mode === "rounds" && room.roundNumber
    ? `Round ${room.roundNumber}/${len.rounds}`
    : room.roundNumber ? `Round ${room.roundNumber} · to ${len?.target}` : lengthText(len);
  const status = room.finalGraceEndsAt ? { tone: "accent", text: `Last matches ${c.graceLeft}s` }
    : room.dutchCallerId ? { tone: "danger", text: `🔔 ${nameOf(room.dutchCallerId)} · ${room.dutchTurnsLeft ?? 0} left` }
    : phase === "PEEK" ? { tone: "info", text: "Peek" }
    : room.pendingEffect ? { tone: "info", text: `⚡ ${room.pendingEffect.type.charAt(0) + room.pendingEffect.type.slice(1).toLowerCase()}` }
    : null;

  // ── dock ─────────────────────────────────────────────────────────────────
  const matchBtn = c.handSize > 0 && phase === "PLAY" && !room.revealHold && (
    <Btn
      className="btn--match"
      hint={room.tutorial && c.coach?.matchIndex != null && c.selIdx === c.coach.matchIndex}
      disabled={!room.discardTop}
      onClick={() => c.emit("match:attempt", { index: c.selIdx })}
    >
      ✋ Match #{c.selIdx}
    </Btn>
  );

  let dockRow;
  if (phase === "PEEK") {
    dockRow = me?.hasPeeked ? (
      <div className="dock__text">✓ Peeked. Waiting for the other players…</div>
    ) : (
      <>
        <div className="dock__text">Tap <b>{c.lookCount}</b> of your cards to peek at them. You can drag to rearrange first.</div>
        <Btn variant="primary" disabled={c.peekPick.length !== c.lookCount} onClick={c.submitPeek}>Peek ({c.peekPick.length}/{c.lookCount})</Btn>
      </>
    );
  } else if (room.finalGraceEndsAt) {
    dockRow = <><div className="dock__text"><b>Last chance to match</b> — scoring in {c.graceLeft}s</div>{matchBtn}</>;
  } else if (room.revealHold === meId) {
    dockRow = <div className="dock__text"><b>Take a look</b> at your Queen peek, then press Done.</div>;
  } else if (c.myEffect?.type === "JACK") {
    dockRow = (
      <>
        <div className="dock__text"><b>Jack</b> — tap two cards: {selText(c.jackA)} ⇄ {selText(c.jackB)}</div>
        <Btn variant="primary" onClick={() => c.emit("effect:jack", { a: c.jackA, b: c.jackB })}>Swap</Btn>
        {matchBtn}
      </>
    );
  } else if (c.myEffect?.type === "QUEEN") {
    dockRow = (
      <>
        <div className="dock__text"><b>Queen</b> — tap a card to peek: {selText(c.queenTarget)}</div>
        <Btn variant="primary" onClick={() => c.emit("effect:queen", { targetPlayerId: c.queenTarget.playerId, targetIndex: c.queenTarget.index })}>Peek</Btn>
        {matchBtn}
      </>
    );
  } else if (c.myEffect?.type === "ACE") {
    dockRow = (
      <>
        <div className="dock__text"><b>Ace</b> — tap a player: {nameOf(c.aceTarget)}</div>
        <Btn variant="primary" onClick={() => c.emit("effect:ace", { targetPlayerId: c.aceTarget })}>Give card</Btn>
        {matchBtn}
      </>
    );
  } else if (c.inDutchWindow) {
    dockRow = (
      <>
        <Pill tone="accent">{c.dutchWindowSecondsLeft}s</Pill>
        <Btn variant="danger" hint={room.tutorial && c.coach?.action?.type === "dutch"} onClick={() => c.emit("dutch:call")}>🔔 Call Dutch</Btn>
        <Btn variant="secondary" hint={room.tutorial && c.coach?.action?.type === "pass"} onClick={() => c.emit("turn:end")}>Pass</Btn>
        {matchBtn}
      </>
    );
  } else if (c.isMyTurn && c.pending) {
    dockRow = (
      <>
        <Btn variant="secondary" hint={room.tutorial && c.coach?.action?.type === "discard"} disabled={c.pending.source !== "DECK"} onClick={() => c.emit("turn:discard-drawn")}>Discard</Btn>
        <Btn variant="primary" hint={room.tutorial && c.coach?.action?.type === "swap"} onClick={() => c.emit("turn:swap", { index: c.selIdx })}>Swap #{c.selIdx}</Btn>
        {matchBtn}
      </>
    );
  } else if (c.isMyTurn) {
    dockRow = (
      <>
        <Btn variant="primary" hint={room.tutorial && c.coach?.action?.type === "draw" && c.coach.action.source === "DECK"} disabled={!!room.pendingEffect}
          onClick={() => c.emit("turn:draw", { source: "DECK" })}>Draw</Btn>
        <Btn variant="secondary" hint={room.tutorial && c.coach?.action?.type === "draw" && c.coach.action.source === "DISCARD"} disabled={!room.discardTop || !!room.pendingEffect}
          onClick={() => c.emit("turn:draw", { source: "DISCARD" })}>Take discard</Btn>
        {matchBtn}
      </>
    );
  } else {
    dockRow = <><div className="dock__text">Waiting for <b>{waitingName}</b>…</div>{matchBtn}</>;
  }

  return (
    <div className="game" ref={gameRef}>
      <header className="topbar">
        <IconBtn label="Activity log" onClick={() => setLogOpen(true)}>☰</IconBtn>
        <div className="topbar__center">
          <Pill>{roundText}</Pill>
          {status && <Pill tone={status.tone}>{status.text}</Pill>}
        </div>
        <IconBtn label="Settings" onClick={() => setSettingsOpen(true)}>⚙</IconBtn>
        <IconBtn label="Rules" onClick={c.onRules}>?</IconBtn>
      </header>

      <main className="table-wrap">
        <Table
          room={room} meId={meId}
          highlights={c.highlights} marks={c.marks}
          targetMode={c.targetMode} aceTarget={c.aceTarget} hintSeatId={c.hintSeatId}
          onCardClick={c.onCardClick} onSeatClick={onSeatClick}
        >
          {c.toast && <div key={c.toast.id} className={`toast toast--${c.toast.tone}`}>{c.toast.text}</div>}
        </Table>
      </main>

      <section className="hand-area">
        <Hand
          room={room} meId={meId} me={me}
          getVisibleCard={c.getVisibleCard} highlights={c.highlights} marks={c.marks}
          selectedIndex={phase === "PLAY" ? c.selIdx : -1}
          canReorder={c.canReorder} onReorder={c.onReorder}
          onMyCardClick={c.onMyCardClick} targetMode={c.targetMode} onCardClick={c.onCardClick}
        />
      </section>

      <footer className={`dock${c.myAttention ? " dock--turn" : ""}`}>
        {room.tutorial && c.coach && (
          <button type="button" className="coach" onClick={() => setCoachOpen(true)}>
            <span className="coach__label">🎓 {c.coach.headline}</span>
            <span className="coach__text">{c.coach.text}</span>
            <span className="coach__more">more</span>
          </button>
        )}
        <div className="dock__row">{dockRow}</div>
      </footer>

      <ArrowLayer rootRef={gameRef} arrows={c.arrows} dep={`${room.players.length}${Object.values(room.handSizes ?? {}).join(",")}`} />

      {/* ── Sheets and popups ─────────────────────────────────────────────── */}
      <Sheet open={logOpen} onClose={() => setLogOpen(false)} title="Activity" side>
        <div className="log">{c.log.slice(-80).map((l, i) => <div key={i}>{l}</div>)}</div>
      </Sheet>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings">
        <div className="stack">
          <div className="row"><Pill>Room <b>{c.roomId.toUpperCase()}</b></Pill><Pill tone="accent">{lengthText(room.gameLength)}</Pill></div>
          {room.botSettings ? (
            <>
              <Field label="Computer speed">
                <select className="select" value={room.botSettings.speed} disabled={!c.isHost} onChange={(e) => c.changeBotSettings({ speed: e.target.value })}>
                  <option value="fast">Fast</option><option value="normal">Normal</option><option value="slow">Slow</option>
                </select>
              </Field>
              <Field label="Computer difficulty">
                <select className="select" value={room.botSettings.difficulty} disabled={!c.isHost} onChange={(e) => c.changeBotSettings({ difficulty: e.target.value })}>
                  <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </select>
              </Field>
            </>
          ) : <p className="lead">No computer players in this room.</p>}
          {room.tutorial && (
            <label className="check">
              <input type="checkbox" checked={!!room.tutorial.showAllCards} onChange={(e) => c.setShowAllCards(e.target.checked)} />
              Show all my cards
            </label>
          )}
          <Btn variant="ghost" block onClick={() => { setSettingsOpen(false); c.onRules(); }}>📖 Rules</Btn>
          <Btn variant="danger" block onClick={() => window.location.reload()}>Leave game</Btn>
        </div>
      </Sheet>

      <Sheet open={coachOpen && !!c.coach} onClose={() => setCoachOpen(false)} title={c.coach ? `🎓 ${c.coach.headline}` : "Coach"}>
        {c.coach && (
          <div className="stack">
            <p style={{ margin: 0 }}>{c.coach.text}</p>
            {c.coach.tip && <p className="lead" style={{ margin: 0 }}>{c.coach.tip}</p>}
          </div>
        )}
      </Sheet>

      <Sheet open={sheetPid !== null} onClose={() => setSheetPid(null)} title={`${sheetPid ? nameOf(sheetPid) : ""}'s cards — tap one`}>
        <div className="target-cards">
          {sheetPid && Array.from({ length: room.handSizes?.[sheetPid] ?? 0 }).map((_, i) => (
            <CardBack key={i} size="big" label={i} highlight={c.marks[`${sheetPid}:${i}`]} onClick={() => { c.onCardClick(sheetPid, i); setSheetPid(null); }} />
          ))}
        </div>
      </Sheet>

      <Sheet open={!!c.queenReveal} onClose={c.hideQueenReveal} title="♛ Queen peek">
        {c.queenReveal && (
          <div className="stack" style={{ alignItems: "center" }}>
            <CardFace card={c.queenReveal.card} size="big" />
            <div><b>{nameOf(c.queenReveal.targetPlayerId)}</b>'s card #{c.queenReveal.targetIndex}</div>
            <p className="lead" style={{ margin: 0 }}>Only you can see this.</p>
            {room.revealHold === meId
              ? <Btn variant="primary" onClick={c.doneReveal}>Done — go to scoring</Btn>
              : <Btn variant="secondary" onClick={c.hideQueenReveal}>Hide</Btn>}
          </div>
        )}
      </Sheet>

      {c.banner && (
        <div className="pop" onClick={c.dismissBanner}>
          <div className="pop__card" key={c.banner.text}>
            <div className="pop__title">🔔 {c.banner.text}</div>
            {c.banner.sub && <div className="pop__sub">{c.banner.sub}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
