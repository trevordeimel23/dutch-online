import { Sheet } from "./ui.jsx";

const VALUES = [
  ["Ace", "1"], ["2 – 10", "face value"], ["Jack", "11"], ["Queen", "12"],
  ["Red King (♥ ♦)", "0"], ["Black King (♠ ♣)", "13"],
];

export default function Rules({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="📖 How to Play Dutch" wide>
      <div className="rules">
        <h3>Objective</h3>
        <p>Finish with the <b>lowest score</b>. Every round you add up the value of the four (or more) cards in front of you. You want that number to be small. The game ends according to the length chosen at the start: after a set number of rounds, or when someone reaches a target score (100 by default). The player with the <b>lowest total</b> wins.</p>

        <h3>Card values</h3>
        <div className="rules__values">
          {VALUES.map(([card, value]) => <div key={card}><span>{card}</span><b>{value}</b></div>)}
        </div>

        <h3>Starting a round</h3>
        <ul>
          <li>3 to 10 players, one standard 52-card deck. The dealer rotates every round.</li>
          <li>Everyone gets <b>4 cards face down</b>, arranged in a row.</li>
          <li>The dealer announces how many cards (0–4) each player may <b>peek at</b>. Memorize them — you can't look again.</li>
          <li>One card is turned face up to start the discard pile; the rest is the draw pile.</li>
          <li>The player after the dealer goes first, then play continues around the table.</li>
        </ul>

        <h3>Your turn</h3>
        <ol>
          <li><b>Draw</b> one card — either from the draw pile (unseen) or the top of the discard pile.</li>
          <li><b>Discard</b> one card: either the card you just drew, or swap it into your hand in place of one of your cards (the replaced card goes face up on the discard pile).</li>
          <li>You can't pick up a card from the discard pile and immediately throw it back. A card taken from the discard pile must go into your hand.</li>
        </ol>
        <p>Every turn you must draw <b>and</b> discard one card, so you can't skip your turn.</p>

        <h3>Matching</h3>
        <ul>
          <li>If the card on top of the discard pile has the <b>same rank</b> as one of your cards, you can match it at any time — even on someone else's turn. Your card goes on the pile and you don't draw a replacement, so your hand gets smaller.</li>
          <li><b>Wrong match?</b> If you try to match with a card that isn't the same rank, you take a penalty card from the draw pile and add it to your hand without looking.</li>
          <li>If you miss a chance to match, the game simply carries on.</li>
        </ul>

        <h3>Special cards</h3>
        <p>When you <b>discard</b> one of these, you get its power:</p>
        <ul>
          <li><b>Jack (11)</b> — swap any two cards on the table. They don't have to be yours.</li>
          <li><b>Queen (12)</b> — look at any one card on the table.</li>
          <li><b>Ace (1)</b> — give a face-down penalty card to the player of your choice.</li>
          <li>If you <b>match</b> a Jack, Queen or Ace out of turn, you get its power too.</li>
        </ul>

        <h3>Calling "Dutch"</h3>
        <ul>
          <li>When you think you have the lowest score, call <b>Dutch</b>. In this online version you do it right after you've drawn and discarded: you get a 10-second window with a Call Dutch button.</li>
          <li>After Dutch is called, <b>every other player gets one more turn</b>. Then there's a final 10-second window where anyone can still match.</li>
          <li>Once you've called Dutch, nobody can give you a penalty card, look at your cards, or swap them.</li>
          <li>If you have the <b>lowest score</b>, you score <b>0</b> for the round. If you're tied (unless you have 0) or someone beats you, you take <b>two penalty cards</b> that count toward your round score.</li>
        </ul>

        <h3>Scoring and winning</h3>
        <ul>
          <li>At the end of the round everyone reveals their cards and adds up their points. Totals carry from round to round.</li>
          <li><b>Game length:</b> choose either a fixed number of rounds (1–20), or play until someone reaches 25, 50, 75 or 100 points (100 is the classic game).</li>
          <li>When the game ends, the <b>lowest total wins</b>.</li>
        </ul>

        <h3>Tips for this online version</h3>
        <ul>
          <li>Peeked cards stay visible for 15 seconds, then flip back over. Drag your own cards to <b>rearrange</b> them — everyone can see that you did, and the 🔀 badge shows how often.</li>
          <li>Highlights, arrows and a short message above the table show which cards moved.</li>
          <li>Play against 2–9 computer players on Easy, Medium or Hard, at Fast, Normal or Slow speed. Try <b>Learn to Play</b> for a coach that suggests moves and tells you when to match.</li>
        </ul>
      </div>
    </Sheet>
  );
}
