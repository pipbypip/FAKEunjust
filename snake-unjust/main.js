const DIRECTIONS = {
  up: { x: 0, y: -1, name: "up" },
  down: { x: 0, y: 1, name: "down" },
  left: { x: -1, y: 0, name: "left" },
  right: { x: 1, y: 0, name: "right" },
};

const OPPOSITES = { up: "down", down: "up", left: "right", right: "left" };
const COLOR_PALETTE = ["#6ee04d", "#4aa3ff", "#d65bff", "#ffcc3b", "#ff7f40", "#f24c4c", "#b7e63f", "#5ad4ff"];

class GameState {
  static IDLE = "idle";
  static LOADING = "loading";
  static PLAYING = "playing";
  static PAUSED = "paused";
  static GAME_OVER = "gameOver";
  static SETTINGS = "settings";
}

class StorageManager {
  constructor(prefix) {
    this.bestKey = `${prefix}.best`;
    this.settingsKey = `${prefix}.settings`;
    this.defaults = { gridSize: 20, mode: "classic", sound: true, visualFilter: "scanline", difficulty: "normal" };
  }
  loadBest() { return Number(localStorage.getItem(this.bestKey) || 0); }
  saveBest(score) { localStorage.setItem(this.bestKey, String(score)); }
  loadSettings() {
    try { return { ...this.defaults, ...JSON.parse(localStorage.getItem(this.settingsKey) || "{}") }; }
    catch { return { ...this.defaults }; }
  }
  saveSettings(settings) { localStorage.setItem(this.settingsKey, JSON.stringify(settings)); }
}

class AudioManager {
  constructor(settings) { this.settings = settings; this.context = null; }
  unlock() {
    if (!this.settings.sound) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.context = this.context || new AudioContext();
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }
  play(name) {
    if (!this.settings.sound) return;
    const audio = this.unlock();
    if (!audio) return;
    const sounds = { start: [440, 0.055, "triangle", 0.07], eat: [740, 0.045, "square", 0.08], pause: [280, 0.07, "sine", 0.055], gameOver: [120, 0.22, "sawtooth", 0.075], block: [170, 0.08, "sawtooth", 0.05], win: [880, 0.12, "triangle", 0.06] };
    const [frequency, duration, type, volume] = sounds[name] || sounds.eat;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration);
  }
}

class SnakeGame {
  constructor(storage, audio) {
    this.storage = storage;
    this.audio = audio;
    this.settings = storage.loadSettings();
    this.bestScore = storage.loadBest();
    this.state = GameState.IDLE;
    this.loadingStarted = 0;
    this.reset();
  }
  reset() {
    this.gridSize = this.settings.gridSize;
    const c = Math.floor(this.gridSize / 2);
    this.snake = [{ x: c, y: c }, { x: c - 1, y: c }, { x: c - 2, y: c }];
    this.direction = DIRECTIONS.right;
    this.directionQueue = [];
    this.score = 0;
    this.foodCount = 0;
    this.level = 1;
    this.combo = 1;
    this.lastFoodAt = 0;
    this.speed = 7;
    this.stepSeconds = 1 / this.speed;
    this.accumulator = 0;
    this.spawnFood();
  }
  startLoading(now) { this.audio.unlock(); this.reset(); this.state = GameState.LOADING; this.loadingStarted = now; }
  startPlaying(now) { this.state = GameState.PLAYING; this.lastFrame = now; this.audio.play("start"); }
  pause() { if (this.state === GameState.PLAYING) { this.state = GameState.PAUSED; this.audio.play("pause"); } }
  resume(now) { if (this.state === GameState.PAUSED) { this.state = GameState.PLAYING; this.lastFrame = now; this.audio.play("start"); } }
  openSettings() { if (this.state === GameState.PLAYING) this.pause(); this.state = GameState.SETTINGS; }
  closeSettings() { this.state = GameState.IDLE; }
  applySettings(settings) { this.settings = settings; this.audio.settings = settings; this.storage.saveSettings(settings); this.reset(); }
  queueDirection(name) {
    const next = DIRECTIONS[name];
    if (!next) return;
    const lastQueued = this.directionQueue.at(-1) || this.direction;
    if (OPPOSITES[lastQueued.name] !== next.name && this.directionQueue.length < 2) this.directionQueue.push(next);
  }
  update(deltaSeconds, now) {
    if (this.state !== GameState.PLAYING) return;
    this.accumulator += Math.min(deltaSeconds, 0.1);
    while (this.accumulator >= this.stepSeconds && this.state === GameState.PLAYING) {
      this.step(now);
      this.accumulator -= this.stepSeconds;
    }
  }
  step(now) {
    this.direction = this.directionQueue.shift() || this.direction;
    const head = this.snake[0];
    const next = { x: head.x + this.direction.x, y: head.y + this.direction.y };
    if (this.settings.mode === "wrap") {
      next.x = (next.x + this.gridSize) % this.gridSize;
      next.y = (next.y + this.gridSize) % this.gridSize;
    } else if (next.x < 0 || next.y < 0 || next.x >= this.gridSize || next.y >= this.gridSize) { this.end(); return; }
    const ate = next.x === this.food.x && next.y === this.food.y;
    const bodyToCheck = ate ? this.snake : this.snake.slice(0, -1);
    if (bodyToCheck.some((p) => p.x === next.x && p.y === next.y)) { this.end(); return; }
    this.snake.unshift(next);
    if (ate) this.eatFood(now); else this.snake.pop();
  }
  eatFood(now) {
    const fast = this.lastFoodAt > 0 && now - this.lastFoodAt <= 4000;
    this.combo = fast ? Math.min(5, this.combo + 1) : 1;
    this.lastFoodAt = now;
    this.foodCount += 1;
    this.level = Math.floor(this.foodCount / 5) + 1;
    this.score += 10 * this.combo;
    const ramps = { chill: 0.6, normal: 1, boss: this.score >= 50 ? 1.8 : 1.15 };
    this.speed = Math.min(18, 7 + Math.floor(this.foodCount / 5) * (ramps[this.settings.difficulty] || 1));
    this.stepSeconds = 1 / this.speed;
    this.audio.play("eat");
    this.spawnFood();
  }
  spawnFood() {
    const occ = new Set(this.snake.map((p) => `${p.x},${p.y}`));
    const free = [];
    for (let y = 0; y < this.gridSize; y += 1) for (let x = 0; x < this.gridSize; x += 1) if (!occ.has(`${x},${y}`)) free.push({ x, y });
    this.food = free[Math.floor(Math.random() * free.length)] || { x: 0, y: 0 };
  }
  end() { this.state = GameState.GAME_OVER; if (this.score > this.bestScore) { this.bestScore = this.score; this.storage.saveBest(this.bestScore); } this.audio.play("gameOver"); }
}

class Renderer {
  constructor(canvas, game) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.game = game; this.board = { x: 0, y: 0, size: 0, cell: 0 }; }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = Math.floor(Math.min(rect.width, rect.height));
    const target = Math.max(300, Math.floor(cssSize * dpr));
    if (this.canvas.width !== target) this.canvas.width = target;
    if (this.canvas.height !== target) this.canvas.height = target;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = Math.floor(cssSize / this.game.gridSize);
    const size = cell * this.game.gridSize;
    this.board = { x: Math.floor((rect.width - size) / 2), y: Math.floor((rect.height - size) / 2), size, cell };
  }
  render(now) {
    this.resize();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const c = this.ctx;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#090b0e";
    c.fillRect(0, 0, w, h);
    this.drawGrid();
    this.drawFood(now);
    this.drawSnake();
    if (this.game.state === GameState.LOADING) this.drawSpinner(now, w, h);
  }
  drawGrid() {
    const { x, y, size, cell } = this.board;
    const c = this.ctx;
    c.fillStyle = "#10151a";
    c.fillRect(x, y, size, size);
    c.strokeStyle = "rgba(255,255,255,0.055)";
    c.lineWidth = 1;
    for (let i = 0; i <= this.game.gridSize; i += 1) {
      const p = x + i * cell + 0.5;
      c.beginPath(); c.moveTo(p, y); c.lineTo(p, y + size); c.stroke();
      const q = y + i * cell + 0.5;
      c.beginPath(); c.moveTo(x, q); c.lineTo(x + size, q); c.stroke();
    }
  }
  drawFood(now) {
    const pulse = 0.75 + Math.sin(now / 135) * 0.25;
    const { x, y, cell } = this.toPixels(this.game.food);
    const c = this.ctx;
    const center = x + cell / 2;
    const radius = cell * (0.24 + pulse * 0.08);
    c.shadowBlur = cell * 0.42;
    c.shadowColor = "#ffcf5a";
    c.fillStyle = "#ffcf5a";
    c.beginPath(); c.arc(center, y + cell / 2, radius, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
  }
  drawSnake() {
    this.game.snake.forEach((part, index) => {
      const { x, y, cell } = this.toPixels(part);
      const inset = Math.max(2, Math.floor(cell * 0.12));
      const size = cell - inset * 2;
      const c = this.ctx;
      c.fillStyle = index === 0 ? "#7dffd0" : `hsl(158 66% ${Math.max(42, 72 - index * 2)}%)`;
      c.fillRect(x + inset, y + inset, size, size);
      c.fillStyle = "rgba(255,255,255,0.18)";
      c.fillRect(x + inset, y + inset, size, Math.max(2, size * 0.22));
    });
  }
  drawSpinner(now, width, height) {
    const c = this.ctx;
    for (let i = 0; i < 12; i += 1) {
      const a = (Math.PI * 2 * i) / 12 + now / 320;
      c.fillStyle = `rgba(69, 240, 170, ${0.2 + i / 12})`;
      c.beginPath(); c.arc(width / 2 + Math.cos(a) * 32, height / 2 + Math.sin(a) * 32, 3.5, 0, Math.PI * 2); c.fill();
    }
  }
  toPixels(cell) { return { x: this.board.x + cell.x * this.board.cell, y: this.board.y + cell.y * this.board.cell, cell: this.board.cell }; }
}

class UIManager {
  constructor(root, game, suffix, labels) {
    this.game = game;
    this.labels = labels;
    this.els = {
      score: root.querySelector(`#score${suffix}`), bestScore: root.querySelector(`#bestScore${suffix}`), level: root.querySelector(`#level${suffix}`),
      speed: root.querySelector(`#speed${suffix}`), mode: root.querySelector(`#mode${suffix}`), comboChip: root.querySelector(`#comboChip${suffix}`),
      overlay: root.querySelector(`#overlay${suffix}`), overlayKicker: root.querySelector(`#overlayKicker${suffix}`), overlayTitle: root.querySelector(`#overlayTitle${suffix}`),
      overlayText: root.querySelector(`#overlayText${suffix}`), helpPanel: root.querySelector(`#helpPanel${suffix}`), primaryAction: root.querySelector(`#primaryAction${suffix}`),
      pauseButton: root.querySelector(`#pauseButton${suffix}`), soundButton: root.querySelector(`#soundButton${suffix}`), timelineFill: root.querySelector(`#timelineFill${suffix}`),
      settingsButton: root.querySelector(`#settingsButton${suffix}`), settingsPanel: root.querySelector(`#settingsPanel${suffix}`), gridSize: root.querySelector(`#gridSize${suffix}`),
      wallMode: root.querySelector(`#wallMode${suffix}`), difficulty: root.querySelector(`#difficulty${suffix}`), visualFilter: root.querySelector(`#visualFilter${suffix}`),
      soundEnabled: root.querySelector(`#soundEnabled${suffix}`), scanlines: root.querySelector(`#scanlines${suffix}`),
    };
  }
  syncSettingsForm() {
    const s = this.game.settings;
    this.els.gridSize.value = String(s.gridSize); this.els.wallMode.value = s.mode; this.els.difficulty.value = s.difficulty; this.els.visualFilter.value = s.visualFilter;
    this.els.soundEnabled.checked = s.sound; this.els.scanlines.hidden = s.visualFilter !== "scanline"; this.els.soundButton.textContent = s.sound ? "S" : "M";
  }
  readSettingsForm() {
    return { gridSize: Number(this.els.gridSize.value), mode: this.els.wallMode.value, difficulty: this.els.difficulty.value, visualFilter: this.els.visualFilter.value, sound: this.els.soundEnabled.checked };
  }
  update() {
    this.els.score.textContent = String(this.game.score); this.els.bestScore.textContent = String(this.game.bestScore); this.els.level.textContent = String(this.game.level);
    this.els.speed.textContent = this.game.speed.toFixed(1).replace(".0", ""); this.els.mode.textContent = this.game.settings.mode === "wrap" ? "Wrap" : "Classic";
    this.els.comboChip.textContent = `Combo x${this.game.combo}`; this.els.comboChip.hidden = this.game.combo <= 1 || this.game.state !== GameState.PLAYING;
    this.els.timelineFill.style.width = `${Math.min(100, 8 + this.game.foodCount * 4)}%`; this.els.pauseButton.textContent = this.game.state === GameState.PAUSED ? ">" : "II";
    this.syncOverlay();
  }
  syncOverlay() {
    const overlays = {
      [GameState.IDLE]: ["hidden player mode", this.labels.title, this.labels.idleText, "Start"],
      [GameState.LOADING]: ["buffering", "Buffering...", "Signal found. Preparing the grid.", "Buffering..."],
      [GameState.PAUSED]: ["paused", "Paused", "Press Space or tap Resume to continue.", "Resume"],
      [GameState.GAME_OVER]: ["signal lost", "Game Over", `Final score ${this.game.score}. Press Enter to restart.`, "Restart"],
      [GameState.SETTINGS]: ["settings", "Settings", "Adjust settings, then press Enter to start.", "Start"],
    };
    const data = overlays[this.game.state];
    this.els.overlay.hidden = !data;
    if (!data) return;
    const [kicker, title, text, button] = data;
    this.els.overlayKicker.textContent = kicker; this.els.overlayTitle.textContent = title; this.els.overlayText.textContent = text; this.els.primaryAction.textContent = button;
    this.els.helpPanel.hidden = this.game.state !== GameState.IDLE;
  }
  setSettingsVisible(visible) { this.els.settingsPanel.hidden = !visible; }
}

class InputManager {
  constructor(root, game, ui) { this.root = root; this.game = game; this.ui = ui; this.touchStart = null; this.bind(); }
  bind() {
    this.ui.els.primaryAction.addEventListener("click", () => this.primaryAction());
    this.ui.els.pauseButton.addEventListener("click", () => this.togglePause());
    this.ui.els.settingsButton.addEventListener("click", () => this.toggleSettings());
    this.ui.els.soundButton.addEventListener("click", () => { const next = { ...this.game.settings, sound: !this.game.settings.sound }; this.game.applySettings(next); this.ui.syncSettingsForm(); });
    this.root.querySelector(".touch-pad").addEventListener("click", (event) => { const b = event.target.closest("button[data-dir]"); if (b) this.move(b.dataset.dir); });
    for (const input of this.ui.els.settingsPanel.querySelectorAll("select,input")) input.addEventListener("change", () => { this.game.applySettings(this.ui.readSettingsForm()); this.ui.syncSettingsForm(); this.ui.setSettingsVisible(true); this.game.state = GameState.SETTINGS; });
    const canvas = this.root.querySelector("canvas");
    canvas.addEventListener("touchstart", (event) => {
      event.preventDefault();
      const t = event.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: false });
    canvas.addEventListener("touchend", (event) => this.onTouchEnd(event), { passive: false });
  }
  onTouchEnd(event) {
    event.preventDefault();
    if (!this.touchStart) return;
    const t = event.changedTouches[0]; const dx = t.clientX - this.touchStart.x; const dy = t.clientY - this.touchStart.y; this.touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    this.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }
  onKey(event) {
    const keyMap = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
    if (keyMap[event.key]) { event.preventDefault(); this.move(keyMap[event.key]); return; }
    if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); this.togglePause(); return; }
    if (event.key === "Enter") { event.preventDefault(); this.primaryAction(); return; }
    if (event.key === "Escape") { event.preventDefault(); this.toggleSettings(); }
  }
  move(direction) { if (this.game.state === GameState.IDLE) this.game.startLoading(performance.now()); this.game.queueDirection(direction); }
  primaryAction() { const now = performance.now(); if (this.game.state === GameState.PAUSED) this.game.resume(now); else { this.ui.setSettingsVisible(false); this.game.startLoading(now); } }
  togglePause() { const now = performance.now(); if (this.game.state === GameState.PLAYING) this.game.pause(); else if (this.game.state === GameState.PAUSED) this.game.resume(now); else if (this.game.state === GameState.IDLE || this.game.state === GameState.GAME_OVER) this.game.startLoading(now); }
  toggleSettings() { const open = this.ui.els.settingsPanel.hidden; this.ui.setSettingsVisible(open); if (open) this.game.openSettings(); else this.game.closeSettings(); }
}

class GameController {
  constructor(config) {
    this.panel = document.querySelector(config.panelSelector);
    this.storage = new StorageManager(config.storagePrefix);
    this.game = new SnakeGame(this.storage, null);
    this.audio = new AudioManager(this.game.settings);
    this.game.audio = this.audio;
    this.renderer = new Renderer(this.panel.querySelector("canvas"), this.game);
    this.ui = new UIManager(this.panel, this.game, config.suffix, config.labels);
    this.input = new InputManager(this.panel, this.game, this.ui);
    this.ui.syncSettingsForm();
    this.ui.update();
  }
  frame(now, deltaSeconds) { if (this.game.state === GameState.LOADING && now - this.game.loadingStarted >= 900) this.game.startPlaying(now); this.game.update(deltaSeconds, now); this.renderer.render(now); this.ui.update(); }
}

class SnakePuzzleState {
  static INTRO = "intro";
  static PLAYING = "playing";
  static SNAKE_MOVING = "snakeMoving";
  static BLOCKED = "blockedFeedback";
  static LEVEL_COMPLETE = "levelComplete";
}

class LevelManager {
  constructor() {
    this.levels = this.generateLevels(50);
  }
  generateLevels(count) {
    const levels = [];
    for (let i = 0; i < count; i += 1) levels.push(this.generateOne(i));
    return levels;
  }
  seeded(seed) {
    let t = seed + 0x6D2B79F5;
    return () => {
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  generateOne(levelIdx) {
    const rnd = this.seeded(1000 + levelIdx * 17);
    const tier = Math.floor(levelIdx / 10);
    const gridSize = 12 + Math.min(10, tier * 2 + Math.floor(levelIdx / 8));
    const snakeCount = Math.min(18, 5 + tier * 2 + Math.floor(levelIdx / 3));
    const minLen = 4 + Math.min(3, tier);
    const maxLen = 7 + Math.min(5, tier + Math.floor(levelIdx / 12));
    const occupied = new Set();
    const snakes = [];
    let colorCursor = levelIdx % COLOR_PALETTE.length;

    const inBounds = (x, y) => x >= 0 && y >= 0 && x < gridSize && y < gridSize;
    const dirs = Object.values(DIRECTIONS);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const nearestEdgeDir = (x, y) => {
      const dists = [
        { name: "left", v: x },
        { name: "right", v: gridSize - 1 - x },
        { name: "up", v: y },
        { name: "down", v: gridSize - 1 - y },
      ];
      dists.sort((a, b) => a.v - b.v);
      return dists[0].name;
    };

    for (let s = 0; s < snakeCount; s += 1) {
      let built = null;
      for (let attempt = 0; attempt < 220 && !built; attempt += 1) {
        const start = { x: Math.floor(rnd() * gridSize), y: Math.floor(rnd() * gridSize) };
        if (occupied.has(`${start.x},${start.y}`)) continue;
        const length = minLen + Math.floor(rnd() * (maxLen - minLen + 1));
        const cells = [{ ...start }];
        const local = new Set([`${start.x},${start.y}`]);
        for (let i = 1; i < length; i += 1) {
          const tail = cells[cells.length - 1];
          const options = dirs.filter((d) => {
            const nx = tail.x + d.x;
            const ny = tail.y + d.y;
            return inBounds(nx, ny) && !occupied.has(`${nx},${ny}`) && !local.has(`${nx},${ny}`);
          });
          if (!options.length) break;
          const chosen = pick(options);
          const next = { x: tail.x + chosen.x, y: tail.y + chosen.y };
          cells.push(next);
          local.add(`${next.x},${next.y}`);
        }
        if (cells.length < minLen) continue;
        const head = cells[0];
        const direction = nearestEdgeDir(head.x, head.y);
        built = {
          id: `lv${levelIdx + 1}_s${s + 1}`,
          color: COLOR_PALETTE[colorCursor % COLOR_PALETTE.length],
          direction,
          cells,
        };
      }
      if (!built) continue;
      snakes.push(built);
      colorCursor += 1;
      built.cells.forEach((c) => occupied.add(`${c.x},${c.y}`));
    }
    const targetMoves = Math.max(10, Math.floor(snakes.reduce((sum, s) => sum + s.cells.length, 0) * 0.7));
    return { gridSize, targetMoves, obstacles: [], snakes };
  }
  get(index) {
    const capped = Math.max(0, Math.min(this.levels.length - 1, index));
    const level = this.levels[capped];
    return JSON.parse(JSON.stringify(level));
  }
}

class MovementSystem {
  constructor(game) { this.game = game; this.active = null; this.progress = 0; this.speed = 7; }
  begin(snakeId) {
    if (this.active || this.game.state === SnakePuzzleState.LEVEL_COMPLETE) return false;
    const snake = this.game.snakes.find((s) => s.id === snakeId);
    if (!snake) return false;
    if (!this.game.canSnakeAdvance(snake)) { this.game.triggerBlocked(snakeId); return false; }
    this.game.pushUndo();
    this.active = snakeId;
    this.progress = 0;
    this.game.moves += 1;
    this.game.state = SnakePuzzleState.SNAKE_MOVING;
    return true;
  }
  update(delta) {
    if (!this.active) return;
    this.progress += delta * this.speed;
    if (this.progress < 1) return;
    this.progress = 0;
    const snake = this.game.snakes.find((s) => s.id === this.active);
    if (!snake) { this.active = null; this.game.state = SnakePuzzleState.PLAYING; return; }
    this.game.stepSnake(snake);
    if (!this.game.snakes.some((s) => s.id === this.active)) {
      this.active = null;
      this.game.checkComplete();
      if (this.game.state !== SnakePuzzleState.LEVEL_COMPLETE) this.game.state = SnakePuzzleState.PLAYING;
      return;
    }
    const still = this.game.snakes.find((s) => s.id === this.active);
    if (!this.game.canSnakeAdvance(still)) { this.active = null; this.game.state = SnakePuzzleState.PLAYING; }
  }
}

class CollisionSystem {
  constructor(game) { this.game = game; }
  occupancy(excludeId = null) {
    const occ = new Map();
    for (const obs of this.game.obstacles) occ.set(`${obs.x},${obs.y}`, { kind: "obstacle" });
    for (const snake of this.game.snakes) {
      if (snake.id === excludeId) continue;
      snake.cells.forEach((cell, idx) => { if (this.game.inBounds(cell)) occ.set(`${cell.x},${cell.y}`, { kind: "snake", id: snake.id, idx }); });
    }
    return occ;
  }
}

class PuzzleRenderer {
  constructor(canvas, game, movement) { this.canvas = canvas; this.ctx = canvas.getContext("2d"); this.game = game; this.movement = movement; this.board = { x: 0, y: 0, size: 0, cell: 0 }; }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = Math.floor(Math.min(rect.width, rect.height));
    const target = Math.max(320, Math.floor(css * dpr));
    if (this.canvas.width !== target) this.canvas.width = target;
    if (this.canvas.height !== target) this.canvas.height = target;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = Math.floor(css / this.game.gridSize);
    const size = cell * this.game.gridSize;
    this.board = { x: Math.floor((rect.width - size) / 2), y: Math.floor((rect.height - size) / 2), size, cell };
  }
  render(now) {
    this.resize();
    const c = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#f0f3f8";
    c.fillRect(0, 0, w, h);
    this.drawGrid();
    this.drawSnakes(now);
  }
  drawGrid() {
    const { x, y, size, cell } = this.board;
    const c = this.ctx;
    c.fillStyle = "#ffffff";
    c.fillRect(x, y, size, size);
    c.strokeStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i <= this.game.gridSize; i += 1) {
      const p = x + i * cell + 0.5;
      c.beginPath(); c.moveTo(p, y); c.lineTo(p, y + size); c.stroke();
      const q = y + i * cell + 0.5;
      c.beginPath(); c.moveTo(x, q); c.lineTo(x + size, q); c.stroke();
    }
  }
  drawSnakes(now) {
    for (const snake of this.game.snakes) {
      const offset = this.segmentOffset(snake);
      this.drawSnakeBody(snake, offset, now);
    }
  }
  segmentOffset(snake) {
    if (this.movement.active !== snake.id) return { x: 0, y: 0 };
    const d = DIRECTIONS[snake.direction];
    return { x: d.x * this.movement.progress, y: d.y * this.movement.progress };
  }
  drawSnakeBody(snake, offset, now) {
    const c = this.ctx;
    const cellSize = this.board.cell;
    const selected = this.game.selectedSnakeId === snake.id;
    const blockedPulse = this.game.blockedSnakeId === snake.id ? Math.sin(now / 40) * 3 : 0;
    snake.cells.forEach((seg, idx) => {
      const px = this.board.x + (seg.x + offset.x) * cellSize + blockedPulse;
      const py = this.board.y + (seg.y + offset.y) * cellSize;
      const r = cellSize * 0.36;
      c.fillStyle = snake.color;
      c.shadowColor = "rgba(0,0,0,0.2)";
      c.shadowBlur = 5;
      c.beginPath();
      c.roundRect(px + cellSize * 0.07, py + cellSize * 0.07, cellSize * 0.86, cellSize * 0.86, r);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = "rgba(255,255,255,0.2)";
      c.beginPath();
      c.roundRect(px + cellSize * 0.17, py + cellSize * 0.16, cellSize * 0.56, cellSize * 0.16, cellSize * 0.09);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.beginPath();
      c.arc(px + cellSize * 0.5, py + cellSize * 0.54, cellSize * 0.3, 0, Math.PI * 2);
      c.fill();
      if (idx === 0) this.drawHeadDetails(px, py, cellSize, snake.direction, snake.color);
      if (selected) {
        c.strokeStyle = "#0f172a";
        c.lineWidth = 2;
        c.strokeRect(px + 2, py + 2, cellSize - 4, cellSize - 4);
      }
    });
  }
  drawHeadDetails(px, py, cell, dir, color) {
    const c = this.ctx;
    c.fillStyle = color;
    c.beginPath();
    c.roundRect(px + cell * 0.06, py + cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.46);
    c.fill();
    const eye = (ox, oy) => {
      c.fillStyle = "#eaf6ff"; c.beginPath(); c.arc(px + ox * cell, py + oy * cell, cell * 0.12, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#1f2937"; c.beginPath(); c.arc(px + ox * cell, py + oy * cell, cell * 0.06, 0, Math.PI * 2); c.fill();
    };
    const map = { right: [[0.72, 0.35], [0.72, 0.65]], left: [[0.28, 0.35], [0.28, 0.65]], up: [[0.35, 0.28], [0.65, 0.28]], down: [[0.35, 0.72], [0.65, 0.72]] };
    map[dir].forEach(([x, y]) => eye(x, y));
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = Math.max(1, cell * 0.04);
    c.beginPath();
    c.arc(px + cell * 0.5, py + cell * 0.5, cell * 0.35, Math.PI * 0.15, Math.PI * 0.85);
    c.stroke();
  }
  cellFromPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left - this.board.x;
    const y = clientY - rect.top - this.board.y;
    const cx = Math.floor(x / this.board.cell);
    const cy = Math.floor(y / this.board.cell);
    if (cx < 0 || cy < 0 || cx >= this.game.gridSize || cy >= this.game.gridSize) return null;
    return { x: cx, y: cy };
  }
}

class PuzzleUIManager {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.els = {
      escaped: root.querySelector("#escaped2"), total: root.querySelector("#total2"), moves: root.querySelector("#moves2"), highScore: root.querySelector("#highScore2"), level: root.querySelector("#level2"), state: root.querySelector("#state2"),
      overlay: root.querySelector("#overlay2"), overlayKicker: root.querySelector("#overlayKicker2"), overlayTitle: root.querySelector("#overlayTitle2"), overlayText: root.querySelector("#overlayText2"),
      help: root.querySelector("#helpPanel2"), start: root.querySelector("#primaryAction2"), pause: root.querySelector("#pauseButton2"), sound: root.querySelector("#soundButton2"),
      undo: root.querySelector("#undoButton2"), hint: root.querySelector("#hintButton2"), reset: root.querySelector("#resetButton2"), settings: root.querySelector("#settingsButton2"),
      settingsPanel: root.querySelector("#settingsPanel2"), gridSize: root.querySelector("#gridSize2"), wallMode: root.querySelector("#wallMode2"), difficulty: root.querySelector("#difficulty2"), visualFilter: root.querySelector("#visualFilter2"), soundEnabled: root.querySelector("#soundEnabled2"),
      scanlines: root.querySelector("#scanlines2"), comboChip: root.querySelector("#comboChip2"), timeline: root.querySelector("#timelineFill2"),
    };
  }
  syncSettingsForm() {
    const s = this.game.settings;
    this.els.gridSize.value = String(s.gridSize); this.els.wallMode.value = s.mode; this.els.difficulty.value = s.difficulty; this.els.visualFilter.value = s.visualFilter; this.els.soundEnabled.checked = s.sound;
    this.els.scanlines.hidden = s.visualFilter !== "scanline";
    this.els.sound.textContent = s.sound ? "S" : "M";
  }
  readSettingsForm() {
    return { gridSize: Number(this.els.gridSize.value), mode: this.els.wallMode.value, difficulty: this.els.difficulty.value, visualFilter: this.els.visualFilter.value, sound: this.els.soundEnabled.checked };
  }
  update() {
    this.els.escaped.textContent = String(this.game.escapedCount);
    this.els.total.textContent = String(this.game.totalSnakes);
    this.els.moves.textContent = String(this.game.moves);
    this.els.highScore.textContent = String(this.game.highScore);
    this.els.level.textContent = String(this.game.levelIndex + 1);
    this.els.state.textContent = this.game.stateLabel();
    this.els.comboChip.textContent = this.game.hintSnakeId ? "Hint active" : "Tap snake";
    this.els.comboChip.hidden = false;
    this.els.timeline.style.width = `${Math.min(100, (this.game.escapedCount / Math.max(1, this.game.totalSnakes)) * 100)}%`;
    this.syncOverlay();
  }
  syncOverlay() {
    const map = {
      [SnakePuzzleState.INTRO]: ["tutorial", "FAKE-unjam", "Tap a snake to slide it out. Free all snakes to clear the board.", "Start"],
      [SnakePuzzleState.LEVEL_COMPLETE]: ["cleared", "Level Complete", `Moves used: ${this.game.moves}.`, "Next Level"],
    };
    const data = map[this.game.state];
    this.els.overlay.hidden = !data;
    if (!data) return;
    const [k, t, tx, b] = data;
    this.els.overlayKicker.textContent = k; this.els.overlayTitle.textContent = t; this.els.overlayText.textContent = tx; this.els.start.textContent = b; this.els.help.hidden = this.game.state !== SnakePuzzleState.INTRO;
  }
}

class SnakePuzzleGame {
  constructor(storage, audio) {
    this.storage = storage;
    this.audio = audio;
    this.settings = storage.loadSettings();
    this.highScore = storage.loadBest();
    this.levelManager = new LevelManager();
    this.collision = new CollisionSystem(this);
    this.levelIndex = 0;
    this.undoStack = [];
    this.loadLevel(0);
  }
  loadLevel(index) {
    const level = this.levelManager.get(index);
    this.levelIndex = index;
    this.gridSize = level.gridSize;
    this.obstacles = level.obstacles;
    this.snakes = level.snakes.map((s) => ({ ...s, cells: s.cells.map((c) => ({ ...c })) }));
    this.totalSnakes = this.snakes.length;
    this.escapedCount = 0;
    this.moves = 0;
    this.state = SnakePuzzleState.INTRO;
    this.selectedSnakeId = null;
    this.blockedSnakeId = null;
    this.blockedUntil = 0;
    this.hintSnakeId = null;
    this.undoStack = [];
  }
  applySettings(settings) { this.settings = settings; this.audio.settings = settings; this.storage.saveSettings(settings); }
  stateLabel() {
    const map = { intro: "Intro", playing: "Playing", snakeMoving: "Moving", blockedFeedback: "Blocked", levelComplete: "Complete" };
    return map[this.state] || "Playing";
  }
  inBounds(cell) { return cell.x >= 0 && cell.y >= 0 && cell.x < this.gridSize && cell.y < this.gridSize; }
  snakeAtCell(cell) {
    for (const snake of this.snakes) for (const seg of snake.cells) if (seg.x === cell.x && seg.y === cell.y) return snake.id;
    return null;
  }
  canSnakeAdvance(snake) {
    const dir = DIRECTIONS[snake.direction];
    const head = snake.cells[0];
    const next = { x: head.x + dir.x, y: head.y + dir.y };
    if (!this.inBounds(next)) return true;
    const occ = this.collision.occupancy(snake.id);
    const hit = occ.get(`${next.x},${next.y}`);
    if (!hit) return true;
    if (hit.kind === "obstacle") return false;
    return false;
  }
  stepSnake(snake) {
    const dir = DIRECTIONS[snake.direction];
    const nextHead = { x: snake.cells[0].x + dir.x, y: snake.cells[0].y + dir.y };
    snake.cells = [nextHead, ...snake.cells.slice(0, -1)];
    if (snake.cells.every((c) => !this.inBounds(c))) {
      this.snakes = this.snakes.filter((s) => s.id !== snake.id);
      this.escapedCount += 1;
      this.selectedSnakeId = null;
      this.audio.play("eat");
    }
  }
  pushUndo() {
    this.undoStack.push({
      snakes: this.snakes.map((s) => ({ ...s, cells: s.cells.map((c) => ({ ...c })) })),
      escapedCount: this.escapedCount,
      moves: this.moves,
    });
    if (this.undoStack.length > 100) this.undoStack.shift();
  }
  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.snakes = snap.snakes;
    this.escapedCount = snap.escapedCount;
    this.moves = snap.moves;
    this.state = SnakePuzzleState.PLAYING;
    this.blockedSnakeId = null;
    this.hintSnakeId = null;
  }
  triggerBlocked(snakeId) {
    this.blockedSnakeId = snakeId;
    this.blockedUntil = performance.now() + 250;
    this.state = SnakePuzzleState.BLOCKED;
    this.audio.play("block");
  }
  clearBlocked(now) {
    if (this.state === SnakePuzzleState.BLOCKED && now >= this.blockedUntil) {
      this.blockedSnakeId = null;
      this.state = SnakePuzzleState.PLAYING;
    }
  }
  checkComplete() {
    if (this.snakes.length === 0) {
      this.state = SnakePuzzleState.LEVEL_COMPLETE;
      const clearedLevel = this.levelIndex + 1;
      if (clearedLevel > this.highScore) {
        this.highScore = clearedLevel;
        this.storage.saveBest(this.highScore);
      }
      this.audio.play("win");
    }
  }
  nextLevel() { this.loadLevel(Math.min(this.levelManager.levels.length - 1, this.levelIndex + 1)); }
  resetLevel() { this.loadLevel(this.levelIndex); }
  findHint() {
    for (const snake of this.snakes) if (this.canSnakeAdvance(snake) && !this.inBounds({ x: snake.cells[0].x + DIRECTIONS[snake.direction].x, y: snake.cells[0].y + DIRECTIONS[snake.direction].y })) return snake.id;
    for (const snake of this.snakes) if (this.canSnakeAdvance(snake)) return snake.id;
    return null;
  }
}

class PuzzleInputManager {
  constructor(root, game, ui, renderer, movement) {
    this.root = root; this.game = game; this.ui = ui; this.renderer = renderer; this.movement = movement;
    this.bind();
  }
  bind() {
    this.ui.els.start.addEventListener("click", () => {
      if (this.game.state === SnakePuzzleState.LEVEL_COMPLETE) this.game.nextLevel();
      else this.game.state = SnakePuzzleState.PLAYING;
    });
    this.ui.els.pause.addEventListener("click", () => {});
    this.ui.els.sound.addEventListener("click", () => { const next = { ...this.game.settings, sound: !this.game.settings.sound }; this.game.applySettings(next); this.ui.syncSettingsForm(); });
    this.ui.els.undo.addEventListener("click", () => this.game.undo());
    this.ui.els.hint.addEventListener("click", () => { this.game.hintSnakeId = this.game.findHint(); });
    this.ui.els.reset.addEventListener("click", () => this.game.resetLevel());
    this.ui.els.settings.addEventListener("click", () => { this.ui.els.settingsPanel.hidden = !this.ui.els.settingsPanel.hidden; });
    for (const input of this.ui.els.settingsPanel.querySelectorAll("select,input")) input.addEventListener("change", () => { this.game.applySettings(this.ui.readSettingsForm()); this.ui.syncSettingsForm(); });
    const canvas = this.root.querySelector("#gameCanvas2");
    const handle = (clientX, clientY) => {
      if (this.game.state === SnakePuzzleState.INTRO) this.game.state = SnakePuzzleState.PLAYING;
      if (this.game.state !== SnakePuzzleState.PLAYING) return;
      const cell = this.renderer.cellFromPoint(clientX, clientY);
      if (!cell) return;
      const snakeId = this.game.snakeAtCell(cell);
      if (!snakeId) return;
      this.game.selectedSnakeId = snakeId;
      this.game.hintSnakeId = null;
      this.movement.begin(snakeId);
    };
    if (window.PointerEvent) {
      canvas.addEventListener("pointerup", (e) => {
        if (e.pointerType === "touch") e.preventDefault();
        handle(e.clientX, e.clientY);
      });
    } else {
      canvas.addEventListener("click", (e) => handle(e.clientX, e.clientY));
      canvas.addEventListener("touchend", (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        handle(t.clientX, t.clientY);
      }, { passive: false });
    }
  }
  onKey(event) {
    if (event.key === "Enter") { event.preventDefault(); if (this.game.state === SnakePuzzleState.LEVEL_COMPLETE) this.game.nextLevel(); else this.game.state = SnakePuzzleState.PLAYING; }
    if (event.key === "r" || event.key === "R") this.game.resetLevel();
    if (event.key === "z" || event.key === "Z") this.game.undo();
  }
}

class PuzzleController {
  constructor(panelSelector) {
    this.panel = document.querySelector(panelSelector);
    this.storage = new StorageManager("snake-unjust.puzzle");
    this.game = new SnakePuzzleGame(this.storage, null);
    this.audio = new AudioManager(this.game.settings);
    this.game.audio = this.audio;
    this.movement = new MovementSystem(this.game);
    this.renderer = new PuzzleRenderer(this.panel.querySelector("#gameCanvas2"), this.game, this.movement);
    this.ui = new PuzzleUIManager(this.panel, this.game);
    this.input = new PuzzleInputManager(this.panel, this.game, this.ui, this.renderer, this.movement);
    this.ui.syncSettingsForm();
    this.ui.update();
  }
  frame(now, deltaSeconds) {
    this.game.clearBlocked(now);
    this.movement.update(deltaSeconds);
    this.game.checkComplete();
    this.renderer.render(now);
    this.ui.update();
  }
}

const controllers = {
  snake: new GameController({ panelSelector: "#playerSnake", storagePrefix: "snake-unjust.snake", suffix: "", labels: { title: "FAKE-snake", idleText: "Press Enter or tap Start to wake the mini-game." } }),
  snakeunjust: new PuzzleController("#playerSnakeUnjust"),
};

let activeTab = "snakeunjust";
const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = { snake: document.querySelector('[data-panel="snake"]'), snakeunjust: document.querySelector('[data-panel="snakeunjust"]') };
function setActiveTab(tabName) {
  activeTab = tabName;
  tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === tabName));
  for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== tabName;
}
tabs.forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));
document.addEventListener("keydown", (event) => controllers[activeTab].input.onKey(event));

let lastFrame = performance.now();
function frame(now) {
  const deltaSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  controllers[activeTab].frame(now, deltaSeconds);
  requestAnimationFrame(frame);
}

setActiveTab("snakeunjust");
requestAnimationFrame(frame);

// ---- Neon FAKE text background ----
(function () {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: true });

  const WORD = "UJ FALUSI";
  const COL_W = 188;
  const ROW_H = 88;
  const FONT_SIZE = 30;
  const SPEED_X = 6;
  const SPEED_Y = 20;

  let w = 0, h = 0, ox = 0, oy = 0, last = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }

  function frame(ts) {
    const dt = Math.min((ts - last) / 1000, 0.05);
    last = ts;
    ox = (ox + SPEED_X * dt) % COL_W;
    oy = (oy + SPEED_Y * dt) % ROW_H;

    ctx.clearRect(0, 0, w, h);
    ctx.font = `800 ${FONT_SIZE}px ui-monospace,"Cascadia Mono","Fira Code",monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const cols = Math.ceil(w / COL_W) + 2;
    const rows = Math.ceil(h / ROW_H) + 2;

    for (let row = -1; row < rows; row++) {
      const stagger = (row & 1) ? COL_W * 0.5 : 0;
      for (let col = -1; col < cols; col++) {
        const x = col * COL_W + stagger + ox;
        const y = row * ROW_H + oy;
        const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0007 + row * 1.3 + col * 0.9);
        const isGreen = ((row + col) & 1) === 0;
        ctx.globalAlpha = 0.06 + 0.07 * pulse;
        ctx.fillStyle = isGreen ? "#54ff9f" : "#9f7fff";
        ctx.shadowColor = isGreen ? "#54ff9f" : "#7f46ff";
        ctx.shadowBlur = 12 + 10 * pulse;
        ctx.fillText(WORD, x, y);
      }
    }

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });
  requestAnimationFrame(function (ts) { last = ts; requestAnimationFrame(frame); });
})();
