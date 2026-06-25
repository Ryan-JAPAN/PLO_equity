// app.js — エントリポイント。UIとワーカーを接続する。

import {
  createUI, setRangeMeta, showProgress, showCalcResult, showDistResult, showError,
} from './ui.js';

// 精度プリセット → 試行回数 / 計算予算
const ACCURACY_MAP = {
  fast: { trials: 60000, budget: 250000 },
  normal: { trials: 200000, budget: 700000 },
  accurate: { trials: 600000, budget: 1800000 },
};
// ワーカー非対応環境（フォールバック）ではメインスレッドを長時間止めないよう軽くする
const FALLBACK_ACCURACY = { trials: 40000, budget: 200000 };

let worker = null;
let workerOk = false;
let reqId = 0;
let activeReq = 0;        // calc/dist 用。run() のみが更新する
let activeRangeReq = 0;   // レンジ件数用。rangeCount() のみが更新する
let lastRunTab = 'calc';
let lastRunLabels = { heroLabel: '', villainLabel: '' };

function initWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = onWorkerError;
    workerOk = true;
  } catch {
    workerOk = false; // file:// 等でワーカーが使えない場合はフォールバック
  }
}

function onWorkerError() {
  // ワーカーで致命的エラー（import失敗・トップレベル例外等）。UIを必ず復帰させる。
  workerOk = false;
  showProgress(false);
  showError(lastRunTab, '計算エンジンでエラーが発生しました。もう一度お試しください。');
}

function onWorkerMessage(e) {
  const msg = e.data;

  // レンジ件数は計算リクエストとは独立に扱う（activeReq を汚さない）
  if (msg.type === 'range') {
    if (msg.id === activeRangeReq) setRangeMeta(msg.size, msg.error);
    return;
  }

  // calc / dist / progress は最新の計算リクエストのものだけ反映
  if (msg.id !== activeReq) return;

  if (msg.type === 'progress') {
    showProgress(true, msg.p);
    return;
  }
  if (msg.type === 'calc') {
    showProgress(false);
    if (msg.error) showError('calc', msg.error);
    else showCalcResult(msg.result);
    return;
  }
  if (msg.type === 'dist') {
    showProgress(false);
    if (msg.error) showError('dist', msg.error);
    else showDistResult(msg.result, lastRunLabels);
  }
}

// ワーカーが無い環境向けのフォールバック（メインスレッドで実行）。
// 古いリクエストの結果を表示しないよう capturedReq でガードする。
async function runFallback(kind, payload, capturedReq, labels) {
  const range = await import('./range.js');
  const equity = await import('./equity.js');
  const { combos, error } = range.parseRange(payload.villainText);
  if (capturedReq !== activeReq) return;
  if (error) { showProgress(false); showError(payload.tab, error); return; }

  // 無効化済みボタンを描画させるため一度イベントループに戻す
  await new Promise((r) => setTimeout(r, 16));
  if (capturedReq !== activeReq) return;

  if (kind === 'calc') {
    const result = equity.monteCarloEquity(payload.hero, payload.board, combos, {
      trials: FALLBACK_ACCURACY.trials, seed: payload.seed,
    });
    if (capturedReq !== activeReq) return;
    showProgress(false);
    if (result.error) showError('calc', result.error); else showCalcResult(result);
  } else {
    const result = equity.equityDistribution(payload.hero, payload.board, combos, {
      budget: FALLBACK_ACCURACY.budget, seed: payload.seed,
    });
    if (capturedReq !== activeReq) return;
    showProgress(false);
    if (result.error) showError('dist', result.error); else showDistResult(result, labels);
  }
}

function rangeCount(text) {
  activeRangeReq = ++reqId;
  if (worker && workerOk) {
    worker.postMessage({ type: 'range', id: activeRangeReq, text });
    return;
  }
  const captured = activeRangeReq;
  import('./range.js').then((m) => {
    if (captured !== activeRangeReq) return;
    const { size, error } = m.parseRange(text);
    setRangeMeta(size, error);
  });
}

function run(s) {
  const acc = ACCURACY_MAP[s.accuracy] || ACCURACY_MAP.normal;
  lastRunLabels = { heroLabel: s.heroLabel, villainLabel: s.villainLabel };
  lastRunTab = s.tab;
  showProgress(true, 0);
  activeReq = ++reqId;
  const capturedReq = activeReq;
  const seed = 1234567;

  if (s.tab === 'calc') {
    const payload = { type: 'calc', id: capturedReq, hero: s.hero, board: s.board, villainText: s.rangeText, trials: acc.trials, seed };
    if (worker && workerOk) worker.postMessage(payload);
    else runFallback('calc', { ...payload, tab: 'calc' }, capturedReq, lastRunLabels);
  } else {
    // 分布も計算タブと同じ完全なボード（フロップ＋任意のターン）を使う
    const payload = { type: 'dist', id: capturedReq, hero: s.hero, board: s.board, villainText: s.rangeText, budget: acc.budget, seed };
    if (worker && workerOk) worker.postMessage(payload);
    else runFallback('dist', { ...payload, tab: 'dist' }, capturedReq, lastRunLabels);
  }
}

initWorker();
createUI({
  onRangeTextChanged: rangeCount,
  onRun: run,
});

// PWA: オフライン用サービスワーカー（任意・対応環境のみ）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => { /* 任意機能 */ });
  });
}
