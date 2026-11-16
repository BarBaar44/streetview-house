/*
 * Streetview House
 * A Lovelace card for the people in the house: on the left a line drawing of the
 * street facade (the counterpart of Gardenview House) seen at an angle, with the
 * arched front door and the big front window; on the right a tile per person.
 * The room light and the door light are on while anyone is home (or follow real
 * lights); the door light pulses while someone is on the way home; now and then
 * the cat walks along the window sill, sits for a wash and strolls off.
 * Without a people list it shows the first four person entities in Home Assistant.
 *
 * Read only: the card calls no services. Taps go through Home Assistant's own
 * action handler (hass-action), more-info of the person by default.
 *
 * https://github.com/BarBaar44/streetview-house  (MIT)
 */

// Everything sits in one block so the top-level names cannot clash with the
// sister cards when the files are loaded as classic scripts.
{
const VERSION = "0.5.0";

const SV_HOLD_MS = 500;
const SV_MOVE_PX = 8;
const SV_TICK_MS = 60000; // "since" texts and cat visits follow the clock
const SV_CAT_SLOT_MS = 15 * 60000; // the cat decides every quarter of an hour
const SV_MAX_PEOPLE = 4; // four tiles

/* Per person: entity, name, portrait, height (relative), proximity. Without a people list the
   card takes the first four person entities in Home Assistant, sorted by entity id. */
const SV_PERSON_DEFAULTS = { name: null, portrait: null, height: 0.95, distance: null, direction: null, away: null };
const SV_PERSON_KEYS = ["entity", "name", "portrait", "height", "distance", "direction", "away"];
const SV_PERSON_ROLES = ["distance", "direction"];

const SV_CAT_DEFAULT = 30; // % of the quarter hours the cat visits while someone is home (twice that when nobody is)

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
const SV_PIN = '<svg class="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const svIsId = (v) => typeof v === "string" && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v);
/*
 * The first four person entities, sorted. Scanning every state is only redone when the entity
 * registry (hass.entities) changes, which is when people can come or go; the result is cached
 * per registry object. Without hass.entities (older HA, tests) it scans on every call.
 */
const svAutoCache = new WeakMap();
const svAutoPeople = (hass) => {
  if (!hass || !hass.states) return [];
  const reg = hass.entities && typeof hass.entities === "object" ? hass.entities : null;
  if (reg && svAutoCache.has(reg)) return svAutoCache.get(reg);
  const ids = Object.keys(hass.states).filter((id) => id.startsWith("person.")).sort().slice(0, SV_MAX_PEOPLE);
  if (reg) svAutoCache.set(reg, ids);
  return ids;
};

/* ---- the drawing ---------------------------------------------------------- */

/*
 * World in metres: the facade is the plane z = 0, x along the wall from the corner (0) to the
 * right, y up, z out into the street. The camera stands on the pavement at eye height, 50 degrees
 * to the wall from the left (the Gardenview camera turned further), so the house reads as a block
 * with its side wall showing.
 */
const SV = (() => {
  const deg = Math.PI / 180, tgt = [2.2, 1.45, 0], D = 13, ang = 50 * deg;
  const cam = [tgt[0] - D * Math.cos(ang), 1.75, D * Math.sin(ang)];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
  const f = norm(sub(tgt, cam)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const proj = (p) => { const d = sub(p, cam); const z = dot(d, f); return [dot(d, r) / z * 200, -dot(d, u) / z * 200]; };
  const H = 2.75, DEP = 0.6, W_MIN = 5.4, W_MAX = 9;
  // the picture around a house W metres wide: corner, fascia, ground in front
  const box = (W) => {
    const e = [[0, 0, -DEP], [0, H + 0.22, -DEP], [W + 0.1, 0, 0.3], [W + 0.1, H + 0.22, 0.18], [-0.1, -0.02, 0.6]].map(proj);
    const xs = e.map((p) => p[0]), ys = e.map((p) => p[1]);
    const x0 = Math.min(...xs) - 6, y0 = Math.min(...ys) - 4;
    return [x0, y0, Math.max(...xs) + 6 - x0, Math.max(...ys) + 2 - y0];
  };
  // the house widens to the right (a longer front window) until it fills a box of aspect a
  const widthFor = (a) => {
    let W = W_MIN;
    while (W < W_MAX) { const b = box(W); if (b[2] / b[3] >= a) break; W += 0.1; }
    return Math.round(W * 10) / 10;
  };
  return { deg, proj, H, DEP, W_MIN, box, widthFor };
})();

/* The cat, side view facing left (feet on y = 0) and sitting, facing the street. Black and white. */
const SV_CAT_SIDE = `
  <g class="tail"><path d="M12 -13 C20 -14 22 -24 18 -30" fill="none" stroke="#111" stroke-width="5.2" stroke-linecap="round"/><path d="M12 -13 C20 -14 22 -24 18 -30" fill="none" stroke="#1d1d1d" stroke-width="3" stroke-linecap="round"/></g>
  <g class="leg b"><rect x="7" y="-9" width="4" height="9" rx="2" fill="#f6f4ef" stroke="#111" stroke-width="1.2"/></g>
  <g class="leg a"><rect x="-10" y="-9" width="4" height="9" rx="2" fill="#f6f4ef" stroke="#111" stroke-width="1.2"/></g>
  <ellipse cx="1" cy="-13" rx="14" ry="7" fill="#f6f4ef" stroke="#111" stroke-width="1.4"/>
  <path d="M-4 -19.6 C2 -21 10 -20 14 -15 C10 -13 4 -14 -2 -15 Z" fill="#1d1d1d"/>
  <g class="leg a"><rect x="9" y="-9" width="4" height="9" rx="2" fill="#f6f4ef" stroke="#111" stroke-width="1.2"/></g>
  <g class="leg b"><rect x="-8" y="-9" width="4" height="9" rx="2" fill="#f6f4ef" stroke="#111" stroke-width="1.2"/></g>
  <g class="bob"><path d="M-17 -27 L-18 -35 L-12.5 -29.5 Z M-11 -28 L-9 -35.5 L-6.5 -28 Z" fill="#1d1d1d" stroke="#111" stroke-width="1"/>
  <circle cx="-13" cy="-23" r="7" fill="#1d1d1d" stroke="#111" stroke-width="1.2"/>
  <path d="M-19.5 -21 C-19 -17 -13 -16 -11 -19 C-14 -20 -17 -20 -19.5 -21 Z" fill="#f6f4ef"/>
  <ellipse cx="-16" cy="-24.5" rx="1.4" ry="1.2" fill="#d9a441"/></g>`;
const SV_CAT_SIT = `
  <g class="stail"><path d="M7 -2 C16 -2 18 -9 15 -14" fill="none" stroke="#111" stroke-width="5" stroke-linecap="round"/><path d="M7 -2 C16 -2 18 -9 15 -14" fill="none" stroke="#1d1d1d" stroke-width="2.8" stroke-linecap="round"/></g>
  <path d="M-9 0 C-11 -12 -8 -22 0 -22 C8 -22 11 -12 9 0 Z" fill="#f6f4ef" stroke="#111" stroke-width="1.4"/>
  <g class="paw"><ellipse cx="-3.5" cy="-1.5" rx="2.6" ry="1.8" fill="#f6f4ef" stroke="#111" stroke-width="1"/></g>
  <ellipse cx="3.5" cy="-1.5" rx="2.6" ry="1.8" fill="#f6f4ef" stroke="#111" stroke-width="1"/>
  <g class="head"><path d="M-8 -18 L-9 -30 L-2 -22 Z M8 -18 L9 -30 L2 -22 Z" fill="#1d1d1d" stroke="#111"/>
  <path d="M-8 -16 C-9 -27 9 -27 8 -16 C4 -19 -4 -19 -8 -16Z" fill="#1d1d1d" stroke="#111" stroke-width="1"/>
  <g class="eyes"><ellipse cx="-3.5" cy="-20" rx="1.7" ry="1.5" fill="#d9a441"/><ellipse cx="3.5" cy="-20" rx="1.7" ry="1.5" fill="#d9a441"/>
  <ellipse cx="-3.5" cy="-20" rx=".5" ry="1.2" fill="#111"/><ellipse cx="3.5" cy="-20" rx=".5" ry="1.2" fill="#111"/></g></g>`;
const SV_CAT_MS = 26000; // one walk: in along the sill, sit, on, jump down, past the door, gone

/*
 * The cat's walk. still: no motion (reduced motion), it just sits on the sill.
 * Otherwise a 26 s loop (SMIL, so it runs inside the SVG): walk in along the sill, sit for a
 * wash and a stare (22 to 58 %), walk on, jump down, stroll off past the door, gone for a moment.
 */
function svCat(wx0, wx1, wy0, dx0, still) {
  const { proj } = SV, F = svF;
  const a = proj([wx1 + 0.4, wy0, 0.07]), b = proj([Math.min((wx0 + wx1) / 2 + 0.2, 3.6), wy0, 0.07]), c = proj([wx0 + 0.05, wy0, 0.07]);
  const g = proj([wx0 - 0.25, 0, 0.45]), e = proj([dx0 - 1.0, 0, 0.45]);
  const sc = (proj([0, wy0, 0.07])[1] - proj([0, wy0 + 0.33, 0.07])[1]) / 30 * 1.25;
  if (still) return `<g class="cat" transform="translate(${F(b[0])} ${F(b[1])}) scale(${F(sc)})"><g class="sit">${SV_CAT_SIT}</g></g>`;
  const d = `M${F(a[0])} ${F(a[1])} L${F(b[0])} ${F(b[1])} L${F(c[0])} ${F(c[1])} Q${F(c[0] - 6)} ${F(c[1] - 14)} ${F(g[0])} ${F(g[1])} L${F(e[0])} ${F(e[1])}`;
  const len = [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(g[0] - c[0], g[1] - c[1]) * 1.15, Math.hypot(e[0] - g[0], e[1] - g[1])];
  const T = len.reduce((x, y) => x + y), k1 = len[0] / T, k2 = (len[0] + len[1]) / T, k3 = (len[0] + len[1] + len[2]) / T;
  const dur = `${SV_CAT_MS / 1000}s`;
  const kt = "0;0.22;0.58;0.70;0.74;0.92;1", kp = `0;${k1.toFixed(4)};${k1.toFixed(4)};${k2.toFixed(4)};${k3.toFixed(4)};1;1`;
  const show = (vals) => `<animate attributeName="opacity" dur="${dur}" repeatCount="indefinite" calcMode="discrete" keyTimes="0;0.22;0.58;0.92;1" values="${vals}"/>`;
  return `<g class="cat"><animateMotion dur="${dur}" repeatCount="indefinite" calcMode="linear" keyTimes="${kt}" keyPoints="${kp}" path="${d}"/>`
    + `<g transform="scale(${F(sc)})"><g class="walk">${show("1;0;1;0;0")}${SV_CAT_SIDE}</g>`
    + `<g class="sit" opacity="0">${show("0;1;0;0;0")}${SV_CAT_SIT}</g></g></g>`;
}

/*
 * The scene. o: { W (house width, from SV.widthFor), lit (room lamp), door (door light on),
 * pulse (door light pulses), cat (the cat is here), still (reduced motion) }.
 * id: unique per card, for the defs. Returns the inner SVG and its viewBox.
 */
function svScene(o, id) {
  const { proj, deg, H, DEP } = SV, W = o.W, F = svF;
  const pts = (a) => a.map((p) => proj(p).map(F).join(",")).join(" ");
  const poly = (a, fill, extra = "") => `<polygon points="${pts(a)}" fill="${fill}" stroke="#111" stroke-width="1.6" stroke-linejoin="round" ${extra}/>`;
  const quad = (x0, x1, y0, y1, z = 0) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
  const line = (a, b, col = "#111", w = 1.6) => { const p = proj(a), q = proj(b); return `<line x1="${F(p[0])}" y1="${F(p[1])}" x2="${F(q[0])}" y2="${F(q[1])}" stroke="${col}" stroke-width="${w}"/>`; };
  const wx0 = 1.75, wx1 = W - 0.3, wy0 = 0.7, wy1 = 2.3; // front window
  const glass = quad(wx0 + 0.1, wx1 - 0.1, wy0 + 0.1, wy1 - 0.1, -0.1);
  let s = `<defs><clipPath id="${id}-glass"><polygon points="${pts(glass)}"/></clipPath>`
    + `<linearGradient id="${id}-gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.lit ? "#ffe9b0" : "#8e9ea3"}"/><stop offset="1" stop-color="${o.lit ? "#e9b65a" : "#5d6b71"}"/></linearGradient>`
    + (o.lit ? `<radialGradient id="${id}-glow"><stop offset="0" stop-color="#fff6d6" stop-opacity=".95"/><stop offset=".35" stop-color="#ffd54f" stop-opacity=".55"/><stop offset="1" stop-color="#ffb300" stop-opacity="0"/></radialGradient>` : "")
    + `<linearGradient id="${id}-sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`;

  // shadow on the pavement, side wall, facade with siding lines, plinth, downpipe
  s += `<polygon points="${pts([[-0.3, 0, -DEP], [W + 0.5, 0, -0.2], [W + 0.7, 0, 0.6], [-0.2, 0, 0.6]])}" fill="#000" opacity=".35"/>`;
  s += poly([[0, 0, 0], [0, 0, -DEP], [0, H, -DEP], [0, H, 0]], "#6e4f3f");
  for (let y = 0.25; y < H; y += 0.25) s += line([0, y, 0], [0, y, -DEP], "#5b4134", 0.6);
  s += poly(quad(0, W, 0, H), "#8a6550");
  for (let y = 0.25; y < H; y += 0.25) s += line([0, y, 0], [W, y, 0], "#a07a63", 0.6);
  s += poly(quad(0, W, 0, 0.32), "#4a3a32");
  s += poly([[0, 0, 0], [0, 0, -DEP], [0, 0.32, -DEP], [0, 0.32, 0]], "#3a2d27");
  s += poly(quad(W - 0.22, W - 0.12, 0.05, H, 0.06), "#3a3a3a");
  // roof fascia: the white band, seen from below
  s += poly([[-0.08, H, 0.18], [W + 0.08, H, 0.18], [W + 0.08, H + 0.22, 0.18], [-0.08, H + 0.22, 0.18]], "#f4f2ee");
  s += poly([[-0.08, H, 0.18], [-0.08, H, -DEP], [-0.08, H + 0.22, -DEP], [-0.08, H + 0.22, 0.18]], "#d8d5cf");
  s += poly([[-0.08, H, 0.18], [W + 0.08, H, 0.18], [W + 0.08, H, 0], [-0.08, H, 0]], "#3a3a3a");

  // arched front door, recessed, with a tall window (about 80 % of the door) behind a grille
  const dx0 = 0.3, dx1 = 1.15, dTop = 1.8, rr = (dx1 - dx0) / 2, cx = (dx0 + dx1) / 2;
  const arch = (r, z) => { const a = [[cx - r, 0, z]]; for (let t = 180; t >= 0; t -= 10) a.push([cx + r * Math.cos(t * deg), dTop + r * Math.sin(t * deg), z]); a.push([cx + r, 0, z]); return a; };
  s += poly(arch(rr + 0.12, 0), "#f4f2ee");
  s += poly(arch(rr, -0.12), "#2a2a2a");
  s += poly(arch(rr - 0.03, -0.12), "#4a3024");
  for (let x = dx0 + 0.12; x < dx1 - 0.05; x += 0.13) s += line([x, 0.05, -0.12], [x, dTop + 0.15, -0.12], "#3a251b", 0.7);
  const dw = 0.17, dy0 = 0.38, dy1 = 1.92, win = [[cx - dw, dy0, -0.12], [cx + dw, dy0, -0.12]];
  for (let t = 0; t <= 180; t += 15) win.push([cx + dw * Math.cos(t * deg), dy1 + dw * Math.sin(t * deg), -0.12]);
  s += `<g class="doorlight${o.pulse ? " pulse" : ""}">${poly(win, o.door || o.pulse ? "#ffd54f" : "#1d1d1d")}</g>`;
  for (let x = cx - 0.085; x < cx + 0.1; x += 0.085) s += line([x, dy0, -0.12], [x, dy1 + 0.14, -0.12], "#111", 0.55);
  for (let y = dy0 + 0.38; y < dy1; y += 0.38) s += line([cx - dw, y, -0.12], [cx + dw, y, -0.12], "#111", 0.55);
  s += line([dx1 - 0.14, 1.0, -0.12], [dx1 - 0.14, 1.12, -0.12], "#d9a441", 2.2);
  s += poly([[dx0 - 0.15, 0.12, 0.3], [dx1 + 0.15, 0.12, 0.3], [dx1 + 0.15, 0.12, 0], [dx0 - 0.15, 0.12, 0]], "#cfcac2");
  s += poly(quad(dx0 - 0.15, dx1 + 0.15, 0, 0.12, 0.3), "#a9a39a");
  // lantern: not used in real life, always off
  s += poly(quad(1.38, 1.52, 1.5, 1.75, 0.08), "#1d1d1d");
  s += poly([[1.38, 1.5, 0.08], [1.38, 1.5, 0], [1.38, 1.75, 0], [1.38, 1.75, 0.08]], "#111");

  // front window: frame, reveal, the room behind (lamp when lit), glass with sheen and a sweep
  s += poly(quad(wx0, wx1, wy0, wy1), "#f4f2ee");
  s += poly([[wx0 + 0.1, wy0 + 0.1, 0], [wx0 + 0.1, wy0 + 0.1, -0.1], [wx0 + 0.1, wy1 - 0.1, -0.1], [wx0 + 0.1, wy1 - 0.1, 0]], "#d8d5cf");
  s += poly([[wx0 + 0.1, wy1 - 0.1, 0], [wx1 - 0.1, wy1 - 0.1, 0], [wx1 - 0.1, wy1 - 0.1, -0.1], [wx0 + 0.1, wy1 - 0.1, -0.1]], "#c6c2bb");
  s += poly(glass, `url(#${id}-gl)`);
  s += `<g clip-path="url(#${id}-glass)" pointer-events="none">`;
  // the room: a sofa back along the bottom, a pendant lamp; with the light on it glows warm
  {
    const lx = Math.min((wx0 + W) / 2, 3.45), lz = -1.0;
    const top = proj([lx, wy1, lz]), l = proj([lx, 1.95, lz]), sw = (proj([lx + 0.16, 1.95, lz])[0] - l[0]);
    if (o.lit) {
      const r = proj([lx + 1.4, 1.95, lz])[0] - l[0];
      s += `<ellipse class="lamp" cx="${F(l[0])}" cy="${F(l[1] + sw * 0.6)}" rx="${F(r)}" ry="${F(r * 0.8)}" fill="url(#${id}-glow)"/>`;
    }
    const sofa = [[wx0 + 0.5, wy0 + 0.1, -1.2], [Math.min(wx1 - 0.4, wx0 + 2.6), wy0 + 0.1, -1.2], [Math.min(wx1 - 0.4, wx0 + 2.6), wy0 + 0.42, -1.2], [wx0 + 0.5, wy0 + 0.42, -1.2]];
    s += `<polygon points="${pts(sofa)}" fill="${o.lit ? "#8a5a3c" : "#3d474b"}" stroke="#111" stroke-width=".8" stroke-linejoin="round"/>`;
    s += `<line x1="${F(top[0])}" y1="${F(top[1])}" x2="${F(l[0])}" y2="${F(l[1])}" stroke="#111" stroke-width=".7"/>`;
    s += `<path d="M${F(l[0] - sw)} ${F(l[1] + sw * 0.9)}L${F(l[0] - sw * 0.45)} ${F(l[1])}H${F(l[0] + sw * 0.45)}L${F(l[0] + sw)} ${F(l[1] + sw * 0.9)}Z" fill="#2b2b2b" stroke="#111" stroke-width=".7"/>`;
    if (o.lit) s += `<ellipse cx="${F(l[0])}" cy="${F(l[1] + sw * 0.9)}" rx="${F(sw * 0.8)}" ry="${F(sw * 0.22)}" fill="#fff3c4"/>`;
  }
  if (!o.lit) s += `<polygon points="${pts(glass)}" fill="#bfe3d4" opacity=".12"/>`;
  s += `<polygon points="${pts([[2.4, wy1, -0.1], [2.65, wy1, -0.1], [2.25, wy0, -0.1], [2.0, wy0, -0.1]])}" fill="#fff" opacity=".18"/>`;
  s += `<polygon class="sweep" points="${pts([[2.3, wy1, -0.1], [2.6, wy1, -0.1], [2.2, wy0, -0.1], [1.9, wy0, -0.1]])}" fill="url(#${id}-sh)"/></g>`;
  s += `<polygon points="${pts(glass)}" fill="none" stroke="#111" stroke-width="1.6"/>`;
  s += poly([[wx0 - 0.08, wy0, 0.12], [wx1 + 0.08, wy0, 0.12], [wx1 + 0.08, wy0, 0], [wx0 - 0.08, wy0, 0]], "#f4f2ee");
  s += poly(quad(wx0 - 0.08, wx1 + 0.08, wy0 - 0.06, wy0, 0.12), "#d8d5cf");
  if (o.lit) {
    s += `<polygon class="spill" points="${pts([[wx0 + 0.1, wy0, 0], [wx1 - 0.1, wy0, 0], [wx1 - 0.1, wy0, 0.12], [wx0 + 0.1, wy0, 0.12]])}" fill="#ffd54f" opacity=".35"/>`;
    s += `<polygon class="spill" points="${pts([[wx0 + 0.1, 0, 0.02], [wx1 - 0.1, 0, 0.02], [wx1 + 0.4, 0, 1.1], [wx0 + 0.3, 0, 1.1]])}" fill="#ffd54f" opacity=".14"/>`;
  }
  if (o.cat) s += svCat(wx0, wx1, wy0, dx0, o.still);
  // awning box over the window
  s += poly([[wx0 - 0.1, wy1 + 0.12, 0.32], [wx1 + 0.1, wy1 + 0.12, 0.32], [wx1 + 0.1, wy1 + 0.32, 0.32], [wx0 - 0.1, wy1 + 0.32, 0.32]], "#f4f2ee");
  s += poly([[wx0 - 0.1, wy1 + 0.32, 0.32], [wx1 + 0.1, wy1 + 0.32, 0.32], [wx1 + 0.1, wy1 + 0.32, 0], [wx0 - 0.1, wy1 + 0.32, 0]], "#e2dfd9");
  s += poly([[wx0 - 0.1, wy1 + 0.12, 0], [wx0 - 0.1, wy1 + 0.12, 0.32], [wx0 - 0.1, wy1 + 0.32, 0.32], [wx0 - 0.1, wy1 + 0.32, 0]], "#c6c2bb");
  return { svg: s, viewBox: SV.box(W).map(svF).join(" ") };
}

/* ---- styles --------------------------------------------------------------- */

const SV_STYLE = `
  ha-card {
    height: 100%; box-sizing: border-box; overflow: hidden; display: flex; align-items: stretch;
    padding: 0 var(--sv-pad, 10px) 0 0;
    user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
  }
  .pic { flex: none; width: 50%; height: 100%; }
  .pic svg { width: 100%; height: 100%; display: block; }
  .tiles {
    flex: 1; min-width: 0; box-sizing: border-box; padding: 8px 0; display: grid; gap: 6px;
    grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; container-type: inline-size;
  }
  .tiles.n1 { grid-template-columns: 1fr; }
  .tile {
    position: relative; overflow: hidden; min-width: 0; border-radius: 10px; cursor: pointer; outline: none;
    display: flex; align-items: flex-end;
    background: rgba(var(--rgb-primary-text-color, 255, 255, 255), .05);
  }
  .tile.home { background: rgba(var(--rgb-primary-text-color, 255, 255, 255), .08); box-shadow: inset 0 0 0 1px rgba(var(--rgb-primary-text-color, 255, 255, 255), .1); }
  .tile:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4); }
  .face { position: absolute; left: -2px; bottom: 0; height: 92%; pointer-events: none; }
  .face img { height: 100%; display: block; -webkit-mask-image: linear-gradient(#000 80%, transparent); mask-image: linear-gradient(#000 80%, transparent); }
  .face.round { left: 8px; bottom: auto; top: 50%; transform: translateY(-50%); height: 60%; }
  .face.round img { border-radius: 50%; -webkit-mask-image: none; mask-image: none; }
  .face.initial { left: 8px; bottom: auto; top: 50%; transform: translateY(-50%); height: 60%; aspect-ratio: 1; border-radius: 50%;
    background: rgba(var(--rgb-primary-text-color, 255, 255, 255), .15); color: var(--primary-text-color); display: flex; align-items: center; justify-content: center; font-weight: 500; }
  .t { position: relative; margin-left: auto; width: 54%; padding: 0 8px 8px 0; display: flex; flex-direction: column; gap: 1px; text-align: right; min-width: 0; }
  .tile.away .t, .tile.unknown .t { width: auto; margin-left: 0; text-align: left; padding: 0 8px 8px 10px; }
  .n { font-size: 13px; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s { font-size: 11px; line-height: 1.25; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile.home .s { color: var(--success-color, #43a047); }
  .tile.coming .s { color: var(--warning-color, #ffa600); }
  .pin { width: 11px; height: 11px; opacity: .6; vertical-align: -1px; margin-right: 2px; fill: currentColor; }
  @container (max-width: 200px) {
    .face { height: 70%; left: 50%; transform: translateX(-50%); top: 3px; bottom: auto; }
    .face.round, .face.initial { height: 46%; top: 8px; left: 50%; transform: translateX(-50%); }
    .tile.home .t { width: 100%; padding: 6px 2px 5px; text-align: center; background: linear-gradient(transparent, var(--ha-card-background, var(--card-background-color, #1c1c1c)) 40%); }
    .n { font-size: 12px; } .s { font-size: 10px; }
    .pin { display: none; } .tile.away .t, .tile.unknown .t { padding-left: 8px; }
  }

  .doorlight.pulse { animation: sv-door 2.4s ease-in-out infinite; }
  @keyframes sv-door { 50% { opacity: .45; } }
  .sweep { animation: sv-sweep 14s linear infinite; }
  @keyframes sv-sweep { 0%, 70% { transform: translateX(-60px); opacity: 0; } 75% { opacity: .25; } 95% { opacity: .15; } 100% { transform: translateX(140px); opacity: 0; } }
  .cat .leg { transform-box: fill-box; transform-origin: 50% 0; animation: sv-leg .45s ease-in-out infinite alternate; }
  .cat .leg.b { animation-delay: -.45s; }
  @keyframes sv-leg { from { transform: rotate(22deg); } to { transform: rotate(-22deg); } }
  .cat .bob { animation: sv-bob .45s ease-in-out infinite alternate; }
  @keyframes sv-bob { to { transform: translateY(.8px); } }
  .cat .tail { transform-box: fill-box; transform-origin: 0% 100%; animation: sv-tail 1.6s ease-in-out infinite alternate; }
  @keyframes sv-tail { from { transform: rotate(-8deg); } to { transform: rotate(14deg); } }
  .cat .stail { transform-box: fill-box; transform-origin: 0% 100%; animation: sv-stail 2.2s ease-in-out infinite; }
  @keyframes sv-stail { 0%, 60%, 100% { transform: rotate(0); } 75% { transform: rotate(-25deg); } 88% { transform: rotate(10deg); } }
  .cat .eyes { transform-box: fill-box; transform-origin: 50% 50%; animation: sv-blink 4.5s infinite; }
  @keyframes sv-blink { 0%, 90%, 100% { transform: scaleY(1); } 94% { transform: scaleY(.1); } }
  .cat .head { transform-box: fill-box; transform-origin: 50% 100%; animation: sv-head 9.4s ease-in-out infinite; }
  @keyframes sv-head { 0%, 20%, 100% { transform: rotate(0); } 28%, 40% { transform: rotate(-12deg) translateY(1px); } 55%, 70% { transform: rotate(8deg); } }
  .cat .paw { transform-box: fill-box; transform-origin: 50% 100%; animation: sv-paw 9.4s ease-in-out infinite; }
  @keyframes sv-paw { 0%, 24%, 44%, 100% { transform: none; } 30%, 38% { transform: translate(1px, -9px) rotate(-20deg); } }

  @media (prefers-reduced-motion: reduce) {
    .doorlight.pulse, .sweep, .cat, .cat * { animation: none !important; }
  }
`;

/* ---- away tiles: what someone is doing while away ---------------------------- */

/*
 * A small line art figure with the person's own face, in a 122 x 80 tile, looping. Each kind has
 * its own little mishap now and then. Picked per person with `away:` in the card config; the card
 * knows nothing about who does what.
 */
const SV_AWAY = ["race_bike", "running", "shopping", "soccer"];

/*
 * kind: one of SV_AWAY. face: { href } for a picture, else { initial }. id: unique per tile, for
 * clip paths. back: coming home (the figure turned towards home; texts stay readable).
 */
function svAway(kind, face, id, back) {
  const L = 'stroke="#111" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"';
  const SKIN = "#f2c9a8";
  let n = 0;
  const head = (x, y, r, extra = "") => {
    const c = `${id}-f${n++}`;
    const inner = face.href
      ? `<clipPath id="${c}"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath><image href="${svEsc(face.href)}" x="${x - r * 1.55}" y="${y - r * 1.15}" width="${r * 3.1}" height="${r * 4.13}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${c})"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="#9e9e9e"/>${txt(x, y + r * 0.38, svEsc(face.initial || "?"), `font-size="${r * 1.1}" font-weight="600" fill="#fff"`)}`;
    return `${inner}<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#111" stroke-width="1.2"/>${extra}`;
  };
  // text stays readable when the scene is turned round
  function txt(x, y, s, attrs, cls = "") {
    const flip = back ? ` transform="translate(${2 * x} 0) scale(-1 1)"` : "";
    return `<text${cls ? ` class="${cls}"` : ""} x="${x}" y="${y}" text-anchor="middle" font-family="system-ui, sans-serif"${flip} ${attrs}>${s}</text>`;
  }
  const limb = (cls, x, y, d, col, w = 3.6, a = 35) => `<g class="a-j ${cls}" style="transform-origin:${x}px ${y}px;--a:${a}deg">`
    + `<path d="M${x} ${y} ${d}" fill="none" stroke="#111" stroke-width="${w + 2.4}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M${x} ${y} ${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const road = (speed) => `<path d="M-10 73 H140" stroke="#3a3a3a" stroke-width="1.2"/><g class="a-road ${speed}">`
    + [0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M${i * 24 - 6} 76.5 h10" stroke="#555" stroke-width="1.2" stroke-linecap="round"/>`).join("") + "</g>";
  const star = (x, y, s) => `<text x="${x}" y="${y}" font-size="${s}" fill="#ffd600" stroke="#111" stroke-width=".4">★</text>`;
  const wheel = (x) => `<g class="a-wheel"><circle cx="${x}" cy="61" r="11" fill="none" ${L}/><path d="M${x} 50 V72 M${x - 11} 61 H${x + 11} M${x - 8} 53 L${x + 8} 69 M${x + 8} 53 L${x - 8} 69" stroke="#777" stroke-width=".7"/></g>`;
  let s = "";

  if (kind === "race_bike") {
    // every 9 s the front wheel comes off and rolls away, the bike nose-dives, stars, the wheel rolls back
    s = `<g class="a-bike">${road("fast")}
      <g stroke="#666" stroke-width="1.2" stroke-linecap="round"><path d="M14 36 h-8"/><path d="M18 46 h-12"/><path d="M14 56 h-9"/></g>
      <g class="a-dive"><g class="a-lean">${wheel(40)}
      ${limb("a-legB", 55, 44, "l8 8 l-3 9", "#1d1d1d", 3.4, 18)}
      <path d="M40 61 L58 61 L52 44 Z M58 61 L76 46 L52 44 M76 46 L85 61" fill="none" stroke="#e53935" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M49 43 h7" stroke="#111" stroke-width="2" stroke-linecap="round"/>
      <path d="M76 46 l1 -4 l4 0 q3 0 2 4 q-1 3 -3 2" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/>
      <g class="a-crank"><path d="M58 61 l0 -5 M58 61 l0 5" stroke="#111" stroke-width="1.6"/><circle cx="58" cy="61" r="2.4" fill="#cfcfcf" stroke="#111"/></g>
      <path d="M53 44 C58 36 68 34 74 37 L72 43 C66 41 60 43 57 46 Z" fill="#ffd600" ${L}/>
      ${limb("a-legA", 55, 44, "l9 7 l-2 10", "#1d1d1d", 3.4, 18)}
      ${limb("", 71, 38, "l5 5 l4 2", SKIN, 2.6, 0)}
      ${head(78, 31, 8, `<path d="M69.5 29 C69.5 20 85 19 88 27 L85 28 C82 24 74 24 72 30 Z" fill="#e53935" ${L}/>`)}
      <g class="a-oops">${star(86, 40, 9)}${star(94, 34, 7)}${star(90, 46, 6)}</g></g></g>
      <g class="a-loose">${wheel(85)}</g></g>`;
  } else if (kind === "running") {
    // every 8 s a cow walks in and gets yelled at
    s = `<g class="a-run">${road("")}<g class="a-bob">
      ${limb("a-legB", 57, 54, "l-5 9 l3 9", "#2b2b2b", 3.4)}${limb("a-armB", 60, 39, "l-6 7 l5 5", SKIN, 2.8)}
      <path d="M55 37 C55 36 63 35 64 37 L61 50 L54 50 Z" fill="#ff7043" ${L}/>
      <path d="M54 49 L61 49 L62 55 L53 55 Z" fill="#2b2b2b" ${L}/>
      ${limb("a-legA", 57, 54, "l5 8 l-2 9", "#2b2b2b", 3.4)}
      ${head(61, 28, 9)}
      ${limb("a-armA", 60, 39, "l6 6 l6 -3", SKIN, 2.8)}
      <path class="a-sweat" d="M71 22 q2 3 0 4 q-2 -1 0 -4" fill="#81d4fa"/></g>
      <g class="a-cow"><g transform="translate(100 72) scale(-1 1)">
        <path d="M-12 -18 C-14 -18 -16 -16 -15 -13" fill="none" ${L}/>
        <path d="M-10 -4 v4 M-6 -4 v4 M5 -4 v4 M9 -4 v4" stroke="#111" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M-13 -19 C-13 -21 9 -21 10 -19 L11 -6 C11 -4 -12 -4 -13 -6 Z" fill="#f4f2ee" ${L}/>
        <path d="M-8 -19 c2 3 6 3 6 0 Z M2 -12 c3 -2 6 0 5 3 c-3 1 -5 0 -5 -3 Z M-12 -10 c2 0 4 2 2 4 l-2 0 Z" fill="#1d1d1d"/>
        <g class="a-cowhead"><path d="M9 -22 C9 -26 19 -26 19 -22 L18 -14 C18 -12 10 -12 10 -14 Z" fill="#f4f2ee" ${L}/>
        <path d="M9 -24 l-3 -3 M19 -24 l3 -3" stroke="#111" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M10 -18 C10 -16 18 -16 18 -18 L18 -13 C18 -11 10 -11 10 -13 Z" fill="#f8bbd0" ${L}/>
        <circle cx="12" cy="-21" r=".9" fill="#111"/><circle cx="16" cy="-21" r=".9" fill="#111"/></g></g></g>
      <g class="a-moo"><path d="M76 22 h38 a4 4 0 0 1 4 4 v7 a4 4 0 0 1 -4 4 h-38 a4 4 0 0 1 -4 -4 v-1 l-4 -2 l4 -1 v-3 a4 4 0 0 1 4 -4 Z" fill="#f4f2ee" ${L}/>
        ${txt(95, 32.5, "MOOOOH!", 'font-size="8" font-weight="800" fill="#111"')}</g></g>`;
  } else if (kind === "shopping") {
    // two bags; now and then a coin drops out of one and a banknote flutters out of the other
    const arm = (x, y, x2, y2) => `<path d="M${x} ${y} L${x2} ${y2}" fill="none" stroke="#111" stroke-width="5.4" stroke-linecap="round"/><path d="M${x} ${y} L${x2} ${y2}" fill="none" stroke="#8e44ad" stroke-width="3" stroke-linecap="round"/>`;
    s = `<g class="a-shop">${road("slow")}<g class="a-bob">
      ${limb("a-legB", 57, 55, "l1 9 l0 8", "#3d5a80", 3.2, 22)}
      <g class="a-j a-bagB" style="transform-origin:51px 40px">${arm(51, 40, 46, 53)}
        <path d="M42 56 Q46 49 50 56" fill="none" stroke="#111" stroke-width="1.2"/>
        <path d="M40 56 L52 56 L53 69 L39 69 Z" fill="#c69c6d" ${L}/>
        <path d="M43 56 l1 -7 l2 0 l-1 7 M48 56 l2 -9 l2 1 l-2 8" fill="#7cb342" ${L}/>
        <g class="a-coin"><circle cx="46" cy="66" r="2.6" fill="#ffd54f" ${L}/><path d="M46 64.6 v2.8" stroke="#b8860b" stroke-width=".8"/></g></g>
      <path d="M52 37 C52 35 62 35 63 38 L65 57 L50 57 Z" fill="#8e44ad" ${L}/>
      ${limb("a-legA", 57, 55, "l1 9 l0 8", "#3d5a80", 3.2, 22)}
      ${head(58, 28, 9.5)}
      <g class="a-j a-bagA" style="transform-origin:62px 40px">${arm(62, 40, 67, 53)}
        <path d="M63 56 Q67 49 71 56" fill="none" stroke="#111" stroke-width="1.2"/>
        <g class="a-note"><rect x="64" y="54" width="9" height="5" rx=".8" fill="#66bb6a" ${L}/><circle cx="68.5" cy="56.5" r="1.2" fill="none" stroke="#1b5e20" stroke-width=".6"/></g>
        <path d="M61 56 L73 56 L74 69 L60 69 Z" fill="#e53935" ${L}/>
        <path d="M64 61 h7" stroke="#f4f2ee" stroke-width="1.2"/></g></g></g>`;
  } else if (kind === "soccer") {
    // three kicks in 7.2 s: goal, goal, over the bar
    const ball = (cls) => `<g class="a-ball ${cls}"><g class="a-roll"><circle cx="0" cy="0" r="3.6" fill="#f4f2ee" ${L}/><path d="M0 -1.4 l1.3 1 l-.5 1.5 h-1.6 l-.5 -1.5 Z" fill="#111"/></g></g>`;
    s = `<g class="a-soccer"><path d="M-10 73 H140" stroke="#3a3a3a" stroke-width="1.2"/>
      <g class="a-net"><path d="M100 46 L118 50 L118 73 L100 73" fill="none" stroke="#9b9b9b" stroke-width=".8"/>
      <path d="M104 47 V73 M108 48 V73 M112 49 V73 M100 52 L118 55 M100 58 L118 60 M100 64 L118 65 M100 69 L118 70" stroke="#666" stroke-width=".5"/></g>
      <path d="M100 73 V46 H104" fill="none" stroke="#f4f2ee" stroke-width="2.4" stroke-linecap="round"/>
      ${limb("", 34, 55, "l-1 9 l0 9", SKIN, 3, 0)}
      ${limb("a-armB", 30, 40, "l-4 6 l1 6", SKIN, 2.6, 0)}
      <path d="M29 38 C29 36 39 36 40 38 L39 51 L30 51 Z" fill="#1e88e5" ${L}/>
      <path d="M30 50 L39 50 L40 56 L29 56 Z" fill="#f4f2ee" ${L}/>
      ${limb("a-kick", 36, 55, "l4 8 l4 8", SKIN, 3, 0)}
      ${limb("a-armA", 38, 40, "l5 6 l1 6", SKIN, 2.6, 0)}
      ${head(35, 28, 9)}
      ${ball("a-miss")}${ball("a-goal")}
      ${txt(76, 36, "GOAL!", 'font-size="12" font-weight="800" fill="#ffd600" stroke="#111" stroke-width=".5"', "a-cheer")}
      ${txt(76, 36, "MISS…", 'font-size="11" font-weight="800" fill="#9b9b9b" stroke="#111" stroke-width=".4"', "a-boo")}</g>`;
  }
  return back ? `<g transform="translate(122 0) scale(-1 1)">${s}</g>` : s;
}

const SV_AWAY_STYLE = `
  .tile.act .t { position: absolute; top: 6px; left: 9px; margin: 0; padding: 0; width: auto; }
  .act-pic { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .a-j { transform-box: view-box; }
  @keyframes a-swing { from { transform: rotate(var(--a, 35deg)); } to { transform: rotate(calc(var(--a, 35deg) * -1)); } }
  @keyframes a-bob { 50% { transform: translateY(-1.6px); } }
  @keyframes a-ground { to { transform: translateX(-24px); } }
  @keyframes a-spin { to { transform: rotate(360deg); } }
  .a-road { animation: a-ground .45s linear infinite; }
  .a-road.slow { animation-duration: .9s; } .a-road.fast { animation-duration: .25s; }
  .a-wheel, .a-roll { transform-box: fill-box; transform-origin: 50% 50%; animation: a-spin .45s linear infinite; }
  .a-roll { animation-duration: .4s; }

  .a-run .a-legA, .a-run .a-armB { animation: a-swing .42s ease-in-out infinite alternate; }
  .a-run .a-legB, .a-run .a-armA { animation: a-swing .42s ease-in-out infinite alternate-reverse; }
  .a-run .a-bob { animation: a-bob .21s ease-in-out infinite; }
  @keyframes a-drop { 0% { opacity: 0; transform: translate(0, 0); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(-6px, 8px); } }
  .a-sweat { animation: a-drop 1.1s ease-in infinite; }
  @keyframes a-cow { 0%, 66% { transform: translateX(80px); } 72%, 90% { transform: translateX(0); } 96%, 100% { transform: translateX(80px); } }
  .a-cow { transform: translateX(80px); animation: a-cow 8s ease-in-out infinite; }
  @keyframes a-cowhead { 0%, 76% { transform: rotate(0); } 80%, 86% { transform: rotate(-14deg); } 90%, 100% { transform: rotate(0); } }
  .a-cowhead { transform-box: fill-box; transform-origin: 0% 100%; animation: a-cowhead 8s ease-in-out infinite; }
  @keyframes a-moo { 0%, 72% { opacity: 0; transform: scale(.4); } 75% { opacity: 1; transform: scale(1.12); } 77%, 89% { opacity: 1; transform: scale(1); } 92%, 100% { opacity: 0; transform: scale(1); } }
  .a-moo { opacity: 0; transform-box: fill-box; transform-origin: 0% 60%; animation: a-moo 8s ease-out infinite; }

  .a-crank { transform-box: view-box; transform-origin: 58px 61px; animation: a-spin .6s linear infinite; }
  @keyframes a-pedal { 0%, 100% { transform: rotate(-18deg); } 50% { transform: rotate(18deg); } }
  .a-bike .a-legA { animation: a-pedal .6s linear infinite; }
  .a-bike .a-legB { animation: a-pedal .6s linear infinite; animation-delay: -.3s; }
  @keyframes a-lean { 50% { transform: translateY(.8px); } }
  .a-lean { animation: a-lean .3s ease-in-out infinite; }
  @keyframes a-loose { 0%, 70% { transform: none; } 82% { transform: translateX(90px); } 84%, 88% { transform: translateX(90px); opacity: 0; } 89% { transform: translateX(90px); opacity: 1; } 97%, 100% { transform: none; } }
  .a-loose { animation: a-loose 9s ease-in infinite; }
  @keyframes a-dive { 0%, 70% { transform: none; } 74%, 92% { transform: rotate(22deg); } 97%, 100% { transform: none; } }
  .a-dive { transform-box: view-box; transform-origin: 40px 72px; animation: a-dive 9s cubic-bezier(.5, 0, .6, 1.6) infinite; }
  @keyframes a-oops { 0%, 74% { opacity: 0; transform: rotate(0); } 76%, 90% { opacity: 1; } 83% { transform: rotate(25deg); } 93%, 100% { opacity: 0; transform: rotate(0); } }
  .a-oops { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: a-oops 9s linear infinite; }

  .a-shop .a-legA, .a-shop .a-legB { --a: 22deg; }
  .a-shop .a-legA { animation: a-swing .55s ease-in-out infinite alternate; }
  .a-shop .a-legB { animation: a-swing .55s ease-in-out infinite alternate-reverse; }
  .a-shop .a-bob { animation: a-bob .275s ease-in-out infinite; }
  @keyframes a-bag { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
  .a-bagA { animation: a-bag .55s ease-in-out infinite alternate; }
  .a-bagB { animation: a-bag .55s ease-in-out infinite alternate-reverse; }
  @keyframes a-note { 0%, 55% { transform: none; opacity: 0; } 58% { opacity: 1; transform: translate(1px, -4px) rotate(-10deg); }
    66% { transform: translate(10px, 2px) rotate(25deg); } 74% { transform: translate(4px, 9px) rotate(-20deg); } 82% { transform: translate(14px, 15px) rotate(15deg); opacity: 1; } 92%, 100% { transform: translate(18px, 16px); opacity: 0; } }
  .a-note { opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; animation: a-note 5.5s ease-in-out infinite; }
  @keyframes a-coin { 0%, 20% { transform: none; opacity: 0; } 22% { opacity: 1; } 30% { transform: translate(-4px, 8px); } 34% { transform: translate(-7px, 3px); } 38% { transform: translate(-10px, 8px); }
    41% { transform: translate(-12px, 6px); } 44%, 50% { transform: translate(-14px, 8px); opacity: 1; } 56%, 100% { transform: translate(-30px, 8px); opacity: 0; } }
  .a-coin { opacity: 0; animation: a-coin 5.5s ease-in infinite; }

  @keyframes a-kick { 0%, 12% { transform: rotate(0); } 20% { transform: rotate(38deg); } 26% { transform: rotate(-48deg); } 40%, 100% { transform: rotate(0); } }
  .a-kick { animation: a-kick 2.4s ease-in-out infinite; }
  @keyframes a-armA { 0%, 17% { transform: rotate(0); } 20%, 27% { transform: rotate(-40deg); } 30%, 50% { transform: rotate(0); } 53%, 60% { transform: rotate(-40deg); } 63%, 100% { transform: rotate(0); } }
  .a-soccer .a-armA { animation: a-armA 7.2s ease-in-out infinite; }
  @keyframes a-armB { 0%, 17% { transform: rotate(0); } 20%, 27% { transform: rotate(40deg); } 30%, 50% { transform: rotate(0); } 53%, 60% { transform: rotate(40deg); } 63%, 100% { transform: rotate(0); } }
  .a-soccer .a-armB { animation: a-armB 7.2s ease-in-out infinite; }
  .a-ball { offset-rotate: 0deg; }
  .a-ball.a-goal { offset-path: path("M47 70 Q76 28 108 60"); animation: a-goalball 7.2s ease-in-out infinite; }
  @keyframes a-goalball { 0%, 8% { offset-distance: 0%; opacity: 1; } 18% { offset-distance: 100%; } 26.6% { offset-distance: 100%; opacity: 1; } 27%, 30% { offset-distance: 0%; opacity: 0; } 31% { opacity: 1; }
    41.3% { offset-distance: 0%; } 51.6% { offset-distance: 100%; } 60% { offset-distance: 100%; opacity: 1; } 60.3%, 96% { offset-distance: 0%; opacity: 0; } 97%, 100% { offset-distance: 0%; opacity: 1; } }
  .a-ball.a-miss { opacity: 0; offset-path: path("M47 70 Q86 0 140 14"); animation: a-missball 7.2s ease-in infinite; }
  @keyframes a-missball { 0%, 62% { offset-distance: 0%; opacity: 0; } 63%, 74.6% { offset-distance: 0%; opacity: 1; } 86% { offset-distance: 100%; opacity: 1; } 86.5%, 100% { offset-distance: 100%; opacity: 0; } }
  @keyframes a-net { 0%, 18% { transform: scaleX(1); } 20% { transform: scaleX(1.18); } 24%, 51.5% { transform: scaleX(1); } 53.5% { transform: scaleX(1.18); } 57%, 100% { transform: scaleX(1); } }
  .a-net { transform-box: fill-box; transform-origin: 0% 50%; animation: a-net 7.2s ease-out infinite; }
  @keyframes a-cheer { 0%, 18% { opacity: 0; } 20%, 26% { opacity: 1; } 29%, 51.5% { opacity: 0; } 53.5%, 59% { opacity: 1; } 62%, 100% { opacity: 0; } }
  .a-cheer { opacity: 0; animation: a-cheer 7.2s ease-out infinite; }
  @keyframes a-boo { 0%, 84% { opacity: 0; } 87%, 95% { opacity: 1; } 98%, 100% { opacity: 0; } }
  .a-boo { opacity: 0; animation: a-boo 7.2s ease-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .act-pic * { animation: none !important; }
    .a-ball.a-goal { offset-distance: 0%; }
    .a-miss, .a-cheer, .a-boo, .a-moo, .a-oops, .a-note, .a-coin { opacity: 0 !important; }
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
    this._W = SV.W_MIN;
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
    // people: a list; without one the card follows the person entities in Home Assistant
    let list = [];
    this._auto = c.people == null;
    if (!this._auto) {
      if (!Array.isArray(c.people)) throw new Error("people must be a list, e.g. - entity: person.me");
      if (c.people.length > SV_MAX_PEOPLE) throw new Error(`people: the card has room for ${SV_MAX_PEOPLE}`);
      list = c.people;
    }
    const people = list.map((p, n) => {
      if (typeof p === "string") p = { entity: p };
      if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error(`people[${n}] must be a map with an entity`);
      for (const k of Object.keys(p)) {
        if (!SV_PERSON_KEYS.includes(k)) throw new Error(`people[${n}]: unknown key '${k}'. Known: ${SV_PERSON_KEYS.join(", ")}`);
      }
      if (!svIsId(p.entity)) throw new Error(`people[${n}].entity: '${p.entity}' is not an entity id`);
      const out = { entity: p.entity };
      for (const role of SV_PERSON_ROLES) {
        const v = role in p ? p[role] : SV_PERSON_DEFAULTS[role];
        if (v !== null && v !== undefined && !svIsId(v)) throw new Error(`people[${n}].${role}: '${v}' is not an entity id (null switches it off)`);
        out[role] = v || null;
      }
      out.name = p.name != null ? String(p.name) : SV_PERSON_DEFAULTS.name;
      out.portrait = p.portrait ? String(p.portrait) : SV_PERSON_DEFAULTS.portrait;
      const h = p.height == null ? SV_PERSON_DEFAULTS.height : svNum(p.height);
      if (h === null || h < 0.5 || h > 1.2) throw new Error(`people[${n}].height must be a number from 0.5 to 1.2`);
      out.height = h;
      if (p.away != null && !SV_AWAY.includes(p.away)) throw new Error(`people[${n}].away must be one of ${SV_AWAY.join(", ")} (or left out)`);
      out.away = p.away || null;
      return out;
    });

    const ent = c.entities == null ? {} : c.entities;
    if (typeof ent !== "object" || Array.isArray(ent)) throw new Error("entities must be a map, e.g. room_light: light.living_room");
    for (const [k, v] of Object.entries(ent)) {
      if (!(k in SV_DEFAULTS.entities)) throw new Error(`entities: unknown role '${k}'. Known: ${Object.keys(SV_DEFAULTS.entities).join(", ")}`);
      if (v !== null && !svIsId(v)) throw new Error(`entities.${k}: '${v}' is not an entity id (null switches it off)`);
    }
    if (c.cat != null && typeof c.cat !== "boolean" && !(typeof c.cat === "number" && c.cat >= 0 && c.cat <= 100)) {
      throw new Error("cat must be true, false or a number from 0 to 100 (how often it visits, in %)");
    }
    for (const k of ["tap_action", "hold_action"]) {
      if (c[k] != null && (typeof c[k] !== "object" || Array.isArray(c[k]) || !c[k].action)) {
        throw new Error(`${k} must be an action, e.g. action: more-info`);
      }
    }

    this._config = {
      people,
      entities: { ...SV_DEFAULTS.entities, ...ent },
      // how often the cat visits: % of the quarter hours while someone is home
      cat: c.cat == null || c.cat === true ? SV_CAT_DEFAULT : c.cat === false ? 0 : c.cat,
      tap_action: c.tap_action || { action: "more-info" },
      hold_action: c.hold_action || { action: "none" },
    };
    this._watch();
    this._build();
    if (this._hass) {
      this._autoPeople(this._hass); // hass came first: fill the automatic list right away
      this._update();
    }
  }

  /* Without a people list: the first four person entities, followed as they come and go. */
  _autoPeople(hass) {
    if (!this._auto) return false;
    const ids = svAutoPeople(hass);
    if (ids.join() === this._config.people.map((p) => p.entity).join()) return false;
    this._config.people = ids.map((entity) => ({ entity, ...SV_PERSON_DEFAULTS }));
    this._watch();
    return true;
  }

  _watch() {
    const ids = [];
    for (const p of this._config.people) for (const k of ["entity", ...SV_PERSON_ROLES]) if (p[k]) ids.push(p[k]);
    for (const v of Object.values(this._config.entities)) if (v) ids.push(v);
    this._ids = ids;
    this._seen = Object.create(null);
    for (const p of this._config.people) if (p.portrait) this._loadImage(p.portrait);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._config) return;
    let changed = this._autoPeople(hass) || first;
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
      this._ro.observe(this._el.pic);
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
      <style>${SV_STYLE}${SV_AWAY_STYLE}</style>
      <ha-card>
        <div class="pic" role="img"><svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMid meet"></svg></div>
        <div class="tiles"></div>
      </ha-card>`;
    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = { card: $("ha-card"), pic: $(".pic"), svg: $("svg"), tiles: $(".tiles") };
    this._sceneKey = null;
    this._tilesKey = null;
    this._bindPress(this._el.tiles, (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
      return t ? Number(t.getAttribute("data-i")) : null;
    });
    if (this.isConnected) this.connectedCallback();
  }

  /*
   * The picture takes the left half. A wide half makes the house longer to the right (a longer
   * front window, never more plain wall); a narrow one shows the house smaller, never cropped.
   */
  _fit(w, h) {
    const W = SV.widthFor(w / h);
    if (W === this._W) return;
    this._W = W;
    this._update();
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
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  _person(p, now) {
    const st = (id) => (id && this._hass ? this._hass.states[id] : undefined);
    const s = st(p.entity);
    const raw = s ? String(s.state) : "unknown";
    const key = svKey(raw);
    const obj = p.entity.split(".")[1].split("_")[0];
    const name = p.name || (s && s.attributes && s.attributes.friendly_name ? String(s.attributes.friendly_name).split(" ")[0] : obj.charAt(0).toUpperCase() + obj.slice(1));
    let presence = "unknown";
    if (key === "home") presence = "home";
    else if (!SV_BAD.includes(key)) presence = "away";
    let line = "Unknown";
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

  /*
   * The cat decides every quarter of an hour (the same answer on every screen): it visits in `cat` %
   * of them while someone is home and twice as often when nobody is. 100: always there; 0: never.
   */
  _catHere(alone, now) {
    const often = this._config.cat;
    if (!often) return false;
    const slot = Math.floor(now / SV_CAT_SLOT_MS);
    const n = ((slot * 2654435761) >>> 0) % 100;
    return n < Math.min(100, alone ? often * 2 : often);
  }

  _on(role) {
    const id = this._config.entities[role];
    const s = id && this._hass ? this._hass.states[id] : undefined;
    return !!s && ["on", "true"].includes(svKey(s.state));
  }

  _still() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; }
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
    const o = { W: this._W, lit, door, pulse: !door && !anyHome && anyComing, cat: this._catHere(!anyHome, now), still: this._still() };
    const key = JSON.stringify(o);
    if (key !== this._sceneKey) {
      this._sceneKey = key;
      const sc = svScene(o, this._uid);
      this._el.svg.setAttribute("viewBox", sc.viewBox);
      this._el.svg.innerHTML = sc.svg;
    }
    this._el.pic.setAttribute("aria-label", anyHome ? `${ps.filter((x) => x.presence === "home").map((x) => x.name).join(", ")} at home` : "Nobody home");

    // tiles, one per person, always in the same place
    const tiles = this._config.people.map((p, i) => {
      const x = ps[i];
      let face = "", photo = false;
      const im = p.portrait ? this._img[p.portrait] : null;
      const picture = p.portrait && (!im || im.ok !== false) ? p.portrait : x.entityPicture || null;
      const act = x.presence === "away" && p.away ? p.away : null;
      if (act) {
        // what they are doing while away: their face on a little figure, no name needed with a picture
        face = `<svg class="act-pic" viewBox="0 0 122 80" preserveAspectRatio="xMidYMax meet">${svAway(act, picture ? { href: picture } : { initial: (x.name || "?").charAt(0).toUpperCase() }, `${this._uid}-t${i}`, x.coming)}</svg>`;
        photo = true; // the figure carries the face or the initial; no room for a name above it
      } else if (x.presence === "home") {
        const h = Math.round(92 * Math.min(1, p.height / SV_PERSON_DEFAULTS.height));
        if (p.portrait && (!im || im.ok !== false)) { face = `<div class="face" style="height:${h}%"><img src="${svEsc(p.portrait)}" alt=""></div>`; photo = true; }
        else if (x.entityPicture) { face = `<div class="face round"><img src="${svEsc(x.entityPicture)}" alt=""></div>`; photo = true; }
        else face = `<div class="face initial">${svEsc((x.name || "?").charAt(0).toUpperCase())}</div>`;
      }
      const cls = (x.presence === "home" ? "home" : x.presence === "away" ? `away${x.coming ? " coming" : ""}` : "unknown") + (act ? " act" : "");
      const pin = x.presence === "away" && !x.coming && !act ? SV_PIN : "";
      return `<div class="tile ${cls}" data-i="${i}" tabindex="0" role="button" title="${svEsc(`${x.name} · ${x.line}`)}">${face}`
        + `<div class="t">${photo ? "" : `<div class="n">${svEsc(x.name)}</div>`}<div class="s">${pin}${svEsc(x.line)}</div></div></div>`;
    }).join("");
    if (tiles !== this._tilesKey) {
      this._tilesKey = tiles;
      this._el.tiles.className = `tiles n${this._config.people.length}`;
      this._el.tiles.innerHTML = tiles;
    }
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
      { name: "away", selector: { select: { mode: "dropdown", options: [
        { value: "", label: "Name and place" },
        { value: "race_bike", label: "Race bike (now and then a crash)" },
        { value: "running", label: "Running (now and then a cow)" },
        { value: "shopping", label: "Shopping (now and then money falls out)" },
        { value: "soccer", label: "Soccer (now and then a miss)" },
      ] } } },
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
  { name: "cat", selector: { number: { min: 0, max: 100, step: 5, mode: "slider", unit_of_measurement: "%" } } },
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
  height: "Portrait size in the tile",
  portrait: "Portrait (e.g. /local/streetview-house/me.webp)",
  away: "While away",
  distance: "Distance to home",
  direction: "Direction of travel",
  room_light: "Room light (empty: on while anyone is home)",
  door_light: "Door light (empty: on while anyone is home)",
  cat: "Cat visits (% of the time while someone is home; 0: no cat, 100: always)",
  tap_action: "Tap action (tile)",
  hold_action: "Hold action (tile)",
};

class StreetviewHouseEditor extends HTMLElement {
  /* config -> form data: defaults filled in, null shown as empty. */
  static toData(config, hass) {
    const list = Array.isArray(config.people) ? config.people : svAutoPeople(hass);
    const data = {};
    SV_SLOTS.forEach((slot, i) => {
      let p = list[i];
      if (typeof p === "string") p = { entity: p };
      if (!p) { data[slot] = {}; return; }
      const d = { entity: p.entity || "" };
      for (const role of SV_PERSON_ROLES) d[role] = p[role] || "";
      d.name = p.name != null ? p.name : "";
      d.portrait = p.portrait || "";
      d.away = p.away || "";
      d.height = p.height != null ? svNum(p.height) : SV_PERSON_DEFAULTS.height;
      data[slot] = d;
    });
    const ent = config.entities || {};
    data.entities = {};
    for (const role of Object.keys(SV_DEFAULTS.entities)) data.entities[role] = (role in ent ? ent[role] : SV_DEFAULTS.entities[role]) || "";
    data.cat = config.cat == null || config.cat === true ? SV_CAT_DEFAULT : config.cat === false ? 0 : svNum(config.cat);
    data.tap_action = config.tap_action;
    data.hold_action = config.hold_action;
    return data;
  }

  /* form data -> config: only what differs from the defaults. A slot without a person ends the list;
     no person at all: no people list (the card follows the person entities in Home Assistant). */
  static toConfig(data, previous, hass) {
    const config = { type: "custom:streetview-house" };
    const handled = ["type", "people", "entities", "cat", "tap_action", "hold_action"];
    for (const [k, v] of Object.entries(previous || {})) if (!handled.includes(k)) config[k] = v;

    const people = [];
    for (const slot of SV_SLOTS) {
      const d = data[slot] || {};
      if (!d.entity) break;
      const p = { entity: d.entity };
      for (const role of SV_PERSON_ROLES) if (d[role]) p[role] = d[role];
      if (d.name) p.name = d.name;
      if (d.portrait) p.portrait = d.portrait;
      if (d.away) p.away = d.away;
      const h = svNum(d.height);
      if (h != null && h !== SV_PERSON_DEFAULTS.height) p.height = h;
      people.push(p);
    }
    // the automatic people, untouched, stay automatic (no list written)
    const auto = svAutoPeople(hass);
    const isAuto = !Array.isArray((previous || {}).people) && people.length === auto.length
      && people.every((p, i) => p.entity === auto[i] && Object.keys(p).length === 1);
    if (people.length && !isAuto) config.people = people.map((p) => (Object.keys(p).length === 1 ? p.entity : p));

    const entities = {};
    for (const [role, def] of Object.entries(SV_DEFAULTS.entities)) {
      const v = (data.entities || {})[role] || null;
      if (v !== def) entities[role] = v;
    }
    if (Object.keys(entities).length) config.entities = entities;
    const cat = svNum(data.cat);
    if (cat === 0) config.cat = false;
    else if (cat != null && cat !== SV_CAT_DEFAULT) config.cat = cat;
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
    // without a people list the slots show the automatic people: refresh when that list changes
    if (this._form && this._config && !Array.isArray(this._config.people)
      && svAutoPeople(hass).join() !== this._autoKey) this._render();
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
        const config = StreetviewHouseEditor.toConfig(e.detail.value, this._config, this._hass);
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = StreetviewHouseEditor.toData(this._config, this._hass);
    this._autoKey = svAutoPeople(this._hass).join();
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
    description: "Who is home: the street facade with the door light and a walking cat, and a tile per person.",
    preview: false,
  });
}

console.info(`%c STREETVIEW-HOUSE %c v${VERSION} `, "color:#fff;background:#4a3226;font-weight:600", "color:#4a3226;background:#f2efe6");
}
