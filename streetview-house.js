/*
 * Streetview House
 * A Lovelace card for the people in the house: a line drawing of the street
 * facade (the counterpart of Gardenview House) with the arched front door and
 * the big front window. Whoever is home stands behind the window; the room
 * light and the door light are on while anyone is home (or follow real lights);
 * the door light pulses while someone is on the way home; the cat comes and goes.
 * The picture is the whole card; hovering a person shows presence and since when.
 *
 * Read only: the card calls no services. Taps go through Home Assistant's own
 * action handler (hass-action), more-info of the person by default.
 *
 * https://github.com/BarBaar44/streetview-house  (MIT)
 */

// Everything sits in one block so the top-level names cannot clash with the
// sister cards when the files are loaded as classic scripts.
{
const VERSION = "0.1.0";

const SV_HOLD_MS = 500;
const SV_MOVE_PX = 8;
const SV_TICK_MS = 60000; // "since" texts and cat visits follow the clock
const SV_CAT_SLOT_MS = 15 * 60000; // the cat decides every quarter of an hour
const SV_MAX_PEOPLE = 4; // the window has room for four

/* Bb's household. Per person: entity, name, portrait, height (relative), phone sensors, proximity. */
const SV_PEOPLE = [
  {
    entity: "person.bart_baars", name: "Bart", portrait: "/local/streetview-house/bart.webp", height: 1,
    distance: "sensor.home_bart_baars_distance", direction: "sensor.home_bart_baars_direction_of_travel",
  },
  {
    entity: "person.gijs_baars", name: "Gijs", portrait: "/local/streetview-house/gijs.webp", height: 0.98,
    distance: null, direction: null,
  },
  {
    entity: "person.marjolijn_bongers", name: "Marjolijn", portrait: "/local/streetview-house/marjolijn.webp", height: 0.93,
    distance: null, direction: null,
  },
  {
    entity: "person.tim_baars", name: "Tim", portrait: "/local/streetview-house/tim.webp", height: 0.88,
    distance: null, direction: null,
  },
];
const SV_PERSON_KEYS = ["entity", "name", "portrait", "height", "distance", "direction"];
const SV_PERSON_ROLES = ["distance", "direction"];

const SV_DEFAULTS = {
  cat: true,
  entities: {
    room_light: null, // light in the front room; null: on while anyone is home
    door_light: null, // hall light behind the door grille; null: on while anyone is home
  },
};

const SV_BAD = ["unknown", "unavailable", "none", ""];
const svNum = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const svKey = (v) => String(v == null ? "" : v).trim().toLowerCase();
const svF = (n) => (Math.round(n * 100) / 100).toString();
const svEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const svIsId = (v) => typeof v === "string" && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
const svDefaultsFor = (entity) => SV_PEOPLE.find((p) => p.entity === entity) || null;

/* ---- the drawing ---------------------------------------------------------- */

/* Camera: the Gardenview camera, here on the street side (74 degrees to the wall). */
const SV = (() => {
  const deg = Math.PI / 180, tgt = [2.2, 1.55, 0.2], D = 16, ang = 74 * deg;
  const cam = [tgt[0] - D * Math.cos(ang), 1.9, D * Math.sin(ang)];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const f = norm(sub(tgt, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const proj = (p) => { const d = sub(p, cam); const z = dot(d, f); return [dot(d, r) / z * 330, -dot(d, u) / z * 330]; };
  const vbFor = (xa, xb) => {
    const e = [[xa, 0.5, 0], [xb, 0.5, 0], [xa, 2.62, 0], [xb, 2.62, 0], [xb, 2.62, 0.32], [xa, 0.5, 0.1]].map(proj);
    const xs = e.map((p) => p[0]), ys = e.map((p) => p[1]);
    const x0 = Math.min(...xs) - 2, y0 = Math.min(...ys) - 2;
    return [x0, y0, Math.max(...xs) + 2 - x0, Math.max(...ys) + 1 - y0];
  };
  return { proj, cam, wide: vbFor(0.0, 4.3), narrow: vbFor(1.42, 4.3) };
})();

/*
 * The scene. o: { lit (room lamp), door (door light on), pulse (door light pulses),
 * people: [{ i, pic: { url, w, h } | null, height, color }] (only those at home),
 * cat: null | { alone } }. id: unique per card, for the defs.
 */
function svScene(o, id) {
  const { proj } = SV;
  const F = svF;
  const pts = (a) => a.map((p) => proj(p).map(F).join(",")).join(" ");
  const poly = (a, fill, extra = "") => `<polygon points="${pts(a)}" fill="${fill}" ${extra}/>`;
  const line = (a, b, extra = "") => { const p = proj(a), q = proj(b); return `<line x1="${F(p[0])}" y1="${F(p[1])}" x2="${F(q[0])}" y2="${F(q[1])}" ${extra}/>`; };
  const rect = (x0, x1, y0, y1, z = 0) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const S = 'stroke="#111" stroke-width="1.3" stroke-linejoin="round"';
  const T = 'stroke="#111" stroke-width=".8"';
  const box = (x0, x1, y0, y1, z0, z1, top, front, side, bottom, st = T) => {
    const xs = SV.cam[0] > x1 ? x1 : x0;
    return (bottom ? poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], bottom, st) : "")
      + poly([[xs, y0, z1], [xs, y0, z0], [xs, y1, z0], [xs, y1, z1]], side, st)
      + poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], front, st)
      + (top ? poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top, st) : "");
  };
  let s = "", defs = "";

  // brick wall (street side: darker brown)
  // brick wall, wider than any view so a wide card shows more wall
  // (taller than the view too, so the slanted top and bottom never leave a gap)
  s += poly(rect(-6, 10, 0.5, 3.6), "#7d5d4b");
  for (let y = 0.56; y < 3.6; y += 0.14) s += line([-6, y, 0], [10, y, 0], 'stroke="#9a7a64" stroke-width=".45"');
  s += poly(rect(-6, 10, -0.6, 0.5, 0.001), "#5a4236");   // darker plinth along the pavement
  for (let y = 0.36; y > -0.6; y -= 0.14) s += line([-6, y, 0.001], [10, y, 0.001], 'stroke="#6b5144" stroke-width=".45"');
  s += line([-6, 0.5, 0.002], [10, 0.5, 0.002], 'stroke="#111" stroke-width="1.3"');

  // ---- arched front door: brick arch, cream frame, dark plank door, grille window ----
  const arch = (x0, x1, y0, ys, z, n = 18) => {
    const cx = (x0 + x1) / 2, r = (x1 - x0) / 2, a = [[x0, y0, z]];
    for (let i = 0; i <= n; i++) { const t = Math.PI - Math.PI * i / n; a.push([cx + r * Math.cos(t), ys + r * Math.sin(t), z]); }
    a.push([x1, y0, z]);
    return a;
  };
  const DX0 = 0.42, DX1 = 1.24, SPR = 1.86, BOT = 0.5;
  s += poly(arch(DX0 - 0.16, DX1 + 0.16, BOT, SPR, 0.002), "#6b4a3a", S);
  {
    const cx = (DX0 + DX1) / 2, r0 = (DX1 - DX0) / 2 + 0.03, r1 = r0 + 0.13;
    for (let i = 1; i < 12; i++) {
      const t = Math.PI * i / 12;
      s += line([cx + r0 * Math.cos(t), SPR + r0 * Math.sin(t), 0.003], [cx + r1 * Math.cos(t), SPR + r1 * Math.sin(t), 0.003], 'stroke="#8a6652" stroke-width=".6"');
    }
  }
  s += poly(arch(DX0 - 0.05, DX1 + 0.05, BOT, SPR, 0.004), "#f2efe6", S);
  s += poly(arch(DX0 + 0.03, DX1 - 0.03, BOT, SPR, 0.008), "#4a3226", S);
  for (const x of [0.58, 0.72, 0.86, 1.0, 1.12]) {
    const r = (DX1 - DX0) / 2 - 0.03, cx = (DX0 + DX1) / 2, dy = Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
    s += line([x, BOT, 0.009], [x, SPR + dy - 0.02, 0.009], 'stroke="#3a261c" stroke-width=".6"');
  }
  const gx0 = 0.72, gx1 = 0.94, gy0 = 0.75, gy1 = 1.92;
  s += `<g class="doorlight${o.pulse ? " pulse" : ""}">` + poly(rect(gx0, gx1, gy0, gy1, 0.01), o.door || o.pulse ? "#ffd54f" : "#2a2a2a", S) + "</g>";
  for (const x of [0.775, 0.83, 0.885]) s += line([x, gy0, 0.012], [x, gy1, 0.012], 'stroke="#111" stroke-width=".7"');
  for (let y = gy0 + 0.24; y < gy1; y += 0.24) {
    const a = proj([gx0, y, 0.012]), b = proj([(gx0 + gx1) / 2, y + 0.1, 0.012]), c = proj([gx1, y, 0.012]);
    s += `<path d="M${F(a[0])} ${F(a[1])}Q${F(b[0])} ${F(b[1])} ${F(c[0])} ${F(c[1])}" fill="none" stroke="#111" stroke-width=".7"/>`;
  }
  s += line([1.13, 1.46, 0.02], [1.13, 1.6, 0.02], 'stroke="#c9a227" stroke-width="1.6" stroke-linecap="round"');

  // ---- carriage lantern (not used, so always off) ----
  s += line([1.6, 2.16, 0], [1.6, 2.16, 0.16], 'stroke="#111" stroke-width="1.6"');
  s += box(1.54, 1.66, 1.86, 2.12, 0.1, 0.22, "#111", "#3a3a3a", "#2e2e2e", null, 'stroke="#111" stroke-width="1.1"');
  s += box(1.52, 1.68, 2.12, 2.15, 0.08, 0.24, "#111", "#111", "#111");

  // ---- front window: cream frame, one large pane, the front room behind it ----
  const WX0 = 1.95, WX1 = 4.15, WY0 = 0.72, WY1 = 2.3, fw = 0.08;
  s += poly(rect(WX0 - 0.06, WX1 + 0.06, WY0 - 0.02, WY1 + 0.04, 0.003), "#f2efe6", S);
  const gq = rect(WX0 + fw, WX1 - fw, WY0 + fw, WY1 - fw, 0.006).map(proj);
  const gxs = gq.map((v) => v[0]), gys = gq.map((v) => v[1]);
  const bx = Math.min(...gxs), by = Math.min(...gys), bw = Math.max(...gxs) - bx, bh = Math.max(...gys) - by;
  const gpts = gq.map((v) => v.map(F).join(",")).join(" ");
  defs += `<clipPath id="${id}-glass"><polygon points="${gpts}"/></clipPath>`;
  const lit = o.lit;
  let r = `<g clip-path="url(#${id}-glass)">`;
  r += `<rect x="${F(bx)}" y="${F(by)}" width="${F(bw)}" height="${F(bh)}" fill="${lit ? "#bfe0d6" : "#1b2224"}"/>`;
  if (lit) { // pendant lamp
    const lx = bx + bw * 0.5, ly = by + bh * 0.1, u = bh / 100;
    r += `<circle cx="${F(lx)}" cy="${F(ly + 3 * u)}" r="${F(14 * u)}" fill="#ffd54f" opacity=".35"/>`;
    r += `<line x1="${F(lx)}" y1="${F(by)}" x2="${F(lx)}" y2="${F(ly)}" stroke="#111" stroke-width=".6"/>`;
    r += `<path d="M${F(lx - 4 * u)} ${F(ly + 5 * u)}Q${F(lx - 3.6 * u)} ${F(ly)} ${F(lx)} ${F(ly)}Q${F(lx + 3.6 * u)} ${F(ly)} ${F(lx + 4 * u)} ${F(ly + 5 * u)}Z" fill="#2b2b2b" stroke="#111" stroke-width=".6"/>`;
    r += `<ellipse cx="${F(lx)}" cy="${F(ly + 5 * u)}" rx="${F(4 * u)}" ry="${F(0.9 * u)}" fill="#ffe082"/>`;
  }
  // people: a fixed spot each (the order of the people list), standing behind the glass
  const cwi = bw * 0.07, x0 = bx + cwi * 1.3, uw = bw - cwi * 2.6, slot = uw / SV_MAX_PEOPLE;
  const one = (p) => {
    const cx = x0 + slot * (p.i + 0.5);
    if (!p.pic) { // no picture: a plain head and shoulders
      const h = bh * 0.5 * p.height, y = by + bh - h;
      return `<g class="person" data-i="${p.i}"><title>${svEsc(p.title || "")}</title><path d="M${F(cx - slot * 0.42)} ${F(by + bh + 2)}V${F(y + h * 0.66)}Q${F(cx - slot * 0.42)} ${F(y + h * 0.52)} ${F(cx - slot * 0.2)} ${F(y + h * 0.52)}H${F(cx + slot * 0.2)}Q${F(cx + slot * 0.42)} ${F(y + h * 0.52)} ${F(cx + slot * 0.42)} ${F(y + h * 0.66)}V${F(by + bh + 2)}Z" fill="${p.color}" stroke="#111" stroke-width=".8"/>`
        + `<ellipse cx="${F(cx)}" cy="${F(y + h * 0.28)}" rx="${F(h * 0.17)}" ry="${F(h * 0.22)}" fill="#e9b896" stroke="#111" stroke-width=".8"/></g>`;
    }
    const keep = 0.74; // the middle 74 % of the portrait: shoulders trimmed, so neighbours do not overlap
    const h = Math.min(bh * 0.66, slot * 0.96 * p.pic.h / (p.pic.w * keep)) * p.height, w = h * p.pic.w / p.pic.h;
    const y = by + bh - h + bh * 0.02, cid = `${id}-pc${p.i}`;
    defs += `<clipPath id="${cid}"><rect x="${F(cx - w * keep / 2)}" y="${F(y - 2)}" width="${F(w * keep)}" height="${F(h + 4)}" rx="${F(w * 0.06)}"/></clipPath>`;
    return `<g class="person" data-i="${p.i}"><title>${svEsc(p.title || "")}</title><image href="${svEsc(p.pic.url)}" x="${F(cx - w / 2)}" y="${F(y)}" width="${F(w)}" height="${F(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/></g>`;
  };
  r += o.people.map(one).join("");
  if (lit) r += `<rect x="${F(bx)}" y="${F(by)}" width="${F(bw)}" height="${F(bh)}" fill="#ffd54f" opacity=".14"/>`;
  // light curtains at both sides
  const cw = bw * 0.07;
  for (const cx of [bx, bx + bw - cw]) {
    r += `<rect x="${F(cx)}" y="${F(by)}" width="${F(cw)}" height="${F(bh)}" fill="${lit ? "#eeece6" : "#3a3e42"}" stroke="#111" stroke-width=".7"/>`;
    for (let k = 1; k < 3; k++) r += `<line x1="${F(cx + cw * k / 3)}" y1="${F(by)}" x2="${F(cx + cw * k / 3)}" y2="${F(by + bh)}" stroke="${lit ? "#cfccc4" : "#2c3033"}" stroke-width=".6"/>`;
  }
  r += `</g><polygon points="${gpts}" fill="none" ${T}/>`;
  s += r;

  // ---- the cat: white, black cap with a white blaze, black nose smudge, side stripes ----
  if (o.cat) {
    const sill = proj([WX0 + fw + 0.55, WY0 + fw, 0.006]);
    const used = new Set(o.people.map((p) => p.i));
    const free = [0, 1, 2, 3].filter((i) => !used.has(i));
    const cx = o.cat.alone ? sill[0] : x0 + slot * ((free.length ? free[0] : 1) + (free.length ? 0.5 : 0));
    const k = (proj([1, 0.5, 0])[1] - proj([1, 1.5, 0])[1]) * 0.42 / 42;
    const st = 'stroke="#111" stroke-width="1.1" stroke-linejoin="round"';
    const body = "M-12 0 C-15 -9 -13 -17 -6 -20 L6 -20 C13 -17 15 -9 12 0 Z";
    const head = "M-9.5 -25 C-10 -32 -6 -35.5 0 -35.5 C6 -35.5 10 -32 9.5 -25 C9 -19.5 5 -16.5 0 -16.5 C-5 -16.5 -9 -19.5 -9.5 -25 Z";
    defs += `<clipPath id="${id}-cb"><path d="${body}"/></clipPath><clipPath id="${id}-ch"><path d="${head}"/></clipPath>`;
    s += `<g transform="translate(${F(cx)} ${F(sill[1])}) scale(${F(k)})"><g class="cat">
      <g class="cat-tail"><path d="M11 -1 C18 -1 19 -6 16 -9" fill="none" stroke="#111" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M11 -1 C18 -1 19 -6 16 -9" fill="none" stroke="#1d1d1d" stroke-width="1.6" stroke-linecap="round"/></g>
      <path d="${body}" fill="#f6f4ef" ${st}/>
      <g clip-path="url(#${id}-cb)" fill="#1d1d1d">
        <path d="M-15 -4 C-10 -8 -8 -13 -9 -21 L-5.5 -21 C-4.5 -13 -7 -7 -13 -1 Z"/>
        <path d="M-15 -12 C-12 -14 -12 -17 -12.5 -21 L-10 -21 C-9 -16 -10 -12 -14 -9 Z"/>
        <path d="M15 -8 C11 -11 10 -15 10.5 -21 L13 -21 C13 -16 14 -12 16 -11 Z"/>
      </g>
      <path d="${body}" fill="none" ${st}/>
      <path d="M-5 0 C-5 -3 -2 -3 -2 0 M2 0 C2 -3 5 -3 5 0" fill="#f6f4ef" stroke="#111" stroke-width=".9"/>
      <g class="cat-head"><g class="cat-ear"><path d="M-8.5 -30 L-10 -41 L-2 -34.5 Z" fill="#1d1d1d" ${st}/><path d="M-7.8 -32.5 L-8.6 -38.2 L-4.6 -34.6 Z" fill="#e8a7a7"/></g>
      <path d="M8.5 -30 L10 -41 L2 -34.5 Z" fill="#1d1d1d" ${st}/><path d="M7.8 -32.5 L8.6 -38.2 L4.6 -34.6 Z" fill="#e8a7a7"/>
      <path d="${head}" fill="#f6f4ef"/>
      <g clip-path="url(#${id}-ch)" fill="#1d1d1d">
        <path d="M-11 -37 L-1.3 -37 C-1.6 -31 -3.5 -27.5 -11 -25.5 Z"/>
        <path d="M11 -37 L1.3 -37 C1.6 -31 3.5 -27.5 11 -25.5 Z"/>
        <path d="M-1.4 -26.5 C-3.4 -23.5 -4.2 -20.5 -2.5 -19 C-0.5 -18 1.6 -19 1.9 -20.8 C2.1 -23 1.2 -25 0.4 -26.5 Z"/>
        <path d="M-5.2 -18.8 C-4 -17.6 -2.4 -17.6 -1.4 -18.6 C-2.6 -19.6 -4 -19.8 -5.2 -18.8 Z"/>
      </g>
      <path d="${head}" fill="none" ${st}/>
      <g class="cat-eyes"><ellipse cx="-4" cy="-26.6" rx="1.9" ry="1.5" fill="#d9a441" stroke="#111" stroke-width=".7"/><ellipse cx="-4" cy="-26.6" rx=".45" ry="1.2" fill="#111"/>
      <ellipse cx="4" cy="-26.6" rx="1.9" ry="1.5" fill="#d9a441" stroke="#111" stroke-width=".7"/><ellipse cx="4" cy="-26.6" rx=".45" ry="1.2" fill="#111"/></g>
      <path d="M-0.9 -21.2 L0.9 -21.2 L0 -20 Z" fill="#111"/></g>
    </g></g>`;
  }

  // ---- the glass itself, over everything behind it ----
  {
    const g = `${id}-gl`;
    defs += `<linearGradient id="${g}-sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1a20" stop-opacity="${lit ? 0.32 : 0.2}"/><stop offset=".35" stop-color="#0d1a20" stop-opacity="0"/></linearGradient>`
      + `<linearGradient id="${g}-tint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8eef7" stop-opacity="${lit ? 0.2 : 0.06}"/><stop offset=".6" stop-color="#9fc3d2" stop-opacity="${lit ? 0.1 : 0.04}"/><stop offset="1" stop-color="#d8eef7" stop-opacity="${lit ? 0.18 : 0.08}"/></linearGradient>`
      + `<filter id="${g}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${F(bh * 0.05)}"/></filter>`;
    let fx = `<g clip-path="url(#${id}-glass)" pointer-events="none">`;
    fx += `<rect x="${F(bx)}" y="${F(by)}" width="${F(bw)}" height="${F(bh)}" fill="url(#${g}-tint)"/>`;
    // the street reflected: a tree and the houses across, soft and faint
    fx += `<g filter="url(#${g}-blur)" opacity="${lit ? 0.16 : 0.22}">`
      + `<ellipse cx="${F(bx + bw * 0.78)}" cy="${F(by + bh * 0.12)}" rx="${F(bw * 0.2)}" ry="${F(bh * 0.2)}" fill="#5f8f55"/>`
      + `<ellipse cx="${F(bx + bw * 0.95)}" cy="${F(by + bh * 0.3)}" rx="${F(bw * 0.1)}" ry="${F(bh * 0.22)}" fill="#4d7a47"/>`
      + `<rect x="${F(bx + bw * 0.05)}" y="${F(by - bh * 0.05)}" width="${F(bw * 0.38)}" height="${F(bh * 0.2)}" fill="#9a6a55"/></g>`;
    fx += `<rect x="${F(bx)}" y="${F(by)}" width="${F(bw)}" height="${F(bh)}" fill="url(#${g}-sh)"/>`;
    fx += `<path d="M${F(bx + bw * 0.5)} ${F(by)}l${F(-bw * 0.26)} ${F(bh)}h${F(bw * 0.05)}l${F(bw * 0.26)} ${F(-bh)}Z M${F(bx + bw * 0.6)} ${F(by)}l${F(-bw * 0.26)} ${F(bh)}h${F(bw * 0.018)}l${F(bw * 0.26)} ${F(-bh)}Z" fill="#fff" opacity="${lit ? 0.2 : 0.13}"/>`;
    fx += `<path class="sweep" style="--sv-sweep:${F(bw * 1.4)}px" d="M${F(bx - bw * 0.1)} ${F(by)}l${F(-bw * 0.3)} ${F(bh)}h${F(bw * 0.12)}l${F(bw * 0.3)} ${F(-bh)}Z" fill="#fff" opacity="0"/>`;
    fx += "</g>";
    fx += `<polyline points="${F(gq[3][0])},${F(gq[3][1])} ${F(gq[0][0])},${F(gq[0][1])} ${F(gq[1][0])},${F(gq[1][1])}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width=".8" pointer-events="none"/>`;
    s += fx;
  }

  // stone sill and white awning
  s += box(WX0 - 0.1, WX1 + 0.1, WY0 - 0.08, WY0 - 0.02, 0, 0.12, "#cfcfcf", "#b5b5b5", "#9e9e9e");
  s += box(WX0 - 0.18, WX1 + 0.18, 2.4, 2.52, 0, 0.3, "#fafafa", "#f2efe6", "#e6e2d6", "#d9d4c6");
  return `<defs>${defs}</defs>${s}`;
}

/* ---- styles --------------------------------------------------------------- */

const SV_STYLE = `
  ha-card {
    height: 100%; box-sizing: border-box; overflow: hidden; position: relative;
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .pic { position: absolute; inset: 0; }
  .pic svg { width: 100%; height: 100%; display: block; }
  .person { cursor: pointer; }

  .doorlight.pulse { animation: sv-door 2.4s ease-in-out infinite; }
  @keyframes sv-door { 50% { opacity: .45; } }
  .sweep { animation: sv-sweep 14s ease-in-out infinite; }
  @keyframes sv-sweep { 0%, 70% { transform: translateX(0); opacity: 0; } 74% { opacity: .22; } 92% { opacity: .18; } 96%, 100% { transform: translateX(var(--sv-sweep, 160px)); opacity: 0; } }
  .cat { animation: sv-cat-in 1.2s ease-out; }
  @keyframes sv-cat-in { from { opacity: 0; transform: translateY(12px); } }
  .cat-tail { transform-box: view-box; transform-origin: 11px -1px; animation: sv-tail 2.8s ease-in-out infinite; }
  @keyframes sv-tail { 0%, 100% { transform: rotate(-6deg); } 50% { transform: rotate(14deg); } }
  .cat-head { transform-box: view-box; transform-origin: 0 -18px; animation: sv-head 9s ease-in-out infinite; }
  @keyframes sv-head { 0%, 30%, 100% { transform: rotate(0); } 38%, 55% { transform: rotate(-9deg); } 63% { transform: rotate(4deg); } 70% { transform: rotate(0); } }
  .cat-ear { transform-box: view-box; transform-origin: -6px -31px; animation: sv-ear 6.5s linear infinite; }
  @keyframes sv-ear { 0%, 88%, 100% { transform: rotate(0); } 90% { transform: rotate(-14deg); } 92% { transform: rotate(0); } 94% { transform: rotate(-10deg); } 96% { transform: rotate(0); } }
  .cat-eyes { transform-box: view-box; transform-origin: 0 -26.6px; animation: sv-blink 4.7s linear infinite; }
  @keyframes sv-blink { 0%, 44%, 50%, 100% { transform: scaleY(1); } 47% { transform: scaleY(.1); } 70%, 82% { transform: scaleY(.35); } }

  @media (prefers-reduced-motion: reduce) {
    .doorlight.pulse, .sweep, .cat, .cat-tail, .cat-head, .cat-ear, .cat-eyes { animation: none !important; }
  }
`;

/* ---- the card ------------------------------------------------------------- */

class StreetviewHouse extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._seen = Object.create(null);
    this._ids = [];
    this._tick = null;
    this._img = Object.create(null); // url -> { ok, w, h } once loaded or failed
    this._narrow = false;
    this._ro = null;
    this._uid = `sv${Math.random().toString(36).slice(2, 7)}`;
  }

  static getConfigElement() {
    return document.createElement("streetview-house-editor");
  }

  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    const c = config || {};
    const known = ["type", "people", "entities", "cat", "tap_action", "hold_action",
      "grid_options", "layout_options", "view_layout", "visibility", "card_mod"];
    for (const k of Object.keys(c)) {
      if (!known.includes(k)) throw new Error(`Unknown option '${k}'. Known: ${known.slice(1, 6).join(", ")}`);
    }
    // people: a list; a known entity takes Bb's defaults for the keys it leaves out, null switches a role off
    let list = SV_PEOPLE;
    if (c.people != null) {
      if (!Array.isArray(c.people)) throw new Error("people must be a list, e.g. - entity: person.me");
      if (c.people.length > SV_MAX_PEOPLE) throw new Error(`people: the window has room for ${SV_MAX_PEOPLE}`);
      list = c.people;
    }
    const people = list.map((p, n) => {
      if (typeof p === "string") p = { entity: p };
      if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(`people[${n}] must be a map with an entity`);
      for (const k of Object.keys(p)) {
        if (!SV_PERSON_KEYS.includes(k)) throw new Error(`people[${n}]: unknown key '${k}'. Known: ${SV_PERSON_KEYS.join(", ")}`);
      }
      if (!svIsId(p.entity)) throw new Error(`people[${n}].entity: '${p.entity}' is not an entity id`);
      const def = svDefaultsFor(p.entity) || {};
      const out = { entity: p.entity };
      for (const role of SV_PERSON_ROLES) {
        const v = role in p ? p[role] : def[role] || null;
        if (v !== null && v !== undefined && !svIsId(v)) throw new Error(`people[${n}].${role}: '${v}' is not an entity id (null switches it off)`);
        out[role] = v || null;
      }
      out.name = p.name != null ? String(p.name) : def.name || null;
      out.portrait = "portrait" in p ? (p.portrait ? String(p.portrait) : null) : def.portrait || null;
      const h = p.height == null ? (def.height || 0.95) : svNum(p.height);
      if (h === null || h < 0.5 || h > 1.2) throw new Error(`people[${n}].height must be a number from 0.5 to 1.2`);
      out.height = h;
      return out;
    });

    const ent = c.entities == null ? {} : c.entities;
    if (typeof ent !== "object" || Array.isArray(ent)) throw new Error("entities must be a map, e.g. room_light: light.living_room");
    for (const [k, v] of Object.entries(ent)) {
      if (!(k in SV_DEFAULTS.entities)) throw new Error(`entities: unknown role '${k}'. Known: ${Object.keys(SV_DEFAULTS.entities).join(", ")}`);
      if (v !== null && !svIsId(v)) throw new Error(`entities.${k}: '${v}' is not an entity id (null switches it off)`);
    }
    if (c.cat != null && typeof c.cat !== "boolean") throw new Error("cat must be true or false");
    for (const k of ["tap_action", "hold_action"]) {
      if (c[k] != null && (typeof c[k] !== "object" || Array.isArray(c[k]) || !c[k].action)) {
        throw new Error(`${k} must be an action, e.g. action: more-info`);
      }
    }

    this._config = {
      people,
      entities: { ...SV_DEFAULTS.entities, ...ent },
      cat: c.cat == null ? SV_DEFAULTS.cat : c.cat,
      tap_action: c.tap_action || { action: "more-info" },
      hold_action: c.hold_action || { action: "none" },
    };
    const ids = [];
    for (const p of people) for (const k of ["entity", ...SV_PERSON_ROLES]) if (p[k]) ids.push(p[k]);
    for (const v of Object.values(this._config.entities)) if (v) ids.push(v);
    this._ids = ids;
    this._seen = Object.create(null);
    this._build();
    for (const p of people) if (p.portrait) this._loadImage(p.portrait);
    if (this._hass) this._update();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = first;
    for (const id of this._ids) {
      const s = hass.states[id];
      if (s !== this._seen[id]) { this._seen[id] = s; changed = true; }
    }
    if (changed) this._update();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    clearInterval(this._tick);
    this._tick = setInterval(() => this._update(), SV_TICK_MS);
    if (typeof ResizeObserver !== "undefined" && this._el && !this._ro) {
      this._ro = new ResizeObserver((entries) => {
        const r = entries[0] && entries[0].contentRect;
        if (r && r.width && r.height) this._fit(r.width, r.height);
      });
      this._ro.observe(this._el.card);
    }
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._tick = null;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  }

  _now() {
    return Date.now();
  }

  getCardSize() {
    return 3;
  }

  getGridOptions() {
    return { columns: 12, rows: 3, min_columns: 6, min_rows: 3 };
  }

  /* ---- DOM, built once per config ------------------------------------------ */

  _build() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.shadowRoot.innerHTML = `
      <style>${SV_STYLE}</style>
      <ha-card>
        <div class="pic" role="img"><svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"></svg></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = { card: $("ha-card"), pic: $(".pic"), svg: $("svg") };
    this._sceneKey = null;
    this._fit(this._size ? this._size[0] : 520, this._size ? this._size[1] : 184, true);
    this._bindPress(this._el.pic, (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
      return t ? Number(t.getAttribute("data-i")) : null;
    });
    if (this.isConnected) this.connectedCallback();
  }

  /*
   * The picture fills the card. A card wider than the facade shows more wall on
   * both sides; a narrower one keeps the window and drops the door first.
   */
  _fit(w, h, force) {
    const key = `${Math.round(w)}x${Math.round(h)}`;
    if (key === this._fitKey && !force) return;
    this._fitKey = key;
    this._size = [w, h];
    const a = w / h;
    const [x0, y0, W, H] = SV.wide;
    const right = x0 + W, min = SV.narrow[2];
    let vb;
    if (a >= W / H) { const nw = H * a; vb = [x0 - (nw - W) / 2, y0, nw, H]; }
    else { const nw = Math.max(min, H * a); vb = [right - nw, y0, nw, H]; }
    this._el.svg.setAttribute("viewBox", vb.map(svF).join(" "));
  }

  /* Tap and hold through HA's action handler; who(e) gives the person index or null. */
  _bindPress(el, who) {
    let timer = null;
    let start = null;
    let held = false;
    let idx = null;
    const cancel = () => { clearTimeout(timer); timer = null; start = null; };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      idx = who(e);
      if (idx === null || idx === undefined) return;
      held = false;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { timer = null; held = true; this._run(this._config.hold_action, "hold", idx); }, SV_HOLD_MS);
    });
    el.addEventListener("pointermove", (e) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SV_MOVE_PX) cancel();
    });
    el.addEventListener("pointerup", () => {
      if (!start) return;
      const wasHeld = held;
      cancel();
      if (!wasHeld) this._run(this._config.tap_action, "tap", idx);
    });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const i = who(e);
      if (i === null || i === undefined) return;
      e.preventDefault();
      this._run(this._config.tap_action, "tap", i);
    });
  }

  /* Hands an action to Home Assistant's own handler, like built-in cards do. */
  _run(conf, kind, i) {
    if (!conf || conf.action === "none") return;
    const p = this._config.people[i];
    if (!p) return;
    window.dispatchEvent(new CustomEvent("haptic", { detail: kind === "hold" ? "medium" : "light" }));
    const config = { entity: p.entity };
    config[kind === "hold" ? "hold_action" : "tap_action"] = conf;
    this.dispatchEvent(new CustomEvent("hass-action", { bubbles: true, composed: true, detail: { config, action: kind } }));
  }

  /* Portraits: load once to learn the size; a missing file falls back to the person's picture in HA. */
  _loadImage(url) {
    if (this._img[url] || typeof Image === "undefined") return;
    this._img[url] = { ok: null, w: 3, h: 4 };
    const im = new Image();
    im.onload = () => { this._img[url] = { ok: true, w: im.naturalWidth || 3, h: im.naturalHeight || 4 }; this._sceneKey = null; this._update(); };
    im.onerror = () => { this._img[url] = { ok: false, w: 1, h: 1 }; this._sceneKey = null; this._update(); };
    im.src = url;
  }

  /* ---- state ---------------------------------------------------------------- */

  _lang() {
    const h = this._hass;
    return (h && h.locale && h.locale.language) || (h && h.language) || "en";
  }

  _since(s, now) {
    const t = Date.parse(s && (s.last_changed || s.last_updated));
    if (isNaN(t)) return "";
    const min = Math.max(0, Math.floor((now - t) / 60000));
    if (min < 1) return "now";
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h`;
    return `${Math.floor(h / 24)} d`;
  }

  _person(p, now) {
    const st = (id) => (id && this._hass ? this._hass.states[id] : undefined);
    const s = st(p.entity);
    const raw = s ? String(s.state) : "unknown";
    const key = svKey(raw);
    const name = p.name || (s && s.attributes && s.attributes.friendly_name ? String(s.attributes.friendly_name).split(" ")[0] : p.entity);
    let presence = "unknown";
    if (key === "home") presence = "home";
    else if (!SV_BAD.includes(key)) presence = "away";
    let line = "";
    let coming = false;
    if (presence === "home") line = `Home · ${this._since(s, now)}`;
    else if (presence === "away") {
      const dir = st(p.direction), dist = st(p.distance);
      const km = dist ? svNum(dist.state) : null;
      if (dir && svKey(dir.state) === "towards" && km !== null && km > 0) {
        const unit = (dist.attributes && dist.attributes.unit_of_measurement) || "km";
        const n = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
        line = `${n.toLocaleString(this._lang())} ${unit} → home`;
        coming = true;
      } else {
        const where = key === "not_home" ? "Away" : raw;
        line = `${where} · ${this._since(s, now)}`;
      }
    }
    const pic = s && s.attributes && s.attributes.entity_picture ? s.attributes.entity_picture : null;
    return { name, presence, line, coming, entityPicture: pic };
  }

  /* The cat decides every quarter of an hour: alone in the house it is there more often than not. */
  _catHere(alone, now) {
    if (!this._config.cat) return false;
    const slot = Math.floor(now / SV_CAT_SLOT_MS);
    const n = ((slot * 2654435761) >>> 0) % 10;
    return alone ? n < 6 : n < 3;
  }

  _on(role) {
    const id = this._config.entities[role];
    const s = id && this._hass ? this._hass.states[id] : undefined;
    return !!s && ["on", "true"].includes(svKey(s.state));
  }

  _update() {
    if (!this._config || !this._hass || !this._el) return;
    const now = this._now();
    const ps = this._config.people.map((p) => this._person(p, now));
    const anyHome = ps.some((x) => x.presence === "home");
    const anyComing = ps.some((x) => x.coming);
    const e = this._config.entities;
    const lit = e.room_light ? this._on("room_light") : anyHome;
    const door = e.door_light ? this._on("door_light") : anyHome;

    // picture, rebuilt only when its inputs change
    const people = [];
    this._config.people.forEach((p, i) => {
      if (ps[i].presence !== "home") return;
      let pic = null;
      const im = p.portrait ? this._img[p.portrait] : null;
      if (p.portrait && (!im || im.ok !== false)) pic = { url: p.portrait, w: im ? im.w : 3, h: im ? im.h : 4 };
      else if (ps[i].entityPicture) pic = { url: ps[i].entityPicture, w: 1, h: 1 };
      people.push({ i, pic, height: p.height, color: "#8d9b8e", title: `${ps[i].name} · ${ps[i].line}` });
    });
    const cat = this._catHere(!anyHome, now) ? { alone: !anyHome } : null;
    const o = { lit, door, pulse: !door && !anyHome && anyComing, people, cat };
    const key = JSON.stringify(o);
    if (key !== this._sceneKey) {
      this._sceneKey = key;
      this._el.svg.innerHTML = svScene(o, this._uid);
    }
    this._el.pic.setAttribute("aria-label", ps.filter((x) => x.presence === "home").map((x) => x.name).join(", ") + (anyHome ? " at home" : "Nobody home"));
  }
}

/* ---- visual editor --------------------------------------------------------- */

const SV_SLOTS = Array.from({ length: SV_MAX_PEOPLE }, (_, i) => `person_${i + 1}`);

const SV_EDITOR_SCHEMA = [
  ...SV_SLOTS.map((slot, i) => ({
    type: "expandable",
    name: slot,
    title: `Person ${i + 1}`,
    icon: "mdi:account",
    schema: [
      { name: "entity", selector: { entity: { domain: "person" } } },
      { type: "grid", name: "", schema: [
        { name: "name", selector: { text: {} } },
        { name: "height", selector: { number: { min: 0.5, max: 1.2, step: 0.01, mode: "box" } } },
      ] },
      { name: "portrait", selector: { text: {} } },
      { name: "distance", selector: { entity: { domain: "sensor" } } },
      { name: "direction", selector: { entity: { domain: "sensor" } } },
    ],
  })),
  {
    type: "expandable",
    name: "entities",
    title: "Lights",
    icon: "mdi:lightbulb",
    schema: [
      { name: "room_light", selector: { entity: { domain: ["light", "switch"] } } },
      { name: "door_light", selector: { entity: { domain: ["light", "switch"] } } },
    ],
  },
  { name: "cat", selector: { boolean: {} } },
  {
    type: "expandable",
    name: "",
    title: "Actions",
    icon: "mdi:gesture-tap",
    schema: [
      { name: "tap_action", selector: { ui_action: { default_action: "more-info" } } },
      { name: "hold_action", selector: { ui_action: { default_action: "none" } } },
    ],
  },
];

const SV_EDITOR_LABELS = {
  entity: "Person",
  name: "Name (empty: first name from HA)",
  height: "Height in the window",
  portrait: "Portrait (e.g. /local/streetview-house/me.webp)",
  distance: "Distance to home",
  direction: "Direction of travel",
  room_light: "Room light (empty: on while anyone is home)",
  door_light: "Door light (empty: on while anyone is home)",
  cat: "Cat",
  tap_action: "Tap action (person)",
  hold_action: "Hold action (person)",
};

class StreetviewHouseEditor extends HTMLElement {
  /* config -> form data: defaults filled in, null shown as empty. */
  static toData(config) {
    const list = Array.isArray(config.people) ? config.people : SV_PEOPLE;
    const data = {};
    SV_SLOTS.forEach((slot, i) => {
      let p = list[i];
      if (typeof p === "string") p = { entity: p };
      if (!p) { data[slot] = {}; return; }
      const def = svDefaultsFor(p.entity) || {};
      const d = { entity: p.entity || "" };
      for (const role of SV_PERSON_ROLES) d[role] = (role in p ? p[role] : def[role]) || "";
      d.name = p.name != null ? p.name : def.name || "";
      d.portrait = ("portrait" in p ? p.portrait : def.portrait) || "";
      d.height = p.height != null ? svNum(p.height) : def.height || 0.95;
      data[slot] = d;
    });
    const ent = config.entities || {};
    data.entities = {};
    for (const role of Object.keys(SV_DEFAULTS.entities)) data.entities[role] = (role in ent ? ent[role] : SV_DEFAULTS.entities[role]) || "";
    data.cat = config.cat == null ? SV_DEFAULTS.cat : !!config.cat;
    data.tap_action = config.tap_action;
    data.hold_action = config.hold_action;
    return data;
  }

  /* form data -> config: only what differs from the defaults. A slot without a person ends the list. */
  static toConfig(data, previous) {
    const config = { type: "custom:streetview-house" };
    const handled = ["type", "people", "entities", "cat", "tap_action", "hold_action"];
    for (const [k, v] of Object.entries(previous || {})) if (!handled.includes(k)) config[k] = v;

    const people = [];
    for (const slot of SV_SLOTS) {
      const d = data[slot] || {};
      if (!d.entity) break;
      const def = svDefaultsFor(d.entity) || {};
      const p = { entity: d.entity };
      for (const role of SV_PERSON_ROLES) {
        const v = d[role] || null;
        if (v !== (def[role] || null)) p[role] = v;
      }
      if (d.name && d.name !== def.name) p.name = d.name;
      const portrait = d.portrait || null;
      if (portrait !== (def.portrait || null)) p.portrait = portrait;
      const h = svNum(d.height);
      if (h != null && h !== (def.height || 0.95)) p.height = h;
      people.push(p);
    }
    const isDefault = people.length === SV_PEOPLE.length && people.every((p, i) => p.entity === SV_PEOPLE[i].entity && Object.keys(p).length === 1);
    if (!isDefault) config.people = people.map((p) => (Object.keys(p).length === 1 ? p.entity : p));

    const entities = {};
    for (const [role, def] of Object.entries(SV_DEFAULTS.entities)) {
      const v = (data.entities || {})[role] || null;
      if (v !== def) entities[role] = v;
    }
    if (Object.keys(entities).length) config.entities = entities;
    if (data.cat === false) config.cat = false;
    for (const k of ["tap_action", "hold_action"]) if (data[k] && Object.keys(data[k]).length) config[k] = data[k];
    return config;
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._loadForm().then(() => this._render());
  }

  /* ha-form is lazy loaded by HA; load it through a built-in card's editor. */
  async _loadForm() {
    if (customElements.get("ha-form")) return;
    try {
      const helpers = await window.loadCardHelpers();
      const card = await helpers.createCardElement({ type: "entities", entities: [] });
      if (card.constructor.getConfigElement) await card.constructor.getConfigElement();
    } catch (_) {
      /* rendered as soon as HA has loaded it */
    }
    await customElements.whenDefined("ha-form");
  }

  _render() {
    if (!this._config || !customElements.get("ha-form")) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.schema = SV_EDITOR_SCHEMA;
      this._form.computeLabel = (s) => SV_EDITOR_LABELS[s.name] || s.name.replace(/_/g, " ");
      this._form.addEventListener("value-changed", (e) => {
        e.stopPropagation();
        const config = StreetviewHouseEditor.toConfig(e.detail.value, this._config);
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = StreetviewHouseEditor.toData(this._config);
  }
}

if (!customElements.get("streetview-house")) {
  customElements.define("streetview-house", StreetviewHouse);
}
if (!customElements.get("streetview-house-editor")) {
  customElements.define("streetview-house-editor", StreetviewHouseEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "streetview-house")) {
  window.customCards.push({
    type: "streetview-house",
    name: "Streetview House",
    description: "Who is home: the street facade with the family standing in the front window, door light and the cat.",
    preview: false,
  });
}

console.info(`%c STREETVIEW-HOUSE %c v${VERSION} `, "color:#fff;background:#4a3226;font-weight:600", "color:#4a3226;background:#f2efe6");
}
