# Snake Unjust

A small client-side Snake game styled as a generic hidden mini-game inside a retro web player. It uses no external assets, backend, or build step.

## Run

Open `index.html` in a modern browser.

Optional static server:

```powershell
cd snake-unjust
python -m http.server 8080
```

Then visit `http://localhost:8080`.

## Controls

- Arrow keys or WASD: move
- Space: pause or resume
- Enter: start or restart
- Touch buttons or swipe: mobile movement

Settings and best score are saved in `localStorage`.

## Files

- `index.html`: static page and faux player shell
- `styles.css`: responsive player, controls, settings, and visual filter
- `main.js`: state machine, input, rendering, Snake logic, audio, and persistence

## Mechanics

The game uses `requestAnimationFrame` for rendering and a fixed timestep for Snake movement. Speed is stored as moves per second, starts at 7, and is capped at 18. Grid size, mode, sound, visual filter, and difficulty are loaded from `localStorage` and can be adjusted in the settings panel.
