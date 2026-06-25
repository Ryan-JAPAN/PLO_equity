// equity.js — エクイティ計算（モンテカルロ）と、ランナウトごとのエクイティ分布。
// フロップ起点（ボード3枚）を主対象とするが、4枚（ターン）・5枚（リバー）にも対応。

import { evalOmaha } from './evaluator.js';
import { NUM_CARDS } from './cards.js';

// 再現性のある擬似乱数（mulberry32）。シードを与えればテストで決定的になる。
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 配列から「死にカード」マスクを作る
function deadMask(ids) {
  const m = new Uint8Array(NUM_CARDS);
  for (const c of ids) m[c] = 1;
  return m;
}

// 相手レンジから、現在の死にカードと衝突しない組だけを残す
function filterValidCombos(combos, dead) {
  const out = [];
  for (const v of combos) {
    if (!dead[v[0]] && !dead[v[1]] && !dead[v[2]] && !dead[v[3]]) out.push(v);
  }
  return out;
}

// ===== モンテカルロによる総合エクイティ =====
// hero: 4枚, board: 3〜5枚, villainCombos: 4枚組の配列（相手レンジ）。
// 各試行で「相手の組を一様抽出 → 残りデッキからランナウトを配る」。
// ProPokerTools のランダムシミュレーションと同じ手順。
export function monteCarloEquity(hero, board, villainCombos, opts = {}) {
  if (!Array.isArray(hero) || hero.length !== 4) {
    return { win: 0, tie: 0, loss: 0, equity: 0, trials: 0, error: '自分のハンドは4枚必要です' };
  }
  if (!Array.isArray(board) || board.length < 3 || board.length > 5) {
    return { win: 0, tie: 0, loss: 0, equity: 0, trials: 0, error: 'ボードは3〜5枚で指定してください' };
  }
  const trials = opts.trials ?? 200000;
  const rng = opts.rng ?? makeRng(opts.seed ?? 12345);

  const baseDead = deadMask([...hero, ...board]);
  const validVillain = filterValidCombos(villainCombos, baseDead);
  if (validVillain.length === 0) {
    return { win: 0, tie: 0, loss: 0, equity: 0, trials: 0, error: '相手レンジに有効な組がありません（ボード/自分の手と全て衝突）' };
  }

  const need = 5 - board.length; // 追加で配るカード数
  const fullBoard = board.slice();
  for (let k = 0; k < need; k++) fullBoard.push(0);

  let win = 0;
  let tie = 0;
  const dead = new Uint8Array(NUM_CARDS);

  let done = 0;
  for (let t = 0; t < trials; t++) {
    const villain = validVillain[(rng() * validVillain.length) | 0];

    // 死にカード = 自分 + ボード + 相手
    dead.set(baseDead);
    dead[villain[0]] = 1; dead[villain[1]] = 1; dead[villain[2]] = 1; dead[villain[3]] = 1;

    // ランナウトを配る（重複しないよう拒否サンプリング）
    for (let k = 0; k < need; k++) {
      let card;
      do {
        card = (rng() * NUM_CARDS) | 0;
      } while (dead[card]);
      dead[card] = 1;
      fullBoard[board.length + k] = card;
    }

    const hs = evalOmaha(hero, fullBoard);
    const vs = evalOmaha(villain, fullBoard);
    if (hs > vs) win++;
    else if (hs === vs) tie++;

    done++;
    if (opts.onProgress && (t & 8191) === 8191) opts.onProgress(done / trials);
  }

  const loss = done - win - tie;
  const equity = (win + tie * 0.5) / done;
  return {
    win: win / done,
    tie: tie / done,
    loss: loss / done,
    equity,
    trials: done,
    villainCombos: validVillain.length,
    error: null,
  };
}

// ===== ランナウトごとのエクイティ分布（フロップ起点） =====
// 各ランナウト（ターン+リバー）を1点とし、その盤面での
// 「自分の手の相手レンジに対するエクイティ」を求め、降順に並べて曲線にする。
//
// 各ランナウト R は「その盤面と矛盾しない相手の組数 w_R」で重み付けする。
// これにより曲線下の面積（重み付き平均）が、計算機タブの総合エクイティと一致し、
// 書籍の「面積＝総合エクイティ」という読み方とも整合する。
// 相手レンジが大きい場合は1ランナウトあたり一定数をサンプリングして高速化する。
export function equityDistribution(hero, flop, villainCombos, opts = {}) {
  if (!Array.isArray(hero) || hero.length !== 4) {
    return { points: [], weights: [], error: '自分のハンドは4枚必要です' };
  }
  if (!Array.isArray(flop) || flop.length < 3 || flop.length > 5) {
    return { points: [], weights: [], error: 'ボードは3〜5枚で指定してください' };
  }
  const rng = opts.rng ?? makeRng(opts.seed ?? 6789);
  const baseDead = deadMask([...hero, ...flop]);
  const validVillain = filterValidCombos(villainCombos, baseDead);
  if (validVillain.length === 0) {
    return { points: [], weights: [], error: '相手レンジに有効な組がありません' };
  }

  // 相手レンジに各カードが現れる回数 / 2枚同時に現れる回数を前計算（重み w_R 用）
  const total = validVillain.length;
  const containCount = new Uint32Array(NUM_CARDS);
  const pairCount = new Map();
  for (const v of validVillain) {
    containCount[v[0]]++; containCount[v[1]]++; containCount[v[2]]++; containCount[v[3]]++;
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        const key = v[a] * NUM_CARDS + v[b]; // 組は昇順ソート済みなので v[a] < v[b]
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
  }

  // 残りデッキ
  const deck = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!baseDead[c]) deck.push(c);

  const need = 5 - flop.length; // 通常2（フロップ→ターン+リバー）
  const fullBoard = flop.slice();
  for (let k = 0; k < need; k++) fullBoard.push(0);

  // ランナウト列挙
  const runouts = [];
  if (need === 2) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) runouts.push([deck[i], deck[j]]);
    }
  } else if (need === 1) {
    for (let i = 0; i < deck.length; i++) runouts.push([deck[i]]);
  } else {
    runouts.push([]); // ボードが既に5枚
  }

  function weightOf(run) {
    if (need === 2) {
      const t = run[0]; const r = run[1]; // deck 走査順により t < r
      const both = pairCount.get(t * NUM_CARDS + r) || 0;
      return total - containCount[t] - containCount[r] + both;
    }
    if (need === 1) return total - containCount[run[0]];
    return total;
  }

  // 1ランナウトあたりに評価する相手の組数（サンプリング上限）
  const budget = opts.budget ?? 800000;
  const perRunout = Math.max(1, Math.min(total, Math.floor(budget / runouts.length)));
  const sampleVillain = perRunout < total;

  const eqArr = new Float64Array(runouts.length);
  const wArr = new Float64Array(runouts.length);
  let count = 0;

  for (let ri = 0; ri < runouts.length; ri++) {
    const run = runouts[ri];
    for (let k = 0; k < need; k++) fullBoard[flop.length + k] = run[k];

    const hs = evalOmaha(hero, fullBoard);

    let wins = 0;
    let ties = 0;
    let tot = 0;

    if (sampleVillain) {
      for (let s = 0; s < perRunout; s++) {
        const v = validVillain[(rng() * total) | 0];
        if (conflicts(v, run, need)) continue;
        const vs = evalOmaha(v, fullBoard);
        if (hs > vs) wins++;
        else if (hs === vs) ties++;
        tot++;
      }
    } else {
      for (let vi = 0; vi < total; vi++) {
        const v = validVillain[vi];
        if (conflicts(v, run, need)) continue;
        const vs = evalOmaha(v, fullBoard);
        if (hs > vs) wins++;
        else if (hs === vs) ties++;
        tot++;
      }
    }

    if (tot > 0) {
      eqArr[count] = (wins + ties * 0.5) / tot;
      wArr[count] = weightOf(run);
      count++;
    }

    if (opts.onProgress && (ri & 63) === 63) opts.onProgress(ri / runouts.length);
  }

  // エクイティ降順でソート（重みも一緒に並べ替える）
  const order = Array.from({ length: count }, (_, i) => i);
  order.sort((a, b) => eqArr[b] - eqArr[a]);
  const points = new Array(count);
  const weights = new Array(count);
  let totalW = 0;
  let weighted = 0;
  let w50 = 0;
  for (let i = 0; i < count; i++) {
    const idx = order[i];
    points[i] = eqArr[idx];
    weights[i] = wArr[idx];
    totalW += wArr[idx];
    weighted += wArr[idx] * eqArr[idx];
    if (eqArr[idx] >= 0.5) w50 += wArr[idx];
  }

  const avgEquity = totalW > 0 ? weighted / totalW : 0;
  const top50 = totalW > 0 ? w50 / totalW : 0;

  return {
    points,
    weights,
    avgEquity,
    top50,
    runouts: count,
    villainCombos: total,
    sampledPerRunout: sampleVillain ? perRunout : total,
    sampled: sampleVillain,
    error: null,
  };
}

function conflicts(v, run, need) {
  for (let k = 0; k < need; k++) {
    const r = run[k];
    if (v[0] === r || v[1] === r || v[2] === r || v[3] === r) return true;
  }
  return false;
}

// 分布の補助量：上位 x%（0..1）のランナウトにおける平均エクイティ。
// points は降順ソート済み。
export function averageOfTop(points, fraction) {
  if (!points.length) return 0;
  const n = Math.max(1, Math.round(points.length * fraction));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += points[i];
  return sum / n;
}

// エクイティ閾値 thr（0..1）以上となるランナウトの割合（0..1）を返す。
export function fractionAtLeast(points, thr) {
  // points 降順。二分探索で閾値位置を求める。
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] >= thr) lo = mid + 1;
    else hi = mid;
  }
  return points.length ? lo / points.length : 0;
}
