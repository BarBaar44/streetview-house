# Streetview House

Who is home, at a glance: the street side of the house as a line drawing, with the family standing behind the front window. The counterpart of [Gardenview House](https://github.com/BarBaar44/gardenview-house), which draws the garden side.

![Streetview House](https://raw.githubusercontent.com/BarBaar44/streetview-house/main/shot.png)

* **Whoever is home stands in the window**, each in their own spot (the order of the `people` list). Away: the spot is empty.
* **Room light and door light** are on while anyone is home, or follow real lights when you set `room_light` and `door_light`.
* **Coming home:** with a proximity sensor (direction `towards`), the door light pulses while the house is still empty.
* **The cat** comes and goes: with nobody home it is on the sill more often than not; with people home it drops by now and then.
* **The picture is the whole card.** It fills any width: a wider card shows more wall, a narrower one keeps the window and drops the door.
* **Hover** a person: name, presence and since when ("Bart · Home · 40 min"). **Tap**: more-info of that person (map and history). Hold: optional.

Read only: the card calls no services. One file, no dependencies, no card_mod.

## Install

**Home Assistant 2026.11 and newer (Marketplace):** Settings → Marketplace → ⋮ → Add from link → `https://github.com/BarBaar44/streetview-house`, category Dashboard. Install, then reload the browser.

**Older versions (HACS):** HACS → ⋮ → Custom repositories → add the URL above as *Dashboard*, install, reload.

Manual: copy `streetview-house.js` to `/config/www/` and add `/local/streetview-house.js` as a JavaScript module resource.

## Portraits

Each person can have a portrait: a head and shoulders picture with a transparent background (PNG or WebP), facing the camera. Put them in `/config/www/streetview-house/` and point `portrait` at `/local/streetview-house/<name>.webp`. About 360 px wide is plenty (around 40 KB as WebP).

Without a portrait file, or when it cannot be loaded, the card uses the person's picture from Home Assistant; without either, a plain figure. Portraits stay on your own Home Assistant, never in this repository.

## Configuration

```yaml
type: custom:streetview-house
grid_options:
  columns: 12
  rows: 3
```

Everything else is optional, in YAML or in the visual editor. The defaults are the owner's household; set `people` for your own.

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
| `people` | the owner's four | list of up to 4 (the window has room for four); a plain entity id is enough |
| `entities.room_light` | none | light or switch of the room behind the window; none: on while anyone is home |
| `entities.door_light` | none | the hall light behind the door grille; none: on while anyone is home |
| `cat` | `true` | `false`: no cat |
| `tap_action` | more-info | for the person tapped in the window |
| `hold_action` | none | |

### Per person

| Key | | |
|---|---|---|
| `entity` | required | `person.*` |
| `name` | first word of the friendly name | |
| `portrait` | none | image URL, see Portraits; `null`: none |
| `height` | `0.95` | 0.5 to 1.2: relative height in the window |
| `distance` | none | proximity distance sensor |
| `direction` | none | proximity direction of travel (`towards` means coming home: the door light pulses while nobody is home) |

A known entity (one of the owner's) keeps its defaults for the keys you leave out; `null` switches a role off.

### What the hover title says

| State | Title |
|---|---|
| `home` | Bart · Home · 40 min |
| `not_home` | only people at home are in the window |
| `unknown` / `unavailable` (no tracker) | never in the window |

## Layout

12 columns by 3 rows (184 px) by default; any size works. The picture always fills the card: wider than the facade shows more wall on both sides, narrower keeps the window and drops the door. All animations (cat, door light, the reflection sliding over the glass) stop under reduced motion.

## License

MIT
