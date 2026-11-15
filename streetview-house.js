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
const VERSION = "0.4.1";

const SV_HOLD_MS = 500;
const SV_MOVE_PX = 8;
const SV_TICK_MS = 60000; // "since" texts and cat visits follow the clock
const SV_CAT_SLOT_MS = 15 * 60000; // the cat decides every quarter of an hour
const SV_MAX_PEOPLE = 4; // four tiles

/* Per person: entity, name, portrait, height (relative), proximity. Without a people list the
   card takes the first four person entities in Home Assistant, sorted by entity id. */
const SV_PERSON_DEFAULTS = { name: null, portrait: null, height: 0.95, distance: null, direction: null };
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
      <style>${SV_STYLE}</style>
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
      let face = "";
      if (x.presence === "home") {
        const im = p.portrait ? this._img[p.portrait] : null;
        const h = Math.round(92 * Math.min(1, p.height / SV_PERSON_DEFAULTS.height));
        if (p.portrait && (!im || im.ok !== false)) face = `<div class="face" style="height:${h}%"><img src="${svEsc(p.portrait)}" alt=""></div>`;
        else if (x.entityPicture) face = `<div class="face round"><img src="${svEsc(x.entityPicture)}" alt=""></div>`;
        else face = `<div class="face initial">${svEsc((x.name || "?").charAt(0).toUpperCase())}</div>`;
      }
      const cls = x.presence === "home" ? "home" : x.presence === "away" ? `away${x.coming ? " coming" : ""}` : "unknown";
      const pin = x.presence === "away" && !x.coming ? SV_PIN : "";
      return `<div class="tile ${cls}" data-i="${i}" tabindex="0" role="button" title="${svEsc(`${x.name} · ${x.line}`)}">${face}`
        + `<div class="t"><div class="n">${svEsc(x.name)}</div><div class="s">${pin}${svEsc(x.line)}</div></div></div>`;
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
  height: "Portrait size in the tile",
  portrait: "Portrait (e.g. /local/streetview-house/me.webp)",
  distance: "Distance to home",
  direction: "Direction of travel",
  room_light: "Room light (empty: on while anyone is home)",
  door_light: "Door light (empty: on while anyone is home)",
  cat: "Cat",
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
      d.height = p.height != null ? svNum(p.height) : SV_PERSON_DEFAULTS.height;
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
