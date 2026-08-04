// ============================================================================
// Gestione Finanze Familiari — dashboard interattiva (vanilla JS, nessuna dipendenza)
// ============================================================================

const MONTH_LABELS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const CAT_COLORS = ["#2ecc71", "#4a9bf0", "#f5a623", "#a78bfa", "#2dd4bf", "#f0575a", "#f472b6", "#60a5fa", "#fbbf24", "#34d399"];
const LS_KEYS = { budgets: "ffd_budgets", name: "ffd_userName", goal: "ffd_savingsGoal" };
const RECENT_LIMIT = 10;

const state = {
  transactions: [],   // {date:Date, category:string, type:'Entrata'|'Uscita', value:number}
  budgets: {},         // {categoria: numero}
  userName: DEFAULT_USER_NAME,
  savingsGoal: DEFAULT_SAVINGS_GOAL,
  selectedMonthKey: null,
  monthly: [],         // computed per-month summary, ascending
};

// ---------------------------------------------------------------- utilities
function monthKeyOf(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function monthLabelOf(key) {
  const [y, m] = key.split("-").map(Number);
  return MONTH_LABELS[m - 1] + " " + y;
}
function fmtCurrency(v, decimals = 0) {
  const sign = v < 0 ? "-" : "";
  return sign + "€" + Math.abs(v).toLocaleString("it-IT", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtPercent(v, decimals = 1) { return (v * 100).toFixed(decimals) + "%"; }
function pad2(n) { return String(n).padStart(2, "0"); }
function fmtDateShort(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtDateFull(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// ---------------------------------------------------------------- CSV import
function normalizeNumber(raw) {
  let s = raw.replace(/[€\s]/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    s = s.replace(",", ".");
  }
  return s;
}
function normalizeTipo(raw) {
  const low = raw.trim().toLowerCase();
  if (low.startsWith("entr") || low.includes("income") || low === "i") return "Entrata";
  if (low.startsWith("usc") || low.includes("outcome") || low.includes("expense") || low === "o") return "Uscita";
  return raw.trim();
}
function parseDateFlexible(raw) {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let [, dd, mm, yyyy, hh, min, ss] = m;
    if (yyyy.length === 2) yyyy = "20" + yyyy;
    return new Date(+yyyy, +mm - 1, +dd, +(hh || 0), +(min || 0), +(ss || 0));
  }
  const d2 = new Date(s);
  return isNaN(d2) ? null : d2;
}
function splitCSVLine(line, delim) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) {
      out.push(cur); cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const firstLine = lines[0];
  const delim = firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",";
  const header = splitCSVLine(firstLine, delim).map((h) => h.trim().toLowerCase());
  const idx = {
    date: header.findIndex((h) => h.includes("data") || h.includes("date")),
    cat: header.findIndex((h) => h.includes("categ")),
    val: header.findIndex((h) => h.includes("valor") || h.includes("importo") || h.includes("value") || h.includes("amount")),
    tipo: header.findIndex((h) => h.includes("tipo") || h.includes("type") || h.includes("entrata") || h.includes("income")),
  };
  if (idx.date < 0 || idx.cat < 0 || idx.val < 0 || idx.tipo < 0) {
    throw new Error("Colonne non riconosciute. Servono: Data e Ora, Categoria, Valore, Tipo.");
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCSVLine(lines[i], delim);
    if (parts.length <= Math.max(idx.date, idx.cat, idx.val, idx.tipo)) continue;
    const dateObj = parseDateFlexible(parts[idx.date]);
    const val = parseFloat(normalizeNumber(parts[idx.val]));
    const cat = parts[idx.cat].trim();
    const tipo = normalizeTipo(parts[idx.tipo]);
    if (!dateObj || isNaN(val) || !cat) continue;
    rows.push({ date: dateObj, category: cat, type: tipo, value: Math.abs(val) });
  }
  return rows;
}

function loadSampleTransactions() {
  return SAMPLE_TRANSACTIONS.map(([iso, cat, tipo, val]) => ({
    date: new Date(iso), category: cat, type: tipo, value: val,
  }));
}

// ---------------------------------------------------------------- persistence
function loadSettings() {
  try {
    const b = localStorage.getItem(LS_KEYS.budgets);
    state.budgets = b ? JSON.parse(b) : { ...DEFAULT_BUDGETS };
  } catch (e) { state.budgets = { ...DEFAULT_BUDGETS }; }
  state.userName = localStorage.getItem(LS_KEYS.name) || DEFAULT_USER_NAME;
  const g = localStorage.getItem(LS_KEYS.goal);
  state.savingsGoal = g !== null ? parseFloat(g) : DEFAULT_SAVINGS_GOAL;
}
function saveSettings() {
  localStorage.setItem(LS_KEYS.budgets, JSON.stringify(state.budgets));
  localStorage.setItem(LS_KEYS.name, state.userName);
  localStorage.setItem(LS_KEYS.goal, String(state.savingsGoal));
}

// ---------------------------------------------------------------- calculations
function getAllExpenseCategories() {
  const known = Object.keys(state.budgets);
  const seen = new Set(known);
  const extra = [];
  for (const t of state.transactions) {
    if (t.type === "Uscita" && !seen.has(t.category)) { seen.add(t.category); extra.push(t.category); }
  }
  extra.sort((a, b) => a.localeCompare(b, "it"));
  return known.concat(extra);
}

function computeMonthly(transactions) {
  const map = new Map();
  for (const t of transactions) {
    const key = monthKeyOf(t.date);
    if (!map.has(key)) map.set(key, { key, label: monthLabelOf(key), entrate: 0, uscite: 0 });
    const m = map.get(key);
    if (t.type === "Entrata") m.entrate += t.value; else m.uscite += t.value;
  }
  const arr = Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  let cum = 0;
  for (const m of arr) {
    m.risparmio = m.entrate - m.uscite;
    m.tassoRisparmio = m.entrate > 0 ? m.risparmio / m.entrate : 0;
    cum += m.risparmio;
    m.saldoCumulativo = cum;
  }
  return arr;
}

function computeCategoryBreakdown(monthKey) {
  const cats = getAllExpenseCategories();
  return cats.map((cat) => {
    const speso = state.transactions
      .filter((t) => t.type === "Uscita" && t.category === cat && monthKeyOf(t.date) === monthKey)
      .reduce((s, t) => s + t.value, 0);
    const budget = state.budgets[cat] || 0;
    const percent = budget > 0 ? speso / budget : null;
    return { category: cat, speso, budget, percent };
  });
}

function computeRecentTransactions(monthKey, limit = RECENT_LIMIT) {
  return state.transactions
    .filter((t) => monthKeyOf(t.date) === monthKey)
    .sort((a, b) => b.date - a.date)
    .slice(0, limit);
}

// ---------------------------------------------------------------- rendering: KPI
function renderKPIs() {
  const grid = document.getElementById("kpiGrid");
  grid.innerHTML = "";
  const idx = state.monthly.findIndex((m) => m.key === state.selectedMonthKey);
  const cur = state.monthly[idx];
  const prev = idx > 0 ? state.monthly[idx - 1] : null;
  const saldoTotale = state.monthly.length ? state.monthly[state.monthly.length - 1].saldoCumulativo : 0;
  const catBreak = computeCategoryBreakdown(state.selectedMonthKey);
  const topCat = catBreak.reduce((best, c) => (c.speso > (best ? best.speso : -1) ? c : best), null);
  const numTx = state.transactions.filter((t) => monthKeyOf(t.date) === state.selectedMonthKey).length;

  const cards = [
    { label: "Saldo Totale", value: fmtCurrency(saldoTotale), cls: "", sub: "Patrimonio netto attuale" },
    { label: "Entrate Mese", value: fmtCurrency(cur ? cur.entrate : 0), cls: "pos", sub: `Mese selezionato: ${monthLabelOf(state.selectedMonthKey)}` },
    { label: "Uscite Mese", value: fmtCurrency(cur ? cur.uscite : 0), cls: "neg", sub: `N. transazioni: ${numTx}` },
    {
      label: "Risparmio Mese",
      value: fmtCurrency(cur ? cur.risparmio : 0),
      cls: cur && cur.risparmio >= 0 ? "pos" : "neg",
      sub: prev ? `vs mese prec.: ${fmtCurrency(cur.risparmio - prev.risparmio)}` : "Primo mese disponibile",
    },
    {
      label: "Tasso di Risparmio",
      value: fmtPercent(cur ? cur.tassoRisparmio : 0),
      cls: cur && cur.tassoRisparmio >= state.savingsGoal ? "pos" : "warn",
      sub: `Obiettivo: ${fmtPercent(state.savingsGoal, 0)}`,
    },
    {
      label: "Top Spesa del Mese",
      value: topCat && topCat.speso > 0 ? topCat.category : "—",
      cls: "text",
      colorCls: "",
      sub: topCat && topCat.speso > 0 ? `${fmtCurrency(topCat.speso)} questo mese` : "Nessuna spesa",
      isText: true,
    },
  ];

  for (const c of cards) {
    const card = el("div", "kpi-card");
    card.appendChild(el("div", "kpi-label", c.label));
    const valDiv = el("div", "kpi-value" + (c.isText ? " text" : "") + (c.cls ? " " + c.cls : ""), c.value);
    card.appendChild(valDiv);
    card.appendChild(el("div", "kpi-sub", c.sub));
    grid.appendChild(card);
  }
}

// ---------------------------------------------------------------- rendering: category list
function renderCategoryList() {
  const box = document.getElementById("categoryList");
  box.innerHTML = "";
  const rows = computeCategoryBreakdown(state.selectedMonthKey);
  if (!rows.length) { box.appendChild(el("div", "list-empty", "Nessuna categoria di spesa configurata.")); return; }
  for (const r of rows) {
    const row = el("div", "list-row cat-row-item");
    row.appendChild(el("div", "cat-name", r.category));
    if (r.budget > 0) {
      row.appendChild(el("div", "cat-amounts" + (r.percent > 1 ? " over" : ""), `${fmtCurrency(r.speso)} / ${fmtCurrency(r.budget)}`));
      const track = el("div", "bar-track");
      const pct = clamp(r.percent, 0, 1.4);
      const fill = el("div", "bar-fill");
      fill.style.width = (pct / 1.4) * 100 + "%";
      fill.style.background = r.percent > 1
        ? "linear-gradient(90deg,#2ecc71,#f0575a)"
        : "linear-gradient(90deg,#1e8f52,#2ecc71)";
      const label = el("span", "bar-label", fmtPercent(r.percent));
      track.appendChild(fill);
      track.appendChild(label);
      row.appendChild(track);
    } else {
      row.appendChild(el("div", "cat-amounts", `${fmtCurrency(r.speso)} / —`));
      row.appendChild(el("div", "muted", "Budget non impostato (Impostazioni)"));
    }
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------- rendering: recent transactions
function renderRecentTransactions() {
  const box = document.getElementById("txList");
  box.innerHTML = "";
  const rows = computeRecentTransactions(state.selectedMonthKey);
  if (!rows.length) { box.appendChild(el("div", "list-empty", "Nessuna transazione in questo mese.")); return; }
  for (const t of rows) {
    const row = el("div", "list-row tx-row-item");
    row.appendChild(el("div", "tx-date", fmtDateShort(t.date)));
    row.appendChild(el("div", "tx-cat", t.category));
    const isIn = t.type === "Entrata";
    row.appendChild(el("div", "tx-type " + (isIn ? "in" : "out"), isIn ? "▲" : "▼"));
    row.appendChild(el("div", "tx-value " + (isIn ? "in" : "out"), (isIn ? "" : "-") + fmtCurrency(t.value, 2)));
    box.appendChild(row);
  }
}

// ---------------------------------------------------------------- rendering: alert
function renderAlert() {
  const box = document.getElementById("alertBox");
  const rows = computeCategoryBreakdown(state.selectedMonthKey).filter((r) => r.budget > 0);
  const overCount = rows.filter((r) => r.percent > 1).length;
  const worst = rows.reduce((best, r) => (r.percent !== null && r.percent > (best ? best.percent : -Infinity) ? r : best), null);
  if (worst && worst.percent > 1) {
    box.className = "alert over";
    box.textContent = `⚠ Attenzione: hai superato il budget di ${worst.category} di ${fmtCurrency(worst.speso - worst.budget)} — ${overCount} categorie fuori budget questo mese.`;
  } else {
    box.className = "alert ok";
    box.textContent = "✓ Tutte le categorie di spesa sono in linea con il budget questo mese.";
  }
}

// ---------------------------------------------------------------- rendering: combo chart
function renderComboChart() {
  const svg = document.getElementById("comboChart");
  const legend = document.getElementById("comboLegend");
  svg.innerHTML = "";
  legend.innerHTML = "";
  const monthly = state.monthly;
  const rect = svg.getBoundingClientRect();
  const W = Math.max(320, rect.width || 600);
  const H = Math.max(180, rect.height || 260);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  document.getElementById("monthsCount").textContent = monthly.length;

  if (!monthly.length) return;

  const margin = { top: 16, right: 52, bottom: 34, left: 52 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const n = monthly.length;
  const bandW = innerW / n;

  const maxFlow = Math.max(1, ...monthly.map((m) => Math.max(m.entrate, m.uscite))) * 1.1;
  const saldos = monthly.map((m) => m.saldoCumulativo);
  const maxSaldo = Math.max(...saldos, 0) * 1.1 || 1;
  const minSaldo = Math.min(...saldos, 0);
  const saldoRange = maxSaldo - minSaldo || 1;

  const yFlow = (v) => margin.top + innerH - (v / maxFlow) * innerH;
  const ySaldo = (v) => margin.top + innerH - ((v - minSaldo) / saldoRange) * innerH;
  const xCenter = (i) => margin.left + i * bandW + bandW / 2;

  // gridlines + left axis labels (flow scale)
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = (maxFlow / ticks) * t;
    const y = yFlow(val);
    svg.appendChild(svgEl("line", { x1: margin.left, x2: W - margin.right, y1: y, y2: y, class: "grid-line" }));
    const txt = svgEl("text", { x: margin.left - 8, y: y + 3, "text-anchor": "end" });
    txt.textContent = fmtCurrency(val);
    svg.appendChild(txt);
  }
  // right axis labels (saldo scale)
  for (let t = 0; t <= ticks; t++) {
    const val = minSaldo + (saldoRange / ticks) * t;
    const y = ySaldo(val);
    const txt = svgEl("text", { x: W - margin.right + 8, y: y + 3, "text-anchor": "start" });
    txt.textContent = fmtCurrency(val);
    svg.appendChild(txt);
  }

  const barW = bandW * 0.32;
  monthly.forEach((m, i) => {
    const xc = xCenter(i);
    const yE = yFlow(m.entrate), yU = yFlow(m.uscite);
    svg.appendChild(svgEl("rect", {
      x: xc - barW - 1, y: yE, width: barW, height: Math.max(0, margin.top + innerH - yE), fill: "#2ecc71", rx: 1.5,
    }));
    svg.appendChild(svgEl("rect", {
      x: xc + 1, y: yU, width: barW, height: Math.max(0, margin.top + innerH - yU), fill: "#f0575a", rx: 1.5,
    }));
    const label = svgEl("text", { x: xc, y: H - margin.bottom + 16, "text-anchor": "middle" });
    label.textContent = m.label.split(" ")[0] + " " + m.label.split(" ")[1].slice(2);
    svg.appendChild(label);
  });

  // saldo cumulativo line
  const pts = monthly.map((m, i) => `${xCenter(i)},${ySaldo(m.saldoCumulativo)}`).join(" ");
  svg.appendChild(svgEl("polyline", { points: pts, fill: "none", stroke: "#2dd4bf", "stroke-width": 2.2 }));
  monthly.forEach((m, i) => {
    svg.appendChild(svgEl("circle", { cx: xCenter(i), cy: ySaldo(m.saldoCumulativo), r: 3, fill: "#2dd4bf" }));
  });

  svg.appendChild(svgEl("line", { x1: margin.left, x2: margin.left, y1: margin.top, y2: margin.top + innerH, class: "axis-line" }));
  svg.appendChild(svgEl("line", { x1: margin.left, x2: W - margin.right, y1: margin.top + innerH, y2: margin.top + innerH, class: "axis-line" }));

  legend.appendChild(legendItem("#2ecc71", "Entrate"));
  legend.appendChild(legendItem("#f0575a", "Uscite"));
  legend.appendChild(legendItem("#2dd4bf", "Saldo Cumulativo"));
}

function legendItem(color, text) {
  const item = el("span", "legend-item");
  const sw = el("span", "legend-swatch");
  sw.style.background = color;
  item.appendChild(sw);
  item.appendChild(document.createTextNode(text));
  return item;
}

// ---------------------------------------------------------------- rendering: pie chart
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", cx, cy, "L", end.x, end.y, "A", r, r, 0, largeArc, 1, start.x, start.y, "Z"].join(" ");
}

function renderPieChart() {
  const svg = document.getElementById("pieChart");
  const legend = document.getElementById("pieLegend");
  svg.innerHTML = "";
  legend.innerHTML = "";
  document.getElementById("pieMonthLabel").textContent = monthLabelOf(state.selectedMonthKey);

  const rows = computeCategoryBreakdown(state.selectedMonthKey).filter((r) => r.speso > 0);
  const rect = svg.getBoundingClientRect();
  const size = Math.max(160, Math.min(rect.width || 240, rect.height || 240));
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  if (!rows.length) {
    const txt = svgEl("text", { x: size / 2, y: size / 2, "text-anchor": "middle" });
    txt.textContent = "Nessuna spesa in questo mese";
    svg.appendChild(txt);
    return;
  }

  const total = rows.reduce((s, r) => s + r.speso, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  let angle = 0;
  rows.forEach((row, i) => {
    const share = row.speso / total;
    const endAngle = angle + share * 360;
    const color = CAT_COLORS[i % CAT_COLORS.length];
    const path = svgEl("path", { d: describeArc(cx, cy, r, angle, endAngle), fill: color, stroke: "#151a21", "stroke-width": 1.5 });
    svg.appendChild(path);
    if (share >= 0.045) {
      const mid = angle + (endAngle - angle) / 2;
      const labelPos = polarToCartesian(cx, cy, r * 0.66, mid);
      const txt = svgEl("text", { x: labelPos.x, y: labelPos.y, "text-anchor": "middle", fill: "#0b0e11", "font-weight": "700", "font-size": "10.5" });
      txt.textContent = fmtPercent(share, 0);
      svg.appendChild(txt);
    }
    angle = endAngle;

    const item = el("span", "legend-item");
    const sw = el("span", "legend-swatch");
    sw.style.background = color;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(`${row.category} (${fmtPercent(share, 0)})`));
    legend.appendChild(item);
  });
}

// ---------------------------------------------------------------- top-level render
function renderAll() {
  renderKPIs();
  renderCategoryList();
  renderRecentTransactions();
  renderAlert();
  renderComboChart();
  renderPieChart();
  document.getElementById("userName").textContent = state.userName;
  document.getElementById("txCountLabel").textContent = `Transazioni caricate: ${state.transactions.length}`;
  document.getElementById("footerLeft").textContent = `Fonte dati: ${state.transactions.length} transazioni caricate`;
  const maxDate = state.transactions.reduce((mx, t) => (t.date > mx ? t.date : mx), new Date(0));
  document.getElementById("dataUpdatedAt").textContent = state.transactions.length ? `Dati al ${fmtDateFull(maxDate)}` : "";
}

function populateMonthSelect() {
  const sel = document.getElementById("monthSelect");
  sel.innerHTML = "";
  for (const m of state.monthly) {
    const opt = document.createElement("option");
    opt.value = m.key;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  if (!state.monthly.find((m) => m.key === state.selectedMonthKey)) {
    state.selectedMonthKey = state.monthly.length ? state.monthly[state.monthly.length - 1].key : null;
  }
  sel.value = state.selectedMonthKey;
}

function reloadTransactions(transactions) {
  state.transactions = transactions;
  state.monthly = computeMonthly(transactions);
  populateMonthSelect();
  renderAll();
}

// ---------------------------------------------------------------- settings modal
function openSettings() {
  document.getElementById("settingName").value = state.userName;
  document.getElementById("settingGoal").value = Math.round(state.savingsGoal * 100);
  const editor = document.getElementById("budgetEditor");
  editor.innerHTML = "";
  for (const cat of getAllExpenseCategories()) {
    const row = el("div", "budget-row");
    const label = el("label", null, cat);
    label.setAttribute("for", "budget_" + cat.replace(/\W+/g, "_"));
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.id = "budget_" + cat.replace(/\W+/g, "_");
    input.dataset.category = cat;
    input.value = state.budgets[cat] || 0;
    row.appendChild(label);
    row.appendChild(input);
    editor.appendChild(row);
  }
  document.getElementById("settingsModal").classList.remove("hidden");
}
function closeSettings() { document.getElementById("settingsModal").classList.add("hidden"); }
function saveSettingsFromModal() {
  state.userName = document.getElementById("settingName").value.trim() || DEFAULT_USER_NAME;
  const goalPct = parseFloat(document.getElementById("settingGoal").value);
  state.savingsGoal = isNaN(goalPct) ? DEFAULT_SAVINGS_GOAL : clamp(goalPct / 100, 0, 1);
  const inputs = document.querySelectorAll("#budgetEditor input");
  const newBudgets = {};
  inputs.forEach((inp) => { newBudgets[inp.dataset.category] = parseFloat(inp.value) || 0; });
  state.budgets = newBudgets;
  saveSettings();
  closeSettings();
  renderAll();
}
function resetSampleData() {
  state.budgets = { ...DEFAULT_BUDGETS };
  state.userName = DEFAULT_USER_NAME;
  state.savingsGoal = DEFAULT_SAVINGS_GOAL;
  saveSettings();
  reloadTransactions(loadSampleTransactions());
  closeSettings();
}

// ---------------------------------------------------------------- init
function init() {
  loadSettings();
  reloadTransactions(loadSampleTransactions());

  document.getElementById("monthSelect").addEventListener("change", (e) => {
    state.selectedMonthKey = e.target.value;
    renderKPIs();
    renderCategoryList();
    renderRecentTransactions();
    renderAlert();
    renderPieChart();
  });

  document.getElementById("btnSettings").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettings);
  document.getElementById("btnSaveSettings").addEventListener("click", saveSettingsFromModal);
  document.getElementById("btnResetSample").addEventListener("click", resetSampleData);
  document.getElementById("settingsModal").addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeSettings();
  });

  document.getElementById("csvFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(reader.result);
        if (!rows.length) throw new Error("Nessuna riga valida trovata nel CSV.");
        reloadTransactions(rows);
      } catch (err) {
        alert("Errore nell'importazione del CSV: " + err.message);
      }
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  });

  window.addEventListener("resize", () => { renderComboChart(); renderPieChart(); });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
