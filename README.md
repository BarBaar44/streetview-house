# Streetview House

Who is home, at a glance: on the left the street side of the house as a line drawing, seen at an angle; on the right a tile per person. The counterpart of [Gardenview House](https://github.com/BarBaar44/gardenview-house), which draws the garden side.

![Streetview House](https://raw.githubusercontent.com/BarBaar44/streetview-house/main/shot.png)

* **A tile per person**, always in the same place, in the order of the `people` list. At home: their portrait and since when ("Home · 40m"); the picture says who it is, so no name. Away: name, place and since when ("Work · 5h"). Coming home: the distance in orange ("4.2 km → home").
* **Room light and door light** are on while anyone is home, or follow real lights when you set `room_light` and `door_light`.
* **Coming home:** with a proximity sensor (direction `towards`), the door light pulses while the house is still empty.
* **The cat** comes and goes: now and then it walks in along the window sill, sits for a wash and a stare, jumps down and strolls off past the door. It visits in about 30 % of the quarter hours while someone is home and twice as often when nobody is; set `cat` to change that.
* **Tap** a tile: more-info of that person (map and history). Hold: optional.

Read only: the card calls no services. One file, no dependencies, no card_mod.

## Install

**Home Assistant 2026.11 and newer (Marketplace):** Settings → Marketplace → ⋮ → Add from link → `https://github.com/BarBaar44/streetview-house`, category Dashboard. Install, then reload the browser.

**Older versions (HACS):** HACS → ⋮ → Custom repositories → add the URL above as *Dashboard*, install, reload.

Manual: copy `streetview-house.js` to `/config/www/` and add `/local/streetview-house.js` as a JavaScript module resource.

## Portraits

Each person can have a portrait: a head and shoulders picture with a transparent background (PNG or WebP), facing the camera. Put them in `/config/www/streetview-house/` and point `portrait` at `/local/streetview-house/<name>.webp`. About 360 px wide is plenty (around 40 KB as WebP).

Without a portrait file, or when it cannot be loaded, the tile shows the person's picture from Home Assistant in a circle; without either, their initial. Portraits stay on your own Home Assistant, never in this repository.

## Configuration

```yaml
type: custom:streetview-house
grid_options:
  columns: 12
  rows: 3
```

Everything else is optional, in YAML or in the visual editor. Without `people` the card shows the first four `person` entities in Home Assistant (sorted by entity id, with their Home Assistant pictures or initials); set `people` to choose who, in which order, with portraits and proximity.

```yaml
type: custom:streetview-house
people:
  - entity: person.alex
    portrait: /local/streetview-house/alex.webp
    distance: sensor.home_alex_distance
    direction: sensor.home_alex_direction_of_travel
  - person.sam            # just the person
entities:
  room_light: light.front_room
  door_light: light.hall
```

| Option | Default | |
|---|---|---|
| `people` | the first four `person` entities | list of up to 4 (four tiles); a plain entity id is enough |
| `entities.room_light` | none | light or switch of the room behind the window; none: on while anyone is home |
| `entities.door_light` | none | the hall light behind the door window; none: on while anyone is home |
| `cat` | `true` (30) | how often the cat visits: a number from 0 to 100, the % of quarter hours it is there while someone is home (twice that when nobody is, at most always). `100`: always there; `false` or `0`: no cat |
| `tap_action` | more-info | for the person whose tile is tapped |
| `hold_action` | none | |

### Per person

| Key | | |
|---|---|---|
| `entity` | required | `person.*` |
| `name` | first word of the friendly name | |
| `portrait` | none | image URL, see Portraits; `null`: none |
| `height` | `0.95` | 0.5 to 1.2: how big the portrait stands in the tile (shorter people a bit smaller) |
| `distance` | none | proximity distance sensor |
| `direction` | none | proximity direction of travel (`towards` means coming home: the door light pulses while nobody is home) |

`null` works the same as leaving a key out.

### What a tile says

| State | Tile |
|---|---|
| `home` | portrait, Home · 40m (green); the name only when there is no picture (initial) |
| `not_home` | Alex, Away · 2h |
| a zone, e.g. `Work` | Alex, Work · 5h |
| coming home (direction `towards`, distance above 0) | Alex, 4.2 km → home (orange) |
| `unknown` / `unavailable` (no tracker) | Alex, Unknown |

## Layout

12 columns by 3 rows (184 px) by default. The house takes the left half, the tiles the right half in a 2 by 2 grid. On a wide card the house gets a longer front window; on a narrow one it is drawn smaller, never cropped, and the tiles put the face on top with the name below. All animations (the cat, the door light, the reflection sliding over the glass) stop under reduced motion; the cat then just sits on the sill.

## License

MIT
