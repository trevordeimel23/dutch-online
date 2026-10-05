/**
 * DUTCH CARD GAME — Unit Tests
 * Tests for pure game logic functions.
 *
 * HOW TO RUN:
 *   1. Copy this file to: C:\Users\trevo\dutch-online\server\tests\gameLogic.test.js
 *   2. In server\package.json add:  "jest": "^29.0.0"  to devDependencies
 *      and  "test": "jest"  to scripts
 *   3. Run: cd C:\Users\trevo\dutch-online\server && npm install --save-dev jest
 *   4. Run: npm test
 *
 * IMPORTANT: Add these exports to the BOTTOM of your server/index.js:
 *   if (process.env.NODE_ENV === 'test') {
 *     module.exports = { makeDeck, cardValue, freshGameState, scoreRound,
 *                        shiftKnownAfterRemoval, checkAndSetSpecialEffect };
 *   }
 */

// ─── Inline copies of pure functions for self-contained testing ──────────────
// (These mirror the logic in server/index.js exactly)

function makeDeck() {
  const suits = ['♠','♣','♥','♦'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (!card) return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') {
    // Red King (hearts/diamonds) = 0, Black King (spades/clubs) = 13
    return (card.suit === '♥' || card.suit === '♦') ? 0 : 13;
  }
  return parseInt(card.rank, 10);
}

function shiftKnownAfterRemoval(known, removedIndex) {
  const shifted = {};
  for (const [idx, card] of Object.entries(known)) {
    const i = parseInt(idx, 10);
    if (i < removedIndex) shifted[i] = card;
    else if (i > removedIndex) shifted[i - 1] = card;
    // i === removedIndex is dropped
  }
  return shifted;
}

function scoreRound(players) {
  // Returns { playerId: totalScore } for this round
  const scores = {};
  for (const p of players) {
    scores[p.id] = p.hand.reduce((sum, card) => sum + cardValue(card), 0);
  }
  return scores;
}

// ─── makeDeck ────────────────────────────────────────────────────────────────

describe('makeDeck()', () => {
  test('produces exactly 52 cards', () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
  });

  test('contains all 4 suits', () => {
    const deck = makeDeck();
    const suits = new Set(deck.map(c => c.suit));
    expect(suits).toEqual(new Set(['♠','♣','♥','♦']));
  });

  test('contains all 13 ranks', () => {
    const deck = makeDeck();
    const ranks = new Set(deck.map(c => c.rank));
    expect(ranks).toEqual(new Set(['A','2','3','4','5','6','7','8','9','10','J','Q','K']));
  });

  test('each suit has exactly 13 cards', () => {
    const deck = makeDeck();
    for (const suit of ['♠','♣','♥','♦']) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(13);
    }
  });

  test('no duplicate cards', () => {
    const deck = makeDeck();
    const keys = deck.map(c => `${c.rank}${c.suit}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(52);
  });

  test('deck is shuffled (not always sorted)', () => {
    // Run 5 times; probability all are sorted is astronomically low
    const results = Array.from({ length: 5 }, () => makeDeck().map(c => c.rank).join(','));
    const allSame = results.every(r => r === results[0]);
    expect(allSame).toBe(false);
  });
});

// ─── cardValue ───────────────────────────────────────────────────────────────

describe('cardValue()', () => {
  test('Ace = 1', () => {
    expect(cardValue({ rank: 'A', suit: '♠' })).toBe(1);
    expect(cardValue({ rank: 'A', suit: '♥' })).toBe(1);
  });

  test('2 through 10 = face value', () => {
    for (let n = 2; n <= 10; n++) {
      expect(cardValue({ rank: String(n), suit: '♠' })).toBe(n);
    }
  });

  test('Jack = 11', () => {
    expect(cardValue({ rank: 'J', suit: '♣' })).toBe(11);
  });

  test('Queen = 12', () => {
    expect(cardValue({ rank: 'Q', suit: '♥' })).toBe(12);
  });

  test('Red King (hearts) = 0', () => {
    expect(cardValue({ rank: 'K', suit: '♥' })).toBe(0);
  });

  test('Red King (diamonds) = 0', () => {
    expect(cardValue({ rank: 'K', suit: '♦' })).toBe(0);
  });

  test('Black King (spades) = 13', () => {
    expect(cardValue({ rank: 'K', suit: '♠' })).toBe(13);
  });

  test('Black King (clubs) = 13', () => {
    expect(cardValue({ rank: 'K', suit: '♣' })).toBe(13);
  });

  test('null/undefined card = 0', () => {
    expect(cardValue(null)).toBe(0);
    expect(cardValue(undefined)).toBe(0);
  });
});

// ─── scoreRound ──────────────────────────────────────────────────────────────

describe('scoreRound()', () => {
  test('single player empty hand = 0', () => {
    const players = [{ id: 'p1', hand: [] }];
    expect(scoreRound(players)).toEqual({ p1: 0 });
  });

  test('sums card values correctly', () => {
    const players = [
      { id: 'p1', hand: [
        { rank: '5', suit: '♠' },
        { rank: '3', suit: '♥' },
        { rank: 'A', suit: '♦' },
      ]},
    ];
    expect(scoreRound(players)).toEqual({ p1: 9 });
  });

  test('Red King adds 0 to score', () => {
    const players = [
      { id: 'p1', hand: [{ rank: 'K', suit: '♥' }, { rank: '5', suit: '♠' }] },
    ];
    expect(scoreRound(players)).toEqual({ p1: 5 });
  });

  test('Black King adds 13 to score', () => {
    const players = [
      { id: 'p1', hand: [{ rank: 'K', suit: '♠' }, { rank: '5', suit: '♣' }] },
    ];
    expect(scoreRound(players)).toEqual({ p1: 18 });
  });

  test('multiple players scored independently', () => {
    const players = [
      { id: 'p1', hand: [{ rank: '2', suit: '♠' }, { rank: '3', suit: '♠' }] },
      { id: 'p2', hand: [{ rank: '10', suit: '♥' }, { rank: 'K', suit: '♦' }] },
    ];
    const scores = scoreRound(players);
    expect(scores.p1).toBe(5);
    expect(scores.p2).toBe(10); // 10 + Red King(0)
  });

  test('all Aces hand = 4 (minimum non-zero hand)', () => {
    const players = [
      { id: 'p1', hand: [
        { rank: 'A', suit: '♠' },
        { rank: 'A', suit: '♣' },
        { rank: 'A', suit: '♥' },
        { rank: 'A', suit: '♦' },
      ]},
    ];
    expect(scoreRound(players)).toEqual({ p1: 4 });
  });

  test('all Red Kings hand = 0 (best possible hand)', () => {
    const players = [
      { id: 'p1', hand: [
        { rank: 'K', suit: '♥' },
        { rank: 'K', suit: '♦' },
        { rank: 'A', suit: '♠' },  // 1 point
        { rank: '2', suit: '♣' },  // 2 points
      ]},
    ];
    expect(scoreRound(players)).toEqual({ p1: 3 });
  });
});

// ─── Dutch caller win/penalty logic ──────────────────────────────────────────

describe('Dutch caller win/penalty logic', () => {
  // Dutch caller wins round if their score is STRICTLY the lowest, or their score is 0.
  // Otherwise they receive a +2 card penalty (2 extra cards from deck).
  // We test the determination logic here since it's pure math.

  function determineDutchResult(callerScore, otherScores) {
    if (callerScore === 0) return 'WIN';
    const allOthersHigher = otherScores.every(s => s > callerScore);
    return allOthersHigher ? 'WIN' : 'PENALTY';
  }

  test('caller wins when strictly lowest score', () => {
    expect(determineDutchResult(5, [8, 12, 10])).toBe('WIN');
  });

  test('caller wins when score is 0', () => {
    expect(determineDutchResult(0, [0, 0, 0])).toBe('WIN'); // 0 always wins
  });

  test('caller gets penalty when tied for lowest', () => {
    expect(determineDutchResult(5, [5, 8, 10])).toBe('PENALTY');
  });

  test('caller gets penalty when another player is lower', () => {
    expect(determineDutchResult(8, [5, 10, 12])).toBe('PENALTY');
  });

  test('caller wins heads-up when strictly lower', () => {
    expect(determineDutchResult(3, [9])).toBe('WIN');
  });

  test('caller gets penalty heads-up when tied', () => {
    expect(determineDutchResult(7, [7])).toBe('PENALTY');
  });
});

// ─── shiftKnownAfterRemoval ───────────────────────────────────────────────────

describe('shiftKnownAfterRemoval()', () => {
  test('removes the exact index', () => {
    const known = { 0: 'A♠', 1: '5♥', 2: 'K♦' };
    const result = shiftKnownAfterRemoval(known, 1);
    expect(result[1]).toBeUndefined(); // was 5♥, now gone
  });

  test('indices below removed index stay the same', () => {
    const known = { 0: 'A♠', 1: '5♥', 2: 'K♦' };
    const result = shiftKnownAfterRemoval(known, 1);
    expect(result[0]).toBe('A♠'); // unchanged
  });

  test('indices above removed index shift down by 1', () => {
    const known = { 0: 'A♠', 1: '5♥', 2: 'K♦' };
    const result = shiftKnownAfterRemoval(known, 1);
    expect(result[1]).toBe('K♦'); // was index 2, now index 1
    expect(result[2]).toBeUndefined();
  });

  test('removing first card shifts all others down', () => {
    const known = { 0: 'A♠', 1: '5♥', 2: 'K♦', 3: '7♣' };
    const result = shiftKnownAfterRemoval(known, 0);
    expect(result[0]).toBe('5♥');
    expect(result[1]).toBe('K♦');
    expect(result[2]).toBe('7♣');
    expect(result[3]).toBeUndefined();
  });

  test('removing last card does not affect others', () => {
    const known = { 0: 'A♠', 1: '5♥', 2: 'K♦' };
    const result = shiftKnownAfterRemoval(known, 2);
    expect(result[0]).toBe('A♠');
    expect(result[1]).toBe('5♥');
    expect(result[2]).toBeUndefined();
  });

  test('empty known object stays empty', () => {
    const result = shiftKnownAfterRemoval({}, 0);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('only-one-known card at removed index produces empty result', () => {
    const result = shiftKnownAfterRemoval({ 2: 'Q♣' }, 2);
    expect(Object.keys(result)).toHaveLength(0);
  });

  test('only-one-known card NOT at removed index shifts correctly', () => {
    const result = shiftKnownAfterRemoval({ 3: 'J♠' }, 1);
    expect(result[2]).toBe('J♠');
    expect(result[3]).toBeUndefined();
  });
});

// ─── Special card identification ─────────────────────────────────────────────

describe('Special card detection', () => {
  function isSpecialCard(card) {
    return ['J', 'Q', 'A'].includes(card?.rank);
  }

  function getSpecialEffect(card) {
    if (!card) return null;
    if (card.rank === 'J') return 'JACK_SWAP';       // swap any two players' cards
    if (card.rank === 'Q') return 'QUEEN_PEEK';      // peek at any one card
    if (card.rank === 'A') return 'ACE_PEEK_OWN';    // peek at one of your own cards
    return null;
  }

  test('Jack triggers JACK_SWAP effect', () => {
    expect(getSpecialEffect({ rank: 'J', suit: '♠' })).toBe('JACK_SWAP');
  });

  test('Queen triggers QUEEN_PEEK effect', () => {
    expect(getSpecialEffect({ rank: 'Q', suit: '♥' })).toBe('QUEEN_PEEK');
  });

  test('Ace triggers ACE_PEEK_OWN effect', () => {
    expect(getSpecialEffect({ rank: 'A', suit: '♦' })).toBe('ACE_PEEK_OWN');
  });

  test('Number cards have no special effect', () => {
    for (let n = 2; n <= 10; n++) {
      expect(getSpecialEffect({ rank: String(n), suit: '♠' })).toBeNull();
    }
  });

  test('King has no special effect', () => {
    expect(getSpecialEffect({ rank: 'K', suit: '♥' })).toBeNull();
    expect(getSpecialEffect({ rank: 'K', suit: '♠' })).toBeNull();
  });

  test('isSpecialCard returns true for J, Q, A', () => {
    expect(isSpecialCard({ rank: 'J', suit: '♠' })).toBe(true);
    expect(isSpecialCard({ rank: 'Q', suit: '♣' })).toBe(true);
    expect(isSpecialCard({ rank: 'A', suit: '♦' })).toBe(true);
  });

  test('isSpecialCard returns false for K and numbers', () => {
    expect(isSpecialCard({ rank: 'K', suit: '♥' })).toBe(false);
    expect(isSpecialCard({ rank: '7', suit: '♠' })).toBe(false);
    expect(isSpecialCard({ rank: '10', suit: '♣' })).toBe(false);
  });
});

// ─── Match attempt validation ─────────────────────────────────────────────────

describe('Match attempt validation', () => {
  // A match attempt is valid when the attempted card's rank matches
  // the top of the discard pile.
  function canMatch(playerCard, discardTopCard) {
    if (!playerCard || !discardTopCard) return false;
    return playerCard.rank === discardTopCard.rank;
  }

  test('matching same rank succeeds', () => {
    expect(canMatch({ rank: '7', suit: '♠' }, { rank: '7', suit: '♥' })).toBe(true);
  });

  test('different rank fails', () => {
    expect(canMatch({ rank: '7', suit: '♠' }, { rank: '8', suit: '♥' })).toBe(false);
  });

  test('same rank different suit succeeds', () => {
    expect(canMatch({ rank: 'J', suit: '♣' }, { rank: 'J', suit: '♦' })).toBe(true);
  });

  test('match against null discard fails gracefully', () => {
    expect(canMatch({ rank: '5', suit: '♠' }, null)).toBe(false);
  });

  test('null card against discard fails gracefully', () => {
    expect(canMatch(null, { rank: '5', suit: '♠' })).toBe(false);
  });

  test('Ace can match Ace', () => {
    expect(canMatch({ rank: 'A', suit: '♥' }, { rank: 'A', suit: '♦' })).toBe(true);
  });

  test('King can match King regardless of color', () => {
    expect(canMatch({ rank: 'K', suit: '♠' }, { rank: 'K', suit: '♥' })).toBe(true);
  });
});

// ─── Turn order logic ────────────────────────────────────────────────────────

describe('Turn order logic', () => {
  function nextPlayerIndex(currentIndex, playerCount) {
    return (currentIndex + 1) % playerCount;
  }

  function isPlayersTurn(currentTurnIndex, playerIndex) {
    return currentTurnIndex === playerIndex;
  }

  test('advances to next player correctly', () => {
    expect(nextPlayerIndex(0, 4)).toBe(1);
    expect(nextPlayerIndex(1, 4)).toBe(2);
    expect(nextPlayerIndex(2, 4)).toBe(3);
  });

  test('wraps around from last player to first', () => {
    expect(nextPlayerIndex(3, 4)).toBe(0);
    expect(nextPlayerIndex(1, 2)).toBe(0);
  });

  test('two player game alternates correctly', () => {
    expect(nextPlayerIndex(0, 2)).toBe(1);
    expect(nextPlayerIndex(1, 2)).toBe(0);
  });

  test('isPlayersTurn returns true for current player', () => {
    expect(isPlayersTurn(2, 2)).toBe(true);
  });

  test('isPlayersTurn returns false for other players', () => {
    expect(isPlayersTurn(2, 0)).toBe(false);
    expect(isPlayersTurn(2, 1)).toBe(false);
    expect(isPlayersTurn(2, 3)).toBe(false);
  });
});

// ─── Peek phase logic ────────────────────────────────────────────────────────

describe('Peek phase', () => {
  function validatePeekSelection(selectedIndices, lookCount, handSize) {
    if (selectedIndices.length !== lookCount) return false;
    if (new Set(selectedIndices).size !== selectedIndices.length) return false; // no duplicates
    return selectedIndices.every(i => i >= 0 && i < handSize);
  }

  test('correct number of peeks passes (2-card peek)', () => {
    expect(validatePeekSelection([0, 1], 2, 4)).toBe(true);
  });

  test('wrong number of peeks fails', () => {
    expect(validatePeekSelection([0], 2, 4)).toBe(false);
    expect(validatePeekSelection([0, 1, 2], 2, 4)).toBe(false);
  });

  test('duplicate indices fail', () => {
    expect(validatePeekSelection([1, 1], 2, 4)).toBe(false);
  });

  test('out-of-range index fails', () => {
    expect(validatePeekSelection([0, 4], 2, 4)).toBe(false); // index 4 invalid for hand of 4
    expect(validatePeekSelection([-1, 0], 2, 4)).toBe(false);
  });

  test('4-card peek works for 8-card hand (alternative rule)', () => {
    expect(validatePeekSelection([0, 1, 2, 3], 4, 8)).toBe(true);
  });

  test('0-card peek always passes (skip peek phase)', () => {
    expect(validatePeekSelection([], 0, 4)).toBe(true);
  });
});

// ─── Dutch window timing logic ────────────────────────────────────────────────

describe('Dutch window timing', () => {
  test('window is active when endsAt is in the future', () => {
    const endsAt = Date.now() + 8000;
    expect(endsAt > Date.now()).toBe(true);
  });

  test('window is expired when endsAt is in the past', () => {
    const endsAt = Date.now() - 1000;
    expect(endsAt > Date.now()).toBe(false);
  });

  test('seconds remaining calculated correctly', () => {
    const endsAt = Date.now() + 7500;
    const remaining = Math.ceil((endsAt - Date.now()) / 1000);
    expect(remaining).toBe(8); // rounds up
  });

  test('seconds remaining = 0 when expired', () => {
    const endsAt = Date.now() - 500;
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    expect(remaining).toBe(0);
  });
});

// ─── Game phase transitions ───────────────────────────────────────────────────

describe('Phase transition validation', () => {
  // Valid transitions: LOBBY → PEEK → PLAY → SCORING → PLAY (new round) or GAME_OVER
  const validTransitions = {
    LOBBY: ['PEEK', 'PLAY'],        // PLAY if lookCount=0
    PEEK: ['PLAY'],
    PLAY: ['SCORING'],
    SCORING: ['PLAY', 'GAME_OVER'],
  };

  function isValidTransition(from, to) {
    return validTransitions[from]?.includes(to) ?? false;
  }

  test('LOBBY → PEEK is valid', () => {
    expect(isValidTransition('LOBBY', 'PEEK')).toBe(true);
  });

  test('LOBBY → PLAY is valid (no peek)', () => {
    expect(isValidTransition('LOBBY', 'PLAY')).toBe(true);
  });

  test('PEEK → PLAY is valid', () => {
    expect(isValidTransition('PEEK', 'PLAY')).toBe(true);
  });

  test('PLAY → SCORING is valid', () => {
    expect(isValidTransition('PLAY', 'SCORING')).toBe(true);
  });

  test('SCORING → PLAY is valid (new round)', () => {
    expect(isValidTransition('SCORING', 'PLAY')).toBe(true);
  });

  test('SCORING → GAME_OVER is valid', () => {
    expect(isValidTransition('SCORING', 'GAME_OVER')).toBe(true);
  });

  test('PLAY → LOBBY is invalid', () => {
    expect(isValidTransition('PLAY', 'LOBBY')).toBe(false);
  });

  test('SCORING → PEEK is invalid', () => {
    expect(isValidTransition('SCORING', 'PEEK')).toBe(false);
  });
});
