# Streetview House: notes for working on this repo

Marketplace (formerly HACS) dashboard card (Lovelace) for the people in the owner's house, drawn as the street facade of the house. Owner: BarBaar44. Sister repos with the same conventions: [gardenview-house](https://github.com/BarBaar44/gardenview-house) (the garden side; the drawing style and camera come from there), [appliance-card](https://github.com/BarBaar44/appliance-card) (the reference), [tesla-model3-card](https://github.com/BarBaar44/tesla-model3-card) (line art and badges).

## Files

| File | Purpose |
|---|---|
| `streetview-house.js` | The whole card: plain custom element, no build step, no dependencies. `SV_PERSON_DEFAULTS` holds the per-person defaults, `SV_DEFAULTS` the rest, `SV` the camera and house width, `svScene` the drawing, `svCat` the walking cat. |
| `tests/streetview-house.test.js` | jsdom tests: presence, zones, coming home, tiles, lights, portraits and fallbacks, cat (walking and still), actions, fitting the picture, redraws, config errors, editor round trips. `npm test`. |
| `hacs.json` | Manifest for the Home Assistant Marketplace. |
| `README.md` | User docs, also the Marketplace info page. Keep the option tables in sync with the code. |
| `CHANGELOG.md` | One `## vX.Y.Z` section per release; the Release workflow uses it as the release notes. |
| `shot.png` | README image (made-up people with initials, no photos), linked by absolute raw URL. |
| `streetview-house.yaml` | Minimal and full example configs. |

## Rules to keep

* **Nothing about the owner's household in this repo:** no names, entity ids, portrait file names or photos, not in code, tests, examples or docs. The owner's people list lives in their dashboard config. Examples and tests use made-up people (Alex, Sam, Robin, Kim). Portraits live on the user's Home Assistant (`/config/www/streetview-house/`, cut out, transparent, about 360 px wide). Screenshots for the README use plain figures.
* Without `people` the card follows the first four `person.*` entities in `hass.states`, sorted by entity id (`_autoPeople`), with the per-person defaults: no portrait, no proximity. `svAutoPeople` caches per `hass.entities` object (the registry), so the state scan only reruns when the registry changes; `setConfig` fills the list at once when hass is already set.
* Layout (v0.4.0, the owner's choice after the Gardenview card; mirrored in v0.6.0): the house on the right half, a tile per person on the left (`house: left` swaps them; `ha-card.house-right` is `row-reverse`, the picture anchors `xMaxYMid` so it sits against the card's edge; the drawing is mirrored too (`o.flip`, a scale(-1 1) about the middle of the viewBox), so the house is seen from the right with the door at the near corner, as the owner asked: "flip the house, keep the door at the front") (2 x 2, same place whether home or not). No phone badges. Nobody stands in the window. No house number on the wall.
* Read only: no service calls. Taps on a tile (and Enter on a focused tile) go through `hass-action` with the person as entity (more-info by default; hold none); the picture does nothing.
* Presence: `home` is home; any other state except unknown/unavailable is away (zone names shown as they are); unknown/unavailable (no tracker) shows "Unknown". Since texts are compact: 40m, 3h, 2d.
* Tiles: home shows the portrait cut out from the bottom of the tile (the entity_picture in a circle, else the initial) and "Home · 40m" in green; no name when a picture shows (owner: the picture is enough), the name only with an initial; away shows no photo (owner dropped the grey look), a pin, place and since, unless `away` is set: then (away or unknown) `svAway` draws an animated figure with their face (portrait, entity_picture, else initial) in a 122 x 80 viewBox (`xMidYMax meet`), status on top, never a name (no room above the figure; the tooltip has it); coming home shows the distance in orange. `height` scales the portrait in its tile. Under 200 px wide (container query) the face sits on top, name and status centred below.
* Away activities (`SV_AWAY`, v0.5.0): `race_bike` (front wheel comes off every 9 s, nose-dive, stars), `running` (a cow walks in every 8 s, "MOOOOH!"), `shopping` (two bags, four banknotes and four coins falling out, out of step, so money is always falling; owner asked for more), `soccer` (goal, goal, over the bar in 7.2 s). Coming home mirrors the scene (`back`), texts are flipped back so they stay readable. Things that leave the scene park far outside the viewBox, because a meet viewBox shows what lies just beside it. All CSS classes start with `a-`; under reduced motion the figures stand still and the transient bits are hidden. Which person does what is the owner's dashboard config, never the repo.
* Lights: `room_light` and `door_light` follow real entities when set, else presence (anyone home). The door light pulses only while nobody is home and someone is coming home (direction `towards`, distance above 0).
* The lantern is not used in real life: it is always drawn off (owner).
* The cat: `_catHere` decides per quarter of an hour (deterministic hash, out of 100): there in `cat` % of the quarters while someone is home (default 30, `SV_CAT_DEFAULT`), twice that when nobody is, capped at always. `cat: true` is the default, `false` is 0; the editor shows a 0 to 100 slider and writes only a non-default. While here it walks a 26 s SMIL loop (`svCat`): in along the sill from the right, sits facing the street (blink, paw lick, tail flick), walks on, jumps down, strolls off past the door. Under reduced motion (`_still`) it just sits on the sill, no SMIL.
* Drawing: camera 50 degrees to the wall from the left, eye height (the owner asked for "45 like the sun screen card"; Gardenview itself uses 65). Side wall showing, white fascia, plinth, downpipe, arched door with a window about 80 % of its height, lantern always off, front window with a sofa back and a pendant lamp (room light on: warm amber glass, lamp glow, light on the sill and the pavement; off: cool grey glass), sheen and a sweep every 14 s, sill, awning box.
* The picture is rebuilt only when its inputs change (`_sceneKey`). Re-render only on the card's own entities plus a 60 s tick (since texts, cat).
* Layout: 12 x 3 (184 px) by default. `_fit` (ResizeObserver on the picture) picks the house width `SV.widthFor(aspect)`: a wider half makes the house and its front window longer to the right (never plain wall, the owner disliked that); a narrow half shows the house smaller (`xMinYMid meet`, never cropped). Measure in a real browser at 250, 370 and 520 px, dark and light theme, after any layout change; a stub `ha-card` must not set `display` inline.
* Every animation stops under reduced motion.
* Visual editor on `ha-form`: four person slots (an empty slot ends the list), lights, cat, actions. Only non-defaults are written; without a `people` list the slots show the automatic people, and leaving them untouched writes no list; unknown keys such as `grid_options` are kept.
* The whole file sits in one block scope; `const VERSION` stays on its own line for the Release workflow.

## Releasing

1. Changes go through a pull request; the owner merges.
2. Bump `VERSION`, add the CHANGELOG section in the PR that is meant to become a release.
3. The owner pushes the `vX.Y.Z` tag. **Never tag or release without the owner's explicit go.**
