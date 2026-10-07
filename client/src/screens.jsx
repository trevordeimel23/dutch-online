import { useState } from "react";
import { Avatar, Btn, Field, GameLengthPicker, Panel, Pill, lengthText } from "./ui.jsx";

// Screens that are allowed to scroll on small phones: landing, lobby and round results.

export function Brand() {
  return <div className="brand"><span>🃏</span> DUTCH</div>;
}

export function Landing({ s, onRules }) {
  const [tab, setTab] = useState("computer");
  const nameOk = s.name.trim().length > 0;
  return (
    <div className="screen">
      <div className="screen__inner">
        <Brand />
        <input className="input" value={s.name} onChange={(e) => s.setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={20} />

        <div className="tabs" role="tablist">
          {[["computer", "🤖 Computer"], ["online", "👥 Online"], ["learn", "🎓 Learn"]].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? " tab--on" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === "computer" && (
          <Panel title="Play vs Computer">
            <div className="stack">
              <Field label="Opponents">
                <select className="select" value={s.botCount} onChange={(e) => s.setBotCount(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field label="Difficulty">
                <select className="select" value={s.botDifficulty} onChange={(e) => s.setBotDifficulty(e.target.value)}>
                  <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </select>
              </Field>
              <Field label="Game speed">
                <select className="select" value={s.botSpeed} onChange={(e) => s.setBotSpeed(e.target.value)}>
                  <option value="fast">Fast</option><option value="normal">Normal</option><option value="slow">Slow</option>
                </select>
              </Field>
              <GameLengthPicker value={s.gameLength} onChange={s.setGameLength} />
              <Btn variant="primary" block onClick={s.playBots} disabled={!nameOk}>Play vs Computer</Btn>
            </div>
          </Panel>
        )}

        {tab === "online" && (
          <Panel title="Join a room">
            <div className="stack">
              <p className="lead">Share a room code with friends. The first person to join is the host and picks the game length.</p>
              <input className="input" value={s.roomId} onChange={(e) => s.setRoomId(e.target.value.toUpperCase())} placeholder="Room code" aria-label="Room code" style={{ textTransform: "uppercase" }} />
              <Btn variant="primary" block onClick={s.join} disabled={!nameOk || !s.roomId.trim()}>Join Room</Btn>
            </div>
          </Panel>
        )}

        {tab === "learn" && (
          <Panel title="Learn to Play">
            <div className="stack">
              <p className="lead">A coach suggests your moves, explains why, and tells you when to match.</p>
              <Field label="Opponents">
                <select className="select" value={s.tutorialBots} onChange={(e) => s.setTutorialBots(Number(e.target.value))}>
                  <option value={1}>1 (heads-up)</option><option value={2}>2</option><option value={3}>3</option>
                </select>
              </Field>
              <label className="check">
                <input type="checkbox" checked={s.tutorialShowAll} onChange={(e) => s.setTutorialShowAll(e.target.checked)} />
                Show all my cards at all times
              </label>
              <GameLengthPicker value={s.tutorialLength} onChange={s.setTutorialLength} />
              <Btn variant="primary" block onClick={s.startTutorial} disabled={!nameOk}>Start Tutorial</Btn>
            </div>
          </Panel>
        )}

        <Btn variant="ghost" block onClick={onRules}>📖 Read the Rules</Btn>
      </div>
    </div>
  );
}

export function Lobby({ s, room, players, isHost, onRules }) {
  const waiting = players.length < (room.expectedPlayers ?? 1);
  return (
    <div className="screen">
      <div className="screen__inner">
        <Brand />
        <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
          <Pill>Room <b>{s.roomId.toUpperCase()}</b></Pill>
          <Pill tone="accent">{lengthText(room.gameLength)}</Pill>
          {room.tutorial && <Pill tone="info">🎓 Tutorial</Pill>}
        </div>

        <Panel title={`Players (${players.length}${room.expectedPlayers ? ` / ${room.expectedPlayers}` : ""})`}>
          <div className="chips">
            {players.map((p) => (
              <span key={p.id} className="chip">
                <Avatar player={p} />
                {p.name.replace(/^🤖\s*/, "")}{p.id === s.meId && " (you)"}{p.id === room.hostId && " ♛"}
              </span>
            ))}
          </div>
        </Panel>

        {isHost ? (
          <Panel title="Game setup">
            <div className="stack">
              <Field label="Cards to peek">
                <select className="select" value={s.lookCount} onChange={(e) => s.setLookCount(Number(e.target.value))}>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <GameLengthPicker value={s.gameLength} onChange={s.setGameLength} />
              {room.botSettings && (
                <>
                  <Field label="Computer speed">
                    <select className="select" value={room.botSettings.speed} onChange={(e) => s.changeBotSettings({ speed: e.target.value })}>
                      <option value="fast">Fast</option><option value="normal">Normal</option><option value="slow">Slow</option>
                    </select>
                  </Field>
                  <Field label="Computer difficulty">
                    <select className="select" value={room.botSettings.difficulty} onChange={(e) => s.changeBotSettings({ difficulty: e.target.value })}>
                      <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                    </select>
                  </Field>
                </>
              )}
              {room.tutorial && (
                <label className="check">
                  <input type="checkbox" checked={!!room.tutorial.showAllCards} onChange={(e) => s.setShowAllCards(e.target.checked)} />
                  Show all my cards
                </label>
              )}
              <Btn variant="primary" block onClick={s.start} disabled={waiting}>{waiting ? "Waiting for players…" : "Start Game"}</Btn>
            </div>
          </Panel>
        ) : (
          <Panel><p className="lead">Waiting for the host to start the game…</p></Panel>
        )}

        <Btn variant="ghost" block onClick={onRules}>📖 Read the Rules</Btn>
      </div>
    </div>
  );
}

export function Results({ s, room, players, totals, dutchCallerId, isHost, isNextDealer, nextDealerName }) {
  const winners = room.gameOver ? (room.winnerIds?.length ? room.winnerIds : [room.winnerId]) : [];
  return (
    <div className="screen">
      <div className="screen__inner screen__inner--wide">
        <div className="big-result">
          <h2>{room.gameOver ? "🏆 Game over" : "Round results"}</h2>
          {room.gameOver && winners.length > 0 && (
            <p>
              {winners.length > 1 ? "It's a tie: " : "Winner: "}
              <b style={{ color: "var(--accent)" }}>{winners.map((id) => players.find((p) => p.id === id)?.name).join(" & ")}</b>
            </p>
          )}
          {!room.gameOver && room.gameLength?.mode === "rounds" && <p>Round {room.roundNumber} of {room.gameLength.rounds}</p>}
          {!room.gameOver && room.gameLength?.mode === "score" && <p>{lengthText(room.gameLength)}</p>}
        </div>

        <Panel>
          <div style={{ overflowX: "auto" }}>
            <table className="score">
              <thead>
                <tr><th>Player</th><th>Hand</th><th>Round</th><th>Total</th></tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const hand = room.revealedHands?.[p.id] ?? [];
                  const isYou = p.id === s.meId;
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.id === dutchCallerId && "🔔 "}{winners.includes(p.id) && "🏆 "}
                        <b className={isYou ? "score__you" : undefined}>{p.name}</b>{isYou && <span className="score__hand"> (you)</span>}
                      </td>
                      <td className="score__hand">{hand.join("  ")}</td>
                      <td className="score__num" style={{ color: (room.roundScores?.[p.id] ?? 0) === 0 ? "var(--ok)" : undefined }}>{room.roundScores?.[p.id] ?? 0}</td>
                      <td className="score__num">{totals[p.id] ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="stack" style={{ alignItems: "center" }}>
          {isNextDealer && !room.gameOver && (
            <>
              <Field label="You deal next — cards to peek">
                <select className="select" value={s.lookCount} onChange={(e) => s.setLookCount(Number(e.target.value))}>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Btn variant="primary" onClick={s.newRound}>Start next round</Btn>
            </>
          )}
          {!isNextDealer && !room.gameOver && <p className="lead">Waiting for {nextDealerName ?? "the dealer"} to start the next round…</p>}
          {room.gameOver && isHost && <Btn variant="primary" onClick={s.start}>New game</Btn>}
          <Btn variant="ghost" onClick={s.onRules}>📖 Rules</Btn>
        </div>
      </div>
    </div>
  );
}
