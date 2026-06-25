// range.js — PLO レンジ記法のパースと展開。
//
// 対応する記法（カンマ区切りで和集合）：
//   - 具体的な4枚:           As Ks Qh Jh / AsKsQhJh
//   - ランクのみ（任意スート）: AKQJ  → A,K,Q,J を各1枚
//   - ワイルドカード:         * または x（指定ランク以外の任意の1枚）
//       例) AA**  = エースちょうど2枚＋それ以外2枚（= 6768通り）
//   - ブロードウェイ:         B（T,J,Q,K,A のいずれか1枚）
//       例) BBBB = ブロードウェイ4枚 / BBB9 = ブロードウェイ3枚＋9
//   - 4枚に満たない指定は末尾を * で自動補完（AA → AA**）
//
// 展開は「候補となる相異なる4枚の組」を生成し、各スロットへ
// 重複なく割り当てられるか（完全マッチング）で判定する。これにより
// 重複カウントが起きず、ProPokerTools の組数（AA**=6768 等）と一致する。

import { parseCard, rankOf, RANK_CHARS, normalizeInput } from './cards.js';

const BROADWAY_RANKS = [8, 9, 10, 11, 12]; // T,J,Q,K,A
const SUIT_SET = new Set(['c', 'd', 'h', 's', '♣', '♦', '♥', '♠', 'C', 'D', 'H', 'S']);
const RANK_INDEX = new Map(RANK_CHARS.map((ch, i) => [ch, i]));

// 1つの項（カンマで区切られた1要素）をスロット列に分解する。
// 戻り値 { slots, error }。slots は最大4個。
function tokenizeTerm(term) {
  const s = term.replace(/\s+/g, '');
  const slots = [];
  let i = 0;
  while (i < s.length) {
    let rankCh;
    if (s[i] === '1' && s[i + 1] === '0') {
      rankCh = 'T';
      i += 2;
    } else {
      rankCh = s[i];
      i += 1;
    }

    const upper = rankCh.toUpperCase();
    if (RANK_INDEX.has(upper)) {
      // 具体ランク。直後がスートなら具体カード。
      const rank = RANK_INDEX.get(upper);
      if (i < s.length && SUIT_SET.has(s[i])) {
        const card = parseCard(upper + s[i]);
        if (card === null) return { slots: [], error: `カードを解釈できません: "${upper}${s[i]}"` };
        slots.push({ kind: 'card', id: card });
        i += 1;
      } else {
        slots.push({ kind: 'rank', rank });
      }
    } else if (upper === 'B') {
      slots.push({ kind: 'class', ranks: BROADWAY_RANKS });
    } else if (upper === 'X' || rankCh === '*') {
      slots.push({ kind: 'wild' });
    } else {
      return { slots: [], error: `記号を解釈できません: "${rankCh}"` };
    }

    if (slots.length > 4) return { slots: [], error: `1つのハンドは4枚までです: "${term}"` };
  }

  if (slots.length === 0) return { slots: [], error: `空のハンド指定です` };
  // 4枚に満たなければワイルドカードで補完
  while (slots.length < 4) slots.push({ kind: 'wild' });
  return { slots, error: null };
}

// スロットが特定カードを許可するか。wild の除外ランクは後から渡す。
function slotAllows(slot, cardId, excludeRanks) {
  switch (slot.kind) {
    case 'card': return slot.id === cardId;
    case 'rank': return rankOf(cardId) === slot.rank;
    case 'class': return slot.ranks.includes(rankOf(cardId));
    case 'wild': return !excludeRanks.has(rankOf(cardId));
    default: return false;
  }
}

// 1つの項あたりの展開上限（巨大レンジによるフリーズ・大量メモリを防ぐ）。
// 現実的なPLOレンジ（AA**=6768, BBBB=4845, 大ペア和≈3万 等）は十分下回る。
const MAX_COMBOS_PER_TERM = 120000;

// 1つの項を、相異なる4枚の組（昇順ID配列）の配列へ展開する。
// 「制約スロットへ昇順割当（同一制約は増加順で対称性を除去）」する構成的列挙で、
// 不要な候補をほぼ生成せず高速。重複（異なる制約スロット間の被り）は parseRange 側で排除される。
function expandTerm(term) {
  const { slots, error } = tokenizeTerm(term);
  if (error) return { combos: [], error };

  // 具体カードの重複は、4枚未満でも早期に弾く（ワイルド補完で見逃さない）
  const cardIds = slots.filter((s) => s.kind === 'card').map((s) => s.id);
  if (new Set(cardIds).size !== cardIds.length) {
    return { combos: [], error: `カードが重複しています: "${term}"` };
  }

  // wild が除外するランク = 具体的に名指しされたランク（card/rank スロット）
  const excludeRanks = new Set();
  for (const slot of slots) {
    if (slot.kind === 'card') excludeRanks.add(rankOf(slot.id));
    else if (slot.kind === 'rank') excludeRanks.add(slot.rank);
  }

  // 各スロットが許可するカード一覧（昇順）
  const allowed = slots.map((slot) => {
    const arr = [];
    for (let c = 0; c < 52; c++) if (slotAllows(slot, c, excludeRanks)) arr.push(c);
    return arr;
  });
  if (allowed.some((a) => a.length === 0)) {
    return { combos: [], error: `ハンドを解釈できません: "${term}"` };
  }

  // 同一制約スロットを隣接させ、対称性除去（同一シグネチャは増加順）を効かせる
  const sig = allowed.map((a) => a.join(','));
  const order = slots.map((_, i) => i).sort((i, j) => (sig[i] < sig[j] ? -1 : sig[i] > sig[j] ? 1 : 0));
  const sAllowed = order.map((i) => allowed[i]);
  const sSig = order.map((i) => sig[i]);

  const combos = [];
  const used = new Uint8Array(52);
  const pick = [0, 0, 0, 0];
  let overflow = false;

  function bt(si, prevIdx) {
    if (overflow) return;
    if (si === 4) {
      const combo = [pick[0], pick[1], pick[2], pick[3]].sort((a, b) => a - b);
      combos.push(combo);
      if (combos.length > MAX_COMBOS_PER_TERM) overflow = true;
      return;
    }
    const arr = sAllowed[si];
    const sameAsPrev = si > 0 && sSig[si] === sSig[si - 1];
    const start = sameAsPrev ? prevIdx + 1 : 0;
    for (let k = start; k < arr.length; k++) {
      const c = arr[k];
      if (used[c]) continue;
      used[c] = 1;
      pick[si] = c;
      bt(si + 1, k);
      used[c] = 0;
      if (overflow) return;
    }
  }
  bt(0, -1);

  if (overflow) {
    return { combos: [], error: `レンジが広すぎます。条件を絞ってください: "${term}"` };
  }
  return { combos, error: null };
}

// レンジ文字列全体をパースして展開する。
// 戻り値 { combos, size, error }。combos は重複排除済みの 4枚組配列。
export function parseRange(text) {
  if (!text || !text.trim()) return { combos: [], size: 0, error: 'レンジが空です' };

  const normalized = normalizeInput(text);
  const terms = normalized.split(/[,\n;]+/).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return { combos: [], size: 0, error: 'レンジが空です' };

  const seen = new Set();
  const combos = [];
  for (const term of terms) {
    const { combos: termCombos, error } = expandTerm(term);
    if (error) return { combos: [], size: 0, error };
    for (const combo of termCombos) {
      const key = combo[0] * 140608 + combo[1] * 2704 + combo[2] * 52 + combo[3];
      if (!seen.has(key)) {
        seen.add(key);
        combos.push(combo);
      }
    }
  }
  return { combos, size: combos.length, error: null };
}
