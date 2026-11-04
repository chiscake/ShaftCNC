/* ---------- утилиты ---------- */
const n = (v) => parseFloat(String(v).replace(",", ".")) || 0;
const f = (v) => String(+Number(v).toFixed(3));
let uid = 100;
const mk = (o = {}) => ({
  id: ++uid,
  type: "cyl",
  d: "30",
  d2: "30",
  L: "20",
  cs: "0",
  ce: "0",
  p: "1.5",
  ...o,
});

const PRESET_SECS = [
  mk({ type: "thread", d: "20", L: "18", p: "1.5", cs: "1.5" }),
  mk({ d: "17", L: "4" }),
  mk({ d: "30", L: "40", cs: "1" }),
  mk({ d: "28", L: "3" }),
  mk({ d: "40", L: "5" }),
  mk({ d: "28", L: "3" }),
  mk({ d: "26", L: "25", ce: "1" }),
];

const PRESET_G = {
  name: "O0001",
  stockD: "42",
  stockL: "110",
  mode: "G73",
  vc: "180",
  smax: "2500",
  fr: "0.25",
  ff: "0.1",
  ap: "1.5",
  r: "0.5",
  u: "0.3",
  w: "0.1",
  tTurn: "0101",
  tThread: "0303",
  thS: "600",
  comments: false,
  ext: "nc",
  mirror: true,
  tMirror: "0202",
  mSp: "M04",
};

/* ---------- обратные участки ---------- */
function splitBack(shape) {
  let m = shape[0][0],
    cur = null;
  const F = [shape[0]],
    zones = [];
  for (let i = 1; i < shape.length; i++) {
    const p = shape[i - 1],
      q = shape[i];
    if (!cur) {
      if (q[0] < m - 1e-9) cur = { env: m, poly: [p, q] };
      else {
        m = Math.max(m, q[0]);
        F.push([m, q[1]]);
      }
    } else if (q[0] >= cur.env - 1e-9) {
      const t = (cur.env - p[0]) / (q[0] - p[0] || 1);
      const zc = p[1] + t * (q[1] - p[1]);
      cur.poly.push([cur.env, zc]);
      zones.push(cur);
      F.push([m, zc]);
      m = Math.max(m, q[0]);
      F.push([m, q[1]]);
      cur = null;
    } else cur.poly.push(q);
  }
  if (cur) {
    const zl = shape[shape.length - 1][1];
    cur.poly.push([cur.env, zl]);
    zones.push(cur);
    F.push([m, zl]);
  }
  return { F, zones };
}

function intervals(poly, lx) {
  const iv = [];
  for (let i = 1; i < poly.length; i++) {
    const [px, pz] = poly[i - 1],
      [qx, qz] = poly[i];
    const pb = px < lx,
      qb = qx < lx;
    if (!pb && !qb) continue;
    if (pb && qb) {
      iv.push([Math.min(pz, qz), Math.max(pz, qz)]);
      continue;
    }
    const zc = pz + ((lx - px) / (qx - px)) * (qz - pz);
    const zb = pb ? pz : qz;
    iv.push([Math.min(zb, zc), Math.max(zb, zc)]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  iv.forEach((v) => {
    const l = out[out.length - 1];
    if (l && v[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], v[1]);
    else out.push([...v]);
  });
  return out;
}

/* ---------- геометрия и генерация G-кода ---------- */
function build(secs, g) {
  const stockD = n(g.stockD);
  let z = 0,
    prev = 0;
  const shape = [[0, 0]];
  const ranges = [];
  const push = (x, zz) => {
    const l = shape[shape.length - 1];
    if (Math.abs(l[0] - x) > 1e-6 || Math.abs(l[1] - zz) > 1e-6) shape.push([x, zz]);
  };
  secs.forEach((s) => {
    const L = Math.max(n(s.L), 0);
    const ds = n(s.d);
    const de = s.type === "cone" ? n(s.d2) : ds;
    const cs = Math.min(n(s.cs), L),
      ce = Math.min(n(s.ce), L);
    const z1 = z - L;
    if (cs > 0 && ds > prev) {
      push(ds - 2 * cs, z);
      push(ds, z - cs);
    } else push(ds, z);
    if (ce > 0) {
      push(de, z1 + ce);
      push(de - 2 * ce, z1);
      prev = de - 2 * ce;
    } else {
      push(de, z1);
      prev = de;
    }
    ranges.push({ s, z0: z, z1, ds, de });
    z = z1;
  });
  const zEnd = z;
  const { F, zones } = g.mirror ? splitBack(shape) : { F: shape, zones: [] };
  const pts = [...(zones.length ? F : shape)];
  if (pts[pts.length - 1][0] < stockD + 2) pts.push([stockD + 2, zEnd]);
  let mono = true;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0] - 1e-9) mono = false;

  const L = [];
  const C = (t) => g.comments && L.push(`;${t}`);
  const mode = zones.length && g.mode === "G73" ? "G71" : g.mode;
  const Q = 100 + (pts.length - 1) * 10;
  C(`${g.name} вал: заготовка D${f(stockD)} x ${f(n(g.stockL))}, нуль Z0 - правый торец`);
  L.push("G21 G40 G99;");
  L.push(`G50 S${f(n(g.smax))};`);
  L.push(`T${g.tTurn};`);
  L.push(`G96 S${f(n(g.vc))} M03;`);
  L.push(`G00 X${f(stockD + 2)} Z2;`);
  L.push("M08;");
  if (mode === "G71" || mode === "G73") {
    C("черновая обработка");
    if (mode === "G71") {
      L.push(`G71 U${f(n(g.ap))} R${f(n(g.r))};`);
      L.push(`G71 P100 Q${Q} U${f(n(g.u))} W${f(n(g.w))} F${f(n(g.fr))};`);
    } else {
      const dmin = Math.min(...ranges.map((r) => Math.min(r.ds, r.de)).filter((v) => v > 0), stockD);
      const ux = Math.max((stockD - dmin) / 2, n(g.ap));
      const R = Math.max(1, Math.ceil(ux / Math.max(n(g.ap), 0.1)));
      L.push(`G73 U${f(ux)} W1 R${R};`);
      L.push(`G73 P100 Q${Q} U${f(n(g.u))} W${f(n(g.w))} F${f(n(g.fr))};`);
    }
    pts.forEach((p, i) => {
      L.push(`N${100 + i * 10} G01 X${f(p[0])} Z${f(p[1])}${i === 0 ? ` F${f(n(g.ff))}` : ""};`);
    });
    C("чистовой проход");
    L.push(`G70 P100 Q${Q} F${f(n(g.ff))};`);
  } else {
    C("контур без черновых проходов");
    L.push("G00 X0 Z2;");
    pts.forEach((p, i) => L.push(`G01 X${f(p[0])} Z${f(p[1])}${i === 0 ? ` F${f(n(g.ff))}` : ""};`));
    L.push(`G00 X${f(stockD + 2)} Z2;`);
  }
  zones.forEach((zn, k) => {
    const ap = Math.max(n(g.ap), 0.1),
      u = n(g.u),
      xe = zn.env,
      xs = f(stockD + 2);
    const xmin = Math.min(...zn.poly.map((p) => p[0]));
    C(`обратный участок ${k + 1}: перевёрнутый резец, ход в +Z`);
    if (k === 0) {
      L.push("G28 U0 W0;");
      L.push(`T${g.tMirror};`);
      L.push(`G96 S${f(n(g.vc))} ${g.mSp};`);
    }
    L.push(`G00 X${xs} Z${f(Math.max(...zn.poly.map((p) => p[1])) + 2)};`);
    for (let lv = xe - 2 * ap; lv > xmin + 1e-6; lv -= 2 * ap) {
      const lx = lv + u;
      intervals(zn.poly, lx).forEach(([a, b]) => {
        L.push(`G00 Z${f(a)};`);
        L.push(`G01 X${f(lx)} F${f(n(g.fr))};`);
        L.push(`G01 Z${f(b)};`);
        L.push(`G00 X${xs};`);
      });
    }
    const rev = [...zn.poly].reverse();
    L.push(`G00 Z${f(rev[0][1])};`);
    rev.forEach((p, i) => L.push(`G01 X${f(p[0])} Z${f(p[1])}${i === 0 ? ` F${f(n(g.ff))}` : ""};`));
    L.push(`G00 X${xs};`);
  });
  if (zones.length) {
    L.push("G28 U0 W0;");
    L.push(`T${g.tTurn};`);
  }
  L.push("M09;");
  ranges
    .filter((r) => r.s.type === "thread")
    .forEach((r) => {
      const P = n(r.s.p),
        d = r.ds;
      if (P <= 0) return;
      const h = 0.6495 * P;
      const np = Math.max(3, Math.ceil(h / 0.35));
      L.push("G28 U0 W0;");
      L.push(`T${g.tThread};`);
      L.push("G97 G99 S" + f(n(g.thS)) + " M03;");
      L.push(`G00 X${f(d + 2)} Z${f(r.z0 + Math.max(3, 2 * P))};`);
      C(`резьба M${f(d)}x${f(P)}, h=${f(h)}`);
      const xs = [];
      for (let i = 1; i <= np; i++) xs.push(+(d - 2 * h * Math.sqrt(i / np)).toFixed(3));
      xs.push(xs[xs.length - 1]);
      xs.forEach((x, i) => L.push(i === 0 ? `G92 X${f(x)} Z${f(r.z1)} F${f(P)};` : `X${f(x)};`));
    });
  L.push("G28 U0 W0;");
  L.push("M05;");
  L.push("M30;");
  return { shape, pts, ranges, zEnd, mono, zones, code: L.join("\n") };
}

/* ---------- состояние ---------- */
const state = {
  secs: PRESET_SECS.map((s) => ({ ...s })),
  g: { ...PRESET_G },
  msg: "",
};

let msgTimer = null;
const flash = (t) => {
  state.msg = t;
  render();
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => {
    state.msg = "";
    render();
  }, 1800);
};

function setG(key, value) {
  state.g[key] = value;
  render();
}

function setS(id, key, value) {
  const s = state.secs.find((x) => x.id === id);
  if (s) s[key] = value;
  render();
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.secs.length) return;
  const b = state.secs;
  [b[i], b[j]] = [b[j], b[i]];
  render();
}

async function copyCode(code) {
  const ta = document.getElementById("code");
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    ta?.select();
    document.execCommand("copy");
  }
  flash("Скопировано");
}

function saveCode(code) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.g.name || "O0001"}.${state.g.ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash("Файл сохранён");
}

/* ---------- превью ---------- */
function previewSvg(geo, g) {
  const sD = n(g.stockD),
    sL = n(g.stockL);
  const total = Math.max(sL, -geo.zEnd);
  const m = 14,
    W = total + 2 * m,
    H = sD + 2 * m + 8,
    cy = m + 4 + sD / 2;
  const X = (z) => m + total + z;
  const Y = (r) => cy - r;
  const fs = Math.max(sD * 0.06, 2.4);
  const poly =
    geo.shape.map(([d, z]) => `${X(z)},${Y(d / 2)}`).join(" ") + ` ${X(geo.zEnd)},${cy} ${X(0)},${cy}`;

  let halves = "";
  [1, -1].forEach((k) => {
    let threads = "";
    geo.ranges
      .filter((r) => r.s.type === "thread" && n(r.s.p) > 0)
      .forEach((r) => {
        const P = n(r.s.p),
          h = 0.6495 * P,
          cnt = Math.min(Math.ceil((r.z0 - r.z1) / P), 90);
        const pp = [];
        for (let i = 0; i <= cnt; i++) {
          const za = Math.max(r.z0 - i * P, r.z1),
            zb = Math.max(za - P / 2, r.z1);
          pp.push(`${X(za)},${Y(r.ds / 2)}`, `${X(zb)},${Y(r.ds / 2 - h)}`);
        }
        threads += `<polyline points="${pp.join(" ")}" fill="none" stroke="#0f766e" stroke-width="0.35"/>`;
      });
    halves += `<g transform="translate(0 ${cy}) scale(1 ${k}) translate(0 ${-cy})">
      <polygon points="${poly}" fill="#e7e5e4" stroke="#292524" stroke-width="0.5" stroke-linejoin="round"/>
      ${threads}
    </g>`;
  });

  let labels = "";
  geo.ranges.forEach((r, i) => {
    const xm = X((r.z0 + r.z1) / 2);
    const txt =
      r.s.type === "thread"
        ? `M${f(r.ds)}x${f(n(r.s.p))}`
        : r.s.type === "cone"
          ? `Ø${f(r.ds)}→${f(r.de)}`
          : `Ø${f(r.ds)}`;
    labels += `<g font-size="${fs}" text-anchor="middle" fill="#44403c">
      <text x="${xm}" y="${Y(Math.max(r.ds, r.de) / 2) - 1.5}">${txt}</text>
      <text x="${xm}" y="${cy + sD / 2 + fs * 1.6}" fill="#0f766e">${f(r.z0 - r.z1)}</text>
      <text x="${xm}" y="${cy + sD / 2 + fs * 3}" fill="#a8a29e" font-size="${fs * 0.8}">${i + 1}</text>
    </g>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="preview" aria-label="Эскиз вала">
    <rect x="${X(-sL)}" y="${Y(sD / 2)}" width="${sL}" height="${sD}" fill="none" stroke="#a8a29e" stroke-dasharray="2 1.5" stroke-width="0.3"/>
    <line x1="${m - 6}" x2="${W - m + 6}" y1="${cy}" y2="${cy}" stroke="#0f766e" stroke-width="0.25" stroke-dasharray="6 1.5 1 1.5"/>
    ${halves}
    ${labels}
    <text x="${X(0) + 1}" y="${cy - sD / 2 - 3}" font-size="${fs}" fill="#b45309">Z0</text>
    <line x1="${X(0)}" x2="${X(0)}" y1="${cy - sD / 2 - 2}" y2="${cy + sD / 2 + 2}" stroke="#b45309" stroke-width="0.3"/>
  </svg>`;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fld(label, value, onAttr, extraClass = "") {
  return `<label class="fld ${extraClass}">${label}
    <input inputmode="decimal" value="${esc(value)}" ${onAttr}/>
  </label>`;
}

function renderSection(s, i, len) {
  const typeOpts = [
    ["cyl", "Цилиндр"],
    ["cone", "Конус"],
    ["thread", "Резьба"],
  ]
    .map(([v, t]) => `<option value="${v}"${s.type === v ? " selected" : ""}>${t}</option>`)
    .join("");

  let fields = fld(
    s.type === "thread" ? "Наружный Ø" : s.type === "cone" ? "Ø начала" : "Ø",
    s.d,
    `data-sec="${s.id}" data-key="d"`,
  );
  if (s.type === "cone") fields += fld("Ø конца", s.d2, `data-sec="${s.id}" data-key="d2"`);
  if (s.type === "thread") fields += fld("Шаг P", s.p, `data-sec="${s.id}" data-key="p"`);
  fields += fld("Длина", s.L, `data-sec="${s.id}" data-key="L"`);
  fields += fld("Фаска в начале", s.cs, `data-sec="${s.id}" data-key="cs"`);
  fields += fld("Фаска в конце", s.ce, `data-sec="${s.id}" data-key="ce"`);

  return `<div class="sec" data-id="${s.id}">
    <div class="sec-head">
      <span class="sec-num">${i + 1}</span>
      <select class="select-auto" data-sec="${s.id}" data-key="type">${typeOpts}</select>
      <div class="row ml-auto">
        <button type="button" class="btn" data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button type="button" class="btn" data-act="down" data-i="${i}" ${i === len - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="btn" data-act="dup" data-i="${i}">Копия</button>
        <button type="button" class="btn" data-act="del" data-id="${s.id}">Удалить</button>
      </div>
    </div>
    <div class="grid cols-3">${fields}</div>
  </div>`;
}

function render() {
  const { secs, g } = state;
  const geo = build(secs, g);
  const total = secs.reduce((s, x) => s + Math.max(n(x.L), 0), 0);
  const warn = [];
  if (total > n(g.stockL)) warn.push(`Длина вала ${f(total)} мм больше заготовки ${f(n(g.stockL))} мм.`);
  if (secs.some((s) => Math.max(n(s.d), n(s.d2)) > n(g.stockD)))
    warn.push("Диаметр секции больше диаметра заготовки.");
  if (g.mode === "G71" && !geo.mono)
    warn.push(
      "Профиль не монотонный (диаметр уменьшается к патрону): G71 неприменим, выберите G73 или чистовой контур.",
    );
  if (geo.zones.length)
    warn.push(
      `Обратных участков: ${geo.zones.length}. T${g.tTurn} ведёт прямой контур (G71/G70), T${g.tMirror} снимает остальное ходом в +Z.`,
    );
  if (g.mode === "G73" && !geo.zones.length)
    warn.push("G73: суммарный припуск U и W рассчитаны автоматически - проверьте в симуляторе.");

  const root = document.getElementById("app");
  const active = document.activeElement;
  const focusKey =
    active && active.dataset
      ? active.dataset.sec
        ? `sec:${active.dataset.sec}:${active.dataset.key}`
        : active.dataset.g
          ? `g:${active.dataset.g}`
          : active.id || null
      : null;
  const selStart = active && "selectionStart" in active ? active.selectionStart : null;
  const selEnd = active && "selectionEnd" in active ? active.selectionEnd : null;

  root.innerHTML = `
    <div class="col">
      <section class="panel">
        <h2>Заготовка и режимы</h2>
        <div class="grid cols-4">
          ${fld("Ø заготовки", g.stockD, 'data-g="stockD"')}
          ${fld("Длина заготовки", g.stockL, 'data-g="stockL"')}
          <label class="fld">Черновой цикл
            <select data-g="mode">
              <option value="G71"${g.mode === "G71" ? " selected" : ""}>G71 продольный</option>
              <option value="G73"${g.mode === "G73" ? " selected" : ""}>G73 по контуру</option>
              <option value="G01"${g.mode === "G01" ? " selected" : ""}>Только контур G01</option>
            </select>
          </label>
          ${fld("Vc, м/мин (G96)", g.vc, 'data-g="vc"')}
          ${fld("Макс. S, об/мин (G50)", g.smax, 'data-g="smax"')}
          ${fld("Подача черн., мм/об", g.fr, 'data-g="fr"')}
          ${fld("Подача чист., мм/об", g.ff, 'data-g="ff"')}
          ${fld("Глубина прохода (рад.)", g.ap, 'data-g="ap"')}
          ${fld("Отвод R", g.r, 'data-g="r"')}
          ${fld("Припуск U (диам.)", g.u, 'data-g="u"')}
          ${fld("Припуск W", g.w, 'data-g="w"')}
          ${fld("Резец T", g.tTurn, 'data-g="tTurn"')}
          ${fld("Резьбовой T", g.tThread, 'data-g="tThread"')}
          ${fld("S резьбы, об/мин", g.thS, 'data-g="thS"')}
          ${fld("Перевёрнутый резец T", g.tMirror, 'data-g="tMirror"')}
          <label class="fld">Шпиндель с ним
            <select data-g="mSp">
              <option value="M04"${g.mSp === "M04" ? " selected" : ""}>M04 (против часовой)</option>
              <option value="M03"${g.mSp === "M03" ? " selected" : ""}>M03 (по часовой)</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" data-g="mirror"${g.mirror ? " checked" : ""}/>
            обратные участки обрабатывать перевёрнутым резцом
          </label>
        </div>
      </section>
      <section class="panel">
        <div class="row between">
          <h2 style="margin:0">Секции</h2>
          <div class="row">
            <button type="button" class="btn" data-act="add">+ Секция</button>
            <button type="button" class="btn" data-act="preset">Пример</button>
          </div>
        </div>
        <div id="sections">
          ${secs.map((s, i) => renderSection(s, i, secs.length)).join("") || '<p class="empty">Добавьте первую секцию.</p>'}
        </div>
      </section>
    </div>
    <aside class="col result">
      <section class="panel result-panel">
        <h2>Эскиз (длина ${f(total)} мм)</h2>
        ${previewSvg(geo, g)}
        ${warn.length ? `<ul class="warn">${warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        <div class="result-code">
          <div class="row end">
            <h2 class="mr-auto" style="margin:0">Управляющая программа</h2>
            <label class="inline">Имя
              <input class="w-24" data-g="name" value="${esc(g.name)}"/>
            </label>
            <label class="inline">Формат
              <select class="select-auto" data-g="ext">
                ${["nc", "txt", "tap", "ngc", "ncc"].map((x) => `<option${g.ext === x ? " selected" : ""}>${x}</option>`).join("")}
              </select>
            </label>
            <label class="check" style="grid-column:auto;padding-bottom:0.35rem">
              <input type="checkbox" data-g="comments"${g.comments ? " checked" : ""}/>
              комментарии
            </label>
          </div>
          <textarea id="code" class="code" readonly spellcheck="false">${esc(geo.code)}</textarea>
          <div class="actions">
            <button type="button" class="btn-primary" data-act="copy">Копировать</button>
            <button type="button" class="btn-secondary" data-act="save">Сохранить в файл</button>
            <span class="msg">${esc(state.msg)}</span>
          </div>
        </div>
      </section>
    </aside>
  `;

  if (focusKey) {
    let el = null;
    if (focusKey.startsWith("sec:")) {
      const [, id, key] = focusKey.split(":");
      el = root.querySelector(`[data-sec="${id}"][data-key="${key}"]`);
    } else if (focusKey.startsWith("g:")) {
      el = root.querySelector(`[data-g="${focusKey.slice(2)}"]`);
    } else if (focusKey) {
      el = document.getElementById(focusKey);
    }
    if (el && typeof el.focus === "function") {
      el.focus();
      if (selStart != null && "setSelectionRange" in el) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // store code for actions
  root.dataset.code = geo.code;
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.g) {
    const key = t.dataset.g;
    state.g[key] = t.type === "checkbox" ? t.checked : t.value;
    render();
    return;
  }
  if (t.dataset.sec && t.dataset.key) {
    setS(+t.dataset.sec, t.dataset.key, t.value);
  }
}

function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  const root = document.getElementById("app");
  if (act === "add") {
    state.secs.push(mk({}));
    render();
  } else if (act === "preset") {
    state.secs = PRESET_SECS.map((s) => ({ ...s, id: ++uid }));
    render();
  } else if (act === "up") {
    move(+btn.dataset.i, -1);
  } else if (act === "down") {
    move(+btn.dataset.i, 1);
  } else if (act === "dup") {
    const i = +btn.dataset.i;
    const s = state.secs[i];
    state.secs.splice(i + 1, 0, { ...s, id: ++uid });
    render();
  } else if (act === "del") {
    const id = +btn.dataset.id;
    state.secs = state.secs.filter((x) => x.id !== id);
    render();
  } else if (act === "copy") {
    copyCode(root.dataset.code || "");
  } else if (act === "save") {
    saveCode(root.dataset.code || "");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("click", onClick);
  render();
});
