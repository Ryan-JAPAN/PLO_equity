// chart.js — 結果の可視化。
//  - drawEquityBar:   勝ち/分け/負けの積み上げバー（計算タブ）
//  - drawDistribution: ランナウトごとのエクイティ分布曲線（分布タブ）
// SVG は viewBox でスケールさせ、モバイルでも鮮明に表示する。

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

// ===== 勝ち/分け/負け バー =====
export function drawEquityBar(container, r) {
  container.innerHTML = '';

  const eqBig = document.createElement('div');
  eqBig.className = 'eq-headline';
  eqBig.innerHTML = `<span class="eq-num">${(r.equity * 100).toFixed(1)}</span><span class="eq-unit">% エクイティ</span>`;
  container.appendChild(eqBig);

  const bar = document.createElement('div');
  bar.className = 'eq-bar';
  const win = document.createElement('div');
  win.className = 'seg win';
  win.style.width = pct(r.win);
  const tie = document.createElement('div');
  tie.className = 'seg tie';
  tie.style.width = pct(r.tie);
  const loss = document.createElement('div');
  loss.className = 'seg loss';
  loss.style.width = pct(r.loss);
  bar.append(win, tie, loss);
  container.appendChild(bar);

  const legend = document.createElement('div');
  legend.className = 'eq-legend';
  legend.innerHTML = `
    <span><i class="dot win"></i>勝ち ${pct(r.win)}</span>
    <span><i class="dot tie"></i>分け ${pct(r.tie)}</span>
    <span><i class="dot loss"></i>負け ${pct(r.loss)}</span>`;
  container.appendChild(legend);

  const meta = document.createElement('p');
  meta.className = 'result-note';
  meta.textContent = `相手レンジ ${r.villainCombos.toLocaleString()} 通り / ${r.trials.toLocaleString()} 回シミュレーション`;
  container.appendChild(meta);
}

// ===== エクイティ分布曲線 =====
// data: { points(降順), weights(各点の確率重み), avgEquity, runouts, villainCombos, sampled, top50 }
export function drawDistribution(container, data, heroLabel, villainLabel) {
  container.innerHTML = '';
  const pts = data.points;
  const n = pts.length;
  if (n === 0) {
    container.innerHTML = '<p class="result-note">表示できる分布がありません。</p>';
    return;
  }

  // 各点の x 位置（累積重みの右端 0..1）と、上位平均算出用の前方累積和を作る
  const weights = data.weights && data.weights.length === n ? data.weights : pts.map(() => 1);
  let totalW = 0;
  for (const w of weights) totalW += w;
  const xRight = new Float64Array(n);   // 点 i の右端の累積割合
  const xMid = new Float64Array(n);     // 点 i の中央の累積割合（プロット用）
  const cumWE = new Float64Array(n);    // Σ w*eq（前方）
  const cumW = new Float64Array(n);     // Σ w（前方）
  let acc = 0; let accWE = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i];
    xMid[i] = (acc + w / 2) / totalW;
    acc += w;
    xRight[i] = acc / totalW;
    accWE += w * pts[i];
    cumWE[i] = accWE;
    cumW[i] = acc;
  }

  const W = 1000;
  const H = 680;
  const L = 96;
  const R = 24;
  const T = 56;
  const B = 84;
  const plotW = W - L - R;
  const plotH = H - T - B;

  const X = (frac) => L + frac * plotW;          // frac: 0..1（ランナウト割合）
  const Y = (eq) => T + (1 - eq) * plotH;        // eq: 0..1（エクイティ）

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'dist-svg',
    role: 'img',
    'aria-label': `エクイティ分布グラフ（平均 ${(data.avgEquity * 100).toFixed(1)}%）`,
  });
  container.appendChild(svg);

  // グリッド & 軸目盛り
  for (let i = 0; i <= 10; i++) {
    const gy = Y(i / 10);
    el('line', { x1: L, y1: gy, x2: W - R, y2: gy, class: 'grid' }, svg);
    el('text', { x: L - 14, y: gy + 6, class: 'tick y', 'text-anchor': 'end' }, svg).textContent = `${i * 10}`;
    const gx = X(i / 10);
    el('line', { x1: gx, y1: T, x2: gx, y2: H - B, class: 'grid' }, svg);
    el('text', { x: gx, y: H - B + 32, class: 'tick x', 'text-anchor': 'middle' }, svg).textContent = `${i * 10}`;
  }

  // 軸ラベル
  el('text', { x: L + plotW / 2, y: H - 18, class: 'axis-label', 'text-anchor': 'middle' }, svg)
    .textContent = 'ランナウトの割合（%）';
  const yl = el('text', { x: 24, y: T + plotH / 2, class: 'axis-label', 'text-anchor': 'middle',
    transform: `rotate(-90 24 ${T + plotH / 2})` }, svg);
  yl.textContent = '最低エクイティ（%）';

  // 曲線とその下の面積（x は累積重み、両端を 0 と 1 に固定して全幅に描く）
  let dCurve = `M${X(0).toFixed(2)} ${Y(pts[0]).toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    dCurve += `L${X(xMid[i]).toFixed(2)} ${Y(pts[i]).toFixed(2)} `;
  }
  dCurve += `L${X(1).toFixed(2)} ${Y(pts[n - 1]).toFixed(2)} `;
  const dArea = `${dCurve}L${X(1).toFixed(2)} ${Y(0)} L${X(0).toFixed(2)} ${Y(0)} Z`;
  el('path', { d: dArea, class: 'dist-area' }, svg);
  el('path', { d: dCurve, class: 'dist-curve' }, svg);

  // 平均エクイティ（面積）の水平線
  const avgY = Y(data.avgEquity);
  el('line', { x1: L, y1: avgY, x2: W - R, y2: avgY, class: 'avg-line' }, svg);
  el('text', { x: W - R - 8, y: avgY - 10, class: 'avg-label', 'text-anchor': 'end' }, svg)
    .textContent = `平均 ${(data.avgEquity * 100).toFixed(1)}%`;

  // エクイティ50%以上となる上位割合（書籍の主要な読み方）
  if (data.top50 > 0 && data.top50 < 1) {
    const tx = X(data.top50);
    el('line', { x1: tx, y1: T, x2: tx, y2: H - B, class: 'mark-line' }, svg);
    el('text', { x: tx + 8, y: T + 22, class: 'mark-label', 'text-anchor': 'start' }, svg)
      .textContent = `上位 ${(data.top50 * 100).toFixed(0)}% が ≥50%`;
  }

  // タイトル（長い相手レンジ名は省略してはみ出しを防ぐ）
  const clip = (s, max) => (s && s.length > max ? `${s.slice(0, max - 1)}…` : s);
  el('text', { x: L, y: 32, class: 'dist-title', 'text-anchor': 'start' }, svg)
    .textContent = `${clip(heroLabel, 14)}  vs  ${clip(villainLabel, 22)}`;

  // インタラクション用カーソル
  const cursor = el('g', { class: 'cursor', visibility: 'hidden' }, svg);
  const cLine = el('line', { y1: T, y2: H - B, class: 'cursor-line' }, cursor);
  const cDot = el('circle', { r: 7, class: 'cursor-dot' }, cursor);

  const readout = document.createElement('div');
  readout.className = 'dist-readout';
  readout.innerHTML = defaultReadout(data);
  container.appendChild(readout);

  const overlay = el('rect', { x: L, y: T, width: plotW, height: plotH, fill: 'transparent', class: 'overlay' }, svg);

  // 累積割合 frac（0..1）を覆う最初の点を二分探索
  function pointAtFrac(frac) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xRight[mid] >= frac) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  function moveTo(clientX) {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return; // 非表示タブ等でレイアウト幅が0のときの0除算を防ぐ
    const xUser = ((clientX - rect.left) / rect.width) * W;
    let frac = (xUser - L) / plotW;
    frac = Math.max(0, Math.min(1, frac));
    const idx = pointAtFrac(frac);
    const eq = pts[idx];
    const cx = X(frac);
    cursor.setAttribute('visibility', 'visible');
    cLine.setAttribute('x1', cx);
    cLine.setAttribute('x2', cx);
    cDot.setAttribute('cx', cx);
    cDot.setAttribute('cy', Y(eq));
    const topFrac = xRight[idx];
    const avgTop = cumW[idx] > 0 ? cumWE[idx] / cumW[idx] : eq;
    readout.innerHTML =
      `<b>上位 ${(topFrac * 100).toFixed(0)}%</b> のランナウト：` +
      `最低エクイティ <b>${(eq * 100).toFixed(1)}%</b>` +
      ` ／ その上位平均 <b>${(avgTop * 100).toFixed(1)}%</b>`;
  }

  overlay.addEventListener('pointermove', (e) => moveTo(e.clientX));
  overlay.addEventListener('pointerdown', (e) => { overlay.setPointerCapture(e.pointerId); moveTo(e.clientX); });
  overlay.addEventListener('pointerleave', () => {
    cursor.setAttribute('visibility', 'hidden');
    readout.innerHTML = defaultReadout(data);
  });

  const note = document.createElement('p');
  note.className = 'result-note';
  note.textContent = `相手レンジ ${data.villainCombos.toLocaleString()} 通り / ${data.runouts.toLocaleString()} ランナウト`
    + (data.sampled ? `（各ランナウト ${data.sampledPerRunout} サンプル）` : '（全数評価）');
  container.appendChild(note);
}

function defaultReadout(data) {
  const t50 = data.top50 > 0 && data.top50 < 1
    ? `エクイティ50%以上は<b>上位 ${(data.top50 * 100).toFixed(0)}%</b>のランナウト。`
    : '';
  return `グラフをなぞると各点の値を表示します。平均エクイティ <b>${(data.avgEquity * 100).toFixed(1)}%</b>。${t50}`;
}
