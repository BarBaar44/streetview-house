# Streetview House: notes for working on this repo

Marketplace (formerly HACS) dashboard card (Lovelace) for the people in the owner's house, drawn as the street facade of the house. Owner: BarBaar44. Sister repos with the same conventions: [gardenview-house](https://github.com/BarBaar44/gardenview-house) (the garden side; the drawing style and camera come from there), [appliance-card](https://github.com/BarBaar44/appliance-card) (the reference), [tesla-model3-card](https://github.com/BarBaar44/tesla-model3-card) (line art and badges).

## Files

| File | Purpose |
|---|---|
| `streetview-house.js` | The whole card: plain custom element, no build step, no dependencies. `SV_PERSON_DEFAULTS` holds the per-person defaults, `SV_DEFAULTS` the rest, `SV` the camera, `svScene` the drawing. |
| `tests/streetview-house.test.js` | jsdom tests: presence, zones, coming home, lights, portraits and fallbacks, cat, actions, fitting the picture, redraws, config errors, editor round trips. `npm test`. |
| `hacs.json` | Manifest for the Home Assistant Marketplace. |
| `README.md` | User docs, also the Marketplace info page. Keep the option tables in sync with the code. |
| `CHANGELOG.md` | One `## vX.Y.Z` section per release; the Release workflow uses it as the release notes. |
| `shot.png` | README image (plain figures, no photos), linked by absolute raw URL. |
| `streetview-house.yaml` | Minimal and full example configs. |

## Rules to keep

* **Nothing about the owner's household in this repo:** no names, entity ids, portrait file names or photos, not in code, tests, examples or docs. The owner's people list lives in their dashboard config. Examples and tests use made-up people (Alex, Sam, Robin, Kim). Portraits live on the user's Home Assistant (`/config/www/streetview-house/`, cut out, transparent, about 360 px wide). Screenshots for the README use plain figures.
* Without `people` the card follows the first four `person.*` entities in `hass.states`, sorted by entity id (`_autoPeople`), with the per-person defaults: no portrait, no proximity.
* The picture is the whole card (the owner dropped the text column: too wide). No rows, no phone badges. Presence and since when show as the hover `<title>` of a person in the window.
* Read only: no service calls. Taps on a person in the window go through `hass-action` with the person as entity (more-info by default; hold none); the wall does nothing.
* Presence: `home` is home; any other state except unknown/unavailable is away (zone names shown as they are); unknown/unavailable (no tracker) is never in the window.
* Whoever is home stands together, centred in the window, shoulder to shoulder in the order of `people` (max 4); no gaps for whoever is away (owner: "we are no enemies"). Each person takes the width they show (middle 74 % of the portrait), so a shorter one (`height`) stands closer. The visiting cat sits right of the group (in front when all four are home).
* Lights: `room_light` and `door_light` follow real entities when set, else presence (anyone home). The door light pulses only while nobody is home and someone is coming home (direction `towards`, distance above 0).
* The lantern is not used in real life: it is always drawn off (owner).
* The cat: `_catHere` decides per quarter of an hour (deterministic hash), more often there when nobody is home; next to the group when people are home. `cat: false` removes it.
* Glass: tint, awning shade, blurred street reflection, fixed sheen and a sweep every 14 s, drawn over the people and the cat.
* The picture is rebuilt only when its inputs change (`_sceneKey`). Re-render only on the card's own entities plus a 60 s tick (since texts, cat).
* Layout: 12 x 3 (184 px) by default. `_fit` (ResizeObserver) sets the viewBox to the card's aspect: wider than the facade widens it around the centre (the wall is drawn far wider and taller than any view, with a darker plinth), narrower anchors on the right (window kept, door dropped first), never narrower than `SV.narrow`; `slice` crops beyond that. Measure in a real browser at 250, 370 and 520 px after any layout change; a stub `ha-card` must not set `display` inline.
* Every animation stops under reduced motion.
* Visual editor on `ha-form`: four person slots (an empty slot ends the list), lights, cat, actions. Only non-defaults are written; no person in any slot writes no `people` list; unknown keys such as `grid_options` are kept.
* The whole file sits in one block scope; `const VERSION` stays on its own line for the Release workflow.

## Releasing

1. Changes go through a pull request; the owner merges.
2. Bump `VERSION`, add the CHANGELOG section in the PR that is meant to become a release.
3. The owner pushes the `vX.Y.Z` tag. **Never tag or release without the owner's explicit go.**
