# Don't Wake the Giant

A small 3D web prototype for testing one gameplay loop:

**enter → sneak → steal → get greedy → make noise → the Giant wakes → panic → escape**

You're tiny. A huge Giant is asleep in a bedroom full of treasure. The closer the loot is to him, the more it's worth — and the better he hears you.

## Run it

Open `index.html` in a modern desktop browser. There's no build step and no server needed (Three.js is vendored in `lib/`).
If your browser blocks local files, serve the folder instead, for example `python3 -m http.server`, then open http://localhost:8000.

## Controls

| Desktop | Action |
|---|---|
| WASD / arrows | Move |
| Mouse (click to lock) | Camera |
| Shift | Run (loud!) |
| Space | Jump (noisy landing) |
| E | Steal |
| R | Restart the run (only while he's still asleep) |

On touch devices, a joystick, look-drag, and RUN, JUMP and STEAL buttons appear automatically.

## What's in the slice

- **Noise meter, "GIANT SLEEP 💤".** Walking is nearly silent. Running, jumping, landing, squeaky floorboards and stealing all add noise. Noise drains while you stay quiet.
- **Hearing.** Every sound gets louder the closer you are to his head (the 👂 indicator).
- **Four Giant states.** DEEP SLEEP (snoring, Zzz) → RESTLESS (grunts and tossing) → SUSPICIOUS (eyes open and follow you; any movement is 2.5× louder) → AWAKE.
- **Steal prompt.** It shows the item's value and how loud stealing it will be, and warns you when stealing it **will wake him**.
- **Loot.** 12 items worth $1,420 in total, from $10 coin bags by the door to the $500 Crown glowing next to his head.
- **Hiding spots.** Under the table, under the chair, and inside the open book. Noise drains 2.4× faster while hidden.
- **Chase.** He stands up, leaps off the bed and chases you, with stomp shockwaves. Jump to clear them, or you'll stumble. An edge-of-screen arrow shows where he is.
- **Endings.** Escape through the mouse hole under the door to bank your loot, or get caught and lose it all. Restarting takes about half a second.

All the sound is synthesized with WebAudio, and every model is built from code primitives.

## Tuning

All the balance numbers are in the `CFG` object at the top of `game.js`: noise rates, decay, state thresholds, Giant speed and catch radius. Each item's value and noise is in `LOOT_DEFS`.
