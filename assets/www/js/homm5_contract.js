/**
 * Герои Меча и Магии V: Эпоха Грифонов — 3D Мини (RU)
 * Единый архитектурный контракт и реестр данных (SSOT для команды ИИ-агентов)
 * Работает как в браузере (window.HOMM5), так и в Node.js для безголового теста ОТК-1.
 */
(function (root) {
  'use strict';

  const HOMM5 = root.HOMM5 || {};

  // Простая и быстрая шина событий для слабой связности между 3D, CombatCore и UI
  const listeners = {};
  HOMM5.Bus = {
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((cb) => cb !== fn);
    },
    emit(event, payload) {
      if (!listeners[event]) return;
      for (let i = 0; i < listeners[event].length; i++) {
        try {
          listeners[event][i](payload);
        } catch (err) {
          console.error('[HOMM5.Bus] Ошибка обработчика ' + event + ':', err);
        }
      }
    }
  };

  HOMM5.CONFIG = {
    VERSION: '1.0.0-OTK',
    TITLE_RU: 'Герои Меча и Магии V: Эпоха Грифонов — 3D Мини',
    GRID_COLS: 10,
    GRID_ROWS: 8,
    CELL_SIZE: 2.2,
    ATB_QUEUE_SIZE: 8,
    SAVE_KEY_V3: 'homm5_3d_mini_save_v3',
    SAVE_KEY_LEGACY: 'homm5_3d_mini_save_v2',
    IDB_NAME: 'HoMM5MiniDB',
    IDB_STORE: 'saves',

    // Герои на кромке поля боя (ходят по собственной шкале ATB, бессмертны как юнит)
    HEROES: {
      haven_lord: {
        id: 'haven_lord',
        name: 'Лорд Годрик',
        title: 'Рыцарь Ордена Порядка',
        faction: 'haven',
        factionName: 'Орден Порядка',
        icon: '👑',
        color: '#fbbf24',
        attack: 6,
        defense: 7,
        spellPower: 5,
        knowledge: 5,
        maxMana: 50,
        initiative: 10,
        morale: 2,
        luck: 2,
        bio: 'Прославленный полководец Империи Грифона. Его присутствие укрепляет строй латников и дарует благословение Эльрата.'
      },
      inferno_lord: {
        id: 'inferno_lord',
        name: 'Аграил Пепельный',
        title: 'Повелитель Демонов Шио',
        faction: 'inferno',
        factionName: 'Инферно',
        icon: '🔥',
        color: '#ef4444',
        attack: 7,
        defense: 4,
        spellPower: 6,
        knowledge: 4,
        maxMana: 45,
        initiative: 10,
        morale: 1,
        luck: 1,
        bio: 'Вестник пламени Хаоса, ведущий легионы Шио к стенам Когтя Грифона.'
      }
    },

    // Каталог существ (Орден Порядка + Инферно) по мотивам Heroes V
    UNITS: {
      squire: {
        id: 'squire',
        name: 'Латники',
        singular: 'Латник',
        faction: 'haven',
        tier: 2,
        icon: '🛡️',
        accent: '#3b82f6',
        attack: 5,
        defense: 9,
        minDmg: 2,
        maxDmg: 5,
        hp: 26,
        initiative: 8,
        speed: 4,
        isRanged: false,
        isFlying: false,
        shots: 0,
        infiniteRetaliation: false,
        costGold: 75,
        costCrystal: 0,
        abilityName: 'Большой щит и Оглушение',
        abilityDesc: 'Снижает входящий стрелковый урон на 35%. Имеет 25% шанс оглушить врага (сдвиг ATB назад на 0.30).'
      },
      crossbowman: {
        id: 'crossbowman',
        name: 'Арбалетчики',
        singular: 'Арбалетчик',
        faction: 'haven',
        tier: 3,
        icon: '🏹',
        accent: '#60a5fa',
        attack: 8,
        defense: 4,
        minDmg: 4,
        maxDmg: 8,
        hp: 16,
        initiative: 9,
        speed: 4,
        isRanged: true,
        isFlying: false,
        shots: 10,
        noRangePenalty: true,
        infiniteRetaliation: false,
        costGold: 110,
        costCrystal: 0,
        abilityName: 'Точный выстрел',
        abilityDesc: 'Стреляет через всё поле без штрафа расстояния. В ближнем бою наносит лишь 50% урона.'
      },
      griffin: {
        id: 'griffin',
        name: 'Королевские Грифоны',
        singular: 'Королевский Грифон',
        faction: 'haven',
        tier: 4,
        icon: '🦅',
        accent: '#f59e0b',
        attack: 11,
        defense: 9,
        minDmg: 7,
        maxDmg: 14,
        hp: 42,
        initiative: 13,
        speed: 7,
        isRanged: false,
        isFlying: true,
        shots: 0,
        infiniteRetaliation: true,
        costGold: 260,
        costCrystal: 1,
        abilityName: 'Полёт и Бесконечный отпор',
        abilityDesc: 'Перелетает любые преграды на поле боя и отвечает на каждую атаку врагов без ограничений.'
      },
      paladin: {
        id: 'paladin',
        name: 'Паладины Света',
        singular: 'Паладин Света',
        faction: 'haven',
        tier: 6,
        icon: '⚔️',
        accent: '#fde047',
        attack: 18,
        defense: 17,
        minDmg: 18,
        maxDmg: 28,
        hp: 105,
        initiative: 12,
        speed: 6,
        isRanged: false,
        isFlying: false,
        shots: 0,
        joustingBonus: true,
        infiniteRetaliation: false,
        costGold: 850,
        costCrystal: 2,
        abilityName: 'Рыцарский разбег',
        abilityDesc: 'Каждая пройденная клетка перед ударом увеличивает урон на +8% (до +48%). Невосприимчив к страху.'
      },

      // Фракция врага: Инферно
      imp: {
        id: 'imp',
        name: 'Черти-Пожиратели',
        singular: 'Чёрт',
        faction: 'inferno',
        tier: 1,
        icon: '😈',
        accent: '#f87171',
        attack: 4,
        defense: 3,
        minDmg: 2,
        maxDmg: 4,
        hp: 12,
        initiative: 11,
        speed: 5,
        isRanged: false,
        isFlying: false,
        shots: 0,
        manaSteal: 3,
        infiniteRetaliation: false,
        costGold: 45,
        costCrystal: 0,
        abilityName: 'Кража маны',
        abilityDesc: 'При атаке выжигает часть маны вражеского героя.'
      },
      hellhound: {
        id: 'hellhound',
        name: 'Церберы Шио',
        singular: 'Цербер',
        faction: 'inferno',
        tier: 3,
        icon: '🐺',
        accent: '#fb923c',
        attack: 10,
        defense: 6,
        minDmg: 5,
        maxDmg: 10,
        hp: 28,
        initiative: 13,
        speed: 7,
        isRanged: false,
        isFlying: false,
        shots: 0,
        noRetaliationAttack: true,
        infiniteRetaliation: false,
        costGold: 150,
        costCrystal: 0,
        abilityName: 'Молниеносный укус',
        abilityDesc: 'Стремительный бросок: вражеский отряд не успевает нанести ответный удар.'
      },
      succubus: {
        id: 'succubus',
        name: 'Демонессы Пламени',
        singular: 'Демонесса',
        faction: 'inferno',
        tier: 4,
        icon: '🔮',
        accent: '#ec4899',
        attack: 10,
        defense: 7,
        minDmg: 7,
        maxDmg: 13,
        hp: 30,
        initiative: 10,
        speed: 4,
        isRanged: true,
        isFlying: false,
        shots: 8,
        noRangePenalty: false,
        infiniteRetaliation: false,
        costGold: 240,
        costCrystal: 1,
        abilityName: 'Цепной огонь',
        abilityDesc: 'Мечет сгустки адского пламени по дальнобойным и пешим целям.'
      },
      pitlord: {
        id: 'pitlord',
        name: 'Пещерные Владыки',
        singular: 'Пещерный Владыка',
        faction: 'inferno',
        tier: 6,
        icon: '👹',
        accent: '#dc2626',
        attack: 19,
        defense: 16,
        minDmg: 19,
        maxDmg: 31,
        hp: 120,
        initiative: 9,
        speed: 5,
        isRanged: false,
        isFlying: false,
        shots: 0,
        cleaveBurn: true,
        infiniteRetaliation: false,
        costGold: 920,
        costCrystal: 2,
        abilityName: 'Клинок Погибели',
        abilityDesc: 'Тяжёлый огненный меч обжигает цель дополнительным чистым уроном пламени (+20%).'
      }
    },

    // Книга Магии (Свет и Хаос)
    SPELLS: {
      righteous_might: {
        id: 'righteous_might',
        name: 'Карающий Удар',
        school: 'Магия Света',
        icon: '✨',
        manaCost: 8,
        targetType: 'ally',
        color: '#fde047',
        desc: 'Благословляет союзный отряд на 3 хода: +6 к Атаке и максимальный базовый урон при каждом ударе.'
      },
      divine_shield: {
        id: 'divine_shield',
        name: 'Небесный Щит',
        school: 'Магия Света',
        icon: '🛡️',
        manaCost: 9,
        targetType: 'ally',
        color: '#60a5fa',
        desc: 'Окружает союзный отряд куполом Эльрата на 3 хода: +8 к Защите и снижение любого урона на 25%.'
      },
      holy_light: {
        id: 'holy_light',
        name: 'Святое Воскрешение',
        school: 'Магия Света',
        icon: '💖',
        manaCost: 14,
        targetType: 'ally',
        color: '#34d399',
        desc: 'Исцеляет раны и поднимает павших воинов союзного отряда в объёме (45 + 22 × Сила Магии) ОЗ.'
      },
      fireball: {
        id: 'fireball',
        name: 'Огненный Шар',
        school: 'Магия Хаоса',
        icon: '☄️',
        manaCost: 15,
        targetType: 'area3x3',
        color: '#f97316',
        desc: 'Обрушивает пылающий метеор на квадрат 3×3 клетки, нанося (28 + 18 × Сила Магии) урона огнём всем отрядам в зоне.'
      }
    },

    // Постройки 3D-замка Ордена Порядка «Коготь Грифона»
    BUILDINGS: {
      barracks: {
        id: 'barracks',
        name: 'Казармы Пехоты',
        icon: '🛡️',
        unlocksUnit: 'squire',
        builtByDefault: true,
        costGold: 0,
        costCrystal: 0,
        weeklyGrowth: 12,
        desc: 'Оплот щитоносцев Империи. Позволяет нанимать закалённых Латников.'
      },
      marksmen_tower: {
        id: 'marksmen_tower',
        name: 'Стрелковая Башня',
        icon: '🏹',
        unlocksUnit: 'crossbowman',
        builtByDefault: true,
        costGold: 400,
        costCrystal: 0,
        weeklyGrowth: 9,
        desc: 'Высокая башня с бойницами, где несут службу меткие Арбалетчики.'
      },
      griffin_bastion: {
        id: 'griffin_bastion',
        name: 'Бастион Грифонов',
        icon: '🦅',
        unlocksUnit: 'griffin',
        builtByDefault: false,
        costGold: 800,
        costCrystal: 2,
        weeklyGrowth: 5,
        desc: 'Небесное гнездовье на вершине скалы. Открывает наём Королевских Грифонов.'
      },
      cathedral_of_light: {
        id: 'cathedral_of_light',
        name: 'Собор Эльрата',
        icon: '⚔️',
        unlocksUnit: 'paladin',
        builtByDefault: false,
        costGold: 1400,
        costCrystal: 4,
        weeklyGrowth: 2,
        bonusSpellPower: 2,
        desc: 'Величественный храм Света. Открывает наём Паладинов и даёт Лорду Годрику +2 к Силе Магии.'
      }
    },

    // 3 тактические миссии и интерактивные точки в долине вокруг замка
    VALLEY_NODES: [
      {
        id: 'chest_1',
        type: 'treasure',
        name: 'Королевский Сундук',
        icon: '💰',
        pos3d: [-11, 0.6, 8],
        goldReward: 950,
        xpHeroBonus: { attack: 1, spellPower: 1 },
        desc: 'Древний ларец Ордена: выберите 950 Золота в казну замка или реликвию опыта (+1 Атака и +1 Сила Магии герою).'
      },
      {
        id: 'crystal_shrine',
        type: 'crystal_mine',
        name: 'Кристальная Жила Эльрата',
        icon: '💎',
        pos3d: [12, 0.6, 7],
        crystalReward: 5,
        goldReward: 400,
        desc: 'Захват сверкающей жилы приносит +5 Кристаллов Света и +400 Золота для возведения Бастиона и Собора.'
      },
      {
        id: 'mission_1',
        type: 'battle',
        missionIndex: 1,
        name: 'Миссия I: Дозор у Пограничной Заставы',
        difficulty: 'Разведка ★☆☆',
        icon: '⚔️',
        pos3d: [-6, 0.8, 14],
        rewardGold: 1100,
        rewardCrystal: 3,
        obstacles: [
          { col: 4, row: 2, kind: 'pillar' },
          { col: 5, row: 5, kind: 'rock' }
        ],
        enemies: [
          { unitId: 'imp', count: 22, col: 8, row: 1 },
          { unitId: 'hellhound', count: 8, col: 8, row: 4 },
          { unitId: 'imp', count: 18, col: 8, row: 6 }
        ],
        desc: 'Авангард Чертей и Церберов прорвал заставу. Разгромите разведчиков Шио!'
      },
      {
        id: 'mission_2',
        type: 'battle',
        missionIndex: 2,
        name: 'Миссия II: Осада Пепельных Руин',
        difficulty: 'Ветеран ★★☆',
        icon: '🔥',
        pos3d: [4, 0.9, 16],
        rewardGold: 1850,
        rewardCrystal: 5,
        obstacles: [
          { col: 4, row: 1, kind: 'ruin' },
          { col: 4, row: 4, kind: 'lava_crag' },
          { col: 5, row: 6, kind: 'pillar' }
        ],
        enemies: [
          { unitId: 'hellhound', count: 14, col: 8, row: 1 },
          { unitId: 'succubus', count: 11, col: 9, row: 3 },
          { unitId: 'succubus', count: 9, col: 9, row: 5 },
          { unitId: 'imp', count: 32, col: 8, row: 6 }
        ],
        desc: 'Демонессы Пламени укрепились за древними колоннами. Используйте Грифонов и Небесный Щит!'
      },
      {
        id: 'mission_3',
        type: 'battle',
        missionIndex: 3,
        name: 'Миссия III: Генеральная Битва с Аграилом',
        difficulty: 'Героический ★★★',
        icon: '👹',
        pos3d: [13, 1.2, 15],
        rewardGold: 3500,
        rewardCrystal: 10,
        obstacles: [
          { col: 4, row: 2, kind: 'lava_crag' },
          { col: 5, row: 3, kind: 'ruin' },
          { col: 4, row: 5, kind: 'lava_crag' }
        ],
        enemies: [
          { unitId: 'hellhound', count: 20, col: 8, row: 0 },
          { unitId: 'succubus', count: 16, col: 9, row: 2 },
          { unitId: 'pitlord', count: 4, col: 8, row: 4 },
          { unitId: 'succubus', count: 14, col: 9, row: 5 },
          { unitId: 'imp', count: 45, col: 8, row: 7 }
        ],
        desc: 'Сам Повелитель Демонов Аграил вывел Пещерных Владык к вратам замка. Решающее сражение за Асхан!'
      }
    ]
  };

  root.HOMM5 = HOMM5;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HOMM5;
  }
})(typeof window !== 'undefined' ? window : globalThis);
