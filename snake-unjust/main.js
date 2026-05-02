const DIRECTIONS = {
  up: { x: 0, y: -1, name: "up" },
  down: { x: 0, y: 1, name: "down" },
  left: { x: -1, y: 0, name: "left" },
  right: { x: 1, y: 0, name: "right" },
};

const OPPOSITES = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

class GameState {
  static IDLE = "idle";
  static LOADING = "loading";
  static PLAYING = "playing";
  static PAUSED = "paused";
  static GAME_OVER = "gameOver";
  static SETTINGS = "settings";
}

class StorageManager {
  constructor() {
    this.bestKey = "snake-unjust.best";
    this.settingsKey = "snake-unjust.settings";
    this.defaults = {
      gridSize: 20,
      mode: "classic",
      sound: true,
      visualFilter: "scanline",
      difficulty: "normal",
    };
  }

  loadBest() {
    return Number(localStorage.getItem(this.bestKey) || 0);
  }

  saveBest(score) {
    localStorage.setItem(this.bestKey, String(score));
  }

  loadSettings() {
    try {
      return { ...this.defaults, ...JSON.parse(localStorage.getItem(this.settingsKey) || "{}") };
    } catch {
      return { ...this.defaults };
    }
  }

  saveSettings(settings) {
    localStorage.setItem(this.settingsKey, JSON.stringify(settings));
  }
}

class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
  }

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
    const sounds = {
      start: [440, 0.055, "triangle", 0.07],
      eat: [740, 0.045, "square", 0.08],
      pause: [280, 0.07, "sine", 0.055],
      gameOver: [120, 0.22, "sawtooth", 0.075],
    };
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
    this.reservedCells = new Set();
    this.reset();
  }

  reset() {
    this.gridSize = this.settings.gridSize;
    const center = Math.floor(this.gridSize / 2);
    this.snake = [
      { x: center, y: center },
      { x: center - 1, y: center },
      { x: center - 2, y: center },
    ];
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

  startLoading(now) {
    this.audio.unlock();
    this.reset();
    this.state = GameState.LOADING;
    this.loadingStarted = now;
  }

  startPlaying(now) {
    this.state = GameState.PLAYING;
    this.lastFrame = now;
    this.audio.play("start");
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.audio.play("pause");
  }

  resume(now) {
    if (this.state !== GameState.PAUSED) return;
    this.state = GameState.PLAYING;
    this.lastFrame = now;
    this.audio.play("start");
  }

  openSettings() {
    if (this.state === GameState.PLAYING) this.pause();
    this.state = GameState.SETTINGS;
  }

  closeSettings() {
    this.state = GameState.IDLE;
  }

  applySettings(settings) {
    this.settings = settings;
    this.audio.settings = settings;
    this.storage.saveSettings(settings);
    this.reset();
  }

  queueDirection(name) {
    const next = DIRECTIONS[name];
    if (!next) return;
    const lastQueued = this.directionQueue.at(-1) || this.direction;
    if (OPPOSITES[lastQueued.name] === next.name) return;
    if (this.directionQueue.length < 2) this.directionQueue.push(next);
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
    } else if (this.isOutside(next)) {
      this.end();
      return;
    }

    const ate = next.x === this.food.x && next.y === this.food.y;
    const bodyToCheck = ate ? this.snake : this.snake.slice(0, -1);
    if (bodyToCheck.some((part) => part.x === next.x && part.y === next.y)) {
      this.end();
      return;
    }

    this.snake.unshift(next);
    if (ate) {
      this.eatFood(now);
    } else {
      this.snake.pop();
    }
  }

  eatFood(now) {
    const fastPickup = this.lastFoodAt > 0 && now - this.lastFoodAt <= 4000;
    this.combo = fastPickup ? Math.min(5, this.combo + 1) : 1;
    this.lastFoodAt = now;
    this.foodCount += 1;
    this.level = Math.floor(this.foodCount / 5) + 1;
    this.score += 10 * this.combo;
    this.speed = this.calculateSpeed();
    this.stepSeconds = 1 / this.speed;
    this.audio.play("eat");
    this.spawnFood();
  }

  calculateSpeed() {
    const ramps = {
      chill: 0.6,
      normal: 1,
      boss: this.score >= 50 ? 1.8 : 1.15,
    };
    const ramp = ramps[this.settings.difficulty] || ramps.normal;
    return Math.min(18, 7 + Math.floor(this.foodCount / 5) * ramp);
  }

  spawnFood() {
    const occupied = new Set([
      ...this.reservedCells,
      ...this.snake.map((part) => `${part.x},${part.y}`),
    ]);
    const candidates = [];
    for (let y = 0; y < this.gridSize; y += 1) {
      for (let x = 0; x < this.gridSize; x += 1) {
        if (!occupied.has(`${x},${y}`)) candidates.push({ x, y });
      }
    }
    this.food = candidates[Math.floor(Math.random() * candidates.length)] || { x: 0, y: 0 };
  }

  isOutside(cell) {
    return cell.x < 0 || cell.y < 0 || cell.x >= this.gridSize || cell.y >= this.gridSize;
  }

  end() {
    this.state = GameState.GAME_OVER;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      this.storage.saveBest(this.bestScore);
    }
    this.audio.play("gameOver");
  }
}

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.game = game;
    this.board = { x: 0, y: 0, size: 0, cell: 0 };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssSize = Math.floor(Math.min(rect.width, rect.height));
    const target = Math.max(300, Math.floor(cssSize * dpr));
    if (this.canvas.width !== target) this.canvas.width = target;
    if (this.canvas.height !== target) this.canvas.height = target;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = Math.floor(cssSize / this.game.gridSize);
    const size = cell * this.game.gridSize;
    this.board = {
      x: Math.floor((rect.width - size) / 2),
      y: Math.floor((rect.height - size) / 2),
      size,
      cell,
    };
  }

  render(now) {
    this.resize();
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#090b0e";
    ctx.fillRect(0, 0, width, height);
    this.drawGrid();
    this.drawFood(now);
    this.drawSnake();
    if (this.game.state === GameState.LOADING) this.drawSpinner(now, width, height);
  }

  drawGrid() {
    const { x, y, size, cell } = this.board;
    const ctx = this.ctx;
    ctx.fillStyle = "#10151a";
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.game.gridSize; i += 1) {
      const p = x + i * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, y);
      ctx.lineTo(p, y + size);
      ctx.stroke();
      const q = y + i * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, q);
      ctx.lineTo(x + size, q);
      ctx.stroke();
    }
  }

  drawFood(now) {
    const pulse = 0.75 + Math.sin(now / 135) * 0.25;
    const { x, y, cell } = this.toPixels(this.game.food);
    const ctx = this.ctx;
    const center = x + cell / 2;
    const radius = cell * (0.24 + pulse * 0.08);
    ctx.shadowBlur = cell * 0.42;
    ctx.shadowColor = "rgba(255,207,90,0.7)";
    ctx.fillStyle = "#ffcf5a";
    ctx.beginPath();
    ctx.arc(center, y + cell / 2, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(center - radius * 0.32, y + cell / 2 - radius * 0.32, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  drawSnake() {
    this.game.snake.forEach((part, index) => {
      const { x, y, cell } = this.toPixels(part);
      const inset = Math.max(2, Math.floor(cell * 0.12));
      const size = cell - inset * 2;
      const ctx = this.ctx;
      ctx.fillStyle = index === 0 ? "#7dffd0" : `hsl(158 66% ${Math.max(42, 72 - index * 2)}%)`;
      ctx.fillRect(x + inset, y + inset, size, size);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x + inset, y + inset, size, Math.max(2, size * 0.22));
      if (index === 0) {
        ctx.fillStyle = "#0b1713";
        const eye = Math.max(2, Math.floor(cell * 0.08));
        ctx.fillRect(x + cell * 0.62, y + cell * 0.3, eye, eye);
        ctx.fillRect(x + cell * 0.62, y + cell * 0.58, eye, eye);
      }
    });
  }

  drawSpinner(now, width, height) {
    const ctx = this.ctx;
    const dots = 12;
    const radius = 32;
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < dots; i += 1) {
      const angle = (Math.PI * 2 * i) / dots + now / 320;
      ctx.fillStyle = `rgba(69, 240, 170, ${0.2 + i / dots})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  toPixels(cell) {
    return {
      x: this.board.x + cell.x * this.board.cell,
      y: this.board.y + cell.y * this.board.cell,
      cell: this.board.cell,
    };
  }
}

class UIManager {
  constructor(game) {
    this.game = game;
    this.els = {
      score: document.querySelector("#score"),
      bestScore: document.querySelector("#bestScore"),
      level: document.querySelector("#level"),
      speed: document.querySelector("#speed"),
      mode: document.querySelector("#mode"),
      comboChip: document.querySelector("#comboChip"),
      overlay: document.querySelector("#overlay"),
      overlayKicker: document.querySelector("#overlayKicker"),
      overlayTitle: document.querySelector("#overlayTitle"),
      overlayText: document.querySelector("#overlayText"),
      helpPanel: document.querySelector("#helpPanel"),
      primaryAction: document.querySelector("#primaryAction"),
      pauseButton: document.querySelector("#pauseButton"),
      soundButton: document.querySelector("#soundButton"),
      timelineFill: document.querySelector("#timelineFill"),
      settingsButton: document.querySelector("#settingsButton"),
      settingsPanel: document.querySelector("#settingsPanel"),
      gridSize: document.querySelector("#gridSize"),
      wallMode: document.querySelector("#wallMode"),
      difficulty: document.querySelector("#difficulty"),
      visualFilter: document.querySelector("#visualFilter"),
      soundEnabled: document.querySelector("#soundEnabled"),
      scanlines: document.querySelector("#scanlines"),
    };
  }

  syncSettingsForm() {
    const { settings } = this.game;
    this.els.gridSize.value = String(settings.gridSize);
    this.els.wallMode.value = settings.mode;
    this.els.difficulty.value = settings.difficulty;
    this.els.visualFilter.value = settings.visualFilter;
    this.els.soundEnabled.checked = settings.sound;
    this.els.scanlines.hidden = settings.visualFilter !== "scanline";
    this.els.soundButton.textContent = settings.sound ? "S" : "M";
  }

  readSettingsForm() {
    return {
      gridSize: Number(this.els.gridSize.value),
      mode: this.els.wallMode.value,
      difficulty: this.els.difficulty.value,
      visualFilter: this.els.visualFilter.value,
      sound: this.els.soundEnabled.checked,
    };
  }

  update() {
    this.els.score.textContent = String(this.game.score);
    this.els.bestScore.textContent = String(this.game.bestScore);
    this.els.level.textContent = String(this.game.level);
    this.els.speed.textContent = this.game.speed.toFixed(1).replace(".0", "");
    this.els.mode.textContent = this.game.settings.mode === "wrap" ? "Wrap" : "Classic";
    this.els.comboChip.textContent = `Combo x${this.game.combo}`;
    this.els.comboChip.hidden = this.game.combo <= 1 || this.game.state !== GameState.PLAYING;
    this.els.timelineFill.style.width = `${Math.min(100, 8 + this.game.foodCount * 4)}%`;
    this.els.pauseButton.textContent = this.game.state === GameState.PAUSED ? ">" : "II";
    this.syncOverlay();
  }

  syncOverlay() {
    const overlays = {
      [GameState.IDLE]: ["hidden player mode", "Snake Unjust", "Press Enter or tap Start to wake the mini-game.", "Start"],
      [GameState.LOADING]: ["buffering", "Buffering...", "Signal found. Preparing the grid.", "Buffering..."],
      [GameState.PAUSED]: ["paused", "Paused", "Press Space or tap Resume to continue.", "Resume"],
      [GameState.GAME_OVER]: ["signal lost", "Game Over", `Final score ${this.game.score}. Press Enter to restart.`, "Restart"],
      [GameState.SETTINGS]: ["settings", "Settings", "Adjust the run, then close settings or press Enter to start.", "Start"],
    };
    const data = overlays[this.game.state];
    this.els.overlay.hidden = !data;
    if (!data) return;
    const [kicker, title, text, button] = data;
    this.els.overlayKicker.textContent = kicker;
    this.els.overlayTitle.textContent = title;
    this.els.overlayText.textContent = text;
    this.els.primaryAction.textContent = button;
    this.els.helpPanel.hidden = this.game.state !== GameState.IDLE;
  }

  setSettingsVisible(visible) {
    this.els.settingsPanel.hidden = !visible;
  }
}

class InputManager {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.touchStart = null;
    this.bind();
  }

  bind() {
    document.addEventListener("keydown", (event) => this.onKey(event));
    document.querySelector("#primaryAction").addEventListener("click", () => this.primaryAction());
    document.querySelector("#pauseButton").addEventListener("click", () => this.togglePause());
    document.querySelector("#settingsButton").addEventListener("click", () => this.toggleSettings());
    document.querySelector("#soundButton").addEventListener("click", () => {
      const next = { ...this.game.settings, sound: !this.game.settings.sound };
      this.game.applySettings(next);
      this.ui.syncSettingsForm();
    });
    document.querySelector(".touch-pad").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-dir]");
      if (!button) return;
      this.move(button.dataset.dir);
    });
    for (const input of this.ui.els.settingsPanel.querySelectorAll("select,input")) {
      input.addEventListener("change", () => {
        this.game.applySettings(this.ui.readSettingsForm());
        this.ui.syncSettingsForm();
        this.ui.setSettingsVisible(true);
        this.game.state = GameState.SETTINGS;
      });
    }
    const canvas = document.querySelector("#gameCanvas");
    canvas.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches[0];
      this.touchStart = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    canvas.addEventListener("touchend", (event) => this.onTouchEnd(event), { passive: true });
  }

  onKey(event) {
    const keyMap = {
      ArrowUp: "up",
      w: "up",
      W: "up",
      ArrowDown: "down",
      s: "down",
      S: "down",
      ArrowLeft: "left",
      a: "left",
      A: "left",
      ArrowRight: "right",
      d: "right",
      D: "right",
    };
    if (keyMap[event.key]) {
      event.preventDefault();
      this.move(keyMap[event.key]);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      this.togglePause();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      this.primaryAction();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.toggleSettings();
    }
  }

  onTouchEnd(event) {
    if (!this.touchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - this.touchStart.x;
    const dy = touch.clientY - this.touchStart.y;
    this.touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    this.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  }

  move(direction) {
    if (this.game.state === GameState.IDLE) this.game.startLoading(performance.now());
    this.game.queueDirection(direction);
  }

  primaryAction() {
    const now = performance.now();
    if (this.game.state === GameState.PAUSED) {
      this.game.resume(now);
      return;
    }
    this.ui.setSettingsVisible(false);
    this.game.startLoading(now);
  }

  togglePause() {
    const now = performance.now();
    if (this.game.state === GameState.PLAYING) this.game.pause();
    else if (this.game.state === GameState.PAUSED) this.game.resume(now);
    else if (this.game.state === GameState.IDLE || this.game.state === GameState.GAME_OVER) this.game.startLoading(now);
  }

  toggleSettings() {
    const open = this.ui.els.settingsPanel.hidden;
    this.ui.setSettingsVisible(open);
    if (open) this.game.openSettings();
    else this.game.closeSettings();
  }
}

const storage = new StorageManager();
const game = new SnakeGame(storage, null);
const audio = new AudioManager(game.settings);
game.audio = audio;
const renderer = new Renderer(document.querySelector("#gameCanvas"), game);
const ui = new UIManager(game);
new InputManager(game, ui);

let lastFrame = performance.now();
function frame(now) {
  if (game.state === GameState.LOADING && now - game.loadingStarted >= 900) {
    game.startPlaying(now);
  }
  const deltaSeconds = (now - lastFrame) / 1000;
  lastFrame = now;
  game.update(deltaSeconds, now);
  renderer.render(now);
  ui.update();
  requestAnimationFrame(frame);
}

ui.syncSettingsForm();
ui.update();
requestAnimationFrame(frame);
