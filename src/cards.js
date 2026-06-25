// cards.js — カードのモデル・パース・整形。
// カードIDは 0..51 の整数。 id = rank*4 + suit。
//   rank: 0..12 = 2,3,4,5,6,7,8,9,T,J,Q,K,A
//   suit: 0..3  = c,d,h,s （♣♦♥♠）
// 比較や評価はすべて整数IDで行い、表示時のみ文字へ変換する。

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUIT_CHARS = ['c', 'd', 'h', 's'];
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
// 赤スート（♦♥）かどうか。UIの色分けに使う。
export const SUIT_IS_RED = [false, true, true, false];

export const NUM_CARDS = 52;

// スート文字（記号含む）→ インデックス
const SUIT_LOOKUP = new Map([
  ['c', 0], ['d', 1], ['h', 2], ['s', 3],
  ['♣', 0], ['♦', 1], ['♥', 2], ['♠', 3],
]);

// ランク文字 → インデックス
const RANK_LOOKUP = new Map(RANK_CHARS.map((ch, i) => [ch, i]));

// 全角英数字・記号を半角へ正規化する（日本語IMEでの入力崩れを吸収）。
// 全角 '！'〜'～'(U+FF01..FF5E) → 半角(U+0021..007E)、全角スペース → 半角。
export function normalizeInput(str) {
  if (!str) return '';
  return String(str)
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');
}

export function rankOf(id) {
  return id >> 2;
}

export function suitOf(id) {
  return id & 3;
}

export function makeCard(rank, suit) {
  return rank * 4 + suit;
}

// 1枚のカード文字列をIDに変換する。'As' 'td' '10h' '7♠' などを受理。
// 解釈できない場合は null を返す（呼び出し側で検証）。
export function parseCard(str) {
  if (!str) return null;
  let s = normalizeInput(String(str)).trim();
  if (!s) return null;

  let rankCh;
  let rest;
  if (s[0] === '1' && s[1] === '0') {
    rankCh = 'T';
    rest = s.slice(2);
  } else {
    rankCh = s[0].toUpperCase();
    rest = s.slice(1);
  }

  const rank = RANK_LOOKUP.get(rankCh);
  if (rank === undefined) return null;
  if (rest.length !== 1) return null;

  const suit = SUIT_LOOKUP.get(rest.toLowerCase()) ?? SUIT_LOOKUP.get(rest);
  if (suit === undefined) return null;

  return makeCard(rank, suit);
}

// 連続したカード列をパースする。'AsKsQhJh' や 'As Ks Qh Jh' を受理。
// 戻り値 { cards, error }。重複や不正があれば error を設定。
export function parseCards(str) {
  if (!str) return { cards: [], error: null };
  const compact = normalizeInput(String(str)).replace(/\s+/g, '');
  const cards = [];
  let i = 0;
  while (i < compact.length) {
    let token;
    if (compact[i] === '1' && compact[i + 1] === '0') {
      token = compact.slice(i, i + 3);
      i += 3;
    } else {
      token = compact.slice(i, i + 2);
      i += 2;
    }
    const id = parseCard(token);
    if (id === null) {
      return { cards: [], error: `カードを解釈できません: "${token}"` };
    }
    cards.push(id);
  }
  const seen = new Set();
  for (const c of cards) {
    if (seen.has(c)) {
      return { cards: [], error: `カードが重複しています: ${cardToString(c)}` };
    }
    seen.add(c);
  }
  return { cards, error: null };
}

export function cardToString(id) {
  return RANK_CHARS[rankOf(id)] + SUIT_SYMBOLS[suitOf(id)];
}

export function cardToCode(id) {
  return RANK_CHARS[rankOf(id)] + SUIT_CHARS[suitOf(id)];
}

export function cardsToString(ids) {
  return ids.map(cardToString).join(' ');
}

// 52枚すべてのデッキ
export function fullDeck() {
  const deck = new Array(NUM_CARDS);
  for (let i = 0; i < NUM_CARDS; i++) deck[i] = i;
  return deck;
}

// 指定カードを除いた残りデッキを返す
export function remainingDeck(deadIds) {
  const dead = new Uint8Array(NUM_CARDS);
  for (const c of deadIds) dead[c] = 1;
  const out = [];
  for (let i = 0; i < NUM_CARDS; i++) if (!dead[i]) out.push(i);
  return out;
}
