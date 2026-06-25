// worker.js — 重い計算（レンジ展開・モンテカルロ・分布）をUIスレッドから分離する。
// モジュールワーカーとして起動（app.js から { type:'module' } で生成）。

import { parseRange } from './range.js';
import { monteCarloEquity, equityDistribution } from './equity.js';

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'range') {
      const { size, error } = parseRange(msg.text);
      self.postMessage({ type: 'range', id: msg.id, size, error });
      return;
    }

    if (msg.type === 'calc') {
      const { combos, error } = parseRange(msg.villainText);
      if (error) { self.postMessage({ type: 'calc', id: msg.id, error }); return; }
      const result = monteCarloEquity(msg.hero, msg.board, combos, {
        trials: msg.trials,
        seed: msg.seed,
        onProgress: (p) => self.postMessage({ type: 'progress', id: msg.id, p }),
      });
      self.postMessage({ type: 'calc', id: msg.id, result });
      return;
    }

    if (msg.type === 'dist') {
      const { combos, error } = parseRange(msg.villainText);
      if (error) { self.postMessage({ type: 'dist', id: msg.id, error }); return; }
      const result = equityDistribution(msg.hero, msg.board, combos, {
        budget: msg.budget,
        seed: msg.seed,
        onProgress: (p) => self.postMessage({ type: 'progress', id: msg.id, p }),
      });
      // top50 / avgEquity は equityDistribution が重み付きで算出済み
      self.postMessage({ type: 'dist', id: msg.id, result });
      return;
    }
  } catch (err) {
    self.postMessage({ type: msg.type, id: msg.id, error: String((err && err.message) || err) });
  }
};
