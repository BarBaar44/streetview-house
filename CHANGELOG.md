# Changelog

## v0.6.0

* The card is mirrored: the house now sits on the right half and the people on the left. The house drawing is mirrored too, seen from the right, with the front door at the near corner. New option `house: left` brings back the old layout (also in the visual editor).
* Shopping drops a lot more money: four banknotes pop out of the bag and flutter down, and four coins drop and bounce, all out of step, so something is always falling.

## v0.5.1

* Someone whose state is unknown (no tracker, phone off) now gets their away animation too, with "Unknown" on top, when `away` is set.

## v0.5.0

* Away tiles can show what someone is doing: set `away` per person to `race_bike`, `running`, `shopping` or `soccer`. Their face (portrait, Home Assistant picture or initial) sits on a small animated line art figure, with the place and since when on top; no name. Each has a mishap now and then: the race bike loses its front wheel, the runner meets a cow ("MOOOOH!"), money falls out of the shopping bags, and every third kick goes over the bar.
* Coming home turns the figure towards home, with the distance in orange.
* The visual editor has a "While away" choice per person. Without `away` the tile stays as before (name, pin, place).
* Under reduced motion the figures stand still.

## v0.4.2

* How often the cat visits is now an option: `cat` takes a number from 0 to 100, the % of quarter hours it is there while someone is home (twice that when nobody is). `100`: always there. `true` stays the default (30), `false` or `0`: no cat. In the visual editor it is a slider.
* Home tiles no longer show the name: the picture says who it is. Tiles without a picture (away, or only an initial) keep the name.

## v0.4.1

* The room light now shows: with the light on, the front room glows warm (amber glass, a pendant lamp with its glow, a sofa back) and the light falls on the sill and the pavement. With it off the glass is cool grey.

## v0.4.0

A new look, after the Gardenview House card: the house on the left, the people on the right.

* The street facade is drawn at an angle, as a block with its side wall showing, and takes the left half of the card. The house number is gone.
* A tile per person on the right, always in the same place: portrait, name and since when while home; place and since when while away; the distance in orange while coming home. Tap a tile for more-info.
* Nobody stands in the window any more; the room light, the door light and the cat stay.
* The cat walks: in along the window sill, sits for a wash and a stare, jumps down and strolls off past the door. Under reduced motion it just sits.
* The window in the front door is taller: about 80 % of the door.
* Shorter since texts: "40m", "3h", "2d". A person without a tracker shows "Unknown".
* `height` now sets how big the portrait stands in its tile.

## v0.3.0

No built-in household any more.

* Without `people` the card now shows the first four `person` entities in Home Assistant, sorted by entity id, and follows them as they are added or removed. Until now the defaults were the owner's own people.
* **If you relied on the defaults:** set `people` in your card config (see the README).
* Examples and tests use made-up people.
* Without a `people` list the visual editor shows the people the card uses; changing any of them writes the list.

## v0.2.0

The picture is the whole card: the text column made the card too wide.

* The house fills any card size: a wider card shows more wall, a narrower one keeps the window and drops the door.
* Whoever is home stands together in the middle of the window, shoulder to shoulder, in the order of the people list (no gaps for whoever is away); the cat sits next to them when it drops by.
* Hover a person in the window for presence and since when; tap: more-info of that person.
* Removed with the text column: the phone battery and charging badges and the options `battery`, `charging`, `battery_low` and `colors` (remove them from your config if you set them).

## v0.1.0

First release.

* The street facade as line art (Gardenview House style): arched front door with grille, lantern, front window with awning and sill.
* Whoever is home stands behind the window, each in their own spot; portraits from `/config/www`, falling back to the person's picture in Home Assistant.
* Room light and door light on while anyone is home, or following `room_light` / `door_light`; the door light pulses while someone is coming home to an empty house.
* The cat comes and goes; glass with tint, shade, reflection and an occasional sweep.
* One row per person: presence and since when, zone names, "12 km → home" from proximity, phone battery low and charging badges.
* Tap: more-info of the person; hold optional. Read only.
* Visual editor: four person slots, lights, battery threshold, cat, actions, colours.
