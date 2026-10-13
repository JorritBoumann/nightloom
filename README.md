# Nightloom

A co-op night shift for two. Bramble and Flit work in a workshop in the sky and weave dreams to order for the sleeping town below. Flit fetches stars and Bramble spins wool into thread. A kettle brews the dream, a clean jar bottles it, and the chute sends it down before the sleeper wakes up.

Two people play on one keyboard, or one person plays with a bot partner. The game runs in the browser from one HTML file and has no dependencies.

## Play it

```bash
npm run build
```

Then open `dist/index.html` in a browser, or serve the folder with any static server.

## How a shift works

1. Orders appear at the top of the screen. Each order names a dream and its ingredients.
2. Wool goes on the loom. Bramble holds the work key to spin it into thread.
3. Put a whole dream's ingredients in a kettle. When its mix makes a dream, the kettle starts to brew.
4. Pour a ready kettle into a clean jar, then drop the jar down the chute.
5. Empty jars come back dirty at the return hatch. Wash them in the basin.

A ready kettle left too long boils into a nightmare, which costs 5 moonlight. A missed order costs 10. Fast deliveries earn a tip, and deliveries in a row build a streak bonus.

The two characters have different abilities, so the players must work together:

| | Bramble | Flit |
| --- | --- | --- |
| Speed | Slow | Fast, with a dash |
| Stars | Cannot take them from the shelf | Takes them |
| Loom | Spins wool into thread | Cannot spin |
| Open sky | Cannot cross it, but throws items over it | Flies over it and catches items in flight |
| Wind | Hardly moves | Gets blown across the room |

## Controls

| Action | Bramble | Flit | Gamepad |
| --- | --- | --- | --- |
| Move | `W` `A` `S` `D` | Arrow keys | Left stick or D-pad |
| Grab or place | `Space` | `Enter` or `.` | A |
| Spin, wash, throw, dash | `Left Shift` | `Right Shift` or `/` | X or B |
| Pause | `Esc` or `P` | `Esc` or `P` | Start |

In solo mode the human player can use either set of keys. Gamepad 1 drives the first human player and gamepad 2 the second.

## The five shifts

| Shift | What is new | Dreams |
| --- | --- | --- |
| 1. Dusk | The basic loop, with hints that point at the next useful job | Flying, Seaside |
| 2. Midnight | A strip of open sky splits the room. Bramble throws, Flit flies. | adds Starfall |
| 3. Gale | Gusts blow through the room. A warning shows before each gust. | Flying, Seaside, Lullaby |
| 4. Witching Hour | A moonbeam bridge joins two halves, but only while the moon is out | all four |
| 5. Daybreak | Two islands, a faster bridge, jars return on the far side | all four |

A shift opens after the previous one earns at least one moon. Best scores are saved in the browser.

## Publishing on Stateloop

The game is built for the Stateloop play page at games.stateloop.ai. You can publish it through creator.stateloop.ai in two ways:

- Source route (preferred). Connect this repository through the Stateloop GitHub App. The platform runs `npm run build` and serves `dist/index.html`. Do not add a `stateloop-game.json` to the build output, because the platform writes its own.
- ZIP route. Run `npm run zip` and upload `dist-upload/nightloom-stateloop.zip`. The ZIP holds `index.html` at its root and a `stateloop-game.json` with the entrypoint, the controls and the key map.

What the game does for the platform:

- The orders, timer, score and streak are drawn on the canvas, because the platform records the canvas and nothing around it.
- The canvas keeps one size (784 by 588) for every shift, so a recording never sees it resize.
- When a shift starts, keyboard focus moves to the element that holds the canvas, so the recorder logs the keys.
- If the window loses focus or the tab is hidden, the game pauses.
- The top bar leaves room for the portal's back button in the top-left corner.
- When the game runs inside Stateloop, the title screen shows a still board. The bot demo that plays behind the title elsewhere is switched off, so no bot play is recorded as human play.
- At dawn, after the last shift, the game calls `window.StateloopSession.complete(detail)`. If that function is not there, it dispatches a `stateloop:session-complete` event. The detail holds the number of shifts, the total moonlight, the moons and the mode.
- All assets are drawn in code. The only outside request is for two Google Fonts. If they do not load, the game uses system fonts.

### Telling the two players apart in a recording

The key map is fixed, so a key log shows which player did what:

- Bramble: `KeyW` `KeyA` `KeyS` `KeyD`, `Space`, `ShiftLeft`
- Flit: `ArrowUp` `ArrowLeft` `ArrowDown` `ArrowRight`, `Enter`, `ShiftRight`

In solo mode one person plays and a bot plays the other character. The canvas shows "you" and "partner" above the characters, and the HUD names the mode. The platform does not record gamepad input, so recordings made with a gamepad have no input log.

### URL parameters

| Parameter | Effect |
| --- | --- |
| `seed=<number>` | Fixes the random orders. Each shift uses its own seed made from this one. The play page sets it. |
| `shift=<id or 1-5>` | Opens straight on that shift's start screen, for example `shift=gale`. |
| `mode=solo` and `as=flit` or `as=bramble` | Sets solo mode and the human player's character. |
| `debug=1` | Adds `window.__nightloom` for browser tests. |

### Agent-played traces

The game logic in `src/data.js`, `src/core.js` and `src/bot.js` has no browser code. It runs headless in Node at a fixed 60 ticks per second, and all randomness comes from a seeded generator. That makes it a trace factory:

```bash
npm run traces -- 3 traces
```

This writes three bot-played episodes per shift to `traces/` as JSON lines (format `nightloom-trace-v1`). Each file has a header with the map, the dreams and the key map. Then it has one line per tick. A tick line gives every actor's position, facing, held item, held inputs and pressed actions. Event lines record grab, act, deliver and expire. Decision lines list the options each bot weighed and the one it picked. A hash line comes once per second, and a summary line ends the file. The same seed gives the same file.

The co-op design gives clear examples of handing off work to a teammate who has a different skill. For example, only Flit can take stars, only Bramble can spin, and Bramble throws items over the sky for Flit to catch.

## Development

| Command | What it does |
| --- | --- |
| `npm run build` | Writes `dist/index.html` and `dist-artifact/nightloom.html` |
| `npm run zip` | Also writes the upload ZIP |
| `npm test` | Rules, determinism, and a check that two bots earn a moon on every shift |
| `npm run sim -- 20` | Two bots play every shift 20 times and print score statistics |
| `npm run traces -- 3` | Writes bot-played traces |
| `node tools/trace.mjs <shift> [seed] [seconds]` | Prints each bot decision, for debugging the bot |

The source files are concatenated in this order: `data.js`, `core.js`, `bot.js`, `render.js`, `input.js`, `audio.js`, `ui.js`. The first three files are the headless game. The other four files are the browser layer.

The moon thresholds come from `npm run sim`. Two expert bots score about 360 on Dusk, 420 on Midnight, 315 on Gale, 330 on Witching Hour and 385 on Daybreak. One moon sits near a quarter of that, and three moons near 80 percent.

## Ownership

Copyright (c) 2026 Jorrit Boumann. All rights reserved.

These parts are original to this project: the name, the world, the characters, the code, and the art, sounds and music, which are all made in code. The only third-party assets are the Gluten and Figtree fonts, which load from Google Fonts under the SIL Open Font License. The genre mechanics (orders, timers, stations) are common game conventions.
