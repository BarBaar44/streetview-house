# Changelog

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
