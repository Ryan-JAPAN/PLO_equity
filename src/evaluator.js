// evaluator.js — 5枚ハンドの評価と、オマハ式ベストハンド選択。
// eval5 は 5枚から「強さを表す整数」を返す（大きいほど強い）。
// 役の比較は返り値の数値比較だけで完結する。

import { rankOf, suitOf } from './cards.js';

// オマハ：手札4枚から必ず2枚、ボード5枚から必ず3枚を使う。
// その2枚×3枚の組み合わせは 6 × 10 = 60 通り。
export const HOLE_PAIRS = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
export const BOARD_TRIPLES = [
  [0, 1, 2], [0, 1, 3], [0, 1, 4], [0, 2, 3], [0, 2, 4],
  [0, 3, 4], [1, 2, 3], [1, 2, 4], [1, 3, 4], [2, 3, 4],
];

// 役カテゴリ（大きいほど強い）
export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

// 評価のたびに再利用するスクラッチ領域（割り当てを避けて高速化）。
// JS は単一スレッドなので各 eval5 呼び出し内で完結する限り安全。
const _rankCount = new Int8Array(13);
const _suitCount = new Int8Array(4);

// 5枚の存在ランクのビットマスクから、ストレートの最高ランクを返す。
// 役なしは -1。A-2-3-4-5（ホイール）は high=3（=5）として扱う。
function straightHigh(mask) {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4); // hi を最上位とする連続5ビット
    if ((mask & need) === need) return hi;
  }
  const wheel = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | 1; // A,5,4,3,2
  if ((mask & wheel) === wheel) return 3;
  return -1;
}

// 5枚（カードID）から強さを表す整数を返す。
export function eval5(c1, c2, c3, c4, c5) {
  _rankCount.fill(0);
  _suitCount.fill(0);

  let r;
  r = c1 >> 2; _rankCount[r]++; _suitCount[c1 & 3]++;
  r = c2 >> 2; _rankCount[r]++; _suitCount[c2 & 3]++;
  r = c3 >> 2; _rankCount[r]++; _suitCount[c3 & 3]++;
  r = c4 >> 2; _rankCount[r]++; _suitCount[c4 & 3]++;
  r = c5 >> 2; _rankCount[r]++; _suitCount[c5 & 3]++;

  let mask = 0;
  for (let i = 0; i < 13; i++) if (_rankCount[i]) mask |= 1 << i;

  const flush = _suitCount[0] === 5 || _suitCount[1] === 5 || _suitCount[2] === 5 || _suitCount[3] === 5;
  const sh = straightHigh(mask);

  // カウント別にランクを高→低で集める
  const c4s = [];
  const c3s = [];
  const c2s = [];
  const c1s = [];
  for (let i = 12; i >= 0; i--) {
    const c = _rankCount[i];
    if (c === 4) c4s.push(i);
    else if (c === 3) c3s.push(i);
    else if (c === 2) c2s.push(i);
    else if (c === 1) c1s.push(i);
  }

  let cat;
  let tb;
  if (sh >= 0 && flush) {
    cat = CATEGORY.STRAIGHT_FLUSH;
    tb = [sh];
  } else if (c4s.length) {
    cat = CATEGORY.QUADS;
    // 5枚評価では残り1枚は必ず単独ランク（c1s[0]）。c3s[0] は到達しないが将来の安全弁。
    tb = [c4s[0], c1s.length ? c1s[0] : c3s[0]];
  } else if (c3s.length && c2s.length) {
    cat = CATEGORY.FULL_HOUSE;
    tb = [c3s[0], c2s[0]];
  } else if (flush) {
    cat = CATEGORY.FLUSH;
    tb = c1s; // 5枚すべて別ランク
  } else if (sh >= 0) {
    cat = CATEGORY.STRAIGHT;
    tb = [sh];
  } else if (c3s.length) {
    cat = CATEGORY.TRIPS;
    tb = [c3s[0], c1s[0], c1s[1]];
  } else if (c2s.length >= 2) {
    cat = CATEGORY.TWO_PAIR;
    tb = [c2s[0], c2s[1], c1s[0]];
  } else if (c2s.length === 1) {
    cat = CATEGORY.PAIR;
    tb = [c2s[0], c1s[0], c1s[1], c1s[2]];
  } else {
    cat = CATEGORY.HIGH_CARD;
    tb = c1s;
  }

  // cat(4bit) + タイブレーク5ニブル → 24bit 整数に詰める
  let score = cat;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (tb[i] !== undefined ? tb[i] + 1 : 0);
  }
  return score;
}

// 手札4枚 + ボード5枚 から、オマハ式のベスト（最大 eval5）を返す。
export function evalOmaha(hole, board) {
  const h0 = hole[0], h1 = hole[1], h2 = hole[2], h3 = hole[3];
  const b0 = board[0], b1 = board[1], b2 = board[2], b3 = board[3], b4 = board[4];
  let best = -1;
  for (let p = 0; p < 6; p++) {
    const hp = HOLE_PAIRS[p];
    const x = hole[hp[0]];
    const y = hole[hp[1]];
    for (let t = 0; t < 10; t++) {
      const bt = BOARD_TRIPLES[t];
      const s = eval5(x, y, board[bt[0]], board[bt[1]], board[bt[2]]);
      if (s > best) best = s;
    }
  }
  return best;
}

// 役カテゴリの日本語名（デバッグ/補足表示用）
export function categoryName(score) {
  const cat = Math.floor(score / 16 ** 5);
  return [
    'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
    'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ',
  ][cat];
}

// 未使用の import を黙らせない（rankOf/suitOf はビット演算で直接処理しているため）
void rankOf; void suitOf;
