# Dutch Card Game — Manual QA Checklist
> For things that are hard to automate (timing, visuals, UX).
> Test with 2–4 browser tabs open, each in a separate window.

---

## 🏠 Room & Lobby

- [ ] Player 1 creates a room and sees themselves listed as host
- [ ] Player 2 joins the same room ID and appears in the lobby
- [ ] Player 3 joins and appears in the lobby
- [ ] All players see the updated player list in real-time
- [ ] Non-host players do NOT see the "Start Game" button
- [ ] Host can start the game

---

## 👀 Peek Phase

- [ ] All players enter the PEEK phase simultaneously
- [ ] Each player can only see their own cards to pick from
- [ ] Selecting fewer than the required number of cards shows an error
- [ ] Selecting too many cards shows an error
- [ ] Confirming the correct number of cards shows "Waiting for others..."
- [ ] Once ALL players confirm, the game advances to PLAY phase
- [ ] Peeked cards are visible with a 15-second countdown
- [ ] After 15 seconds, peeked cards flip back face-down

---

## 🃏 Turn Basics

- [ ] Only the current player sees "Draw from Deck" and "Draw from Discard"
- [ ] Out-of-turn players do NOT see draw buttons
- [ ] Drawing from deck shows the drawn card temporarily
- [ ] Player can choose to discard the drawn card (it goes to discard pile)
- [ ] Player can choose to swap the drawn card with one in hand
  - [ ] The old hand card goes to the discard pile
  - [ ] The drawn card replaces it in hand
  - [ ] If the drawn card is visible (via peek), visibility transfers correctly
- [ ] After discarding or swapping, turn advances to the next player
- [ ] **No immediate re-discard of drawn card** — drawing from discard pile and immediately discarding it is blocked

---

## ⏱️ Dutch Window (10-second window after discard)

- [ ] After the current player discards/swaps, a "Call Dutch?" window appears for THEM
- [ ] The window shows a countdown (10, 9, 8... 1, 0)
- [ ] "🔔 Call Dutch" button is visible during the window
- [ ] "Pass Turn" button is visible during the window
- [ ] Clicking "Pass Turn" immediately ends the window and advances the turn
- [ ] If neither button is clicked, turn advances automatically after 10 seconds
- [ ] Other players do NOT see the Dutch window (it's only for the player who just discarded)

---

## 🔔 Dutch Call

- [ ] Player can call Dutch at the start of their turn (before drawing)
- [ ] Player can call Dutch during the 10-second post-discard window
- [ ] Dutch cannot be called out of turn (no window, not your turn)
- [ ] After Dutch is called, all other players get ONE final turn
- [ ] The Dutch caller does NOT get another turn
- [ ] After the final round, scoring is displayed

---

## 🎯 Match Attempt (Out-of-Turn)

- [ ] Any player can attempt a match at any time (not just their turn)
- [ ] Matching a card with the SAME RANK as the discard pile top succeeds
  - [ ] The matched card is removed from hand
  - [ ] It goes to the discard pile
  - [ ] The matching player's turn does NOT change (they wait for their normal turn)
- [ ] Matching a card with a DIFFERENT rank fails
  - [ ] A penalty card is added to the player's hand from the deck
  - [ ] Penalty card is face-down (unknown)
- [ ] After a failed match, `me:update` reflects the larger hand size
- [ ] Matched card does NOT remain permanently visible after the match

---

## 🃏 Special Cards

### Jack (Swap any two cards)
- [ ] Discarding a Jack shows a "Jack Effect" UI
- [ ] Player selects Card A (from any player's hand, including own)
- [ ] Player selects Card B (from any player's hand)
- [ ] The two cards swap positions
- [ ] If either card was visible to you, visibility is updated correctly
- [ ] **Dutch caller protection**: Jack cannot target the Dutch caller's cards once Dutch is called

### Queen (Peek at any one card)
- [ ] Discarding a Queen shows a "Queen Effect" UI
- [ ] Player can pick any card from any player's hand (including own)
- [ ] The selected card is revealed to that player for 15 seconds
- [ ] Other players do NOT see the peeked card
- [ ] **Dutch caller protection**: Queen cannot target the Dutch caller once Dutch is called

### Ace (Peek at one of your own cards)
- [ ] Discarding an Ace shows an "Ace Effect" UI
- [ ] Player can only pick from their OWN hand
- [ ] The selected card is revealed for 15 seconds
- [ ] **Dutch caller protection**: If Dutch is called, Ace effect targeting the caller is blocked

---

## 🏆 Scoring

- [ ] Red Kings (♥ K, ♦ K) count as 0 points
- [ ] Black Kings (♠ K, ♣ K) count as 13 points
- [ ] Ace = 1, 2–10 = face value, J = 11, Q = 12
- [ ] Dutch caller wins round if their score is strictly the LOWEST
- [ ] Dutch caller wins if their score is exactly 0
- [ ] Dutch caller gets a +2 card PENALTY if tied or not lowest
- [ ] Scores accumulate across rounds
- [ ] A player is eliminated when they reach the score limit (if configured)
- [ ] Game ends when only one player remains, or all rounds complete
- [ ] Final winner is displayed

---

## 🌐 Multiplayer Stability

- [ ] Refreshing a browser tab disconnects that player cleanly (no ghost players)
- [ ] Game continues for remaining players if one disconnects during play
- [ ] Two separate rooms don't interfere with each other
- [ ] Starting a new round after scoring works correctly
- [ ] Chat / player names display correctly with special characters (spaces, apostrophes)

---

## 📱 Visual / UX

- [ ] Face-down cards show as a card back (no rank/suit visible)
- [ ] Peeked cards show rank and suit clearly
- [ ] Discard pile shows the top card face-up
- [ ] Current player is visually highlighted
- [ ] Dutch window countdown is visible and updates smoothly
- [ ] "Waiting for other players..." message shows after peek confirm
- [ ] No console errors in browser DevTools during normal gameplay
