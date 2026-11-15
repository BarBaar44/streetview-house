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
/* What the card knows per person (shown on their tile). */
function rows(c) {
  return c._config.people.map((p) => {
    const x = c._person(p, Date.now());
    return { name: x.name, line: x.line, coming: x.coming, away: x.presence === "away" };
  });
}
const tileEls = (c) => [...c._el.tiles.querySelectorAll(".tile")];
/* Titles of the tiles of whoever is home. */
const titles = (c) => tileEls(c).filter((t) => t.classList.contains("home")).map((t) => t.getAttribute("title"));
const scene = (c) => c._el.svg.innerHTML;
const atHome = (c) => tileEls(c).filter((t) => t.classList.contains("home")).map((t) => Number(t.getAttribute("data-i")));
function actions(c) {
  const got = [];
  c.addEventListener("hass-action", (ev) => got.push(ev.detail));
  return got;
}
const same = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("people list: names, presence and since on the tiles", () => {
  const c = render(states());
  const r = rows(c);
  same(titles(c), ["Alex · Home · 40m", "Sam · Home · 3h"]);
  same(r.map((x) => x.name), ["Alex", "Sam", "Robin", "Kim"]);
  assert.strictEqual(r[0].line, "Home · 40m");
  assert.strictEqual(r[1].line, "Home · 3h");
  assert.strictEqual(r[2].line, "Away · 5h");
  assert(r[2].away && !r[0].away);
});

test("no tracker (unknown): a tile that says so, never at home", () => {
  const c = render(states());
  const r = rows(c);
  assert.strictEqual(r[3].line, "Unknown");
  assert(!r[3].away);
  same(atHome(c), [0, 1]);
  assert(tileEls(c)[3].classList.contains("unknown"));
});

test("zone name and days", () => {
  const r = rows(render(states({ "person.robin": st("Work", {}, 60 * 50) })));
  assert.strictEqual(r[2].line, "Work · 2d");
});

test("coming home: distance and arrow on the tile, door light pulses when nobody is home", () => {
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
  assert(tileEls(c)[0].classList.contains("coming"));
  same(atHome(c), []);
});

test("coming home under 10 km keeps one decimal; away_from is just away", () => {
  const near = rows(render(states({ "person.alex": st("not_home"), "sensor.home_alex_distance": st(3.64, { unit_of_measurement: "km" }), "sensor.home_alex_direction_of_travel": st("towards") })));
  assert.strictEqual(near[0].line, "3.6 km → home");
  const off = rows(render(states({ "person.alex": st("not_home", {}, 120), "sensor.home_alex_distance": st(8, { unit_of_measurement: "km" }), "sensor.home_alex_direction_of_travel": st("away_from") })));
  assert.strictEqual(off[0].line, "Away · 2h");
});

test("no pulse while someone is home (the door light is simply on)", () => {
  const c = render(states({ "person.alex": st("not_home"), "sensor.home_alex_distance": st(5), "sensor.home_alex_direction_of_travel": st("towards") }));
  assert(!/pulse/.test(scene(c)));
  assert(/#ffd54f/.test(scene(c)));
});

test("lights: follow presence by default, real lights when set", () => {
  const lamp = (x) => /class="lamp"/.test(x);
  const empty = states({ "person.alex": st("not_home"), "person.sam": st("not_home") });
  assert(!lamp(scene(render(empty))), "dark room when nobody is home");
  assert(lamp(scene(render(states()))), "lit room when someone is home");
  const cfg = { entities: { room_light: "light.front_room", door_light: "light.hall" } };
  const off = scene(render(states({ "light.front_room": st("off"), "light.hall": st("off") }), cfg));
  assert(!lamp(off) && !/#ffd54f/.test(off), "home but lights off: dark");
  const on = scene(render(states({ "light.front_room": st("on"), "light.hall": st("on") }), cfg));
  assert(lamp(on) && /#ffd54f/.test(on));
});

test("portraits on the home tiles: configured file, entity_picture when it fails, an initial without either", () => {
  const c = render(states({ "person.sam": st("home", { entity_picture: "/api/image/sam.jpg" }) }));
  const img = (i) => { const e = tileEls(c)[i].querySelector(".face img"); return e && e.getAttribute("src"); };
  assert.strictEqual(img(0), "/local/streetview-house/alex.webp");
  assert.strictEqual(img(2), null, "away: no face");
  c._img["/local/streetview-house/sam.webp"] = { ok: false, w: 1, h: 1 };
  c._update();
  assert.strictEqual(img(1), "/api/image/sam.jpg");
  assert(tileEls(c)[1].querySelector(".face.round"));
  const d = render(states(), { people: [{ entity: "person.alex", portrait: null }] });
  assert.strictEqual(tileEls(d)[0].querySelector(".face.initial").textContent, "A");
  assert(!/<image/.test(scene(d)), "nobody in the window any more");
});

test("tiles: one per person in list order, in the same place whether home or not", () => {
  const c = render(states({ "person.sam": st("not_home"), "person.kim": st("home") }));
  same(tileEls(c).map((t) => Number(t.getAttribute("data-i"))), [0, 1, 2, 3]);
  same(atHome(c), [0, 3], "Alex and Kim");
  same(tileEls(c).map((t) => t.querySelector(".n").textContent), ["Alex", "Sam", "Robin", "Kim"]);
  assert(tileEls(c)[1].querySelector(".pin"), "away: a pin before the place");
  assert.strictEqual(c._el.tiles.className, "tiles n4");
  const one = render(states(), { people: ["person.alex"] });
  assert.strictEqual(one._el.tiles.className, "tiles n1");
});

test("the cat: there or not, in a free spot when people are home", () => {
  assert(/class="cat"/.test(scene(render(states(), {}, true))));
  assert(!/class="cat"/.test(scene(render(states(), {}, false))));
  assert(!/class="cat"/.test(scene(render(states(), { cat: false }))), "cat: false never shows it");
  assert(/animateMotion/.test(scene(render(states(), {}, true))), "it walks");
  const still = new Card();
  w.document.body.appendChild(still);
  still._catHere = () => true;
  still._still = () => true;
  still.setConfig({ people: FAMILY });
  still.hass = hass(states());
  assert(/class="cat"/.test(scene(still)) && !/animateMotion|<animate /.test(scene(still)), "reduced motion: it just sits");
  const c = render(states());
  c._catHere = Card.prototype._catHere;
  const count = (cfg, alone) => {
    const k = new Card();
    k.setConfig({ people: FAMILY, ...cfg });
    let n = 0;
    for (let q = 0; q < 400; q++) if (k._catHere(alone, q * 15 * MIN)) n++;
    return n / 4; // % of 400 quarter hours
  };
  const home = count({}, false), alone = count({}, true);
  assert(home > 15 && home < 45 && alone > home, `default: about 30 % home, more when nobody is (${home}, ${alone})`);
  assert.strictEqual(count({ cat: 100 }, false), 100, "100: always there");
  assert.strictEqual(count({ cat: 50 }, true), 100, "nobody home: twice as often, at most always");
  assert.strictEqual(count({ cat: 0 }, true), 0, "0: never");
  assert.strictEqual(count({ cat: true }, false), home, "true is the default");
});

test("tap on a tile: more-info of that person; hold off by default; the picture does nothing", () => {
  const c = render(states());
  const got = actions(c);
  const press = (el) => {
    el.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }));
    el.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
  };
  press(tileEls(c)[2].querySelector(".n"));
  same(got[0], { config: { entity: "person.robin", tap_action: { action: "more-info" } }, action: "tap" });
  press(tileEls(c)[1]);
  assert.strictEqual(got[1].config.entity, "person.sam");
  press(c._el.svg.querySelector("polygon"));
  assert.strictEqual(got.length, 2, "tapping the house does nothing");
  tileEls(c)[0].dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.strictEqual(got[2].config.entity, "person.alex", "Enter on a focused tile");
});

test("the picture: a wider half makes the house longer, a narrow one shows it whole", () => {
  const c = render(states());
  const vb = () => c._el.svg.getAttribute("viewBox").split(" ").map(Number);
  c._fit(180, 184);
  assert.strictEqual(c._W, 5.4, "phone: the house as drawn");
  const narrow = vb();
  c._fit(320, 184);
  assert(c._W > 5.4, "wide: a longer house");
  const wide = vb();
  assert(Math.abs(wide[2] / wide[3] - 320 / 184) < 0.08, `fills the half: ${wide[2] / wide[3]}`);
  assert(wide[2] > narrow[2] && Math.abs(wide[0] - narrow[0]) < 0.01, "grows to the right, the corner stays");
  assert.strictEqual(c.shadowRoot.querySelector("svg").getAttribute("preserveAspectRatio"), "xMinYMid meet", "never cropped");
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
  same(titles(c), ["Alex · Home · 40m", "Sam · Home · 3h"]);
  assert(!tileEls(c).some((t) => t.querySelector(".face img")), "no portraits by default: initials");
  const s = states();
  delete s["person.kim"];
  c.hass = hass(s);
  same(c._config.people.map((p) => p.entity), ["person.alex", "person.robin", "person.sam"]);
  c.hass = hass({ ...s, "person.sam": st("not_home") });
  same(titles(c), ["Alex · Home · 40m"], "still follows their states");
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
  same(titles(c), ["Alex · Home · 40m", "Sam · Home · 3h"]);
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
    [{ cat: "yes" }, /cat must be true, false or a number/],
    [{ cat: 150 }, /cat must be true, false or a number/],
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
  assert.strictEqual(d.cat, 30, "the cat shows its default rate");
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
  d.cat = 0;
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
  const often = Editor.toData({ type: "custom:streetview-house", cat: 80 });
  assert.strictEqual(often.cat, 80);
  same(Editor.toConfig(often, { type: "custom:streetview-house" }), { type: "custom:streetview-house", cat: 80 });
  often.cat = 30;
  same(Editor.toConfig(often, { type: "custom:streetview-house" }), { type: "custom:streetview-house" }, "back to the default: nothing written");
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
