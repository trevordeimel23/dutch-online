import { useEffect } from "react";

const h2 = { fontSize: 16, color: "#f0d080", margin: "22px 0 8px", letterSpacing: "0.04em", borderBottom: "1px solid rgba(200,169,110,0.35)", paddingBottom: 4 };
const p = { margin: "6px 0", lineHeight: 1.55 };
const li = { margin: "4px 0", lineHeight: 1.5 };

const VALUES = [
  ["Ace", "1"], ["2 – 10", "face value"], ["Jack", "11"], ["Queen", "12"],
  ["Red King (♥ ♦)", "0"], ["Black King (♠ ♣)", "13"],
];

export default function Rules({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Dutch rules"
        style={{
          width: "100%", maxWidth: 760, maxHeight: "92vh", display: "flex", flexDirection: "column",
          background: "linear-gradient(to bottom, #173d1b, #0f2a12)", border: "2px solid rgba(200,169,110,0.6)", borderRadius: 14,
          color: "#e8d5a3", fontFamily: "Georgia, 'Times New Roman', serif", boxShadow: "0 12px 50px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(200,169,110,0.35)" }}>
          <div style={{ fontSize: 22, fontWeight: "bold", color: "#f0d080" }}>📖 How to Play Dutch</div>
          <button
            onClick={onClose}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.3)", color: "#e8d5a3", borderRadius: 8, padding: "6px 14px", fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "4px 22px 22px", fontSize: 15 }}>
          <h3 style={h2}>Objective</h3>
          <p style={p}>Finish with the <b>lowest score</b>. Every round you add up the value of the four (or more) cards in front of you. You want that number to be small. The game ends according to the length chosen at the start: after a set number of rounds, or when someone reaches a target score (100 by default). The player with the <b>lowest total</b> wins.</p>

          <h3 style={h2}>Card values</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 6 }}>
            {VALUES.map(([card, value]) => (
              <div key={card} style={{ display: "flex", justifyContent: "space-between", background: "rgba(0,0,0,0.25)", padding: "6px 12px", borderRadius: 8 }}>
                <span>{card}</span><b style={{ color: "#ffd700" }}>{value}</b>
              </div>
            ))}
          </div>

          <h3 style={h2}>Starting a round</h3>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}>3 to 10 players, one standard 52-card deck. The dealer rotates every round.</li>
            <li style={li}>Everyone gets <b>4 cards face down</b>, arranged in a row.</li>
            <li style={li}>The dealer announces how many cards (0–4) each player may <b>peek at</b>. Memorize them — you can't look again.</li>
            <li style={li}>One card is turned face up to start the discard pile; the rest is the draw pile.</li>
            <li style={li}>The player after the dealer goes first, then play continues around the table.</li>
          </ul>

          <h3 style={h2}>Your turn</h3>
          <ol style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}><b>Draw</b> one card — either from the draw pile (unseen) or the top of the discard pile.</li>
            <li style={li}><b>Discard</b> one card: either the card you just drew, or swap it into your hand in place of one of your cards (the replaced card goes face up on the discard pile).</li>
            <li style={li}>You can't pick up a card from the discard pile and immediately throw it back. A card taken from the discard pile must go into your hand.</li>
          </ol>
          <p style={p}>Every turn you must draw <b>and</b> discard one card, so you can't skip your turn.</p>

          <h3 style={h2}>Matching</h3>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}>If the card on top of the discard pile has the <b>same rank</b> as one of your cards, you can match it at any time — even on someone else's turn. Your card goes on the pile and you don't draw a replacement, so your hand gets smaller.</li>
            <li style={li}><b>Wrong match?</b> If you try to match with a card that isn't the same rank, you take a penalty card from the draw pile and add it to your hand without looking.</li>
            <li style={li}>If you miss a chance to match, the game simply carries on.</li>
          </ul>

          <h3 style={h2}>Special cards</h3>
          <p style={p}>When you <b>discard</b> one of these, you get its power:</p>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}><b>Jack (11)</b> — swap any two cards on the table. They don't have to be yours.</li>
            <li style={li}><b>Queen (12)</b> — look at any one card on the table.</li>
            <li style={li}><b>Ace (1)</b> — give a face-down penalty card to the player of your choice.</li>
            <li style={li}>If you <b>match</b> a Jack, Queen or Ace out of turn, you get its power too.</li>
          </ul>

          <h3 style={h2}>Calling "Dutch"</h3>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}>When you think you have the lowest score, call <b>Dutch</b>. In this online version you do it right after you've drawn and discarded: you get a 10-second window with a Call Dutch button.</li>
            <li style={li}>After Dutch is called, <b>every other player gets one more turn</b>. Then there's a final 10-second window where anyone can still match.</li>
            <li style={li}>Once you've called Dutch, nobody can give you a penalty card, look at your cards, or swap them.</li>
            <li style={li}>If you have the <b>lowest score</b>, you score <b>0</b> for the round. If you're tied (unless you have 0) or someone beats you, you take <b>two penalty cards</b> that count toward your round score.</li>
          </ul>

          <h3 style={h2}>Scoring and winning</h3>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}>At the end of the round everyone reveals their cards and adds up their points. Totals carry from round to round.</li>
            <li style={li}><b>Game length:</b> choose either a fixed number of rounds (1–20), or play until someone reaches 25, 50, 75 or 100 points (100 is the classic game).</li>
            <li style={li}>When the game ends, the <b>lowest total wins</b>.</li>
          </ul>

          <h3 style={h2}>Tips for this online version</h3>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li style={li}>Peeked cards stay visible for 15 seconds, then flip back over. Drag your own cards to <b>rearrange</b> them — everyone can see that you did, and the 🔀 badge shows how often.</li>
            <li style={li}>Highlights, arrows and a caption above the table show which cards moved.</li>
            <li style={li}>Play against 2–9 computer players on Easy, Medium or Hard, at Fast, Normal or Slow speed. Try <b>Learn to Play</b> for a coach that suggests moves and tells you when to match.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
