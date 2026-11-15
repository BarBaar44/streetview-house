# Changelog

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
