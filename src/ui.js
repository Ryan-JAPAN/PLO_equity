// ui.js — モバイル向けUIの構築と状態管理。
// カードピッカー（ボトムシート）、レンジ入力、精度、タブ、結果表示を担当する。
// 重い計算は app.js 経由でワーカーに渡す（ここでは行わない）。

import { makeCard, cardToString, cardsToString, RANK_CHARS, SUIT_SYMBOLS, SUIT_IS_RED } from './cards.js';
import { drawEquityBar, drawDistribution } from './chart.js';

const RANK_ORDER = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; // A..2 表示順
const PRESETS = [
  { label: 'AA**', value: 'AA**' },
  { label: 'KK**', value: 'KK**' },
  { label: 'QQ**', value: 'QQ**' },
  { label: '大ペア', value: 'AA**,KK**,QQ**' },
  { label: 'ブロードウェイ', value: 'BBBB' },
  { label: 'AKQJ', value: 'AKQJ' },
];
const ACCURACY = [
  { id: 'fast', label: '高速' },
  { id: 'normal', label: '標準' },
  { id: 'accurate', label: '高精度' },
];

const LS = {
  hero: 'plo_hero', board: 'plo_board', range: 'plo_range', acc: 'plo_acc', tab: 'plo_tab',
};

const state = {
  tab: 'calc',
  hero: [null, null, null, null],
  board: [null, null, null, null], // 0..2 = フロップ, 3 = ターン(任意)
  rangeText: 'AA**',
  accuracy: 'normal',
};

let handlers = {};
let picker = { group: null, index: 0 };

// ---- localStorage ----
function save() {
  try {
    localStorage.setItem(LS.hero, JSON.stringify(state.hero));
    localStorage.setItem(LS.board, JSON.stringify(state.board));
    localStorage.setItem(LS.range, state.rangeText);
    localStorage.setItem(LS.acc, state.accuracy);
    localStorage.setItem(LS.tab, state.tab);
  } catch { /* プライベートモード等では無視 */ }
}
function load() {
  try {
    const h = JSON.parse(localStorage.getItem(LS.hero) || 'null');
    const b = JSON.parse(localStorage.getItem(LS.board) || 'null');
    if (Array.isArray(h) && h.length === 4) state.hero = h;
    if (Array.isArray(b) && b.length === 4) state.board = b;
    state.rangeText = localStorage.getItem(LS.range) || state.rangeText;
    state.accuracy = localStorage.getItem(LS.acc) || state.accuracy;
    state.tab = localStorage.getItem(LS.tab) || state.tab;
  } catch { /* 無視 */ }
}

// ---- ユーティリティ ----
function usedCards(except) {
  const set = new Set();
  state.hero.forEach((c, i) => { if (c !== null && !(except === 'hero' && i === picker.index)) set.add(c); });
  state.board.forEach((c, i) => { if (c !== null && !(except === 'board' && i === picker.index)) set.add(c); });
  return set;
}

function filledHero() { return state.hero.filter((c) => c !== null); }
function filledBoard() { return state.board.filter((c) => c !== null); }

// ---- スロット描画 ----
function renderSlots() {
  const heroEl = document.getElementById('heroSlots');
  const boardEl = document.getElementById('boardSlots');
  heroEl.innerHTML = '';
  boardEl.innerHTML = '';

  state.hero.forEach((card, i) => heroEl.appendChild(makeSlot('hero', i, card)));
  state.board.forEach((card, i) => {
    const slot = makeSlot('board', i, card, i === 3 ? 'ターン' : null);
    boardEl.appendChild(slot);
  });
}

function makeSlot(group, index, card, placeholder) {
  const btn = document.createElement('button');
  btn.className = 'slot' + (card === null ? ' empty' : '');
  btn.type = 'button';
  if (card === null) {
    const phClass = placeholder ? 'slot-ph text' : 'slot-ph';
    btn.innerHTML = `<span class="${phClass}">${placeholder || '＋'}</span>`;
  } else {
    const red = SUIT_IS_RED[card & 3];
    btn.classList.add(red ? 'red' : 'black');
    btn.innerHTML = `<span class="slot-rank">${RANK_CHARS[card >> 2]}</span><span class="slot-suit">${SUIT_SYMBOLS[card & 3]}</span>`;
    const clr = document.createElement('span');
    clr.className = 'slot-clear';
    clr.textContent = '×';
    clr.addEventListener('click', (e) => {
      e.stopPropagation();
      state[group][index] = null;
      onInputsChanged();
    });
    btn.appendChild(clr);
  }
  btn.addEventListener('click', () => openPicker(group, index));
  return btn;
}

// ---- カードピッカー（ボトムシート）----
function buildPickerGrid() {
  const grid = document.getElementById('pickerGrid');
  grid.innerHTML = '';
  for (let suit = 3; suit >= 0; suit--) {
    const row = document.createElement('div');
    row.className = 'suit-row';
    const tag = document.createElement('span');
    tag.className = 'suit-tag ' + (SUIT_IS_RED[suit] ? 'red' : 'black');
    tag.textContent = SUIT_SYMBOLS[suit];
    row.appendChild(tag);
    for (const rank of RANK_ORDER) {
      const id = makeCard(rank, suit);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (SUIT_IS_RED[suit] ? ' red' : ' black');
      b.dataset.card = id;
      b.textContent = RANK_CHARS[rank];
      b.addEventListener('click', () => pickCard(id));
      row.appendChild(b);
    }
    grid.appendChild(row);
  }
}

function refreshPickerDisabled() {
  const used = usedCards(picker.group);
  document.querySelectorAll('#pickerGrid .pick').forEach((b) => {
    const id = Number(b.dataset.card);
    const isCurrent = state[picker.group][picker.index] === id;
    b.classList.toggle('selected', isCurrent);
    b.disabled = used.has(id) && !isCurrent;
  });
}

function slotLabel(group, index) {
  return group === 'hero'
    ? `自分のハンド ${index + 1} 枚目`
    : (index === 3 ? 'ターン（任意）' : `フロップ ${index + 1} 枚目`);
}

function focusSlot(group, index) {
  const container = document.getElementById(group === 'hero' ? 'heroSlots' : 'boardSlots');
  const btn = container && container.children[index];
  if (btn) btn.focus();
}

function openPicker(group, index) {
  picker = { group, index };
  document.getElementById('pickerTarget').textContent = slotLabel(group, index);
  refreshPickerDisabled();
  document.getElementById('pickerBackdrop').hidden = false;
  document.getElementById('pickerSheet').hidden = false;
  document.body.classList.add('no-scroll');
  // モーダルへフォーカスを移す（キーボード/スクリーンリーダー対応）
  document.getElementById('pickerClose').focus();
}

function closePicker() {
  document.getElementById('pickerBackdrop').hidden = true;
  document.getElementById('pickerSheet').hidden = true;
  document.body.classList.remove('no-scroll');
  // 起点スロットへフォーカスを戻す
  focusSlot(picker.group, picker.index);
}

function pickCard(id) {
  const cur = state[picker.group][picker.index];
  if (cur === id) {
    state[picker.group][picker.index] = null; // 同じカードを再タップで解除
  } else {
    state[picker.group][picker.index] = id;
    // 同じグループの次の空きスロットへ自動で進む
    const arr = state[picker.group];
    const next = arr.findIndex((c, i) => c === null && i > picker.index);
    if (next !== -1) picker.index = next;
  }
  refreshPickerDisabled();
  onInputsChanged();
  document.getElementById('pickerTarget').textContent = slotLabel(picker.group, picker.index);
}

// ---- 入力変化 ----
function onInputsChanged() {
  renderSlots();
  save();
  validate();
}

function validate() {
  const msg = document.getElementById('inputError');
  const hero = filledHero();
  const board = filledBoard();
  let text = '';
  if (hero.length > 0 && hero.length < 4) text = `自分のハンドはあと ${4 - hero.length} 枚必要です`;
  else if (board.length > 0 && board.length < 3) text = `フロップはあと ${3 - board.length} 枚必要です`;
  msg.textContent = text;
  return { hero, board, valid: hero.length === 4 && board.length >= 3 };
}

// ---- タブ ----
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.tab === tab;
    t.classList.toggle('is-active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.tabIndex = active ? 0 : -1;
  });
  document.getElementById('calcResult').hidden = tab !== 'calc';
  document.getElementById('distResult').hidden = tab !== 'dist';
  document.getElementById('runBtn').textContent = tab === 'calc' ? 'エクイティを計算' : '分布グラフを描く';
  document.getElementById('distHint').hidden = tab !== 'dist';
  save();
}

// ---- 公開API ----
export function createUI(h) {
  handlers = h;
  load();

  // タブ（クリック＋WAI-ARIA Tabsの左右/Home/Endキー操作）
  const tabEls = [...document.querySelectorAll('.tab')];
  tabEls.forEach((t, i) => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      let ni = null;
      if (e.key === 'ArrowRight') ni = (i + 1) % tabEls.length;
      else if (e.key === 'ArrowLeft') ni = (i - 1 + tabEls.length) % tabEls.length;
      else if (e.key === 'Home') ni = 0;
      else if (e.key === 'End') ni = tabEls.length - 1;
      if (ni !== null) {
        e.preventDefault();
        setTab(tabEls[ni].dataset.tab);
        tabEls[ni].focus();
      }
    });
  });

  // ピッカーのキーボード操作（Escで閉じる／Tabでシート内をループ）
  const sheet = document.getElementById('pickerSheet');
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); return; }
    if (e.key !== 'Tab') return;
    const f = sheet.querySelectorAll('button:not([disabled])');
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // プリセット
  const presetEl = document.getElementById('rangePresets');
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      state.rangeText = p.value;
      document.getElementById('rangeInput').value = p.value;
      save();
      handlers.onRangeTextChanged(p.value);
    });
    presetEl.appendChild(b);
  });

  // レンジ入力
  const rangeInput = document.getElementById('rangeInput');
  rangeInput.value = state.rangeText;
  let debounce;
  rangeInput.addEventListener('input', () => {
    state.rangeText = rangeInput.value.trim();
    save();
    clearTimeout(debounce);
    debounce = setTimeout(() => handlers.onRangeTextChanged(state.rangeText), 250);
  });

  // 精度
  const accEl = document.getElementById('accuracy');
  ACCURACY.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (a.id === state.accuracy ? ' active' : '');
    b.textContent = a.label;
    b.dataset.acc = a.id;
    b.addEventListener('click', () => {
      state.accuracy = a.id;
      accEl.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x.dataset.acc === a.id));
      save();
    });
    accEl.appendChild(b);
  });

  // ピッカー
  buildPickerGrid();
  document.getElementById('pickerClose').addEventListener('click', closePicker);
  document.getElementById('pickerBackdrop').addEventListener('click', closePicker);
  document.getElementById('pickerClearSlot').addEventListener('click', () => {
    state[picker.group][picker.index] = null;
    refreshPickerDisabled();
    onInputsChanged();
  });

  // 実行
  document.getElementById('runBtn').addEventListener('click', () => {
    const v = validate();
    if (!v.valid) {
      const msg = document.getElementById('inputError');
      if (!msg.textContent) msg.textContent = '自分のハンド4枚とフロップ3枚を入力してください';
      return;
    }
    handlers.onRun(getState());
  });

  setTab(state.tab);
  renderSlots();
  validate();
  handlers.onRangeTextChanged(state.rangeText);
}

export function getState() {
  const hero = filledHero();
  const board = filledBoard();
  return {
    tab: state.tab,
    hero,
    board,
    rangeText: state.rangeText,
    accuracy: state.accuracy,
    heroLabel: cardsToString(hero),
    villainLabel: state.rangeText,
  };
}

export function setRangeMeta(size, error) {
  const el = document.getElementById('rangeMeta');
  if (error) {
    el.className = 'range-meta error';
    el.textContent = `⚠ ${error}`;
  } else {
    el.className = 'range-meta ok';
    el.textContent = `${size.toLocaleString()} 通り`;
  }
}

export function showProgress(show, p) {
  const wrap = document.getElementById('progress');
  wrap.hidden = !show;
  if (show) {
    const bar = document.getElementById('progressBar');
    bar.style.width = `${Math.round((p || 0) * 100)}%`;
  }
  document.getElementById('runBtn').disabled = show;
}

export function showCalcResult(result) {
  const c = document.getElementById('calcResult');
  if (result.error) { c.innerHTML = `<p class="result-note error">⚠ ${result.error}</p>`; return; }
  drawEquityBar(c, result);
}

export function showDistResult(result, labels) {
  const c = document.getElementById('distResult');
  if (result.error) { c.innerHTML = `<p class="result-note error">⚠ ${result.error}</p>`; return; }
  drawDistribution(c, result, labels.heroLabel, labels.villainLabel);
}

export function showError(tab, msg) {
  const c = document.getElementById(tab === 'calc' ? 'calcResult' : 'distResult');
  c.innerHTML = `<p class="result-note error">⚠ ${msg}</p>`;
}

// 役に立たない警告を避けるための参照
void cardToString;
