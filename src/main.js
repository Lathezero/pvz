const GRID_ROWS = 5;
const GRID_COLS = 9;
const CELL_W = 110;
const CELL_H = 120;

const plantTypes = {
  peashooter: {
    key: 'peashooter',
    name: '豌豆射手',
    cost: 100,
    health: 220,
    fireRate: 1.4,
    damage: 28,
    img: 'assets/peashooter.svg',
    description: '远程输出，行列有僵尸时射击。'
  },
  sunflower: {
    key: 'sunflower',
    name: '向日葵',
    cost: 50,
    health: 180,
    sunRate: 7,
    img: 'assets/sunflower.svg',
    description: '周期产阳光，经济来源。'
  },
  wallnut: {
    key: 'wallnut',
    name: '坚果墙',
    cost: 75,
    health: 750,
    img: 'assets/wallnut.svg',
    description: '高血量防御，拖延僵尸。'
  }
};

const zombieTypes = {
  walker: {
    name: '普通僵尸',
    speed: 16,
    health: 260,
    damage: 26,
    img: 'assets/zombie.svg'
  },
  runner: {
    name: '冲刺僵尸',
    speed: 24,
    health: 200,
    damage: 30,
    img: 'assets/zombie.svg'
  },
  tank: {
    name: '铁桶僵尸',
    speed: 12,
    health: 520,
    damage: 35,
    img: 'assets/zombie.svg'
  }
};

const levels = [
  { name: '草坪练习', spawnEvery: 4.5, zombies: { walker: 12 }, sunBonus: 100 },
  { name: '黄昏警报', spawnEvery: 4, zombies: { walker: 10, runner: 6 }, sunBonus: 125 },
  { name: '深夜来袭', spawnEvery: 3.6, zombies: { walker: 10, runner: 8, tank: 4 }, sunBonus: 150 }
];

const boardEl = document.getElementById('board');
const gridEl = document.getElementById('grid');
const entitiesEl = document.getElementById('entities');
const messageEl = document.getElementById('message');
const plantBarEl = document.getElementById('plant-bar');
const sunCountEl = document.getElementById('sun-count');
const levelLabelEl = document.getElementById('level-label');
const restartBtn = document.getElementById('restart');
const toggleMusicBtn = document.getElementById('toggle-music');

const music = new Audio('assets/background.ogg');
music.loop = true;
music.volume = 0.35;
const shootSfx = new Audio('assets/shoot.ogg');
shootSfx.volume = 0.6;
const hitSfx = new Audio('assets/hit.ogg');
hitSfx.volume = 0.6;

const state = {
  sun: 150,
  plants: [],
  zombies: [],
  projectiles: [],
  suns: [],
  selected: null,
  status: 'ready',
  lastTime: 0,
  levelIndex: 0,
  spawnQueue: [],
  spawnIndex: 0,
  spawnTimer: 0,
  skySunTimer: 0,
  victoryShown: false
};

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function setupGrid() {
  gridEl.innerHTML = '';
  for (let r = 0; r < GRID_ROWS; r += 1) {
    for (let c = 0; c < GRID_COLS; c += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      gridEl.appendChild(cell);
    }
  }
}

function buildPlantBar() {
  plantBarEl.innerHTML = '';
  Object.values(plantTypes).forEach((plant) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.key = plant.key;
    card.innerHTML = `
      <img src="${plant.img}" alt="${plant.name}">
      <div class="meta">
        <div class="name">${plant.name}</div>
        <div class="cost">💰 ${plant.cost}</div>
        <div class="desc">${plant.description}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      if (state.sun < plant.cost) return;
      state.selected = plant.key;
      refreshPlantBar();
    });
    plantBarEl.appendChild(card);
  });
  refreshPlantBar();
}

function refreshPlantBar() {
  const cards = plantBarEl.querySelectorAll('.card');
  cards.forEach((card) => {
    const key = card.dataset.key;
    const plant = plantTypes[key];
    card.classList.toggle('selected', state.selected === key);
    card.classList.toggle('inactive', state.sun < plant.cost);
  });
}

function cellToPosition(row, col) {
  return {
    x: col * CELL_W + CELL_W / 2,
    y: row * CELL_H + CELL_H / 2
  };
}

function placePlant(row, col) {
  if (state.status !== 'playing') return;
  const key = state.selected;
  if (!key) return;
  if (state.plants.find((p) => p.row === row && p.col === col)) return;
  const plant = plantTypes[key];
  if (state.sun < plant.cost) return;
  const pos = cellToPosition(row, col);
  state.plants.push({
    id: uid('plant'),
    key,
    row,
    col,
    x: pos.x,
    y: pos.y,
    health: plant.health,
    fireTimer: 0,
    sunTimer: 0
  });
  state.sun -= plant.cost;
  state.selected = null;
  refreshPlantBar();
}

function spawnZombie(typeKey) {
  const type = zombieTypes[typeKey];
  const row = Math.floor(Math.random() * GRID_ROWS);
  const pos = cellToPosition(row, GRID_COLS);
  state.zombies.push({
    id: uid('zombie'),
    type: typeKey,
    row,
    x: pos.x + 40,
    y: pos.y,
    health: type.health,
    speed: type.speed,
    attackTimer: 0
  });
}

function addProjectile(x, y, row, damage) {
  state.projectiles.push({
    id: uid('pea'),
    x,
    y,
    row,
    damage,
    speed: 240
  });
  shootSfx.currentTime = 0;
  shootSfx.play();
}

function addSun(x, y, fall = false) {
  state.suns.push({
    id: uid('sun'),
    x,
    y: fall ? -40 : y,
    targetY: y,
    collected: false,
    fall,
    life: 8
  });
}

function updatePlants(dt) {
  state.plants = state.plants.filter((plant) => {
    const data = plantTypes[plant.key];
    if (plant.health <= 0) return false;

    if (plant.key === 'sunflower') {
      plant.sunTimer += dt;
      if (plant.sunTimer >= data.sunRate) {
        plant.sunTimer = 0;
        addSun(plant.x, plant.y - 24, false);
      }
    }

    if (plant.key === 'peashooter') {
      const hasEnemy = state.zombies.some((z) => z.row === plant.row);
      plant.fireTimer += dt;
      if (hasEnemy && plant.fireTimer >= data.fireRate) {
        plant.fireTimer = 0;
        addProjectile(plant.x + 30, plant.y - 10, plant.row, data.damage);
      }
    }

    return true;
  });
}

function updateProjectiles(dt) {
  state.projectiles.forEach((p) => {
    p.x += p.speed * dt;
  });

  state.projectiles = state.projectiles.filter((p) => {
    if (p.x > GRID_COLS * CELL_W) return false;
    const target = state.zombies.find((z) => z.row === p.row && Math.abs(z.x - p.x) < 28);
    if (target) {
      target.health -= p.damage;
      hitSfx.currentTime = 0;
      hitSfx.play();
      return false;
    }
    return true;
  });
}

function updateZombies(dt) {
  state.zombies = state.zombies.filter((zombie) => {
    if (zombie.health <= 0) return false;
    const plant = state.plants.find((p) => p.row === zombie.row && Math.abs(p.x - zombie.x) < 36);
    if (plant) {
      zombie.attackTimer += dt;
      if (zombie.attackTimer >= 0.8) {
        zombie.attackTimer = 0;
        plant.health -= zombieTypes[zombie.type].damage;
      }
    } else {
      zombie.x -= zombie.speed * dt;
    }

    if (zombie.x <= 20) {
      gameOver('僵尸闯入院子了！');
      return false;
    }
    return true;
  });
}

function updateSuns(dt) {
  state.skySunTimer += dt;
  if (state.skySunTimer >= 8) {
    state.skySunTimer = 0;
    const col = Math.floor(Math.random() * GRID_COLS);
    const pos = cellToPosition(Math.floor(Math.random() * GRID_ROWS), col);
    addSun(pos.x, pos.y, true);
  }

  state.suns.forEach((sun) => {
    sun.life -= dt;
    if (sun.fall && sun.y < sun.targetY) {
      sun.y = Math.min(sun.targetY, sun.y + 80 * dt);
    }
  });

  state.suns = state.suns.filter((sun) => sun.life > 0 && !sun.collected);
}

function spawnByLevel(dt) {
  const level = levels[state.levelIndex];
  if (!level) return;
  if (state.spawnIndex >= state.spawnQueue.length) return;
  state.spawnTimer += dt;
  if (state.spawnTimer >= level.spawnEvery) {
    const type = state.spawnQueue[state.spawnIndex];
    state.spawnIndex += 1;
    spawnZombie(type);
    state.spawnTimer = 0;
  }
}

function gameLoop(ts) {
  const dt = Math.min((ts - state.lastTime) / 1000 || 0, 0.05);
  state.lastTime = ts;
  if (state.status === 'playing') {
    spawnByLevel(dt);
    updatePlants(dt);
    updateProjectiles(dt);
    updateZombies(dt);
    updateSuns(dt);
    checkVictory();
  }
  render();
  requestAnimationFrame(gameLoop);
}

function startLevel(index) {
  state.levelIndex = index;
  const config = levels[index];
  state.sun = 150 + config.sunBonus;
  state.plants = [];
  state.zombies = [];
  state.projectiles = [];
  state.suns = [];
  state.selected = null;
  state.spawnIndex = 0;
  state.spawnTimer = 0;
  state.skySunTimer = 0;
  state.status = 'playing';
  state.victoryShown = false;
  state.spawnQueue = buildSpawnQueue(config);
  state.lastTime = performance.now();
  hideBanner();
  refreshPlantBar();
  levelLabelEl.textContent = `${index + 1}/${levels.length} - ${config.name}`;
  ensureMusic();
}

function buildSpawnQueue(config) {
  const queue = [];
  Object.entries(config.zombies).forEach(([type, count]) => {
    for (let i = 0; i < count; i += 1) queue.push(type);
  });
  return queue.sort(() => Math.random() - 0.5);
}

function checkVictory() {
  if (state.spawnIndex >= state.spawnQueue.length && state.zombies.length === 0 && !state.victoryShown) {
    state.victoryShown = true;
    if (state.levelIndex < levels.length - 1) {
      state.status = 'paused';
      showBanner(`第 ${state.levelIndex + 1} 关胜利！`, {
        primary: {
          text: '前往下一关',
          action: () => startLevel(state.levelIndex + 1)
        }
      });
    } else {
      state.status = 'paused';
      showBanner('恭喜通关全部关卡！', {
        primary: {
          text: '再玩一遍',
          action: () => startLevel(0)
        }
      });
    }
  }
}

function gameOver(reason) {
  if (state.status === 'ended') return;
  state.status = 'ended';
  showBanner(`${reason}`, {
    primary: { text: '重试本关', action: () => startLevel(state.levelIndex) },
    secondary: { text: '从头开始', action: () => startLevel(0) }
  });
}

function showBanner(text, actions = {}) {
  messageEl.innerHTML = `
    <div class="banner">
      <div>${text}</div>
      <div style="display:flex; gap:8px;">
        ${actions.primary ? `<button data-action="primary">${actions.primary.text}</button>` : ''}
        ${actions.secondary ? `<button data-action="secondary" class="ghost">${actions.secondary.text}</button>` : ''}
      </div>
    </div>
  `;
  messageEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'primary') actions.primary?.action();
      if (btn.dataset.action === 'secondary') actions.secondary?.action();
    });
  });
}

function hideBanner() {
  messageEl.innerHTML = '';
}

function render() {
  sunCountEl.textContent = Math.floor(state.sun);
  refreshPlantBar();
  entitiesEl.innerHTML = '';

  state.plants.forEach((plant) => {
    const el = document.createElement('div');
    el.className = 'entity plant';
    el.style.left = `${plant.x}px`;
    el.style.top = `${plant.y}px`;
    el.innerHTML = `<img src="${plantTypes[plant.key].img}" alt="${plant.key}">`;
    entitiesEl.appendChild(el);
  });

  state.zombies.forEach((z) => {
    const el = document.createElement('div');
    el.className = 'entity zombie';
    el.style.left = `${z.x}px`;
    el.style.top = `${z.y}px`;
    el.innerHTML = `<img src="${zombieTypes[z.type].img}" alt="zombie">`;
    entitiesEl.appendChild(el);
  });

  state.projectiles.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'entity projectile';
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.innerHTML = '<img src="assets/pea.svg" alt="pea">';
    entitiesEl.appendChild(el);
  });

  state.suns.forEach((sun) => {
    const el = document.createElement('div');
    el.className = 'sun-token';
    el.style.left = `${sun.x}px`;
    el.style.top = `${sun.y}px`;
    el.innerHTML = '<img src="assets/sun.svg" alt="sun">';
    el.addEventListener('click', () => {
      if (sun.collected) return;
      sun.collected = true;
      state.sun += 25;
    });
    entitiesEl.appendChild(el);
  });

  const level = levels[state.levelIndex];
  const progressFill = document.createElement('div');
  progressFill.className = 'status-bar';
  const ratio = state.spawnQueue.length === 0 ? 0 : state.spawnIndex / state.spawnQueue.length;
  progressFill.innerHTML = `
    <div>僵尸进度</div>
    <div class="progress"><div class="fill" style="width:${Math.min(1, ratio) * 100}%"></div></div>
  `;
  entitiesEl.appendChild(progressFill);
}

function ensureMusic() {
  if (music.dataset.started) return;
  music.dataset.started = 'true';
  music.play().catch(() => {});
}

function toggleMusic() {
  if (music.paused) {
    music.play();
    toggleMusicBtn.textContent = '🔈 音乐';
  } else {
    music.pause();
    toggleMusicBtn.textContent = '🔇 静音';
  }
}

function handleInput() {
  gridEl.addEventListener('click', (ev) => {
    const cell = ev.target.closest('.cell');
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    placePlant(row, col);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === '1') state.selected = 'peashooter';
    if (ev.key === '2') state.selected = 'sunflower';
    if (ev.key === '3') state.selected = 'wallnut';
    if (ev.key === ' ') state.selected = null;
    if (ev.key.toLowerCase() === 'r') startLevel(state.levelIndex);
    refreshPlantBar();
  });

  restartBtn.addEventListener('click', () => startLevel(state.levelIndex));
  toggleMusicBtn.addEventListener('click', toggleMusic);
}

function init() {
  setupGrid();
  buildPlantBar();
  handleInput();
  startLevel(0);
  requestAnimationFrame(gameLoop);
}

init();
