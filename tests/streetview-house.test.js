// Tests for streetview-house.js in a simulated browser. Run: npm test
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const src = fs.readFileSync(path.join(__dirname, "..", "streetview-house.js"), "utf8");
w.eval(src);
w.eval(src); // loading twice as a classic script must not throw (no top-level name clashes)
const Card = w.customElements.get("streetview-house");
const Editor = w.customElements.get("streetview-house-editor");
assert(Card && Editor, "registered");

const MIN = 60000;
const ago = (min) => new Date(Date.now() - min * MIN).toISOString();
const st = (state, attributes = {}, min = 60) => ({ state: String(state), attributes, last_changed: ago(min), last_updated: ago(min) });

/* A made-up household; o overrides per entity. */
const states = (o = {}) => ({
  "person.alex": st("home", { friendly_name: "Alex Jansen" }, 40),
  "person.sam": st("home", { friendly_name: "Sam" }, 180),
  "person.robin": st("not_home", { friendly_name: "Robin" }, 300),
  "person.kim": st("unknown", { friendly_name: "Kim" }, 600),
  "sensor.home_alex_distance": st(0, { unit_of_measurement: "km" }),
  "sensor.home_alex_direction_of_travel": st("arrived"),
  ...o,
});
/* Their people list, in this order (the tests use the index). */
const FAMILY = [
  { entity: "person.alex", portrait: "/local/streetview-house/alex.webp", height: 1,
    distance: "sensor.home_alex_distance", direction: "sensor.home_alex_direction_of_travel" },
  { entity: "person.sam", portrait: "/local/streetview-house/sam.webp", height: 0.98 },
  { entity: "person.robin", portrait: "/local/streetview-house/robin.webp" },
  { entity: "person.kim", portrait: "/local/streetview-house/kim.webp", height: 0.88 },
];
const hass = (s) => ({ states: s, language: "en", locale: { language: "en" } });

function render(s, config = {}, cat = false) {
  const c = new Card();
  w.document.body.appendChild(c);
  c._catHere = () => cat;
  c.setConfig({ people: FAMILY, ...config });
  c.hass = hass(s);
  return c;
}
/* What the card knows per person (shown as the hover title of a person in the window). */
function rows(c) {
  return c._config.people.map((p) => {
    const x = c._person(p, Date.now());
    return { name: x.name, line: x.line, coming: x.coming, away: x.presence === "away" };
  });
}
const titles = (c) => [...c._el.svg.querySelectorAll(".person title")].map((t) => t.textContent);
const scene = (c) => c._el.svg.innerHTML;
const inWindow = (c) => [...c._el.svg.querySelectorAll(".person")].map((e) => Number(e.getAttribute("data-i")));
function actions(c) {
  const got = [];
  c.addEventListener("hass-action", (ev) => got.push(ev.detail));
  return got;
}
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("people list: names, presence and since; titles for those at home", () => {
  const c = render(states());
  const r = rows(c);
  same(titles(c), ["Alex · Home · 40 min", "Sam · Home · 3 h"]);
  same(r.map((x) => x.name), ["Alex", "Sam", "Robin", "Kim"]);
  assert.strictEqual(r[0].line, "Home · 40 min");
  assert.strictEqual(r[1].line, "Home · 3 h");
  assert.strictEqual(r[2].line, "Away · 5 h");
  assert(r[2].away && !r[0].away);
});

test("no tracker (unknown): no presence line, not in the window", () => {
  const c = render(states());
  const r = rows(c);
  assert.strictEqual(r[3].line, "");
  assert(!r[3].away);
  same(inWindow(c), [0, 1]);
});

test("zone name and days", () => {
  const r = rows(render(states({ "person.robin": st("Work", {}, 60 * 50) })));
  assert.strictEqual(r[2].line, "Work · 2 d");
});

test("coming home: distance and arrow in the title, door light pulses when nobody is home", () => {
  const s = states({
    "person.alex": st("not_home", {}, 120),
    "person.sam": st("not_home", {}, 30),
    "sensor.home_alex_distance": st(12.4, { unit_of_measurement: "km" }),
    "sensor.home_alex_direction_of_travel": st("towards"),
  });
  const c = render(s);
  const r = rows(c);
  assert.strictEqual(r[0].line, "12 km → home");
  assert(r[0].coming);
  assert(/class="doorlight pulse"/.test(scene(c)));
  same(inWindow(c), []);
});

test("coming home under 10 km keeps one decimal; away_from is just away", () => {
  const near = rows(render(states({ "person.alex": st("not_home"), "sensor.home_alex_distance": st(3.64, { unit_of_measurement: "km" }), "sensor.home_alex_direction_of_travel": st("towards") })));
  assert.strictEqual(near[0].line, "3.6 km → home");
  const off = rows(render(states({ "person.alex": st("not_home", {}, 120), "sensor.home_alex_distance": st(8, { unit_of_measurement: "km" }), "sensor.home_alex_direction_of_travel": st("away_from") })));
  assert.strictEqual(off[0].line, "Away · 2 h");
});

test("no pulse while someone is home (the door light is simply on)", () => {
  const c = render(states({ "person.alex": st("not_home"), "sensor.home_alex_distance": st(5), "sensor.home_alex_direction_of_travel": st("towards") }));
  assert(!/pulse/.test(scene(c)));
  assert(/#ffd54f/.test(scene(c)));
});

test("lights: follow presence by default, real lights when set", () => {
  const empty = states({ "person.alex": st("not_home"), "person.sam": st("not_home") });
  assert(/#1b2224/.test(scene(render(empty))), "dark room when nobody is home");
  assert(/#bfe0d6/.test(scene(render(states()))), "lit room when someone is home");
  const cfg = { entities: { room_light: "light.front_room", door_light: "light.hall" } };
  const off = scene(render(states({ "light.front_room": st("off"), "light.hall": st("off") }), cfg));
  assert(/#1b2224/.test(off) && !/#ffd54f/.test(off), "home but lights off: dark");
  const on = scene(render(states({ "light.front_room": st("on"), "light.hall": st("on") }), cfg));
  assert(/#bfe0d6/.test(on));
});

test("portraits: configured file, fallback to entity_picture when it fails, plain figure without either", () => {
  const c = render(states({ "person.sam": st("home", { entity_picture: "/api/image/sam.jpg" }) }));
  assert(/href="\/local\/streetview-house\/alex.webp"/.test(scene(c)));
  c._img["/local/streetview-house/sam.webp"] = { ok: false, w: 1, h: 1 };
  c._sceneKey = null; c._update();
  assert(/href="\/api\/image\/sam.jpg"/.test(scene(c)));
  const d = render(states(), { people: [{ entity: "person.alex", portrait: null }] });
  assert(!/<image/.test(scene(d)) && /class="person"/.test(scene(d)));
});

test("people at home stand together in the middle, in list order, no gaps", () => {
  const c = render(states({ "person.sam": st("not_home"), "person.kim": st("home") }));
  same(inWindow(c), [0, 3], "Alex and Kim");
  const xs = [...c._el.svg.querySelectorAll(".person clipPath rect, clipPath[id$='-pc0'] rect, clipPath[id$='-pc3'] rect")];
  const clip = (i) => c._el.svg.querySelector(`clipPath[id$='-pc${i}'] rect`);
  const r0 = clip(0), r3 = clip(3);
  const right0 = Number(r0.getAttribute("x")) + Number(r0.getAttribute("width"));
  const left3 = Number(r3.getAttribute("x"));
  assert(left3 <= right0 + 0.01, `touching: ${right0} vs ${left3}`);
});

test("the cat: there or not, in a free spot when people are home", () => {
  assert(/class="cat"/.test(scene(render(states(), {}, true))));
  assert(!/class="cat"/.test(scene(render(states(), {}, false))));
  assert(!/class="cat"/.test(scene(render(states(), { cat: false }))), "cat: false never shows it");
  const c = render(states());
  c._catHere = Card.prototype._catHere;
  const slots = new Set();
  for (let q = 0; q < 40; q++) slots.add(c._catHere(true, q * 15 * MIN));
  assert(slots.has(true) && slots.has(false), "comes and goes");
});

test("tap on a person in the window: more-info of that person; hold off by default", () => {
  const c = render(states({ "person.robin": st("home") }));
  const got = actions(c);
  const tap = (i) => {
    const el = c._el.svg.querySelector(`.person[data-i="${i}"] image`);
    el.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    el.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
  };
  tap(2);
  same(got[0], { config: { entity: "person.robin", tap_action: { action: "more-info" } }, action: "tap" });
  tap(1);
  assert.strictEqual(got[1].config.entity, "person.sam");
  const wall = c._el.svg.querySelector("polygon");
  wall.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
  wall.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
  assert.strictEqual(got.length, 2, "tapping the wall does nothing");
});

test("the picture fills the card: wider shows more wall, narrower drops the door", () => {
  const c = render(states());
  const vb = () => c._el.svg.getAttribute("viewBox").split(" ").map(Number);
  c._fit(520, 184);
  const wide = vb();
  c._fit(370, 184);
  const mid = vb();
  c._fit(250, 184);
  const narrow = vb();
  assert(Math.abs(wide[2] / wide[3] - 520 / 184) < 0.01 && Math.abs(mid[2] / mid[3] - 370 / 184) < 0.01);
  assert(narrow[0] > mid[0], "narrow keeps the window, crops the door side");
  assert(Math.abs(narrow[0] + narrow[2] - (mid[0] + mid[2])) < 0.5 || narrow[0] + narrow[2] <= mid[0] + mid[2] + 0.5);
});

test("own people list: no built-in defaults, null switches a role off", () => {
  const c = render(states({ "person.guest": st("home", { friendly_name: "Anna de Vries" }) }),
    { people: [{ entity: "person.alex", distance: "sensor.home_alex_distance", direction: null }, "person.guest"] });
  const r = rows(c);
  same(r.map((x) => x.name), ["Alex", "Anna"]);
  assert.strictEqual(c._config.people[0].direction, null);
  assert.strictEqual(c._config.people[0].distance, "sensor.home_alex_distance");
  same(c._config.people[1], { entity: "person.guest", distance: null, direction: null, name: null, portrait: null, height: 0.95 });
});

test("no people list: the first four person entities in Home Assistant, sorted, following them", () => {
  const c = new Card();
  w.document.body.appendChild(c);
  c._catHere = () => false;
  c.setConfig({});
  c.hass = hass(states({ "person.zoe": st("home", { friendly_name: "Zoe" }) }));
  same(c._config.people.map((p) => p.entity), ["person.alex", "person.kim", "person.robin", "person.sam"]);
  same(titles(c), ["Alex · Home · 40 min", "Sam · Home · 3 h"]);
  assert(!/<image/.test(scene(c)), "no portraits by default: plain figures");
  const s = states();
  delete s["person.kim"];
  c.hass = hass(s);
  same(c._config.people.map((p) => p.entity), ["person.alex", "person.robin", "person.sam"]);
  c.hass = hass({ ...s, "person.sam": st("not_home") });
  same(titles(c), ["Alex · Home · 40 min"], "still follows their states");
  const e = new Card();
  e.setConfig({});
  e.hass = hass({ "sun.sun": st("above_horizon") });
  same(e._config.people, [], "no person entities: an empty house");
});

test("no people list, hass set before the config: people show at once", () => {
  const c = new Card();
  w.document.body.appendChild(c);
  c._catHere = () => false;
  c.setConfig({ people: FAMILY });
  c.hass = hass(states());
  c.setConfig({});
  same(c._config.people.map((p) => p.entity), ["person.alex", "person.kim", "person.robin", "person.sam"]);
  same(titles(c), ["Alex · Home · 40 min", "Sam · Home · 3 h"]);
});

test("automatic list: scanned again only when the entity registry changes", () => {
  const c = new Card();
  c.setConfig({});
  const reg = { "person.alex": {} };
  let scans = 0;
  const counted = (s) => new Proxy(s, { ownKeys: (t) => { scans++; return Reflect.ownKeys(t); } });
  c.hass = { ...hass(counted(states())), entities: reg };
  c.hass = { ...hass(counted(states({ "person.sam": st("not_home") }))), entities: reg };
  c.hass = { ...hass(counted(states())), entities: reg };
  assert.strictEqual(scans, 1, "same registry: one scan");
  const s = { ...states(), "person.zoe": st("home") };
  delete s["person.kim"];
  c.hass = { ...hass(counted(s)), entities: { ...reg } };
  assert.strictEqual(scans, 2, "new registry: scanned again");
  same(c._config.people.map((p) => p.entity), ["person.alex", "person.robin", "person.sam", "person.zoe"]);
});

test("re-render only when the card's own entities change", () => {
  const c = render(states());
  let n = 0;
  const orig = c._update.bind(c);
  c._update = () => { n++; orig(); };
  const s = states();
  c.hass = hass({ ...s, "sun.sun": st("below_horizon") });
  c.hass = hass({ ...c.hass.states, "person.alex": st("not_home") });
  assert.strictEqual(n, 2, "first set with new objects counts; unrelated entity does not");
});

test("config errors", () => {
  const bad = [
    [{ foo: 1 }, /Unknown option 'foo'/],
    [{ people: "person.x" }, /people must be a list/],
    [{ people: [{ entity: "x" }] }, /not an entity id/],
    [{ people: [{ entity: "person.a", phone: "sensor.x" }] }, /unknown key 'phone'/],
    [{ people: [1, 2, 3, 4, 5].map((i) => `person.p${i}`) }, /room for 4/],
    [{ people: [{ entity: "person.a", height: 3 }] }, /height must be/],
    [{ entities: { lamp: "light.x" } }, /unknown role 'lamp'/],
    [{ battery_low: 20 }, /Unknown option 'battery_low'/],
    [{ people: [{ entity: "person.a", battery: "sensor.x" }] }, /unknown key 'battery'/],
    [{ cat: "yes" }, /cat must be true or false/],
    [{ tap_action: "more-info" }, /tap_action must be an action/],
  ];
  for (const [config, re] of bad) {
    const c = new Card();
    assert.throws(() => c.setConfig(config), re, JSON.stringify(config));
  }
});

test("size: 12 x 3", () => {
  const c = render(states());
  same(c.getGridOptions(), { columns: 12, rows: 3, min_columns: 6, min_rows: 3 });
  assert.strictEqual(c.getCardSize(), 3);
});

test("editor: no people list shows the automatic people and writes nothing back", () => {
  const h = hass(states());
  const d = Editor.toData({}, h);
  same([1, 2, 3, 4].map((i) => d[`person_${i}`].entity), ["person.alex", "person.kim", "person.robin", "person.sam"]);
  assert.strictEqual(d.person_1.portrait, "");
  assert.strictEqual(d.cat, true);
  same(Editor.toConfig(d, { type: "custom:streetview-house" }, h), { type: "custom:streetview-house" }, "untouched: stays automatic");
  d.person_2 = { ...d.person_2, portrait: "/local/streetview-house/kim.webp" };
  same(Editor.toConfig(d, { type: "custom:streetview-house" }, h).people,
    ["person.alex", { entity: "person.kim", portrait: "/local/streetview-house/kim.webp" }, "person.robin", "person.sam"],
    "an edit writes the full list");
  const empty = Editor.toData({});
  same(empty.person_1, {}, "no hass yet: empty slots");
  same(Editor.toConfig(empty, { type: "custom:streetview-house", grid_options: { columns: 12, rows: 3 } }),
    { type: "custom:streetview-house", grid_options: { columns: 12, rows: 3 } });
});

test("editor: changes are written as the smallest config, and every written config is accepted", () => {
  const d = Editor.toData({ type: "custom:streetview-house", people: FAMILY });
  assert.strictEqual(d.person_1.distance, "sensor.home_alex_distance");
  d.person_1 = { ...d.person_1, distance: "", direction: "", portrait: "", height: 0.95 };
  d.person_2.name = "G";
  d.person_4 = {};
  d.entities.room_light = "light.front_room";
  d.cat = false;
  const cfg = Editor.toConfig(d, { type: "custom:streetview-house" });
  same(cfg, {
    type: "custom:streetview-house",
    people: ["person.alex", { entity: "person.sam", name: "G", portrait: "/local/streetview-house/sam.webp", height: 0.98 },
      { entity: "person.robin", portrait: "/local/streetview-house/robin.webp" }],
    entities: { room_light: "light.front_room" },
    cat: false,
  });
  const c = new Card();
  c.setConfig(cfg);
  same(Editor.toData(cfg).person_1.distance, "");
  same(Editor.toConfig(Editor.toData({}), { type: "custom:streetview-house" }), { type: "custom:streetview-house" }, "no person: no list");
  same(Editor.toConfig(Editor.toData(cfg), cfg), cfg, "round trip");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
