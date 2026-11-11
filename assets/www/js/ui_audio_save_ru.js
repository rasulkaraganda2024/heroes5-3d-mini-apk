/**
 * Герои Меча и Магии V: Эпоха Грифонов — 3D Мини
 * ui_audio_save_ru.js — Модули SaveV3, Audio и UI (100% Русский интерфейс и Лор)
 *
 * Содержит:
 *  1. window.HOMM5.SaveV3 — Строгий стандарт Save Engine v3 (Dual-Layer: LocalStorage + IndexedDB + Монотонное слияние)
 *  2. window.HOMM5.Audio  — Процедурный WebAudio синтезатор (0 внешних mp3, атмосфера замка, марш боя, 12 SFX, виброотклик)
 *  3. window.HOMM5.UI     — Связующий контроллер королевского интерфейса (HUD, ATB-лента, Журнал боя, 7 модалок, PWA / APK)
 */
(function (root) {
  'use strict';

  let HOMM5 = root.HOMM5;
  if (!HOMM5 && typeof require !== 'undefined') {
    try {
      HOMM5 = require('./homm5_contract.js');
    } catch {
      // Игнорируем в изолированных средах
    }
  }
  HOMM5 = HOMM5 || root.HOMM5 || {};

  const Bus = HOMM5.Bus || {
    on() {},
    off() {},
    emit() {}
  };
  const CFG = HOMM5.CONFIG || {};

  // Безопасный перехват события установки PWA
  let deferredInstallPrompt = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const btn = document.getElementById('btn-open-install');
      if (btn) btn.style.display = 'inline-flex';
    });
  }

  // Безопасный тактильный виброотклик для смартфонов (Android)
  function triggerVibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Игнорируем устройства без поддержки вибро
    }
  }

  function normalizeArmyToDict(army) {
    const dict = { squire: 0, crossbowman: 0, griffin: 0, paladin: 0 };
    if (!army) return dict;
    if (Array.isArray(army)) {
      for (let i = 0; i < army.length; i++) {
        const s = army[i];
        if (s && s.id) dict[s.id] = (dict[s.id] || 0) + (s.count || 0);
      }
    } else if (typeof army === 'object') {
      const keys = Object.keys(army);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        dict[k] = Math.max(dict[k] || 0, Number(army[k]) || 0);
      }
    }
    return dict;
  }

  /* ==========================================================================
     1. window.HOMM5.SaveV3 — Dual-Layer Persistence (Save Engine v3)
     ========================================================================== */
  const SaveV3 = {
    KEY_V3: (CFG && CFG.SAVE_KEY_V3) || 'homm5_3d_mini_save_v3',
    KEY_LEGACY: (CFG && CFG.SAVE_KEY_LEGACY) || 'homm5_3d_mini_save_v2',
    IDB_NAME: (CFG && CFG.IDB_NAME) || 'HoMM5MiniDB',
    IDB_STORE: (CFG && CFG.IDB_STORE) || 'saves',
    _dbPromise: null,
    _currentData: null,

    /**
     * Создание чистого начального профиля кампании «Эпоха Грифонов» (без вызова ядровой кампании во избежание рекурсии)
     */
    getDefaultSave() {
      const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
      const startPos = advCfg.startPos || { x: 0, z: 6.5 };
      const baseMp = Number(advCfg.baseMovePoints) || 12;
      const defaultRevealed = {};
      const sectors = advCfg.fogSectors || [];
      if (sectors.length > 0) {
        sectors.forEach((sec) => {
          defaultRevealed[sec.id] = !!sec.defaultRevealed;
        });
      } else {
        defaultRevealed.sector_castle_gate = true;
        defaultRevealed.sector_west_woods = true;
        defaultRevealed.sector_east_crystals = true;
        defaultRevealed.sector_ashen_ruins = false;
        defaultRevealed.sector_citadel_ash = false;
      }

      return {
        version: '3.0.0',
        timestamp: Date.now(),
        gold: 1650,
        crystals: 3,
        day: 1,
        week: 1,
        maxUnlockedMission: 1,
        victories: 0,
        bestStarsByMission: { 1: 0, 2: 0, 3: 0, 4: 0 },
        hero: {
          id: 'haven_lord',
          name: 'Лорд Годрик',
          faction: 'haven',
          icon: '👑',
          attack: 6,
          defense: 7,
          spellPower: 5,
          knowledge: 5,
          maxMana: 50,
          mana: 50,
          initiative: 10,
          morale: 2,
          luck: 2,
          level: 1,
          xp: 0,
          skillPoints: 1,
          unlockedSkills: []
        },
        ownedArtifacts: [],
        equippedArtifacts: {
          weapon: null,
          shield: null,
          helm: null,
          boots: null
        },
        capturedMines: {},
        revealedSectors: defaultRevealed,
        heroPos: { x: Number(startPos.x) || 0, z: Number(startPos.z) || 6.5 },
        movePoints: baseMp,
        maxMovePoints: baseMp,
        buildings: {
          barracks: true,
          marksmen_tower: true,
          griffin_bastion: false,
          cathedral_of_light: false
        },
        dwellingsAvailable: {
          squire: 18,
          crossbowman: 12,
          griffin: 5,
          paladin: 2
        },
        army: {
          squire: 24,
          crossbowman: 14,
          griffin: 3,
          paladin: 0
        },
        completedNodes: {}
      };
    },

    /**
     * Монотонное аддитивное слияние двух сохранений (Правило Save Engine v3).
     * Прогресс игрока НИКОГДА не затирается меньшими значениями!
     */
    mergeSaveData(a, b) {
      if (!a && !b) return this.getDefaultSave();
      const res = this.getDefaultSave();
      if (!a) return this.mergeSaveData(res, b);
      if (!b) return this.mergeSaveData(res, a);

      const tsA = Number(a.timestamp) || 0;
      const tsB = Number(b.timestamp) || 0;
      const bIsNewer = tsB >= tsA;
      const newer = bIsNewer ? b : a;
      const older = bIsNewer ? a : b;

      res.maxUnlockedMission = Math.max(a.maxUnlockedMission || 1, b.maxUnlockedMission || 1);
      res.victories = Math.max(a.victories || 0, b.victories || 0);

      const starsA = a.bestStarsByMission || {};
      const starsB = b.bestStarsByMission || {};
      res.bestStarsByMission = {
        1: Math.max(starsA[1] || 0, starsB[1] || 0),
        2: Math.max(starsA[2] || 0, starsB[2] || 0),
        3: Math.max(starsA[3] || 0, starsB[3] || 0),
        4: Math.max(starsA[4] || 0, starsB[4] || 0)
      };

      res.gold = Math.max(a.gold ?? 1650, b.gold ?? 1650);
      res.crystals = Math.max(a.crystals ?? 3, b.crystals ?? 3);
      res.week = Math.max(a.week || 1, b.week || 1);
      res.day = Math.max(a.day || 1, b.day || 1);

      const hA = a.hero || {};
      const hB = b.hero || {};
      const aSkills = Array.isArray(hA.unlockedSkills) ? hA.unlockedSkills : [];
      const bSkills = Array.isArray(hB.unlockedSkills) ? hB.unlockedSkills : [];
      const mergedSkills = Array.from(new Set([...aSkills, ...bSkills])).filter(Boolean);

      const hasModernSpA = typeof hA.skillPoints === 'number' && !Number.isNaN(hA.skillPoints);
      const hasModernSpB = typeof hB.skillPoints === 'number' && !Number.isNaN(hB.skillPoints);
      let mergedSkillPoints = 1;
      if (hasModernSpA && hasModernSpB) {
        mergedSkillPoints = Math.max(0, bIsNewer ? hB.skillPoints : hA.skillPoints);
      } else if (hasModernSpB) {
        mergedSkillPoints = Math.max(0, hB.skillPoints);
      } else if (hasModernSpA) {
        mergedSkillPoints = Math.max(0, hA.skillPoints);
      } else {
        const mergedLvl = Math.max(hA.level || 1, hB.level || 1);
        mergedSkillPoints = Math.max(1, mergedLvl - mergedSkills.length);
      }

      res.hero = {
        id: 'haven_lord',
        name: 'Лорд Годрик',
        faction: 'haven',
        icon: '👑',
        level: Math.max(hA.level || 1, hB.level || 1),
        xp: Math.max(hA.xp || 0, hB.xp || 0),
        attack: Math.max(hA.attack || 6, hB.attack || 6),
        defense: Math.max(hA.defense || 7, hB.defense || 7),
        spellPower: Math.max(hA.spellPower || 5, hB.spellPower || 5),
        knowledge: Math.max(hA.knowledge || 5, hB.knowledge || 5),
        maxMana: Math.max(hA.maxMana || 50, hB.maxMana || 50),
        mana: Math.max(hA.mana || 50, hB.mana || 50),
        initiative: Math.max(hA.initiative || 10, hB.initiative || 10),
        morale: Math.max(hA.morale || 2, hB.morale || 2),
        luck: Math.max(hA.luck || 2, hB.luck || 2),
        skillPoints: mergedSkillPoints,
        unlockedSkills: mergedSkills
      };
      if (res.hero.mana > res.hero.maxMana) res.hero.mana = res.hero.maxMana;

      const artA = Array.isArray(a.ownedArtifacts) ? a.ownedArtifacts : [];
      const artB = Array.isArray(b.ownedArtifacts) ? b.ownedArtifacts : [];
      res.ownedArtifacts = Array.from(new Set([...artA, ...artB])).filter(Boolean);

      const eqNew = newer.equippedArtifacts || {};
      const eqOld = older.equippedArtifacts || {};
      const eqRes = { weapon: null, shield: null, helm: null, boots: null };
      ['weapon', 'shield', 'helm', 'boots'].forEach((slot) => {
        const chosen = (slot in eqNew && eqNew[slot] !== undefined)
          ? (eqNew[slot] || eqOld[slot] || null)
          : (eqOld[slot] || null);
        eqRes[slot] = chosen;
        if (chosen && !res.ownedArtifacts.includes(chosen)) {
          res.ownedArtifacts.push(chosen);
        }
      });
      res.equippedArtifacts = eqRes;

      const minesA = a.capturedMines || {};
      const minesB = b.capturedMines || {};
      const mergedMines = {};
      Object.keys(Object.assign({}, minesA, minesB)).forEach((mKey) => {
        if (minesA[mKey] || minesB[mKey]) mergedMines[mKey] = true;
      });
      res.capturedMines = mergedMines;

      const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
      const revA = a.revealedSectors || {};
      const revB = b.revealedSectors || {};
      const mergedSectors = Object.assign({}, res.revealedSectors);
      Object.keys(Object.assign({}, mergedSectors, revA, revB)).forEach((sKey) => {
        mergedSectors[sKey] = !!(res.revealedSectors[sKey] || revA[sKey] || revB[sKey]);
      });
      (advCfg.fogSectors || []).forEach((sec) => {
        if (sec.defaultRevealed) mergedSectors[sec.id] = true;
      });
      res.revealedSectors = mergedSectors;

      const startPos = advCfg.startPos || [0, 6.5];
      const defX = Array.isArray(startPos) ? Number(startPos[0]) || 0 : Number(startPos.x) || 0;
      const defZ = Array.isArray(startPos) ? Number(startPos[1]) || 6.5 : Number(startPos.z) || 6.5;
      const posNew = newer.heroPos || older.heroPos || startPos;
      const rawX = Array.isArray(posNew) ? Number(posNew[0]) : Number(posNew.x);
      const rawZ = Array.isArray(posNew) ? Number(posNew[1]) : Number(posNew.z);
      const safeX = Number.isFinite(rawX) ? rawX : defX;
      const safeZ = Number.isFinite(rawZ) ? rawZ : defZ;
      res.heroPos = Array.isArray(newer.heroPos || older.heroPos)
        ? [safeX, safeZ]
        : { x: safeX, z: safeZ };

      const baseMp = Number(advCfg.baseMovePoints) || 12;
      const rawMaxMp = (typeof newer.maxMovePoints === 'number' && Number.isFinite(newer.maxMovePoints))
        ? newer.maxMovePoints
        : ((typeof older.maxMovePoints === 'number' && Number.isFinite(older.maxMovePoints)) ? older.maxMovePoints : baseMp);
      res.maxMovePoints = Math.max(baseMp, rawMaxMp);

      const rawMp = (typeof newer.movePoints === 'number' && Number.isFinite(newer.movePoints))
        ? newer.movePoints
        : ((typeof older.movePoints === 'number' && Number.isFinite(older.movePoints)) ? older.movePoints : res.maxMovePoints);
      res.movePoints = Math.max(0, Math.min(res.maxMovePoints, rawMp));

      const bA = a.buildings || {};
      const bB = b.buildings || {};
      res.buildings = {
        barracks: true,
        marksmen_tower: true,
        griffin_bastion: !!(bA.griffin_bastion || bB.griffin_bastion),
        cathedral_of_light: !!(bA.cathedral_of_light || bB.cathedral_of_light)
      };

      const dwA = a.dwellingsAvailable || a.recruitsAvailable || {};
      const dwB = b.dwellingsAvailable || b.recruitsAvailable || {};
      res.dwellingsAvailable = {
        squire: Math.max(dwA.squire ?? 18, dwB.squire ?? 18),
        crossbowman: Math.max(dwA.crossbowman ?? 12, dwB.crossbowman ?? 12),
        griffin: Math.max(dwA.griffin ?? 5, dwB.griffin ?? 5),
        paladin: Math.max(dwA.paladin ?? 2, dwB.paladin ?? 2)
      };

      const armA = normalizeArmyToDict(a.army);
      const armB = normalizeArmyToDict(b.army);
      res.army = {
        squire: Math.max(armA.squire, armB.squire),
        crossbowman: Math.max(armA.crossbowman, armB.crossbowman),
        griffin: Math.max(armA.griffin, armB.griffin),
        paladin: Math.max(armA.paladin, armB.paladin)
      };

      res.completedNodes = Object.assign({}, a.completedNodes || a.valleyNodesVisited || {}, b.completedNodes || b.valleyNodesVisited || {});

      res.timestamp = Date.now();
      return res;
    },

    _openIDB() {
      if (this._dbPromise) return this._dbPromise;
      if (typeof indexedDB === 'undefined') {
        this._dbPromise = Promise.resolve(null);
        return this._dbPromise;
      }
      this._dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(this.IDB_NAME, 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(this.IDB_STORE)) {
              db.createObjectStore(this.IDB_STORE);
            }
          };
          req.onsuccess = (e) => resolve(e.target.result);
          req.onerror = () => resolve(null);
        } catch (err) {
          console.warn('[SaveV3] Ошибка инициализации IndexedDB:', err);
          resolve(null);
        }
      });
      return this._dbPromise;
    },

    async _loadFromIDB() {
      const db = await this._openIDB();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(this.IDB_STORE, 'readonly');
          const store = tx.objectStore(this.IDB_STORE);
          const req = store.get('main');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },

    async _saveToIDB(data) {
      const db = await this._openIDB();
      if (!db) return;
      try {
        const tx = db.transaction(this.IDB_STORE, 'readwrite');
        const store = tx.objectStore(this.IDB_STORE);
        store.put(data, 'main');
      } catch (err) {
        console.warn('[SaveV3] Ошибка записи в IndexedDB:', err);
      }
    },

    _loadFromLocalStorage() {
      if (typeof localStorage === 'undefined') return null;
      try {
        const raw = localStorage.getItem(this.KEY_V3) || localStorage.getItem(this.KEY_LEGACY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('[SaveV3] Ошибка чтения LocalStorage:', err);
        return null;
      }
    },

    _saveToLocalStorage(data) {
      if (typeof localStorage === 'undefined') return;
      try {
        const str = JSON.stringify(data);
        localStorage.setItem(this.KEY_V3, str);
        localStorage.setItem(this.KEY_LEGACY, str);
      } catch (err) {
        console.warn('[SaveV3] Ошибка записи LocalStorage:', err);
      }
    },

    async initSaveSystem() {
      const lsData = this._loadFromLocalStorage();
      const idbData = await this._loadFromIDB();

      const def = this.getDefaultSave();
      this._currentData = this.mergeSaveData(lsData || def, idbData);

      // Синхронизируем с CombatCore как единым источником правды
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.loadCampaignState === 'function') {
        this._currentData = HOMM5.CombatCore.loadCampaignState(this._currentData);
      }

      this._saveToLocalStorage(this._currentData);
      this._saveToIDB(this._currentData);

      if (typeof window !== 'undefined') {
        const autoSave = () => this.saveCurrentState();
        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') autoSave();
        });
        window.addEventListener('pagehide', autoSave);
        window.addEventListener('beforeunload', autoSave);
      }

      Bus.emit('save:loaded', this._currentData);
      return this._currentData;
    },

    getSaveData() {
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.getCampaignState === 'function') {
        return HOMM5.CombatCore.getCampaignState();
      }
      if (!this._currentData) {
        this._currentData = this._loadFromLocalStorage() || this.getDefaultSave();
      }
      return this._currentData;
    },

    saveCurrentState(patch) {
      if (patch) {
        this._currentData = this.mergeSaveData(this._currentData, patch);
      } else if (HOMM5.CombatCore && typeof HOMM5.CombatCore.getCampaignState === 'function') {
        this._currentData = this.mergeSaveData(this._currentData, HOMM5.CombatCore.getCampaignState());
      }
      if (!this._currentData) this._currentData = this.getDefaultSave();
      this._currentData.timestamp = Date.now();
      this._saveToLocalStorage(this._currentData);
      this._saveToIDB(this._currentData);
      Bus.emit('save:updated', this._currentData);
      return this._currentData;
    },

    exportSaveJSON() {
      const data = this.getSaveData();
      const jsonStr = JSON.stringify(data, null, 2);
      const b64 = typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(jsonStr))) : '';

      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(b64).catch(() => {});
      }

      if (typeof document !== 'undefined') {
        try {
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const dateStr = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `homm5_save_${dateStr}.json`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }, 200);
        } catch (err) {
          console.warn('[SaveV3] Ошибка скачивания файла:', err);
        }
      }

      return { json: jsonStr, base64: b64 };
    },

    importSaveJSON(rawText) {
      if (!rawText || typeof rawText !== 'string') {
        throw new Error('Указана пустая строка сохранения');
      }
      let parsed = null;
      const clean = rawText.trim();

      try {
        parsed = JSON.parse(clean);
      } catch {
        try {
          const decoded = typeof atob !== 'undefined' ? decodeURIComponent(escape(atob(clean))) : '';
          parsed = JSON.parse(decoded);
        } catch {
          throw new Error('Не удалось распознать формат файла (требуется JSON или Base64)');
        }
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Некорректная структура данных сохранения');
      }

      this._currentData = this.mergeSaveData(this._currentData, parsed);
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.loadCampaignState === 'function') {
        this._currentData = HOMM5.CombatCore.loadCampaignState(this._currentData);
      }
      this._saveToLocalStorage(this._currentData);
      this._saveToIDB(this._currentData);

      Bus.emit('save:imported', this._currentData);
      Bus.emit('save:updated', this._currentData);
      return this._currentData;
    },

    resetSaveData() {
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.createDefaultCampaign === 'function') {
        this._currentData = HOMM5.CombatCore.createDefaultCampaign();
      } else {
        this._currentData = this.getDefaultSave();
      }
      this._saveToLocalStorage(this._currentData);
      this._saveToIDB(this._currentData);
      Bus.emit('save:updated', this._currentData);
      return this._currentData;
    }
  };

  /* ==========================================================================
     2. window.HOMM5.Audio — Процедурный WebAudio Синтезатор (0 внешних mp3)
     ========================================================================== */
  const Audio = {
    ctx: null,
    masterGain: null,
    isMutedState: true,
    isMusicEnabled: false,
    currentTheme: null,
    _themeTimer: null,

    initContext() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return this.ctx;
      }
      const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AudioCtx) return null;

      try {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMutedState ? 0 : 0.65, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      } catch (err) {
        console.warn('[Audio] Не удалось запустить AudioContext:', err);
      }
      return this.ctx;
    },

    toggleMute() {
      this.isMutedState = !this.isMutedState;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(this.isMutedState ? 0 : 0.65, this.ctx.currentTime);
      }
      return this.isMutedState;
    },

    isMuted() {
      return this.isMutedState;
    },

    _createNoiseBuffer(durationSec = 1.0) {
      if (!this.ctx) return null;
      const bufferSize = Math.floor(this.ctx.sampleRate * durationSec);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      return buffer;
    },

    playSFX(type) {
      if (this.isMutedState) return;
      const ctx = this.initContext();
      if (!ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;

      switch (type) {
        case 'click': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1400, now);
          osc.frequency.exponentialRampToValueAtTime(800, now + 0.03);
          gain.gain.setValueAtTime(0.2, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.03);
          break;
        }

        case 'build': {
          const freqs = [440, 880, 1318, 1760];
          freqs.forEach((f, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.setValueAtTime(f, now);
            gain.gain.setValueAtTime(0.3 / (idx + 1), now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 1.8);
          });
          break;
        }

        case 'recruit': {
          const noise = ctx.createBufferSource();
          noise.buffer = this._createNoiseBuffer(0.3);
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(2200, now);
          filter.Q.setValueAtTime(4.0, now);

          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);

          noise.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          noise.start(now);

          const osc = ctx.createOscillator();
          const oscGain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, now + 0.05);
          osc.frequency.exponentialRampToValueAtTime(540, now + 0.35);
          oscGain.gain.setValueAtTime(0.25, now + 0.05);
          oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
          osc.connect(oscGain);
          oscGain.connect(this.masterGain);
          osc.start(now + 0.05);
          osc.stop(now + 0.35);
          break;
        }

        case 'move': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(140, now);
          osc.frequency.exponentialRampToValueAtTime(45, now + 0.12);
          gain.gain.setValueAtTime(0.3, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.12);
          break;
        }

        case 'sword': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(520, now);
          osc.frequency.exponentialRampToValueAtTime(120, now + 0.22);
          gain.gain.setValueAtTime(0.4, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.22);

          const noise = ctx.createBufferSource();
          noise.buffer = this._createNoiseBuffer(0.18);
          const filter = ctx.createBiquadFilter();
          filter.type = 'highpass';
          filter.frequency.setValueAtTime(1600, now);
          const nGain = ctx.createGain();
          nGain.gain.setValueAtTime(0.4, now);
          nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
          noise.connect(filter);
          filter.connect(nGain);
          nGain.connect(this.masterGain);
          noise.start(now);
          break;
        }

        case 'arrow': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(620, now);
          osc.frequency.exponentialRampToValueAtTime(160, now + 0.09);
          gain.gain.setValueAtTime(0.45, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.09);

          const whistle = ctx.createOscillator();
          const wGain = ctx.createGain();
          whistle.type = 'sine';
          whistle.frequency.setValueAtTime(1900, now + 0.04);
          whistle.frequency.exponentialRampToValueAtTime(1100, now + 0.28);
          wGain.gain.setValueAtTime(0.15, now + 0.04);
          wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
          whistle.connect(wGain);
          wGain.connect(this.masterGain);
          whistle.start(now + 0.04);
          whistle.stop(now + 0.28);
          break;
        }

        case 'griffin': {
          const screech = ctx.createOscillator();
          const gain = ctx.createGain();
          screech.type = 'sawtooth';
          screech.frequency.setValueAtTime(950, now);
          screech.frequency.linearRampToValueAtTime(1450, now + 0.18);
          screech.frequency.exponentialRampToValueAtTime(650, now + 0.45);

          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(1200, now);
          filter.Q.setValueAtTime(3.0, now);

          gain.gain.setValueAtTime(0.35, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

          screech.connect(filter);
          filter.connect(gain);
          gain.connect(this.masterGain);
          screech.start(now);
          screech.stop(now + 0.45);
          break;
        }

        case 'crit': {
          const triad = [523.25, 659.25, 783.99, 1046.5];
          triad.forEach((freq) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 0.65);
          });
          break;
        }

        case 'spell_light': {
          const notes = [440, 554, 659, 880, 1108, 1318];
          notes.forEach((freq, idx) => {
            const noteStart = now + idx * 0.05;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, noteStart);
            gain.gain.setValueAtTime(0.2, noteStart);
            gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.55);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(noteStart);
            osc.stop(noteStart + 0.55);
          });
          break;
        }

        case 'fireball': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.exponentialRampToValueAtTime(35, now + 0.55);
          gain.gain.setValueAtTime(0.55, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 0.55);

          const noise = ctx.createBufferSource();
          noise.buffer = this._createNoiseBuffer(0.6);
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(800, now);
          filter.frequency.exponentialRampToValueAtTime(100, now + 0.6);
          const nGain = ctx.createGain();
          nGain.gain.setValueAtTime(0.5, now);
          nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
          noise.connect(filter);
          filter.connect(nGain);
          nGain.connect(this.masterGain);
          noise.start(now);
          break;
        }

        case 'victory': {
          const melody = [
            { f: 523.25, d: 0.18 },
            { f: 523.25, d: 0.18 },
            { f: 523.25, d: 0.18 },
            { f: 659.25, d: 0.45 },
            { f: 783.99, d: 0.65 }
          ];
          let offset = 0;
          melody.forEach((note) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(note.f, now + offset);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1600, now + offset);

            gain.gain.setValueAtTime(0.3, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + note.d);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now + offset);
            osc.stop(now + offset + note.d);

            offset += note.d * 0.9;
          });
          break;
        }

        case 'defeat': {
          const somber = [440, 415.3, 392, 349.23];
          let off = 0;
          somber.forEach((f) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, now + off);
            gain.gain.setValueAtTime(0.3, now + off);
            gain.gain.exponentialRampToValueAtTime(0.001, now + off + 0.45);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now + off);
            osc.stop(now + off + 0.45);
            off += 0.35;
          });
          break;
        }

        case 'gallop': {
          const beats = [0, 0.08, 0.19];
          beats.forEach((off, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(idx === 2 ? 155 : 125, now + off);
            osc.frequency.exponentialRampToValueAtTime(52, now + off + 0.055);
            gain.gain.setValueAtTime(0.22, now + off);
            gain.gain.exponentialRampToValueAtTime(0.001, now + off + 0.055);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now + off);
            osc.stop(now + off + 0.055);
          });
          break;
        }

        case 'capture': {
          const fanfare = [392.0, 523.25, 659.25, 783.99];
          fanfare.forEach((f, idx) => {
            const st = now + idx * 0.07;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, st);
            gain.gain.setValueAtTime(0.24, st);
            gain.gain.exponentialRampToValueAtTime(0.001, st + 0.4);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(st);
            osc.stop(st + 0.4);
          });
          break;
        }

        case 'skill_up': {
          const chime = [523.25, 659.25, 783.99, 1046.5, 1318.5];
          chime.forEach((f, idx) => {
            const st = now + idx * 0.055;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
            osc.frequency.setValueAtTime(f, st);
            gain.gain.setValueAtTime(0.22, st);
            gain.gain.exponentialRampToValueAtTime(0.001, st + 0.48);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(st);
            osc.stop(st + 0.48);
          });
          break;
        }

        default:
          break;
      }
    },

    setTheme(themeName) {
      this.currentTheme = themeName;

      if (this._themeTimer) {
        clearInterval(this._themeTimer);
        this._themeTimer = null;
      }

      // Фоновая процедурная музыка выключена по требованию руководителя
      if (!this.isMusicEnabled) return;

      const ctx = this.initContext();
      if (!ctx || this.isMutedState) return;

      if (themeName === 'castle') {
        const chords = [
          [293.66, 349.23, 440.0],
          [349.23, 440.0, 523.25],
          [392.0, 466.16, 587.33],
          [440.0, 523.25, 659.25]
        ];
        let chordIdx = 0;
        let step = 0;

        this._themeTimer = setInterval(() => {
          if (this.isMutedState || this.currentTheme !== 'castle') return;
          const currentChord = chords[chordIdx];
          const noteFreq = currentChord[step % currentChord.length];
          const now = ctx.currentTime;

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(noteFreq, now);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
          osc.connect(gain);
          gain.connect(this.masterGain);
          osc.start(now);
          osc.stop(now + 1.2);

          step++;
          if (step >= 6) {
            step = 0;
            chordIdx = (chordIdx + 1) % chords.length;
          }
        }, 550);
      } else if (themeName === 'combat') {
        let beat = 0;
        this._themeTimer = setInterval(() => {
          if (this.isMutedState || this.currentTheme !== 'combat') return;
          const now = ctx.currentTime;

          const kick = ctx.createOscillator();
          const kGain = ctx.createGain();
          kick.type = 'sine';
          kick.frequency.setValueAtTime(beat % 2 === 0 ? 120 : 85, now);
          kick.frequency.exponentialRampToValueAtTime(35, now + 0.22);
          kGain.gain.setValueAtTime(0.3, now);
          kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          kick.connect(kGain);
          kGain.connect(this.masterGain);
          kick.start(now);
          kick.stop(now + 0.22);

          if (beat % 2 === 1) {
            const snareNoise = ctx.createBufferSource();
            snareNoise.buffer = this._createNoiseBuffer(0.12);
            const sFilter = ctx.createBiquadFilter();
            sFilter.type = 'bandpass';
            sFilter.frequency.setValueAtTime(1400, now);
            const sGain = ctx.createGain();
            sGain.gain.setValueAtTime(0.16, now);
            sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            snareNoise.connect(sFilter);
            sFilter.connect(sGain);
            sGain.connect(this.masterGain);
            snareNoise.start(now);
          }

          beat = (beat + 1) % 4;
        }, 320);
      } else if (themeName === 'valley') {
        const pentatonic = [329.63, 392.0, 440.0, 493.88, 587.33];
        this._themeTimer = setInterval(() => {
          if (this.isMutedState || this.currentTheme !== 'valley') return;
          if (Math.random() > 0.4) {
            const f = pentatonic[Math.floor(Math.random() * pentatonic.length)];
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(f, now);
            gain.gain.setValueAtTime(0.07, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
            osc.connect(gain);
            gain.connect(this.masterGain);
            osc.start(now);
            osc.stop(now + 1.4);
          }
        }, 900);
      }
    }
  };

  /* ==========================================================================
     3. window.HOMM5.UI — Связующий контроллер интерфейса (100% Русский)
     ========================================================================== */
  const UI = {
    mode: 'castle',
    currentLighting: 'day',
    activeUnit: null,
    atbQueue: [],
    isAutoCombat: false,
    targetingSpell: null,
    targetingHeroStrike: false,
    _aiTimer: null,
    elements: {},
    isMinimalHud: false,
    isBottomSheetOpen: false,
    currentSheet: null,
    radialTargetStackId: null,
    _toastTimer: null,

    showAdventureToast(message, options) {
      if (typeof document === 'undefined' || !message) return;
      const opts = options || {};
      const layer = this.elements.floatingLayer || document.getElementById('homm5-floating-layer');
      if (!layer) return;

      const prev = document.getElementById('homm5-adventure-toast');
      if (prev && prev.parentNode) {
        prev.parentNode.removeChild(prev);
      }
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
        this._toastTimer = null;
      }

      const toast = document.createElement('div');
      toast.id = 'homm5-adventure-toast';
      toast.className = 'homm5-adventure-toast';
      toast.style.cssText = [
        'position:absolute',
        'top:max(54px, calc(env(safe-area-inset-top) + 46px))',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:96',
        'max-width:92vw',
        'background:rgba(10,16,32,0.95)',
        'border:1px solid #fbbf24',
        'border-radius:12px',
        'padding:8px 14px',
        'color:#fef08a',
        'font-size:12px',
        'font-weight:700',
        'box-shadow:0 6px 22px rgba(0,0,0,0.8), 0 0 14px rgba(251,191,36,0.35)',
        'text-align:center',
        'pointer-events:' + (opts.actionLabel ? 'auto' : 'none')
      ].join(';');

      if (opts.actionLabel && typeof opts.onAction === 'function') {
        toast.innerHTML = `
          <div style="margin-bottom:6px;">${message}</div>
          <button class="homm5-btn homm5-btn-gold" id="btn-toast-action" style="font-size:11px; padding:4px 10px;">
            ${opts.actionLabel}
          </button>
        `;
      } else {
        toast.textContent = message;
      }

      layer.appendChild(toast);

      if (opts.actionLabel && typeof opts.onAction === 'function') {
        toast.querySelector('#btn-toast-action')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (toast.parentNode) toast.parentNode.removeChild(toast);
          opts.onAction();
        });
      }

      const dur = opts.durationMs || (opts.actionLabel ? 4600 : 2900);
      this._toastTimer = setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        this._toastTimer = null;
      }, dur);
    },

    getEffectiveHeroStatsFallback(save) {
      const s = save || SaveV3.getSaveData();
      const h = (s && s.hero) || {};
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.getHeroEffectiveStats === 'function') {
        try {
          const eff = HOMM5.CombatCore.getHeroEffectiveStats();
          if (eff) {
            return Object.assign({}, eff, {
              level: eff.level || Number(h.level) || 1,
              mana: eff.mana !== undefined ? eff.mana : Math.min(eff.maxMana || 50, Number(h.mana ?? eff.maxMana ?? 50)),
              movePoints: eff.movePoints !== undefined ? eff.movePoints : (typeof s.movePoints === 'number' ? s.movePoints : (eff.maxMovePoints || 12))
            });
          }
        } catch {}
      }
      const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
      let atk = Number(h.attack) || 6;
      let def = Number(h.defense) || 7;
      let sp = Number(h.spellPower) || 5;
      let knw = Number(h.knowledge) || 5;
      let maxMana = Number(h.maxMana) || 50;
      let morale = Number(h.morale) || 2;
      let luck = Number(h.luck) || 2;
      let maxMp = Number(s.maxMovePoints) || Number(advCfg.baseMovePoints) || 12;

      const skills = Array.isArray(h.unlockedSkills) ? h.unlockedSkills : [];
      if (skills.includes('logistics')) maxMp = Math.max(maxMp, (Number(advCfg.baseMovePoints) || 12) + 4);
      if (skills.includes('elrath_blessing')) luck += 1;

      const eq = (s && s.equippedArtifacts) || {};
      const arts = HOMM5.ARTIFACTS || CFG.ARTIFACTS || {};
      Object.keys(eq).forEach((slot) => {
        const aid = eq[slot];
        const art = aid && arts[aid];
        if (art && art.stats) {
          if (art.stats.attack) atk += art.stats.attack;
          if (art.stats.defense) def += art.stats.defense;
          if (art.stats.spellPower) sp += art.stats.spellPower;
          if (art.stats.maxMana) maxMana += art.stats.maxMana;
          if (art.stats.movePoints && !s.maxMovePoints) maxMp += art.stats.movePoints;
        }
      });

      return {
        attack: atk,
        defense: def,
        spellPower: sp,
        knowledge: knw,
        maxMana: maxMana,
        mana: Math.min(maxMana, Number(h.mana ?? maxMana)),
        morale: morale,
        luck: luck,
        maxMovePoints: maxMp,
        movePoints: typeof s.movePoints === 'number' ? s.movePoints : maxMp
      };
    },

    triggerAdvanceAdventureDay() {
      let res = null;
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.advanceAdventureDay === 'function') {
        res = HOMM5.CombatCore.advanceAdventureDay();
      } else {
        const cur = SaveV3.getSaveData();
        const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
        const eff = this.getEffectiveHeroStatsFallback(cur);
        let goldGain = 0;
        let crystalGain = 0;
        const mines = cur.capturedMines || {};
        (HOMM5.VALLEY_NODES || CFG.VALLEY_NODES || []).forEach((n) => {
          if (n.type === 'mine' && mines[n.id]) {
            if (n.resource === 'gold') goldGain += (n.dailyIncome || 350);
            if (n.resource === 'crystals') crystalGain += (n.dailyIncome || 1);
          }
        });
        cur.day = (cur.day || 1) + 1;
        if (cur.day > 7) {
          cur.day = 1;
          cur.week = (cur.week || 1) + 1;
          goldGain += 650;
        }
        cur.gold = (cur.gold || 0) + goldGain;
        cur.crystals = (cur.crystals || 0) + crystalGain;
        cur.maxMovePoints = eff.maxMovePoints || Number(advCfg.baseMovePoints) || 12;
        cur.movePoints = cur.maxMovePoints;
        SaveV3.saveCurrentState(cur);
        if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
          HOMM5.World3D.syncCampaignState(cur);
        }
        res = {
          ok: true,
          goldIncome: goldGain,
          crystalIncome: crystalGain,
          movePoints: cur.movePoints,
          day: cur.day,
          week: cur.week,
          message: `⛺ Новый день похода! Восстановлено 🐎${cur.movePoints} ОД${goldGain > 0 || crystalGain > 0 ? ` · Доход шахт: +${goldGain}💰${crystalGain > 0 ? ` +${crystalGain}💎` : ''}` : ''}.`
        };
      }

      if (res && res.ok !== false) {
        Audio.playSFX('capture');
        const msg = res.message || `⛺ Новый день! Запас хода коня восстановлен${res.goldIncome ? ` (+${res.goldIncome}💰 от шахт)` : ''}.`;
        this.showAdventureToast(msg);
        const st = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
        SaveV3.saveCurrentState(st);
        this.updateHUDFromSave(st);
      } else if (res && res.message) {
        this.showAdventureToast(res.message);
      }
      return res;
    },

    executeValleyNodeInteraction(node) {
      if (!node) return;
      const save = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      const isLocked = node.missionIndex && node.missionIndex > (save.maxUnlockedMission || 1);
      if (isLocked) {
        Audio.playSFX('defeat');
        this.showAdventureToast(`🔒 Миссия пока закрыта: победите в предыдущем сражении!`);
        return;
      }

      if (node.type === 'treasure') {
        const completed = save.completedNodes || {};
        if (completed[node.id]) {
          this.showAdventureToast(`✅ ${node.name} уже открыт.`);
          return;
        }
        this.openTreasureModal(node);
        return;
      }

      if (node.type === 'battle') {
        this.startBattle(node);
        return;
      }

      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.interactValleyNode === 'function') {
        const res = HOMM5.CombatCore.interactValleyNode(node.id);
        if (res && res.ok) {
          if (node.type === 'mine') {
            Audio.playSFX('capture');
          } else if (node.type === 'relic' || node.type === 'obelisk') {
            Audio.playSFX('skill_up');
          } else {
            Audio.playSFX('spell_light');
          }
          const msg = res.message || `✨ Исследован объект «${node.name}»!`;
          this.showAdventureToast(msg);
          this.addCombatLogEntry(msg, 'haven');
          const cur = HOMM5.CombatCore.getCampaignState();
          SaveV3.saveCurrentState(cur);
          this.updateHUDFromSave(cur);
          if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
            HOMM5.World3D.syncCampaignState(cur);
          }
        } else if (res && res.message) {
          this.showAdventureToast(res.message);
        }
      }
    },

    formatGoldMicro(val) {
      val = Number(val) || 0;
      if (val >= 1000) {
        const k = (val / 1000).toFixed(1);
        return (k.endsWith('.0') ? k.slice(0, -2) : k) + 'k';
      }
      return val.toString();
    },

    initHUDMode() {
      let saved = null;
      try {
        if (typeof localStorage !== 'undefined') {
          saved = localStorage.getItem('homm5_hud_mode');
        }
      } catch {}

      if (saved === 'classic') {
        this.isMinimalHud = false;
      } else if (saved === 'minimal') {
        this.isMinimalHud = true;
      } else {
        this.isMinimalHud = (typeof window !== 'undefined' && window.innerWidth < 1024);
      }
      this.applyHUDMode();
    },

    setHUDMode(isMinimal) {
      this.isMinimalHud = !!isMinimal;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('homm5_hud_mode', this.isMinimalHud ? 'minimal' : 'classic');
        }
      } catch {}
      this.applyHUDMode();
      if (this.isBottomSheetOpen && this.currentSheet === 'settings') {
        this.renderSettingsSheet();
      }
    },

    applyHUDMode() {
      const layer = document.getElementById('ui-layer');
      if (!layer) return;
      if (this.isMinimalHud) {
        layer.classList.add('hud-minimal');
      } else {
        layer.classList.remove('hud-minimal');
      }
    },

    /**
     * Инициализация UI. Рендерит всю разметку в контейнер uiRoot.
     */
    init(container) {
      if (typeof document === 'undefined') return;

      let layer = container || document.getElementById('ui-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'ui-layer';
        document.body.appendChild(layer);
      }

      this._buildDOMElements(layer);
      this.initHUDMode();
      this._bindGlobalEvents();
      this._subscribeToBus();

      const campState = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      this.updateHUDFromSave(campState);
      this.setMode('castle');

      console.log('👑 [HOMM5.UI] Королевский интерфейс Героев Меча и Магии V успешно активирован!');
    },

    _buildDOMElements(layer) {
      layer.innerHTML = `
        <!-- 0. Слой пространственного Микро-HUD ≤ 4.5% для смартфонов и планшетов -->
        <div id="micro-hud-layer" class="homm5-interactive">
          <div id="micro-resource-pill" class="homm5-micro-pill" title="Казна и Поход (Клик — обзор, лагерь и миссии)">
            <span id="micro-mode-icon">🏰</span>
            <span id="micro-gold-wrap">🪙<b id="micro-val-gold" class="micro-gold-val">1.7k</b></span>
            <span id="micro-sec-wrap">💎<b id="micro-val-crystals" class="micro-crystal-val">3</b></span>
          </div>
          <button id="micro-settings-btn" class="homm5-micro-btn" title="Настройки, звук, сохранения и HUD">
            ⚙️
          </button>
          <div id="micro-atb-pill" class="homm5-micro-pill homm5-hidden" title="Шкала инициативы (Клик — тактический обзор)">
            <span id="micro-atb-current" class="micro-atb-current">🛡️ Латники</span>
            <span class="micro-atb-divider">▶</span>
            <div id="micro-atb-queue-icons" class="micro-atb-queue-icons"></div>
          </div>
        </div>

        <!-- Контекстное Радиальное Меню 3D -->
        <div id="radial-action-menu" class="radial-action-menu radial-ring-menu homm5-hidden">
          <div class="radial-center-dot"></div>
          <div class="radial-petals" id="radial-petals"></div>
        </div>

        <!-- Парящий прогноз урона в 3D и чип отмены магии -->
        <div id="damage-preview-tooltip" class="damage-preview-tooltip homm5-hidden"></div>
        <div id="targeting-cancel-chip" class="targeting-cancel-chip homm5-hidden">✕ Отмена заклинания</div>

        <!-- Универсальный сапфировый мобильный Bottom Sheet ≤ 52vh -->
        <div id="homm-bottom-sheet-backdrop" class="homm-bottom-sheet-backdrop"></div>
        <aside id="homm-bottom-sheet" class="homm-bottom-sheet">
          <div class="bottom-sheet-handle-wrap" id="bottom-sheet-handle-wrap">
            <div class="bottom-sheet-handle"></div>
          </div>
          <div class="bottom-sheet-header-row">
            <span class="bottom-sheet-title" id="bottom-sheet-title">🏰 Замок «Коготь Грифона»</span>
            <button class="bottom-sheet-close-btn" id="btn-close-bottom-sheet" title="Закрыть шторку">✕</button>
          </div>
          <div class="bottom-sheet-content" id="bottom-sheet-content"></div>
        </aside>

        <!-- 1. Верхний королевский бар -->
        <header id="homm5-top-bar" class="homm5-panel homm5-corner-decor">
          <div class="homm5-resources-group">
            <div class="homm5-res-badge homm5-res-gold" id="res-gold-badge" title="Золото королевской казны">
              💰 <span id="val-gold">1 650</span>
            </div>
            <div class="homm5-res-badge homm5-res-crystal" id="res-crystal-badge" title="Кристаллы Света">
              💎 <span id="val-crystals">3</span>
            </div>
            <div class="homm5-res-badge homm5-res-mana" id="res-mana-badge" title="Мана Лорда Годрика">
              🔮 <span id="val-mana">50 / 50</span>
            </div>
            <div class="homm5-calendar-badge" id="val-calendar" title="Календарь Асхана">
              📅 Неделя 1, День 1 (Неделя Грифонов)
            </div>
          </div>

          <nav class="homm5-mode-nav">
            <button class="homm5-btn" id="btn-mode-castle" title="Обозреть замок Ордена Порядка 360°">
              🏰 Замок 360°
            </button>
            <button class="homm5-btn" id="btn-mode-valley" title="Исследовать долину миссий и сокровищ">
              🗺️ Поход
            </button>
            <button class="homm5-btn homm5-btn-gold" id="btn-open-hero" title="Колесо Умений Ордена и Кукла Реликвий Лорда Годрика">
              🎖️ Герой
            </button>
            <button class="homm5-btn homm5-btn-crimson" id="btn-mode-combat" title="Быстрый тактический бой на арене">
              ⚔️ Быстрый Бой
            </button>
            <button class="homm5-btn" id="btn-toggle-lighting" title="Сменить время суток (День / Закат)">
              🌅 День
            </button>
            <button class="homm5-btn" id="btn-toggle-audio" title="Включить / Выключить звук">
              🔊 Звук
            </button>
            <button class="homm5-btn homm5-btn-gold" id="btn-open-install" title="Установить мобильную версию или скачать Android APK">
              📲 На телефон
            </button>
            <button class="homm5-btn homm5-btn-gold" id="btn-open-save" title="Хранилище Сохранений (Save Engine v3)">
              💾 Сохранить
            </button>
          </nav>
        </header>

        <!-- 2. Левая сворачиваемая панель -->
        <aside id="homm5-left-panel" class="homm5-panel">
          <div class="homm5-left-header">
            <span class="homm5-left-title" id="left-panel-title">Гарнизон Замка</span>
            <button class="homm5-toggle-btn" id="btn-toggle-left-panel" title="Свернуть / Развернуть панель">◀</button>
          </div>
          <div class="homm5-left-content" id="left-panel-content"></div>
        </aside>

        <!-- 3. Фирменная нижняя панель Боя и Шкалы Инициативы (ATB) -->
        <footer id="homm5-combat-hud" class="homm5-panel homm5-hidden">
          <div class="homm5-active-card" id="homm5-active-unit-card">
            <div class="homm5-active-portrait" id="active-portrait">
              <span id="active-portrait-icon">🛡️</span>
              <span class="homm5-active-faction-tag homm5-tag-haven" id="active-faction-tag">Порядок</span>
            </div>
            <div class="homm5-active-details">
              <div class="homm5-active-name-row">
                <span class="homm5-active-name" id="active-unit-name">Латники</span>
                <span class="homm5-active-count" id="active-unit-count">24</span>
              </div>
              <div class="homm5-hp-bar-wrap">
                <div class="homm5-hp-fill" id="active-unit-hp-bar"></div>
              </div>
              <div class="homm5-hp-text">
                <span id="active-unit-hp-val">26 / 26 ОЗ</span>
                <span id="active-unit-init-val">Инициатива: 8</span>
              </div>
              <div class="homm5-active-mini-stats">
                <span>⚔️ <b id="active-stat-atk">5</b></span>
                <span>🛡️ <b id="active-stat-def">9</b></span>
                <span>🏃 <b id="active-stat-spd">4</b></span>
                <span id="active-stat-shots-wrap">🏹 <b id="active-stat-shots">0</b></span>
              </div>
            </div>
          </div>

          <div class="homm5-atb-container">
            <div class="homm5-atb-label">Шкала Инициативы (Очередь ходов)</div>
            <div class="homm5-atb-queue" id="homm5-atb-ribbon"></div>
          </div>

          <div class="homm5-combat-actions">
            <button class="homm5-btn homm5-btn-magic homm5-action-btn" id="btn-act-spellbook" title="Книга Заклинаний Эльрата [C]">
              📖 Книга Магии (C)
            </button>
            <button class="homm5-btn homm5-btn-gold homm5-action-btn" id="btn-act-hero-strike" title="Прямой удар Лорда Годрика">
              🗡️ Удар Героя
            </button>
            <button class="homm5-btn homm5-action-btn" id="btn-act-wait" title="Пропустить часть хода вперёд по шкале ATB [W]">
              ⏳ Ждать (W)
            </button>
            <button class="homm5-btn homm5-action-btn" id="btn-act-defend" title="Встать в глухую оборону (+30% Защиты) [D]">
              🛡️ Оборона (D)
            </button>
            <button class="homm5-btn homm5-action-btn" id="btn-act-autocombat" title="Включить / Выключить автобой ИИ">
              🤖 Автобой
            </button>
            <button class="homm5-btn homm5-btn-crimson homm5-action-btn" id="btn-act-retreat" title="Отступить в Замок Коготь Грифона">
              🏳️ В Замок
            </button>
          </div>
        </footer>

        <!-- 4. Правый Боевой Летописец (Журнал боя) -->
        <aside id="homm5-combat-log" class="homm5-panel homm5-hidden">
          <div class="homm5-log-header">
            <span class="homm5-log-title">📜 Боевой Летописец</span>
            <button class="homm5-toggle-btn" id="btn-toggle-log" title="Свернуть / Развернуть журнал">▶</button>
          </div>
          <div class="homm5-log-body" id="combat-log-body">
            <div class="homm5-log-entry homm5-log-round">⚔️ Битва за Асхан началась!</div>
          </div>
        </aside>

        <!-- 5. Слой всплывающего урона / исцеления / критов -->
        <div id="homm5-floating-layer"></div>

        <!-- 6. Контейнер всплывающего тултипа -->
        <div id="homm5-tooltip" class="homm5-tooltip"></div>

        <!-- 7. Контейнер модальных окон -->
        <div id="homm5-modal-container" class="homm5-modal-backdrop"></div>
      `;

      this.elements = {
        topBar: document.getElementById('homm5-top-bar'),
        leftPanel: document.getElementById('homm5-left-panel'),
        leftContent: document.getElementById('left-panel-content'),
        leftTitle: document.getElementById('left-panel-title'),
        combatHud: document.getElementById('homm5-combat-hud'),
        atbRibbon: document.getElementById('homm5-atb-ribbon'),
        combatLog: document.getElementById('homm5-combat-log'),
        combatLogBody: document.getElementById('combat-log-body'),
        floatingLayer: document.getElementById('homm5-floating-layer'),
        modalContainer: document.getElementById('homm5-modal-container'),
        tooltip: document.getElementById('homm5-tooltip'),
        microHudLayer: document.getElementById('micro-hud-layer'),
        microResourcePill: document.getElementById('micro-resource-pill'),
        microSettingsBtn: document.getElementById('micro-settings-btn'),
        microAtbPill: document.getElementById('micro-atb-pill'),
        microValGold: document.getElementById('micro-val-gold'),
        microValCrystals: document.getElementById('micro-val-crystals'),
        microAtbCurrent: document.getElementById('micro-atb-current'),
        microAtbQueueIcons: document.getElementById('micro-atb-queue-icons'),
        radialMenu: document.getElementById('radial-action-menu'),
        radialPetals: document.getElementById('radial-petals'),
        damagePreviewTooltip: document.getElementById('damage-preview-tooltip'),
        targetingCancelChip: document.getElementById('targeting-cancel-chip'),
        bottomSheet: document.getElementById('homm-bottom-sheet'),
        bottomSheetBackdrop: document.getElementById('homm-bottom-sheet-backdrop'),
        bottomSheetTitle: document.getElementById('bottom-sheet-title'),
        bottomSheetContent: document.getElementById('bottom-sheet-content')
      };
    },

    _bindGlobalEvents() {
      document.getElementById('btn-mode-castle')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.setMode('castle');
      });

      document.getElementById('btn-mode-valley')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.setMode('valley');
      });

      document.getElementById('btn-open-hero')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.openBottomSheet('hero');
      });

      document.getElementById('btn-mode-combat')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.startQuickBattle();
      });

      document.getElementById('btn-toggle-lighting')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.toggleLighting();
      });

      document.getElementById('btn-toggle-audio')?.addEventListener('click', () => {
        const isMuted = Audio.toggleMute();
        const btn = document.getElementById('btn-toggle-audio');
        if (btn) btn.innerHTML = isMuted ? '🔇 Без звука' : '🔊 Звук';
      });

      document.getElementById('btn-open-install')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.openInstallModal();
      });

      document.getElementById('btn-open-save')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.openSaveModal();
      });

      document.getElementById('btn-toggle-left-panel')?.addEventListener('click', () => {
        Audio.playSFX('click');
        const p = this.elements.leftPanel;
        p?.classList.toggle('homm5-collapsed');
        const btn = document.getElementById('btn-toggle-left-panel');
        if (btn) btn.innerText = p?.classList.contains('homm5-collapsed') ? '▶' : '◀';
      });

      document.getElementById('btn-toggle-log')?.addEventListener('click', () => {
        Audio.playSFX('click');
        const l = this.elements.combatLog;
        l?.classList.toggle('homm5-collapsed');
        const btn = document.getElementById('btn-toggle-log');
        if (btn) btn.innerText = l?.classList.contains('homm5-collapsed') ? '◀' : '▶';
      });

      document.getElementById('btn-act-spellbook')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.openSpellbookModal();
      });

      document.getElementById('btn-act-hero-strike')?.addEventListener('click', () => {
        this.executeHeroStrike();
      });

      document.getElementById('btn-act-wait')?.addEventListener('click', () => {
        this.executeAction('wait');
      });

      document.getElementById('btn-act-defend')?.addEventListener('click', () => {
        this.executeAction('defend');
      });

      document.getElementById('btn-act-autocombat')?.addEventListener('click', () => {
        this.toggleAutoCombat();
      });

      document.getElementById('btn-act-retreat')?.addEventListener('click', () => {
        Audio.playSFX('click');
        if (confirm('Отступить в замок Коготь Грифона? Битва будет проиграна!')) {
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.resetBattle === 'function') {
            HOMM5.CombatCore.resetBattle();
          }
          this.setMode('castle');
        }
      });

      // События кнопок Микро-HUD
      document.getElementById('micro-resource-pill')?.addEventListener('click', () => {
        if (this.mode === 'valley') {
          this.openBottomSheet('valley');
        } else {
          this.openBottomSheet('castle');
        }
      });

      document.getElementById('micro-settings-btn')?.addEventListener('click', () => {
        this.openBottomSheet('settings');
      });

      document.getElementById('micro-atb-pill')?.addEventListener('click', () => {
        this.openBottomSheet('atb');
      });

      document.getElementById('targeting-cancel-chip')?.addEventListener('click', () => {
        this.cancelTargeting();
      });

      document.getElementById('btn-close-bottom-sheet')?.addEventListener('click', () => {
        this.closeBottomSheet();
      });

      document.getElementById('homm-bottom-sheet-backdrop')?.addEventListener('click', () => {
        this.closeBottomSheet();
      });

      // Жест свайпа вниз на Bottom Sheet для закрытия (> 55px)
      const sheet = document.getElementById('homm-bottom-sheet');
      if (sheet) {
        let touchStartY = 0;
        let touchDiffY = 0;
        sheet.addEventListener('touchstart', (e) => {
          if (e.touches && e.touches.length > 0) {
            touchStartY = e.touches[0].clientY;
            touchDiffY = 0;
          }
        }, { passive: true });

        sheet.addEventListener('touchmove', (e) => {
          if (e.touches && e.touches.length > 0) {
            const currentY = e.touches[0].clientY;
            touchDiffY = currentY - touchStartY;
            if (touchDiffY > 0) {
              sheet.style.transform = `translateY(${touchDiffY}px)`;
            }
          }
        }, { passive: true });

        sheet.addEventListener('touchend', () => {
          if (touchDiffY > 55) {
            this.closeBottomSheet();
          } else {
            sheet.style.transform = '';
          }
          touchDiffY = 0;
        });
      }

      // Закрытие радиального меню при клике мимо него
      window.addEventListener('click', (e) => {
        const radial = document.getElementById('radial-action-menu');
        if (radial && !radial.classList.contains('homm5-hidden')) {
          if (!radial.contains(e.target)) {
            this.closeRadialMenu();
          }
        }
      });

      // Адаптивная синхронизация режима HUD при ресайзе окна
      window.addEventListener('resize', () => {
        let saved = null;
        try {
          if (typeof localStorage !== 'undefined') saved = localStorage.getItem('homm5_hud_mode');
        } catch {}
        if (!saved) {
          this.isMinimalHud = window.innerWidth < 1024;
          this.applyHUDMode();
        }
      });

      this.elements.modalContainer?.addEventListener('click', (e) => {
        if (e.target === this.elements.modalContainer) {
          this.closeModal();
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.targetingSpell || this.targetingHeroStrike) {
            this.cancelTargeting();
            return;
          }
          if (this.isBottomSheetOpen) {
            this.closeBottomSheet();
            return;
          }
          if (this.elements.modalContainer?.classList.contains('homm5-active')) {
            this.closeModal();
            return;
          }
        }

        if (this.mode === 'combat') {
          const k = e.key.toUpperCase();
          if (k === 'W') {
            e.preventDefault();
            this.executeAction('wait');
          } else if (k === 'D') {
            e.preventDefault();
            this.executeAction('defend');
          } else if (k === 'C') {
            e.preventDefault();
            this.openSpellbookModal();
          } else if (e.code === 'Space') {
            e.preventDefault();
            if (HOMM5.World3D && typeof HOMM5.World3D.resetCamera === 'function') {
              HOMM5.World3D.resetCamera();
            }
          }
        }
      });
    },

    _subscribeToBus() {
      // 1. Кампания и сохранения
      Bus.on('campaign:updated', (campState) => {
        SaveV3.saveCurrentState(campState);
        this.updateHUDFromSave(campState);
        if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
          HOMM5.World3D.syncCampaignState(campState);
        }
      });

      Bus.on('save:updated', (data) => this.updateHUDFromSave(data));
      Bus.on('mode:change', (payload) => this.setMode(payload.mode));

      // 2. События тактического боя из tactical_atb_core.js
      Bus.on('battle:started', (bState) => {
        this._initCombatUIAndScene(bState);
      });

      Bus.on('battle:turn', (payload) => {
        this.updateActiveUnitCard(payload.activeActor);
        this.updateATBRibbon(payload.queue);

        const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;

        if (payload.activeActor.side === 'player' && !this.isAutoCombat) {
          let validToHighlight = payload.validActions || {};
          const actUnit = payload.activeActor;
          const isBallistaTurn = !!(
            actUnit.isWarMachine ||
            actUnit.unitId === 'ballista' ||
            (actUnit.unit && actUnit.unit.isWarMachine) ||
            ((actUnit.speed === 0 || (actUnit.unit && actUnit.unit.speed === 0)) && (actUnit.isRanged || (actUnit.unit && actUnit.unit.isRanged)))
          );
          if (isBallistaTurn && bState && Array.isArray(bState.stacks)) {
            const enemyTargets = bState.stacks
              .filter((s) => s.side === 'enemy' && s.count > 0)
              .map((s) => ({ col: s.col, row: s.row, targetStackId: s.id }));
            if (!validToHighlight.targets || validToHighlight.targets.length === 0) {
              validToHighlight = { moves: [], targets: enemyTargets };
            }
            this.addCombatLogEntry('🏹 Очередь 3D-Баллисты Ордена: укажите вражеский отряд для осадного залпа!', 'haven');
          }

          if (HOMM5.World3D) {
            if (typeof HOMM5.World3D.highlightCells === 'function') {
              HOMM5.World3D.highlightCells(validToHighlight);
            }
            if (typeof HOMM5.World3D.syncBattleState === 'function') {
              HOMM5.World3D.syncBattleState(bState);
            }
          }

          // Авто-вызов радиального веера заклинаний и удара при наступлении хода hero_player
          if (payload.activeActor.isHeroActor || payload.activeActor.id === 'hero_player') {
            let hPos = null;
            if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
              hPos = HOMM5.World3D.getActorScreenPosition('hero_player');
            }
            const hx = (hPos && hPos.x !== undefined) ? hPos.x : (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
            const hy = (hPos && hPos.y !== undefined) ? hPos.y : (typeof window !== 'undefined' ? window.innerHeight / 2 : 300);
            this.openRadialMenu('hero', hx, hy, 'hero_player');
          }
        }

        if (this._aiTimer) {
          clearTimeout(this._aiTimer);
          this._aiTimer = null;
        }

        // Автоход вражеского ИИ или Автобой игрока
        if (payload.activeActor.side === 'enemy' || this.isAutoCombat) {
          this._aiTimer = setTimeout(() => {
            const curBState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
            if (!curBState || curBState.status !== 'active') return;

            if (payload.activeActor.side === 'enemy') {
              HOMM5.CombatCore.stepAI();
            } else if (this.isAutoCombat) {
              const actions = HOMM5.CombatCore.getValidActions(payload.activeActor.id);
              if (actions.targets && actions.targets.length > 0) {
                const t = actions.targets[0];
                const moveCell = (t.moveFromCol !== undefined && t.moveFromCol !== null && t.moveFromCol >= 0)
                  ? { col: t.moveFromCol, row: t.moveFromRow }
                  : (t.moveCell || null);
                HOMM5.CombatCore.executeUnitAttack(t.targetStackId, moveCell);
              } else if (actions.moves && actions.moves.length > 0) {
                const sortedMoves = [...actions.moves].sort((a, b) => b.col - a.col);
                HOMM5.CombatCore.executeUnitMove(sortedMoves[0].col, sortedMoves[0].row);
              } else if (payload.activeActor.isHeroActor) {
                const enemy = curBState.stacks.find((s) => s.side === 'enemy' && s.count > 0);
                if (enemy) {
                  HOMM5.CombatCore.executeHeroStrike(enemy.id);
                } else {
                  HOMM5.CombatCore.commandWait();
                }
              } else {
                HOMM5.CombatCore.commandDefend();
              }
            }
          }, 520);
        }
      });

      Bus.on('battle:action', (payload) => {
        if (payload.log) {
          this.addCombatLogEntry(payload.log, payload.type || 'normal');
        }

        // Звуковые эффекты и тактильный виброотклик
        if (payload.type === 'move') {
          Audio.playSFX('move');
        } else if (payload.type === 'attack') {
          if (payload.isCrit) {
            Audio.playSFX('crit');
            triggerVibrate([40, 30, 80]);
          } else if (payload.mode === 'ranged') {
            Audio.playSFX('arrow');
          } else {
            const aName = (payload.actor && (payload.actor.name || payload.actor.unitId)) || '';
            if (/грифон/i.test(aName)) {
              Audio.playSFX('griffin');
            } else {
              Audio.playSFX('sword');
            }
          }
        } else if (payload.type === 'hero_strike') {
          Audio.playSFX('sword');
        } else if (payload.type === 'spell') {
          Audio.playSFX(payload.spellId === 'fireball' ? 'fireball' : 'spell_light');
          if (payload.spellId === 'fireball') {
            triggerVibrate([70, 40, 120]);
          }
        } else if (payload.type === 'wait' || payload.type === 'defend') {
          Audio.playSFX('click');
        }

        // Анимации 3D WebGL
        if (HOMM5.World3D) {
          const syncState = () => {
            if (HOMM5.CombatCore && typeof HOMM5.World3D.syncBattleState === 'function') {
              HOMM5.World3D.syncBattleState(HOMM5.CombatCore.getBattleState());
            }
          };

          if (payload.type === 'move' && typeof HOMM5.World3D.playUnitMove === 'function') {
            const path = (payload.path && payload.path.length > 0)
              ? payload.path
              : [{ col: payload.targetCol, row: payload.targetRow }];
            HOMM5.World3D.playUnitMove(payload.actor.id, path, syncState);
          } else if (payload.type === 'attack' && typeof HOMM5.World3D.playAttackAnim === 'function') {
            HOMM5.World3D.playAttackAnim(
              payload.actor.id,
              payload.target ? payload.target.id : null,
              {
                isRanged: payload.mode === 'ranged',
                isCrit: !!payload.isCrit,
                damage: payload.damage,
                killed: payload.killed,
                isHeroAttack: false
              },
              syncState
            );
          } else if (payload.type === 'hero_strike' && typeof HOMM5.World3D.playAttackAnim === 'function') {
            HOMM5.World3D.playAttackAnim(
              payload.actor.id,
              payload.target ? payload.target.id : null,
              {
                isRanged: true,
                isCrit: false,
                damage: payload.damage,
                killed: payload.killed,
                isHeroAttack: true
              },
              syncState
            );
          } else if (payload.type === 'spell' && typeof HOMM5.World3D.playSpellFX === 'function') {
            HOMM5.World3D.playSpellFX(
              payload.spellId,
              payload.targetCol,
              payload.targetRow,
              { targetStackId: payload.targetStackId },
              syncState
            );
          } else {
            syncState();
          }
        }
      });

      Bus.on('battle:ended', (payload) => {
        if (this._aiTimer) {
          clearTimeout(this._aiTimer);
          this._aiTimer = null;
        }
        if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
          HOMM5.World3D.highlightCells(null);
        }

        if (payload.status === 'victory') {
          Audio.playSFX('victory');
          triggerVibrate([60, 50, 60, 50, 140]);
          this.openVictoryModal(payload);
        } else {
          Audio.playSFX('defeat');
          this.openDefeatModal(payload);
        }
      });

      // 3. Подписка на 3D-события world3d_engine.js
      Bus.on('3d:cameraManipulating', (payload) => {
        const isManipulating = (typeof payload === 'boolean') ? payload : !!(payload && payload.isManipulating);
        const hudLayer = document.getElementById('micro-hud-layer');
        if (hudLayer) {
          if (isManipulating) {
            hudLayer.classList.add('hud-camera-fade');
          } else {
            hudLayer.classList.remove('hud-camera-fade');
          }
        }
      });

      Bus.on('3d:emptyTap', () => {
        this.closeRadialMenu();
        this.hideDamagePreview();
        if (this.isBottomSheetOpen) {
          this.closeBottomSheet();
        }
      });

      Bus.on('3d:buildingClick', (payload) => {
        if (this.isMinimalHud) {
          this.openBottomSheet('castle', payload.buildingId);
        } else {
          this.openCastleModal(payload.buildingId);
        }
      });

      Bus.on('3d:valleyGroundTap', (payload) => {
        if (!payload) return;
        const radial = document.getElementById('radial-action-menu');
        const radialOpen = radial && !radial.classList.contains('homm5-hidden');
        if (this.isBottomSheetOpen || radialOpen) {
          this.closeRadialMenu();
          if (this.isBottomSheetOpen) this.closeBottomSheet();
          return;
        }

        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.moveAdventureHero === 'function') {
          const res = HOMM5.CombatCore.moveAdventureHero(payload.x, payload.z);
          if (res && res.ok) {
            Audio.playSFX('gallop');
            const st = HOMM5.CombatCore.getCampaignState();
            SaveV3.saveCurrentState(st);
            this.updateHUDFromSave(st);
            if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
              HOMM5.World3D.syncCampaignState(st);
            }
          } else if (res && res.reason === 'no_move_points') {
            Audio.playSFX('click');
            this.showAdventureToast('🐎 Ход окончен (0 ОД) — тапните по Всаднику для Нового дня');
            let hScreen = null;
            if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
              hScreen = HOMM5.World3D.getActorScreenPosition('adventure_hero');
            }
            const sx = (hScreen && hScreen.x !== undefined) ? hScreen.x : (payload.screenX || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
            const sy = (hScreen && hScreen.y !== undefined) ? hScreen.y : (payload.screenY || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300));
            this.openRadialMenu('adventure_hero', sx, sy, 'adventure_hero');
          } else if (res && res.message) {
            this.showAdventureToast(res.message);
          }
        }
      });

      Bus.on('3d:adventureHeroTap', (payload) => {
        const sx = (payload && payload.screenX !== undefined)
          ? payload.screenX
          : (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
        const sy = (payload && payload.screenY !== undefined)
          ? payload.screenY
          : (typeof window !== 'undefined' ? window.innerHeight / 2 : 300);
        this.openRadialMenu('adventure_hero', sx, sy, 'adventure_hero');
      });

      Bus.on('hero:levelUp', (payload) => {
        Audio.playSFX('skill_up');
        triggerVibrate([50, 40, 90]);
        const lvl = (payload && payload.level) || ((SaveV3.getSaveData().hero || {}).level || 2);
        this.showAdventureToast(
          `👑 Лорд Годрик достиг ${lvl}-го уровня! Получено +1 очко умений.`,
          {
            actionLabel: '🎡 Открыть Колесо Умений',
            onAction: () => this.openBottomSheet('hero', { section: 'skills' }),
            durationMs: 5500
          }
        );
        const st = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
        this.updateHUDFromSave(st);
      });

      Bus.on('3d:nodeClick', (payload) => {
        if (!payload || !payload.nodeId) return;
        this.closeRadialMenu();
        const nodeId = payload.nodeId;
        const node = (HOMM5.VALLEY_NODES || CFG.VALLEY_NODES || []).find((n) => n.id === nodeId);
        if (!node) return;

        if (this.mode === 'valley' && HOMM5.CombatCore && typeof HOMM5.CombatCore.moveAdventureHero === 'function' && Array.isArray(node.pos3d)) {
          const st = HOMM5.CombatCore.getCampaignState();
          const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
          const hPos = st.heroPos || advCfg.startPos || { x: 0, z: 6.5 };
          const tx = Number(node.pos3d[0]) || 0;
          const tz = Number(node.pos3d[2]) || 0;
          const dist = Math.hypot(tx - (Number(hPos.x) || 0), tz - (Number(hPos.z) || 0));
          const interactR = Number(advCfg.interactionRadius) || 2.6;

          if (dist > interactR) {
            const mv = HOMM5.CombatCore.moveAdventureHero(tx, tz);
            if (mv && mv.ok) {
              Audio.playSFX('gallop');
              const updated = HOMM5.CombatCore.getCampaignState();
              SaveV3.saveCurrentState(updated);
              this.updateHUDFromSave(updated);
              if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
                HOMM5.World3D.syncCampaignState(updated);
              }
              const newPos = updated.heroPos || { x: tx, z: tz };
              const remDist = Math.hypot(tx - (Number(newPos.x) || 0), tz - (Number(newPos.z) || 0));
              if (remDist > 3.2) {
                this.showAdventureToast(
                  `🐎 Всадник на пути к «${node.shortTitle || node.name}» (0 ОД) — разбейте лагерь на Новый день!`,
                  {
                    actionLabel: '⛺ Новый день',
                    onAction: () => this.triggerAdvanceAdventureDay()
                  }
                );
                return;
              }
            } else if (dist > 3.2) {
              Audio.playSFX('click');
              this.showAdventureToast(
                `🐎 Недостаточно ОД до «${node.shortTitle || node.name}» — разбейте лагерь на Новый день!`,
                {
                  actionLabel: '⛺ Разбить лагерь (Новый день)',
                  onAction: () => this.triggerAdvanceAdventureDay()
                }
              );
              return;
            }
          }
        }

        this.executeValleyNodeInteraction(node);
      });

      Bus.on('3d:actorTap', (payload) => {
        if (this.targetingSpell || this.targetingHeroStrike) return;
        if (!payload || !payload.stackId) return;
        const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
        if (!bState || bState.status !== 'active') return;
        const stack = (bState.stacks || []).find((s) => s.id === payload.stackId && s.count > 0);
        if (!stack || stack.side !== 'player') return;

        let screenPos = null;
        if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
          screenPos = HOMM5.World3D.getActorScreenPosition(stack.id);
        }
        const sx = (screenPos && screenPos.x !== undefined) ? screenPos.x : (payload.screenX || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
        const sy = (screenPos && screenPos.y !== undefined) ? screenPos.y : (payload.screenY || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300));

        if (stack.id === bState.activeActorId) {
          this.openRadialMenu('unit', sx, sy, stack.id);
        } else {
          this.openUnitInspectModal(stack.id);
        }
      });

      Bus.on('3d:heroTap', (payload) => {
        let screenPos = null;
        if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
          screenPos = HOMM5.World3D.getActorScreenPosition('hero_player');
        }
        const sx = (screenPos && screenPos.x !== undefined) ? screenPos.x : ((payload && payload.screenX) || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
        const sy = (screenPos && screenPos.y !== undefined) ? screenPos.y : ((payload && payload.screenY) || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300));

        this.openRadialMenu('hero', sx, sy, 'hero_player');
      });

      Bus.on('3d:cellTap', (payload) => {
        this._handleCellTap(payload);
      });

      Bus.on('3d:cellClick', (payload) => {
        this._handleCellClick(payload);
      });

      Bus.on('3d:cellHover', (payload) => {
        if (this.targetingSpell === 'fireball' && HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
          HOMM5.World3D.highlightCells({
            moves: [],
            targets: [],
            aoeCenter: { col: payload.col, row: payload.row }
          });
        }
        this.updateDamagePreview(payload);
      });

      Bus.on('3d:unitInspect', (payload) => {
        if (payload.stackId) {
          this.openUnitInspectModal(payload.stackId);
        }
      });

      Bus.on('fx:floatingText', (payload) => {
        this.spawnFloatingCombatText(payload.text, payload.screenX, payload.screenY, payload.kind || 'damage');
      });
    },

    setMode(mode) {
      this.mode = mode;
      Audio.setTheme(mode);

      const modeIcon = document.getElementById('micro-mode-icon');
      if (modeIcon) {
        modeIcon.innerText = mode === 'castle' ? '🏰' : (mode === 'valley' ? '🗺️' : '⚔️');
      }

      if (HOMM5.World3D && typeof HOMM5.World3D.setMode === 'function') {
        HOMM5.World3D.setMode(mode);
      }

      const combatHud = this.elements.combatHud;
      const combatLog = this.elements.combatLog;
      const microAtbPill = document.getElementById('micro-atb-pill');
      const uiLayer = document.getElementById('ui-layer');

      if (mode === 'combat') {
        combatHud?.classList.remove('homm5-hidden');
        combatLog?.classList.remove('homm5-hidden');
        microAtbPill?.classList.remove('homm5-hidden');
        uiLayer?.classList.add('in-combat');
        this.renderCombatLeftPanel();
      } else {
        combatHud?.classList.add('homm5-hidden');
        combatLog?.classList.add('homm5-hidden');
        microAtbPill?.classList.add('homm5-hidden');
        uiLayer?.classList.remove('in-combat');
        this.hideDamagePreview();
        this.closeRadialMenu();

        if (mode === 'castle') {
          this.renderCastleLeftPanel();
        } else if (mode === 'valley') {
          this.renderValleyLeftPanel();
        }
      }

      const curSave = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      this.syncMicroResourcePill(curSave);

      Bus.emit('ui:modeChanged', { mode });
    },

    syncMicroResourcePill(save) {
      const s = save || SaveV3.getSaveData();
      if (!s) return;
      const pill = document.getElementById('micro-resource-pill');
      if (!pill) return;
      const gStr = this.formatGoldMicro(s.gold || 0);
      const eff = this.getEffectiveHeroStatsFallback(s);

      if (this.mode === 'valley') {
        const mp = Math.max(0, Math.round(typeof s.movePoints === 'number' ? s.movePoints : (eff.movePoints ?? 12)));
        pill.innerHTML = `<span id="micro-mode-icon">🗺️</span><span>🪙<b id="micro-val-gold" class="micro-gold-val">${gStr}</b> · 🐎<b id="micro-val-crystals" class="micro-crystal-val">${mp}</b></span>`;
      } else {
        const icon = this.mode === 'combat' ? '⚔️' : '🏰';
        const crys = Number(s.crystals || 0);
        const dayNum = Number(s.day || 1);
        pill.innerHTML = `<span id="micro-mode-icon">${icon}</span><span>🪙<b id="micro-val-gold" class="micro-gold-val">${gStr}</b> 💎<b id="micro-val-crystals" class="micro-crystal-val">${crys}</b> Д${dayNum}</span>`;
      }
    },

    toggleLighting() {
      if (HOMM5.World3D && typeof HOMM5.World3D.toggleTimeOfDay === 'function') {
        const theme = HOMM5.World3D.toggleTimeOfDay();
        const btn = document.getElementById('btn-toggle-lighting');
        if (btn) {
          btn.innerHTML = theme === 'eclipse' ? '🌇 Закат' : '🌅 День';
        }
      }
    },

    updateHUDFromSave(save) {
      if (!save) return;
      const goldEl = document.getElementById('val-gold');
      const crystalEl = document.getElementById('val-crystals');
      const manaEl = document.getElementById('val-mana');
      const calEl = document.getElementById('val-calendar');
      const eff = this.getEffectiveHeroStatsFallback(save);

      if (goldEl) goldEl.innerText = Number(save.gold || 0).toLocaleString('ru-RU');
      if (crystalEl) crystalEl.innerText = Number(save.crystals || 0).toLocaleString('ru-RU');
      this.syncMicroResourcePill(save);

      if (manaEl) {
        manaEl.innerText = `${eff.mana ?? 50} / ${eff.maxMana || 50}`;
      }
      if (calEl) {
        calEl.innerText = `📅 Неделя ${save.week || 1}, День ${save.day || 1} (Неделя Грифонов)`;
      }

      const heroBtn = document.getElementById('btn-open-hero');
      const spAvail = Number((save.hero && save.hero.skillPoints) || 0);
      if (heroBtn) {
        heroBtn.innerHTML = spAvail > 0 ? `🎖️ Герой 🟡` : `🎖️ Герой`;
      }

      if (this.isBottomSheetOpen) {
        if (this.currentSheet === 'castle') {
          this.renderCastleSheet();
        } else if (this.currentSheet === 'valley') {
          this.renderValleySheet();
        } else if (this.currentSheet === 'hero') {
          this.renderHeroSheet();
        }
      }

      if (this.mode === 'castle') {
        this.renderCastleLeftPanel();
      } else if (this.mode === 'valley') {
        this.renderValleyLeftPanel();
      }
    },

    renderCastleLeftPanel() {
      const title = this.elements.leftTitle;
      const content = this.elements.leftContent;
      if (title) title.innerText = 'Замок «Коготь Грифона»';
      if (!content) return;

      const save = SaveV3.getSaveData();
      const armyDict = normalizeArmyToDict(save.army);

      let armyHtml = '<div class="homm5-army-grid">';
      Object.keys(armyDict).forEach((uid) => {
        const u = CFG.UNITS[uid];
        if (!u) return;
        const count = armyDict[uid];
        armyHtml += `
          <div class="homm5-army-slot" data-unit-id="${u.id}" title="ПКМ — детальный осмотр ${u.name}">
            <span class="homm5-slot-tier">T${u.tier}</span>
            <div class="homm5-slot-icon">${u.icon}</div>
            <div class="homm5-slot-name">${u.name}</div>
            <div class="homm5-slot-count">${count}</div>
          </div>
        `;
      });
      armyHtml += '</div>';

      content.innerHTML = `
        <div style="font-size:11px; color:#cbd5e1; font-weight:700;">Армия Лорда Годрика:</div>
        ${armyHtml}
        <button class="homm5-btn homm5-btn-gold" id="btn-open-castle-modal" style="width:100%; margin-top:6px;">
          🏛️ Отстройка и Наём
        </button>
        <button class="homm5-btn" id="btn-next-week" style="width:100%; margin-top:6px; font-size:11px;">
          📅 Следующая Неделя (+650 💰)
        </button>
      `;

      document.getElementById('btn-open-castle-modal')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.openCastleModal();
      });

      document.getElementById('btn-next-week')?.addEventListener('click', () => {
        Audio.playSFX('build');
        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.nextWeek === 'function') {
          const res = HOMM5.CombatCore.nextWeek();
          if (res.ok) {
            this.addCombatLogEntry(res.message, 'haven');
          }
        }
      });

      content.querySelectorAll('.homm5-army-slot').forEach((el) => {
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const uid = el.getAttribute('data-unit-id');
          if (uid) {
            this.openUnitInspectModal(uid);
          }
        });
      });
    },

    renderValleyLeftPanel() {
      const title = this.elements.leftTitle;
      const content = this.elements.leftContent;
      if (title) title.innerText = 'Долина Миссий';
      if (!content) return;

      const save = SaveV3.getSaveData();
      const nodes = HOMM5.VALLEY_NODES || CFG.VALLEY_NODES || [];
      const completed = save.completedNodes || save.valleyNodesVisited || {};
      const capturedMines = save.capturedMines || {};
      const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
      const mp = Math.round(save.movePoints ?? advCfg.baseMovePoints ?? 12);
      const maxMp = Math.round(save.maxMovePoints ?? advCfg.baseMovePoints ?? 12);

      let listHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:8px;">
          <span style="font-size:11px; color:#cbd5e1;">🐎 ОД: <b style="color:var(--gold-bright);">${mp}/${maxMp}</b></span>
          <button class="homm5-btn homm5-btn-gold" id="btn-valley-left-camp" style="padding:4px 8px; font-size:10px;">⛺ Новый день</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
      `;
      nodes.forEach((node) => {
        const isMine = node.type === 'mine';
        const isCaptured = isMine && !!capturedMines[node.id];
        const visited = isMine ? isCaptured : !!completed[node.id];
        const isLocked = node.missionIndex && node.missionIndex > (save.maxUnlockedMission || 1);
        const stars = (save.bestStarsByMission && save.bestStarsByMission[node.missionIndex]) || 0;
        const starStr = stars > 0 ? '★'.repeat(stars) : '';

        let subText = node.difficulty || 'Награда готова';
        if (isLocked) subText = '🔒 Требуется открыть';
        else if (isCaptured) subText = `🚩 Захвачено (+${node.dailyGold || 350} 💰/д)`;
        else if (visited) subText = '✅ Завершено';

        listHtml += `
          <div class="homm5-list-item ${visited ? 'homm5-visited' : ''}" style="opacity:${isLocked ? 0.5 : 1}; cursor:${isLocked ? 'not-allowed' : 'pointer'}" data-node-id="${node.id}">
            <div class="homm5-item-info">
              <div class="homm5-item-title">${node.icon} ${node.name} ${starStr ? `<span style="color:var(--gold-bright);">${starStr}</span>` : ''}</div>
              <div class="homm5-item-sub">${subText}</div>
            </div>
            ${!isLocked && !visited ? `<button class="homm5-btn" style="padding:4px 8px; font-size:10px;">В поход</button>` : ''}
          </div>
        `;
      });
      listHtml += '</div>';

      content.innerHTML = listHtml;

      document.getElementById('btn-valley-left-camp')?.addEventListener('click', () => {
        this.triggerAdvanceAdventureDay();
      });

      content.querySelectorAll('.homm5-list-item').forEach((el) => {
        el.addEventListener('click', () => {
          const nid = el.getAttribute('data-node-id');
          const node = nodes.find((n) => n.id === nid);
          if (!node) return;
          const isLocked = node.missionIndex && node.missionIndex > (save.maxUnlockedMission || 1);
          if (isLocked) return;

          if (Bus && typeof Bus.emit === 'function') {
            Bus.emit('3d:nodeClick', { nodeId: node.id });
          } else {
            this.executeValleyNodeInteraction(node);
          }
        });
      });
    },

    renderCombatLeftPanel() {
      const title = this.elements.leftTitle;
      const content = this.elements.leftContent;
      if (title) title.innerText = 'Тактический обзор';
      if (!content) return;

      const eff = this.getEffectiveHeroStatsFallback();
      const save = SaveV3.getSaveData();
      const skills = (save.hero && Array.isArray(save.hero.unlockedSkills)) ? save.hero.unlockedSkills : [];
      const hasBallista = !!(eff.hasBallista || skills.includes('ballista') || skills.includes('war_machines'));

      content.innerHTML = `
        <div style="font-size:12px; color:#cbd5e1; line-height:1.5;">
          <div style="color:var(--gold-bright); font-weight:700; margin-bottom:6px;">Командующий: Лорд Годрик (Ур. ${eff.level || 1})</div>
          <div>Атака героя: <b>+${eff.attack}</b> · Защита: <b>+${eff.defense}</b></div>
          <div>Сила магии: <b>+${eff.spellPower}</b> · Боевой дух: <b>+${eff.morale}</b></div>
          <div>Удача: <b>+${eff.luck}</b> (шанс крита 🍀 УДАЧА!)</div>
          ${hasBallista ? '<div style="color:var(--gold-bright); margin-top:4px;">🏹 Боевая Баллиста на позиции</div>' : ''}
        </div>
        <div style="margin-top:12px; font-size:11px; color:#94a3b8; border-top:1px dashed rgba(212,175,55,0.3); padding-top:8px;">
          Горячие клавиши:<br>
          <b>W</b> — Ждать<br>
          <b>D</b> — Оборона (+30% защ.)<br>
          <b>C</b> — Книга Магии Эльрата<br>
          <b>Пробел</b> — Сброс ракурса камеры<br>
          <b>ПКМ</b> — Осмотр характеристик отряда
        </div>
      `;
    },

    updateActiveUnitCard(unit) {
      if (!unit) return;
      this.activeUnit = unit;

      const pIcon = document.getElementById('active-portrait-icon');
      const fTag = document.getElementById('active-faction-tag');
      const uName = document.getElementById('active-unit-name');
      const uCount = document.getElementById('active-unit-count');
      const hpBar = document.getElementById('active-unit-hp-bar');
      const hpVal = document.getElementById('active-unit-hp-val');
      const initVal = document.getElementById('active-unit-init-val');
      const sAtk = document.getElementById('active-stat-atk');
      const sDef = document.getElementById('active-stat-def');
      const sSpd = document.getElementById('active-stat-spd');
      const sShotsWrap = document.getElementById('active-stat-shots-wrap');
      const sShots = document.getElementById('active-stat-shots');

      if (pIcon) pIcon.innerText = unit.icon || '🛡️';
      if (fTag) {
        fTag.innerText = unit.side === 'player' || unit.faction === 'haven' ? 'Порядок' : 'Инферно';
        fTag.className = `homm5-active-faction-tag ${unit.side === 'player' || unit.faction === 'haven' ? 'homm5-tag-haven' : 'homm5-tag-inferno'}`;
      }
      if (uName) uName.innerText = unit.name || 'Воин';
      if (uCount) {
        const isMachine = !!(unit.isWarMachine || unit.unitId === 'ballista' || (unit.unit && unit.unit.isWarMachine));
        uCount.innerText = unit.isHeroActor ? 'Герой' : (isMachine ? 'Машина' : (unit.count || 1));
      }

      const unitBase = unit.unit || {};
      const maxHp = unit.maxHp || unitBase.hp || ((unit.hp || 20) * (unit.count || 1));
      const curHp = unit.topHp ?? unit.currentHp ?? maxHp;
      const pct = Math.max(0, Math.min(100, Math.round((curHp / Math.max(1, maxHp)) * 100)));

      if (hpBar) hpBar.style.width = `${pct}%`;
      if (hpVal) hpVal.innerText = unit.isHeroActor ? `Мана: ${unit.mana ?? 50} / ${unit.maxMana || 50}` : `${curHp} / ${maxHp} ОЗ`;
      if (initVal) initVal.innerText = `Инициатива: ${unit.initiative || 10}`;
      if (sAtk) sAtk.innerText = unit.attack ?? unitBase.attack ?? 0;
      if (sDef) sDef.innerText = unit.defense ?? unitBase.defense ?? 0;
      if (sSpd) sSpd.innerText = unit.speed ?? unitBase.speed ?? 0;

      if (sShotsWrap && sShots) {
        const isRanged = !!(unit.isRanged || unitBase.isRanged || unitBase.ranged);
        if (isRanged) {
          sShotsWrap.style.display = 'inline';
          const shotsVal = unit.shotsLeft ?? unit.shots ?? unitBase.shots ?? 0;
          sShots.innerText = shotsVal >= 90 ? '∞' : shotsVal;
        } else {
          sShotsWrap.style.display = 'none';
        }
      }
    },

    updateATBRibbon(queue) {
      this.atbQueue = queue || [];
      const ribbon = this.elements.atbRibbon;
      if (!ribbon) return;

      const size = (CFG.ATB_QUEUE_SIZE) || 8;
      const displayQueue = this.atbQueue.slice(0, size);

      let html = '';
      displayQueue.forEach((entry, idx) => {
        const u = entry.unit || entry;
        const isHaven = u.side === 'player' || u.faction === 'haven';
        const isCurrent = idx === 0;
        const isMachine = !!(u.isWarMachine || u.unitId === 'ballista' || (u.unit && u.unit.isWarMachine));
        const countBadge = u.isHero ? '👑' : (isMachine ? '⚙️' : (u.count || 1));
        const countLabel = u.isHero ? 'Герой' : (isMachine ? 'Машина' : (u.count || 1) + ' шт.');

        html += `
          <div class="homm5-atb-slot ${isHaven ? 'homm5-atb-haven' : 'homm5-atb-inferno'} ${isCurrent ? 'homm5-atb-current' : ''}" data-idx="${idx}" title="${u.name} (${countLabel})">
            <div class="homm5-atb-icon">${u.icon || '🛡️'}</div>
            <div class="homm5-atb-count">${countBadge}</div>
          </div>
        `;
      });

      ribbon.innerHTML = html;

      // Обновление полоски Micro-HUD #micro-atb-pill
      const microCur = document.getElementById('micro-atb-current');
      const microIcons = document.getElementById('micro-atb-queue-icons');
      if (microCur && microIcons) {
        const cur = displayQueue[0];
        if (cur) {
          const u = cur.unit || cur;
          microCur.innerHTML = `${u.icon || '🛡️'} ${(u.name || 'Юнит').slice(0, 8)}`;
        }
        let iconsHtml = '';
        displayQueue.slice(1, 4).forEach((item) => {
          const u = item.unit || item;
          const isHaven = u.side === 'player' || u.faction === 'haven';
          iconsHtml += `<span class="micro-atb-mini-icon ${isHaven ? 'micro-atb-player' : 'micro-atb-enemy'}" title="${u.name}">${u.icon || '⚔️'}</span>`;
        });
        microIcons.innerHTML = iconsHtml;
      }

      if (this.isBottomSheetOpen && this.currentSheet === 'atb') {
        this.renderAtbSheet();
      }

      ribbon.querySelectorAll('.homm5-atb-slot').forEach((el) => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-idx'), 10);
          const target = displayQueue[idx];
          if (target) {
            this.openUnitInspectModal(target.actorId || (target.unit && target.unit.id));
          }
        });
      });
    },

    addCombatLogEntry(text, type = 'normal') {
      const body = this.elements.combatLogBody;
      if (!body) return;

      const entry = document.createElement('div');
      entry.className = `homm5-log-entry homm5-log-${type}`;
      entry.innerText = text;

      body.appendChild(entry);
      body.scrollTop = body.scrollHeight;
    },

    spawnFloatingCombatText(text, x, y, type = 'damage') {
      const layer = this.elements.floatingLayer;
      if (!layer) return;

      const el = document.createElement('div');
      el.className = `homm5-fct homm5-fct-${type}`;
      el.innerText = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      layer.appendChild(el);
      setTimeout(() => {
        if (el.parentNode === layer) {
          layer.removeChild(el);
        }
      }, 1250);
    },

    startQuickBattle() {
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.startCustomSkirmish === 'function') {
        const bState = HOMM5.CombatCore.startCustomSkirmish();
        this._initCombatUIAndScene(bState);
      }
    },

    startBattle(missionNode) {
      if (!missionNode) return;
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.startMissionBattle === 'function') {
        const bState = HOMM5.CombatCore.startMissionBattle(missionNode.missionIndex || 1);
        this._initCombatUIAndScene(bState);
      }
    },

    _initCombatUIAndScene(bState) {
      this.setMode('combat');
      if (HOMM5.World3D) {
        if (typeof HOMM5.World3D.setMode === 'function') {
          HOMM5.World3D.setMode('combat');
        }
        if (typeof HOMM5.World3D.buildCombatArena === 'function') {
          HOMM5.World3D.buildCombatArena(bState);
        }
      }

      let activeActor = null;
      if (bState && bState.stacks) {
        activeActor = bState.stacks.find((s) => s.id === bState.activeActorId);
      }
      if (!activeActor && bState) {
        if (bState.heroPlayer && bState.heroPlayer.id === bState.activeActorId) activeActor = bState.heroPlayer;
        else if (bState.heroEnemy && bState.heroEnemy.id === bState.activeActorId) activeActor = bState.heroEnemy;
      }

      if (activeActor) {
        this.updateActiveUnitCard(activeActor);
      }

      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.predictATBQueue === 'function') {
        const queue = HOMM5.CombatCore.predictATBQueue(8);
        this.updateATBRibbon(queue);
      }

      if (activeActor && activeActor.side === 'player' && !this.isAutoCombat) {
        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.getValidActions === 'function') {
          const actions = HOMM5.CombatCore.getValidActions(activeActor.id);
          if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
            HOMM5.World3D.highlightCells(actions);
          }
        }
      }

      this.addCombatLogEntry(`⚔️ Битва началась: ${bState.missionName || 'Сражение на тактической арене'}`, 'round');
    },

    executeAction(actionType) {
      Audio.playSFX('click');
      if (HOMM5.CombatCore) {
        if (actionType === 'wait' && typeof HOMM5.CombatCore.commandWait === 'function') {
          HOMM5.CombatCore.commandWait();
        } else if (actionType === 'defend' && typeof HOMM5.CombatCore.commandDefend === 'function') {
          HOMM5.CombatCore.commandDefend();
        }
      }
    },

    executeHeroStrike() {
      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (!bState || bState.status !== 'active') return;

      const enemies = bState.stacks.filter((s) => s.side === 'enemy' && s.count > 0);
      if (enemies.length === 0) return;

      this.targetingHeroStrike = true;
      this.targetingSpell = null;
      this.showTargetingCancelChip();
      Audio.playSFX('click');
      this.addCombatLogEntry('🗡️ Выберите вражеский отряд кликом для удара Лорда Годрика (Escape для отмены).', 'haven');

      if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
        HOMM5.World3D.highlightCells({
          moves: [],
          targets: enemies.map((e) => ({ col: e.col, row: e.row }))
        });
      }
    },

    toggleAutoCombat() {
      this.isAutoCombat = !this.isAutoCombat;
      Audio.playSFX('click');
      const btn = document.getElementById('btn-act-autocombat');
      if (btn) {
        btn.innerText = this.isAutoCombat ? '⏹️ Стоп Авто' : '🤖 Автобой';
        btn.classList.toggle('homm5-btn-crimson', this.isAutoCombat);
      }
      this.addCombatLogEntry(
        this.isAutoCombat ? '🤖 Автобой ИИ включён!' : '⏸️ Автобой отключён, управление передано игроку.'
      );

      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (this.isAutoCombat && bState && bState.status === 'active') {
        const actor = bState.stacks.find((s) => s.id === bState.activeActorId) || (bState.heroPlayer && bState.heroPlayer.id === bState.activeActorId ? bState.heroPlayer : null);
        if (actor && actor.side === 'player') {
          Bus.emit('battle:turn', {
            activeActor: actor,
            queue: HOMM5.CombatCore.predictATBQueue(8),
            validActions: HOMM5.CombatCore.getValidActions(actor.id)
          });
        }
      }
    },

    _handleCellClick(payload) {
      const col = payload.col;
      const row = payload.row;
      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (!bState || bState.status !== 'active') return;

      // 1. Прицеливание заклинания
      if (this.targetingSpell) {
        const targetStack = bState.stacks.find((s) => s.count > 0 && s.col === col && s.row === row);
        const targetStackId = targetStack ? targetStack.id : null;
        this.castTargetedSpell(this.targetingSpell, col, row, targetStackId);
        this.targetingSpell = null;
        this.hideTargetingCancelChip();
        if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
          HOMM5.World3D.highlightCells(null);
        }
        return;
      }

      // 2. Прицеливание удара героя
      if (this.targetingHeroStrike) {
        const targetStack = bState.stacks.find((s) => s.count > 0 && s.side === 'enemy' && s.col === col && s.row === row);
        if (targetStack) {
          this.targetingHeroStrike = false;
          this.hideTargetingCancelChip();
          if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
            HOMM5.World3D.highlightCells(null);
          }
          HOMM5.CombatCore.executeHeroStrike(targetStack.id);
        } else {
          this.addCombatLogEntry('Выберите вражеский отряд для удара героя!', 'normal');
        }
        return;
      }

      // 3. Стандартный ход активного существа игрока
      const activeActorId = bState.activeActorId;
      const activeActor = bState.stacks.find((s) => s.id === activeActorId) || (bState.heroPlayer && bState.heroPlayer.id === activeActorId ? bState.heroPlayer : null);
      if (!activeActor || activeActor.side !== 'player') return;

      if (activeActor.isHeroActor) {
        const enemyStack = bState.stacks.find((s) => s.count > 0 && s.side === 'enemy' && s.col === col && s.row === row);
        if (enemyStack) {
          this.hideDamagePreview();
          this.closeRadialMenu();
          HOMM5.CombatCore.executeHeroStrike(enemyStack.id);
        }
        return;
      }

      const actions = HOMM5.CombatCore.getValidActions(activeActorId) || {};
      let targetAction = (actions.targets || []).find((t) => t.col === col && t.row === row);
      if (!targetAction) {
        const isMachine = !!(
          activeActor.isWarMachine ||
          activeActor.unitId === 'ballista' ||
          (activeActor.unit && activeActor.unit.isWarMachine)
        );
        if (isMachine) {
          const enemyStack = bState.stacks.find((s) => s.count > 0 && s.side === 'enemy' && s.col === col && s.row === row);
          if (enemyStack) {
            targetAction = { col, row, targetStackId: enemyStack.id };
          }
        }
      }
      if (targetAction) {
        const moveCell = (targetAction.moveFromCol !== undefined && targetAction.moveFromCol !== null && targetAction.moveFromCol >= 0)
          ? { col: targetAction.moveFromCol, row: targetAction.moveFromRow }
          : (targetAction.moveCell || null);
        this.hideDamagePreview();
        this.closeRadialMenu();
        HOMM5.CombatCore.executeUnitAttack(targetAction.targetStackId, moveCell);
        return;
      }

      if (activeActor && !activeActor.isHeroActor && col === activeActor.col && row === activeActor.row) {
        let screenPos = (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function')
          ? HOMM5.World3D.getActorScreenPosition(activeActor.id)
          : null;
        const sx = (screenPos && screenPos.x !== undefined) ? screenPos.x : (payload.screenX || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400));
        const sy = (screenPos && screenPos.y !== undefined) ? screenPos.y : (payload.screenY || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300));
        this.openRadialMenu('unit', sx, sy, activeActor.id);
        return;
      }

      const moveAction = (actions.moves || []).find((m) => m.col === col && m.row === row && (m.col !== activeActor.col || m.row !== activeActor.row));
      if (moveAction) {
        this.hideDamagePreview();
        this.closeRadialMenu();
        HOMM5.CombatCore.executeUnitMove(col, row);
      }
    },

    cancelTargeting() {
      this.targetingSpell = null;
      this.targetingHeroStrike = false;
      this.hideTargetingCancelChip();
      if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
        HOMM5.World3D.highlightCells(null);
      }
      this.addCombatLogEntry('Прицеливание отменено.');
    },

    showTargetingCancelChip() {
      const chip = document.getElementById('targeting-cancel-chip');
      if (chip) chip.classList.remove('homm5-hidden');
    },

    hideTargetingCancelChip() {
      const chip = document.getElementById('targeting-cancel-chip');
      if (chip) chip.classList.add('homm5-hidden');
    },

    _handleCellTap(payload) {
      if (this.targetingSpell || this.targetingHeroStrike) {
        this._handleCellClick(payload);
        return;
      }

      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (bState && bState.status === 'active' && payload && payload.col !== undefined && payload.row !== undefined) {
        // Проверяем, нажат ли союзный отряд игрока
        const ally = (bState.stacks || []).find((s) => s.count > 0 && s.side === 'player' && s.col === payload.col && s.row === payload.row);
        if (ally) {
          let sx = payload.screenX;
          let sy = payload.screenY;
          if (sx === undefined || sy === undefined) {
            if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
              const pos = HOMM5.World3D.getActorScreenPosition(ally.id);
              if (pos) { sx = pos.x; sy = pos.y; }
            }
          }
          if (sx === undefined || sy === undefined) {
            sx = (typeof window !== 'undefined') ? window.innerWidth / 2 : 400;
            sy = (typeof window !== 'undefined') ? window.innerHeight / 2 : 300;
          }
          this.openRadialMenu('unit', sx, sy, ally.id);
          return;
        }
      }

      this.closeRadialMenu();
      this._handleCellClick(payload);
    },

    updateDamagePreview(payload) {
      const tooltip = document.getElementById('damage-preview-tooltip');
      if (!tooltip) return;

      if (this.mode !== 'combat' || !payload || payload.col === undefined || payload.row === undefined) {
        this.hideDamagePreview();
        return;
      }

      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (!bState || bState.status !== 'active') {
        this.hideDamagePreview();
        return;
      }

      const defender = (bState.stacks || []).find((s) => s.count > 0 && s.side === 'enemy' && s.col === payload.col && s.row === payload.row);
      if (!defender) {
        this.hideDamagePreview();
        return;
      }

      const activeActorId = bState.activeActorId;
      const isHeroAiming = this.targetingHeroStrike || activeActorId === 'hero_player';
      const attackerId = isHeroAiming ? 'hero_player' : activeActorId;

      let moveDist = 0;
      const activeStack = (bState.stacks || []).find((s) => s.id === attackerId);
      const isBallistaAttacker = !!(
        activeStack &&
        (activeStack.isWarMachine || activeStack.unitId === 'ballista' || (activeStack.unit && activeStack.unit.isWarMachine))
      );
      if (!isHeroAiming && !isBallistaAttacker && HOMM5.CombatCore && typeof HOMM5.CombatCore.getValidActions === 'function') {
        const valid = HOMM5.CombatCore.getValidActions(attackerId) || {};
        const targetAction = (valid.targets || []).find((t) => t.targetStackId === defender.id);
        if (!targetAction && !this.targetingSpell) {
          this.hideDamagePreview();
          return;
        }
        moveDist = targetAction ? (targetAction.moveDist || 0) : 0;
      }

      let preview = null;
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.estimateDamagePreview === 'function') {
        preview = HOMM5.CombatCore.estimateDamagePreview(attackerId, defender.id, moveDist);
      }

      if (!preview || !preview.ok) {
        this.hideDamagePreview();
        return;
      }

      const dmgStr = preview.minDamage === preview.maxDamage
        ? `${preview.minDamage}`
        : `${preview.minDamage}–${preview.maxDamage}`;

      const unitName = (defender.unit && defender.unit.name) || defender.name || 'воин';
      const killsStr = preview.minKills === preview.maxKills
        ? (preview.minKills > 0 ? `${preview.minKills}` : '0')
        : `${preview.minKills}..${preview.maxKills}`;

      const text = `«⚔️ ${dmgStr} (−${killsStr} воинов)» (ОЗ: ${defender.topHp}/${defender.maxHp})`;
      tooltip.innerHTML = text;

      // Определение экранной позиции тултипа рядом с врагом
      let screenX = payload.screenX;
      let screenY = payload.screenY;
      if (screenX === undefined || screenY === undefined) {
        if (HOMM5.World3D && typeof HOMM5.World3D.getActorScreenPosition === 'function') {
          const pos = HOMM5.World3D.getActorScreenPosition(defender.id);
          if (pos) {
            screenX = pos.x;
            screenY = pos.y;
          }
        }
      }

      const w = (typeof window !== 'undefined') ? window.innerWidth : 800;
      const h = (typeof window !== 'undefined') ? window.innerHeight : 600;

      if (screenX !== undefined && screenY !== undefined) {
        screenX = Math.max(90, Math.min(w - 90, screenX));
        screenY = Math.max(50, Math.min(h - 40, screenY - 16));
        tooltip.style.left = `${Math.round(screenX)}px`;
        tooltip.style.top = `${Math.round(screenY)}px`;
      } else {
        tooltip.style.left = '50%';
        tooltip.style.top = '35%';
      }

      tooltip.classList.remove('homm5-hidden');
      tooltip.style.display = 'block';
    },

    hideDamagePreview() {
      const tooltip = document.getElementById('damage-preview-tooltip');
      if (tooltip) {
        tooltip.classList.add('homm5-hidden');
        tooltip.style.display = 'none';
      }
    },

    openRadialMenu(type, screenX, screenY, stackId) {
      const menu = document.getElementById('radial-action-menu');
      const petalsContainer = document.getElementById('radial-petals');
      if (!menu || !petalsContainer) return;

      this.radialTargetStackId = stackId;
      Audio.playSFX('click');

      const w = (typeof window !== 'undefined') ? window.innerWidth : 800;
      const h = (typeof window !== 'undefined') ? window.innerHeight : 600;

      // Ограничение clamp внутри границ экрана (46x46 px кнопки + радиус 64px)
      screenX = Math.max(76, Math.min(w - 76, Number(screenX) || (w / 2)));
      screenY = Math.max(76, Math.min(h - 76, Number(screenY) || (h / 2)));

      menu.style.left = `${Math.round(screenX)}px`;
      menu.style.top = `${Math.round(screenY)}px`;

      petalsContainer.innerHTML = '';

      if (type === 'adventure_hero') {
        const save = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
        const spAvail = Number((save && save.hero && save.hero.skillPoints) || 0);
        const skillsBadge = spAvail > 0
          ? `<span style="position:absolute; top:-4px; right:-4px; min-width:15px; height:15px; border-radius:50%; background:#fbbf24; color:#0f172a; font-size:9px; font-weight:900; display:flex; align-items:center; justify-content:center; box-shadow:0 0 6px #fde047;">${spAvail}</span>`
          : '';
        const petals = [
          {
            id: 'new_day',
            icon: '⛺',
            label: 'Новый день',
            dx: 0,
            dy: -64,
            badge: '',
            action: () => this.triggerAdvanceAdventureDay()
          },
          {
            id: 'skills',
            icon: '🎡',
            label: 'Умения',
            dx: 64,
            dy: 0,
            badge: skillsBadge,
            action: () => this.openBottomSheet('hero', { section: 'skills' })
          },
          {
            id: 'relics',
            icon: '🗡️',
            label: 'Реликвии',
            dx: 0,
            dy: 64,
            badge: '',
            action: () => this.openBottomSheet('hero', { section: 'relics' })
          },
          {
            id: 'to_castle',
            icon: '🏰',
            label: 'В Замок',
            dx: -64,
            dy: 0,
            badge: '',
            action: () => this.setMode('castle')
          }
        ];

        petals.forEach((p, idx) => {
          const btn = document.createElement('button');
          btn.className = 'radial-btn';
          btn.style.left = `${p.dx}px`;
          btn.style.top = `${p.dy}px`;
          btn.style.animationDelay = `${idx * 0.03}s`;
          btn.innerHTML = `${p.badge}<span class="radial-btn-icon">${p.icon}</span><span class="radial-btn-label">${p.label}</span>`;
          btn.title = p.label;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeRadialMenu();
            p.action();
          });
          petalsContainer.appendChild(btn);
        });
      } else if (type === 'hero') {
        // 6 лепестков вокруг Героя (веер действий и заклинаний)
        const petals = [
          { id: 'strike', icon: '🗡️', label: 'Удар', dx: 0, dy: -64, action: () => this.executeHeroStrike() },
          { id: 'might', icon: '✨', label: 'Кара', dx: 55, dy: -32, action: () => this.prepareSpell('righteous_might') },
          { id: 'shield', icon: '🛡️', label: 'Щит', dx: 55, dy: 32, action: () => this.prepareSpell('divine_shield') },
          { id: 'heal', icon: '💖', label: 'Свет', dx: 0, dy: 64, action: () => this.prepareSpell('holy_light') },
          { id: 'fireball', icon: '☄️', label: 'Шар', dx: -55, dy: 32, action: () => this.prepareSpell('fireball') },
          { id: 'wait', icon: '⏳', label: 'Пауза', dx: -55, dy: -32, action: () => this.executeAction('wait') }
        ];

        petals.forEach((p, idx) => {
          const btn = document.createElement('button');
          btn.className = 'radial-btn';
          btn.style.left = `${p.dx}px`;
          btn.style.top = `${p.dy}px`;
          btn.style.animationDelay = `${idx * 0.03}s`;
          btn.innerHTML = `<span class="radial-btn-icon">${p.icon}</span><span class="radial-btn-label">${p.label}</span>`;
          btn.title = p.label;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeRadialMenu();
            p.action();
          });
          petalsContainer.appendChild(btn);
        });
      } else {
        // 4 круговые кнопки 46x46 px для отряда юнита (радиус 62px)
        const petals = [
          { id: 'defend', icon: '🛡️', label: 'Оборона', dx: 0, dy: -62, action: () => this.executeAction('defend') },
          { id: 'wait', icon: '⏳', label: 'Ждать', dx: 62, dy: 0, action: () => this.executeAction('wait') },
          { id: 'inspect', icon: '🔍', label: 'Досье', dx: 0, dy: 62, action: () => this.openUnitInspectModal(stackId) },
          { id: 'summary', icon: '🏰', label: 'Сводка', dx: -62, dy: 0, action: () => this.openBottomSheet('castle') }
        ];

        petals.forEach((p, idx) => {
          const btn = document.createElement('button');
          btn.className = 'radial-btn';
          btn.style.left = `${p.dx}px`;
          btn.style.top = `${p.dy}px`;
          btn.style.animationDelay = `${idx * 0.03}s`;
          btn.innerHTML = `<span class="radial-btn-icon">${p.icon}</span><span class="radial-btn-label">${p.label}</span>`;
          btn.title = p.label;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeRadialMenu();
            p.action();
          });
          petalsContainer.appendChild(btn);
        });
      }

      menu.classList.remove('homm5-hidden');
    },

    closeRadialMenu() {
      const menu = document.getElementById('radial-action-menu');
      if (menu) menu.classList.add('homm5-hidden');
      this.radialTargetStackId = null;
    },

    prepareSpell(spellId) {
      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (!bState || bState.status !== 'active') return;

      const spell = (CFG.SPELLS || {})[spellId];
      if (!spell) return;

      const hero = bState.heroPlayer;
      if (hero && hero.mana < spell.manaCost) {
        this.addCombatLogEntry(`Недостаточно маны для заклинания «${spell.name}» (требуется ${spell.manaCost}🔮, у вас ${hero.mana}🔮)!`, 'spell');
        Audio.playSFX('defeat');
        return;
      }

      this.targetingSpell = spellId;
      this.targetingHeroStrike = false;
      this.showTargetingCancelChip();

      Audio.playSFX('click');
      this.addCombatLogEntry(`Прицеливание заклинания «${spell.name}». Кликните по целевой клетке поля боя (Escape для отмены).`, 'spell');

      if (HOMM5.World3D && typeof HOMM5.World3D.highlightCells === 'function') {
        const targets = [];
        if (spell.targetType === 'ally') {
          bState.stacks.filter((s) => s.side === 'player' && s.count > 0).forEach((s) => targets.push({ col: s.col, row: s.row }));
        } else if (spell.targetType === 'enemy') {
          bState.stacks.filter((s) => s.side === 'enemy' && s.count > 0).forEach((s) => targets.push({ col: s.col, row: s.row }));
        } else if (spell.targetType === 'area3x3') {
          for (let c = 0; c < 10; c++) {
            for (let r = 0; r < 8; r++) {
              targets.push({ col: c, row: r });
            }
          }
        }
        HOMM5.World3D.highlightCells({ moves: [], targets });
      }
    },

    renderSheetTabsHtml(activeTab) {
      const save = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      const spAvail = Number((save && save.hero && save.hero.skillPoints) || 0);
      const dot = spAvail > 0
        ? `<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#fbbf24; box-shadow:0 0 6px #fde047; margin-left:3px; vertical-align:middle;"></span>`
        : '';
      const inCombat = this.mode === 'combat';
      return `
        <div class="sheet-tabs" style="display:flex; gap:5px; margin-bottom:10px; flex-wrap:wrap;">
          <button class="homm5-btn ${activeTab === 'castle' ? 'homm5-btn-gold' : ''}" style="flex:1; padding:6px 6px; font-size:11px;" data-sheet-tab="castle">🏰 Замок</button>
          <button class="homm5-btn ${activeTab === 'valley' ? 'homm5-btn-gold' : ''}" style="flex:1; padding:6px 6px; font-size:11px;" data-sheet-tab="valley">🗺️ Поход</button>
          <button class="homm5-btn ${activeTab === 'hero' ? 'homm5-btn-gold' : ''}" style="flex:1; padding:6px 6px; font-size:11px;" data-sheet-tab="hero">🎖️ Герой${dot}</button>
          ${inCombat ? `<button class="homm5-btn ${activeTab === 'atb' ? 'homm5-btn-gold' : ''}" style="flex:1; padding:6px 6px; font-size:11px;" data-sheet-tab="atb">⚔️ Очередь</button>` : ''}
          <button class="homm5-btn ${activeTab === 'settings' ? 'homm5-btn-gold' : ''}" style="flex:1; padding:6px 6px; font-size:11px;" data-sheet-tab="settings">⚙️ Меню</button>
        </div>
      `;
    },

    bindSheetTabButtons(content) {
      if (!content) return;
      content.querySelectorAll('[data-sheet-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-sheet-tab');
          if (t) this.openBottomSheet(t);
        });
      });
    },

    openBottomSheet(tab, extraData) {
      const sheet = this.elements.bottomSheet || document.getElementById('homm-bottom-sheet');
      const backdrop = this.elements.bottomSheetBackdrop || document.getElementById('homm-bottom-sheet-backdrop');
      const title = this.elements.bottomSheetTitle || document.getElementById('bottom-sheet-title');
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!sheet || !content) return;

      this.currentSheet = tab;
      this.isBottomSheetOpen = true;
      Audio.playSFX('click');

      if (tab === 'castle') {
        if (title) title.innerText = '🏰 Замок «Коготь Грифона»';
        this.renderCastleSheet(extraData);
      } else if (tab === 'valley') {
        if (title) title.innerText = '🗺️ Поход по Изумрудной Долине';
        this.renderValleySheet();
      } else if (tab === 'hero') {
        if (title) title.innerText = '🎖️ Лорд Годрик: Умения и Реликвии';
        this.renderHeroSheet(extraData);
      } else if (tab === 'atb') {
        if (title) title.innerText = '⚔️ Тактическая шкала инициативы (ATB)';
        this.renderAtbSheet();
      } else if (tab === 'settings') {
        if (title) title.innerText = '⚙️ Настройки и Меню';
        this.renderSettingsSheet();
      }

      sheet.style.transform = '';
      sheet.classList.add('homm5-sheet-open');
      backdrop?.classList.add('homm5-sheet-open');
    },

    closeBottomSheet() {
      const sheet = this.elements.bottomSheet || document.getElementById('homm-bottom-sheet');
      const backdrop = this.elements.bottomSheetBackdrop || document.getElementById('homm-bottom-sheet-backdrop');
      this.isBottomSheetOpen = false;
      this.currentSheet = null;
      if (sheet) {
        sheet.classList.remove('homm5-sheet-open');
        sheet.style.transform = '';
      }
      backdrop?.classList.remove('homm5-sheet-open');
      Audio.playSFX('click');
    },

    renderHeroSheet(extraData) {
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!content) return;

      const save = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      const hero = (save && save.hero) || {};
      const eff = this.getEffectiveHeroStatsFallback(save);
      const advCfg = HOMM5.ADVENTURE_CONFIG || CFG.ADVENTURE_CONFIG || {};
      const xpPerLevel = Number(advCfg.xpPerLevel) || 500;
      const curLvl = Number(hero.level) || 1;
      const curXp = Number(hero.xp) || 0;
      const xpInLevel = curXp % xpPerLevel;
      const xpPct = Math.max(0, Math.min(100, Math.round((xpInLevel / xpPerLevel) * 100)));
      const skillPoints = Math.max(0, Number(hero.skillPoints ?? 0));
      const unlocked = Array.isArray(hero.unlockedSkills) ? hero.unlockedSkills : [];

      const skillsMap = HOMM5.SKILLS || CFG.SKILLS || {};
      const skillOrder = HOMM5.SKILL_ORDER || CFG.SKILL_ORDER || Object.keys(skillsMap);
      const artifactsMap = HOMM5.ARTIFACTS || CFG.ARTIFACTS || {};
      const ownedArts = Array.isArray(save.ownedArtifacts) ? save.ownedArtifacts : [];
      const equippedArts = save.equippedArtifacts || { weapon: null, shield: null, helm: null, boots: null };

      const artifactHints = {
        griffin_blade: 'Добывается в «Реликварии Грифона» или в Миссии III',
        elrath_aegis: 'Добывается за победу в Миссии II (Осада Пепельных Руин)',
        crown_of_light: 'Легендарный трофей Миссии IV (Цитадель Пепла — Аграил)',
        wayfarer_boots: 'Добывается за победу в Миссии I (Пограничная Застава)'
      };

      const curMp = Math.round(typeof save.movePoints === 'number' ? save.movePoints : (eff.movePoints ?? 12));
      const maxMp = Math.round(eff.maxMovePoints || save.maxMovePoints || 12);

      let html = '<div class="sheet-hero-section">';
      html += this.renderSheetTabsHtml('hero');

      html += `
        <div class="sheet-setting-group" style="flex-direction:column; align-items:stretch; gap:8px; border-color:rgba(251,191,36,0.45);">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:28px;">👑</span>
              <div>
                <div style="font-weight:800; color:#fbbf24; font-size:14px;">${hero.name || 'Лорд Годрик'} · Уровень ${curLvl}</div>
                <div style="font-size:11px; color:#cbd5e1;">Опыт: <b>${xpInLevel} / ${xpPerLevel}</b> (всего ${curXp}) · 🐎 ОД: <b>${curMp}/${maxMp}</b></div>
              </div>
            </div>
            <div style="background:rgba(251,191,36,0.16); border:1px solid #fbbf24; border-radius:14px; padding:4px 10px; font-size:11px; font-weight:800; color:#fef08a;">
              Очки умений: ${skillPoints}
            </div>
          </div>
          <div style="width:100%; height:7px; background:#020617; border:1px solid rgba(212,175,55,0.4); border-radius:4px; overflow:hidden;">
            <div style="width:${xpPct}%; height:100%; background:linear-gradient(90deg, #f59e0b 0%, #fef08a 100%);"></div>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:space-between; font-size:11px; color:#e2e8f0; padding-top:2px;">
            <span>⚔️ Атака: <b style="color:#fef08a;">${eff.attack}</b></span>
            <span>🛡️ Защита: <b style="color:#fef08a;">${eff.defense}</b></span>
            <span>✨ Колдовство: <b style="color:#c084fc;">${eff.spellPower}</b></span>
            <span>🔮 Мана: <b style="color:#c084fc;">${eff.mana}/${eff.maxMana}</b></span>
            <span>🎺 Дух: <b style="color:#34d399;">+${eff.morale}</b></span>
            <span>🍀 Удача: <b style="color:#34d399;">+${eff.luck}</b></span>
          </div>
        </div>
      `;

      html += `<div class="sheet-subhead" id="hero-skills-section">🎡 Колесо Умений Ордена Порядка</div>`;
      html += `<div class="skill-wheel-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; margin-top:6px;">`;
      skillOrder.forEach((sid) => {
        const sk = skillsMap[sid];
        if (!sk) return;
        const isUnlocked = unlocked.includes(sid);
        const isAvailable = !isUnlocked && skillPoints > 0;
        const cls = [
          'skill-wheel-node',
          isUnlocked ? 'skill-node-unlocked' : '',
          isAvailable ? 'skill-node-available' : ''
        ].filter(Boolean).join(' ');

        html += `
          <div class="${cls}" style="background:rgba(15,23,42,0.75); border:1px solid ${isUnlocked ? '#34d399' : (isAvailable ? '#fbbf24' : 'rgba(255,255,255,0.12)')}; border-radius:8px; padding:9px 11px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <div style="display:flex; align-items:center; gap:7px;">
                <span style="font-size:20px;">${sk.icon || '✨'}</span>
                <div>
                  <div style="font-weight:700; font-size:12px; color:#fef08a;">${sk.name}</div>
                  <div style="font-size:10px; color:#94a3b8;">${sk.branch || 'Орден Порядка'}</div>
                </div>
              </div>
              ${isUnlocked
                ? `<span style="color:#34d399; font-size:11px; font-weight:800;">✓ Изучено</span>`
                : `<button class="homm5-btn ${isAvailable ? 'homm5-btn-gold' : ''} btn-unlock-skill" data-skill-id="${sk.id}" ${isAvailable ? '' : 'disabled'} style="font-size:10.5px; padding:4px 8px;">Изучить (1 очко)</button>`}
            </div>
            <div style="font-size:11px; color:#cbd5e1; line-height:1.35;">${sk.desc}</div>
          </div>
        `;
      });
      html += `</div>`;

      html += `<div class="sheet-subhead" id="hero-relics-section" style="margin-top:12px;">🗡️ Экипировка Реликвий Асхана (4 слота)</div>`;
      html += `<div class="artifact-doll-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:8px; margin-top:6px;">`;

      const slotMeta = [
        { slot: 'weapon', title: 'Оружие', emptyIcon: '🗡️', artId: 'griffin_blade' },
        { slot: 'shield', title: 'Щит', emptyIcon: '🛡️', artId: 'elrath_aegis' },
        { slot: 'helm', title: 'Венец', emptyIcon: '👑', artId: 'crown_of_light' },
        { slot: 'boots', title: 'Сапоги', emptyIcon: '👢', artId: 'wayfarer_boots' }
      ];

      slotMeta.forEach((sm) => {
        const eqId = equippedArts[sm.slot] || null;
        const art = artifactsMap[eqId || sm.artId] || {};
        const isOwned = ownedArts.includes(art.id) || !!eqId;
        const isEquipped = eqId === art.id && !!eqId;
        const artCls = ['artifact-slot-card', isEquipped ? 'artifact-equipped' : (!isOwned ? 'artifact-locked' : '')].filter(Boolean).join(' ');

        html += `
          <div class="${artCls}" style="background:rgba(15,23,42,0.75); border:1px solid ${isEquipped ? '#fbbf24' : (isOwned ? '#60a5fa' : 'rgba(255,255,255,0.1)')}; border-radius:8px; padding:9px 11px; display:flex; flex-direction:column; gap:6px;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:22px; opacity:${isOwned ? '1' : '0.4'};">${art.icon || sm.emptyIcon}</span>
                <div>
                  <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Слот: ${sm.title}</div>
                  <div style="font-weight:700; font-size:12px; color:${isOwned ? '#fef08a' : '#94a3b8'};">${art.name || sm.title}</div>
                </div>
              </div>
              ${isOwned ? `
                <button class="homm5-btn ${isEquipped ? '' : 'homm5-btn-gold'} btn-toggle-artifact" data-artifact-id="${art.id}" data-slot="${sm.slot}" data-equipped="${isEquipped ? '1' : '0'}" style="font-size:10.5px; padding:4px 8px;">
                  ${isEquipped ? 'Снять' : 'Надеть'}
                </button>
              ` : `<span style="font-size:10px; color:#64748b;">Не найдено</span>`}
            </div>
            <div style="font-size:11px; color:#cbd5e1; line-height:1.35;">${art.desc || ''}</div>
            ${!isOwned ? `<div style="font-size:10px; color:#fbbf24;">📍 ${artifactHints[art.id] || 'Добывается в походе по Долине'}</div>` : ''}
          </div>
        `;
      });

      html += `</div></div>`;
      content.innerHTML = html;

      this.bindSheetTabButtons(content);

      content.querySelectorAll('.btn-unlock-skill').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sid = btn.getAttribute('data-skill-id');
          if (!sid) return;
          let res = null;
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.unlockHeroSkill === 'function') {
            res = HOMM5.CombatCore.unlockHeroSkill(sid);
          } else {
            const cur = SaveV3.getSaveData();
            const h = cur.hero || {};
            if ((h.skillPoints || 0) > 0) {
              h.unlockedSkills = Array.from(new Set([...(h.unlockedSkills || []), sid]));
              h.skillPoints = Math.max(0, (h.skillPoints || 1) - 1);
              if (sid === 'logistics') {
                cur.maxMovePoints = (cur.maxMovePoints || 12) + 4;
                cur.movePoints = (cur.movePoints || 12) + 4;
              }
              SaveV3.saveCurrentState(cur);
              res = { ok: true, message: `Изучено умение «${(skillsMap[sid] && skillsMap[sid].name) || sid}»!` };
            } else {
              res = { ok: false, message: 'Недостаточно очков умений!' };
            }
          }

          if (res && res.ok) {
            Audio.playSFX('skill_up');
            triggerVibrate([35, 25, 65]);
            const updated = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
            SaveV3.saveCurrentState(updated);
            this.updateHUDFromSave(updated);
            if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
              HOMM5.World3D.syncCampaignState(updated);
            }
            this.showAdventureToast(res.message || `✨ Изучено умение «${(skillsMap[sid] && skillsMap[sid].name) || sid}»!`);
            this.renderHeroSheet();
          } else if (res && res.message) {
            Audio.playSFX('defeat');
            this.showAdventureToast(res.message);
          }
        });
      });

      content.querySelectorAll('.btn-toggle-artifact').forEach((btn) => {
        btn.addEventListener('click', () => {
          const aid = btn.getAttribute('data-artifact-id');
          const slot = btn.getAttribute('data-slot');
          const wasEquipped = btn.getAttribute('data-equipped') === '1';
          if (!aid) return;

          let res = null;
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.equipArtifact === 'function') {
            if (wasEquipped && typeof HOMM5.CombatCore.unequipArtifact === 'function') {
              res = HOMM5.CombatCore.unequipArtifact(slot);
            } else {
              res = HOMM5.CombatCore.equipArtifact(wasEquipped ? null : aid, slot);
              if (wasEquipped && res && !res.ok) {
                res = HOMM5.CombatCore.equipArtifact(aid);
              }
            }
          } else {
            const cur = SaveV3.getSaveData();
            cur.equippedArtifacts = cur.equippedArtifacts || { weapon: null, shield: null, helm: null, boots: null };
            cur.equippedArtifacts[slot] = wasEquipped ? null : aid;
            SaveV3.saveCurrentState(cur);
            res = { ok: true };
          }

          Audio.playSFX('build');
          const updated = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
          SaveV3.saveCurrentState(updated);
          this.updateHUDFromSave(updated);
          if (HOMM5.World3D && typeof HOMM5.World3D.syncCampaignState === 'function') {
            HOMM5.World3D.syncCampaignState(updated);
          }
          this.renderHeroSheet();
        });
      });

      if (extraData && (extraData.section === 'relics' || extraData.section === 'artifacts')) {
        const relEl = content.querySelector('#hero-relics-section');
        if (relEl && typeof relEl.scrollIntoView === 'function') {
          setTimeout(() => relEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
      }
    },

    renderCastleSheet(focusBuildingId) {
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!content) return;

      const campState = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      const armyDict = normalizeArmyToDict(campState.army);
      const buildings = campState.buildings || {};
      const pool = campState.dwellingPool || campState.dwellingsAvailable || {};

      let html = '<div class="sheet-castle-section">';

      html += this.renderSheetTabsHtml('castle');
      html += `
        <div class="sheet-nav-actions" style="display:flex; gap:6px; margin-bottom:10px;">
          <button class="homm5-btn homm5-btn-gold" id="btn-sheet-nav-valley" style="flex:1; font-size:11px; padding:6px 8px;">
            🗺️ Выйти в 3D-Долину Похода
          </button>
          <button class="homm5-btn homm5-btn-crimson" id="btn-sheet-nav-quickbattle" style="flex:1; font-size:11px; padding:6px 8px;">
            ⚔️ Быстрый Бой (Дуэль)
          </button>
        </div>
        <div class="sheet-res-bar">
          <span>💰 Золото: <b>${Number(campState.gold || 0).toLocaleString('ru-RU')}</b></span>
          <span>💎 Кристаллы: <b>${campState.crystals || 0}</b></span>
          <span>📅 Неделя ${campState.week || 1}, День ${campState.day || 1}</span>
        </div>
      `;

      html += '<div class="sheet-subhead">🛡️ Гарнизон и Наём существ</div>';
      const orderUnits = ['squire', 'crossbowman', 'griffin', 'paladin'];
      orderUnits.forEach((uid) => {
        const u = CFG.UNITS[uid];
        if (!u) return;
        const inArmy = armyDict[uid] || 0;
        const canRecruit = pool[uid] || 0;
        const bId = u.dwellingBuildingId || (uid === 'squire' ? 'barracks' : uid === 'crossbowman' ? 'marksmen_tower' : uid === 'griffin' ? 'griffin_bastion' : 'cathedral_of_light');
        const isBuilt = buildings[bId] || uid === 'squire' || uid === 'crossbowman';
        const bGrowth = (CFG.BUILDINGS && CFG.BUILDINGS[bId] && CFG.BUILDINGS[bId].weeklyGrowth) || u.weeklyGrowth || 5;

        html += `
          <div class="sheet-unit-row">
            <div class="sheet-row-info">
              <span>${u.icon}</span>
              <div>
                <b>${u.name}</b>: в армии <b>${inArmy}</b>
                <div style="font-size: 10px; color: #94a3b8;">Прирост: +${bGrowth}/нед. Доступно: ${canRecruit}</div>
              </div>
            </div>
            <div class="sheet-row-actions">
              ${isBuilt ? `
                <button class="homm5-btn homm5-btn-gold btn-sheet-recruit" data-unit="${u.id}" ${canRecruit <= 0 || campState.gold < u.costGold ? 'disabled' : ''} style="font-size: 11px; padding: 4px 8px;">
                  +1 (${u.costGold}💰)
                </button>
              ` : `<span style="font-size: 10px; color: #ef4444;">Нужна постройка</span>`}
            </div>
          </div>
        `;
      });

      html += '<div class="sheet-subhead">🏰 Цитадель и Постройки</div>';
      const bList = CFG.BUILDINGS || {};
      Object.keys(bList).forEach((bid) => {
        const b = bList[bid];
        const isBuilt = !!buildings[bid];
        const canAfford = (campState.gold >= (b.costGold || 0)) && (campState.crystals >= (b.costCrystal || 0));

        html += `
          <div class="sheet-building-row" ${bid === focusBuildingId ? 'style="border-color: #fbbf24;"' : ''}>
            <div class="sheet-row-info">
              <span>${b.icon || '🏛️'}</span>
              <div>
                <b>${b.name}</b>
                <div style="font-size: 10px; color: #94a3b8;">${b.desc || ''}</div>
              </div>
            </div>
            <div class="sheet-row-actions">
              ${isBuilt ? '<span style="color: #34d399; font-size: 11px; font-weight: bold;">✅ Возведено</span>' : `
                <button class="homm5-btn btn-sheet-build" data-building="${b.id}" ${!canAfford ? 'disabled' : ''} style="font-size: 11px; padding: 4px 8px;">
                  🔨 ${b.costGold}💰 ${b.costCrystal ? b.costCrystal + '💎' : ''}
                </button>
              `}
            </div>
          </div>
        `;
      });

      html += `
        <div style="margin-top: 10px; text-align: center;">
          <button class="homm5-btn homm5-btn-gold" id="btn-sheet-next-week" style="width: 100%; padding: 8px;">
            📅 Завершить ход недели (+прирост существ)
          </button>
        </div>
      `;

      html += '</div>';
      content.innerHTML = html;

      this.bindSheetTabButtons(content);

      content.querySelectorAll('.btn-sheet-recruit').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uid = btn.getAttribute('data-unit');
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.recruitUnit === 'function') {
            const res = HOMM5.CombatCore.recruitUnit(uid, 1);
            if (res.ok) {
              Audio.playSFX('spell_light');
              this.renderCastleSheet(focusBuildingId);
            } else {
              Audio.playSFX('defeat');
              alert(res.message);
            }
          }
        });
      });

      content.querySelectorAll('.btn-sheet-build').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-building');
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.constructBuilding === 'function') {
            const res = HOMM5.CombatCore.constructBuilding(bid);
            if (res.ok) {
              Audio.playSFX('spell_light');
              this.renderCastleSheet(bid);
            } else {
              Audio.playSFX('defeat');
              alert(res.message);
            }
          }
        });
      });

      content.querySelector('#btn-sheet-next-week')?.addEventListener('click', () => {
        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.nextWeek === 'function') {
          const res = HOMM5.CombatCore.nextWeek();
          if (res.ok) {
            Audio.playSFX('spell_light');
            this.renderCastleSheet(focusBuildingId);
          }
        }
      });

      content.querySelector('#btn-sheet-nav-valley')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.setMode('valley');
      });
      content.querySelector('#btn-sheet-nav-quickbattle')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.startQuickBattle();
      });
    },

    renderValleySheet() {
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!content) return;

      const save = HOMM5.CombatCore ? HOMM5.CombatCore.getCampaignState() : SaveV3.getSaveData();
      const eff = this.getEffectiveHeroStatsFallback(save);
      const nodes = HOMM5.VALLEY_NODES || CFG.VALLEY_NODES || [];
      const completed = save.completedNodes || save.valleyNodesVisited || {};
      const capturedMines = save.capturedMines || {};

      let dailyGold = 0;
      let dailyCrystals = 0;
      let capturedCount = 0;
      nodes.forEach((n) => {
        if (n.type === 'mine' && (capturedMines[n.id] || completed[n.id])) {
          capturedCount++;
          if (n.resource === 'gold') dailyGold += (n.dailyIncome || 350);
          if (n.resource === 'crystals') dailyCrystals += (n.dailyIncome || 1);
        }
      });

      const curMp = Math.round(typeof save.movePoints === 'number' ? save.movePoints : (eff.movePoints ?? 12));
      const maxMp = Math.round(eff.maxMovePoints || save.maxMovePoints || 12);

      let html = '<div class="sheet-valley-section">';
      html += this.renderSheetTabsHtml('valley');

      html += `
        <div class="sheet-nav-actions" style="display:flex; gap:6px; margin-bottom:8px;">
          <button class="homm5-btn homm5-btn-gold" id="btn-vsheet-nav-castle" style="flex:1; font-size:11px; padding:6px 8px;">
            🏰 В 3D-Замок
          </button>
          <button class="homm5-btn" id="btn-vsheet-nav-valley-3d" style="flex:1; font-size:11px; padding:6px 8px;">
            🐎 К 3D-Карте Похода
          </button>
          <button class="homm5-btn homm5-btn-crimson" id="btn-vsheet-nav-quickbattle" style="flex:1; font-size:11px; padding:6px 8px;">
            ⚔️ Быстрый Бой
          </button>
        </div>
        <div class="sheet-res-bar" style="flex-wrap:wrap; gap:8px;">
          <span>📅 Нед. ${save.week || 1}, День <b>${save.day || 1}</b></span>
          <span>🐎 ОД: <b>${curMp}/${maxMp}</b></span>
          <span>⛏️ Шахты (${capturedCount}): <b>+${dailyGold}💰/д${dailyCrystals > 0 ? `, +${dailyCrystals}💎/д` : ''}</b></span>
        </div>
        <div style="margin:8px 0 10px 0;">
          <button class="homm5-btn homm5-btn-gold" id="btn-vsheet-camp-new-day" style="width:100%; padding:8px 10px; font-size:11.5px;">
            ⛺ Разбить лагерь (Новый день — восстановить ОД и собрать доход шахт)
          </button>
        </div>
        <div class="sheet-subhead">🗺️ Объекты Долины и Сюжетные Миссии (1..4)</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
      `;

      nodes.forEach((node) => {
        const isMine = node.type === 'mine';
        const isMineCaptured = isMine && !!(capturedMines[node.id] || completed[node.id]);
        const visited = isMine ? isMineCaptured : !!completed[node.id];
        const isLocked = node.missionIndex && node.missionIndex > (save.maxUnlockedMission || 1);
        const stars = (save.bestStarsByMission && save.bestStarsByMission[node.missionIndex]) || 0;
        const starStr = stars > 0 ? '★'.repeat(stars) : '';

        let btnLabel = '🐎 В поход';
        if (node.type === 'treasure') btnLabel = '💰 Открыть';
        else if (node.type === 'crystal_mine' || node.type === 'mine') btnLabel = '⛏️ Захватить';
        else if (node.type === 'relic') btnLabel = '🗡️ Реликвия';
        else if (node.type === 'obelisk') btnLabel = '🗿 Обелиск';
        else if (node.type === 'battle') btnLabel = '⚔️ В бой';

        let subStatus = node.difficulty || node.desc || 'Готово к походу';
        if (isMineCaptured) {
          subStatus = `🚩 Знамя Ордена поднято (+${node.dailyIncome} ${node.resource === 'crystals' ? '💎' : '💰'}/день)`;
        } else if (visited && node.type !== 'battle') {
          subStatus = '✅ Исследовано';
        } else if (visited && node.type === 'battle') {
          subStatus = `✅ Победа одержана (${starStr || '★'}) — можно повторить`;
        } else if (isLocked) {
          subStatus = '🔒 Откроется после победы в предыдущей миссии';
        }

        const canAct = !isLocked && (!visited || node.type === 'battle');

        html += `
          <div class="sheet-unit-row ${visited ? 'homm5-visited' : ''}" style="opacity:${isLocked ? 0.52 : 1};" data-node-id="${node.id}">
            <div class="sheet-row-info">
              <span style="font-size:20px;">${node.icon}</span>
              <div>
                <b>${node.name}</b> ${starStr ? `<span style="color:var(--gold-bright);">${starStr}</span>` : ''}
                <div style="font-size: 10px; color: #94a3b8;">${subStatus}</div>
              </div>
            </div>
            <div class="sheet-row-actions">
              ${canAct ? `
                <button class="homm5-btn homm5-btn-gold btn-sheet-node-action" data-node-id="${node.id}" style="font-size: 11px; padding: 4px 8px;">
                  ${btnLabel}
                </button>
              ` : (visited ? '<span style="color: #34d399; font-size: 11px; font-weight: bold;">✅ Под контролем</span>' : '<span style="color: #ef4444; font-size: 11px;">🔒 Закрыто</span>')}
            </div>
          </div>
        `;
      });

      html += '</div></div>';
      content.innerHTML = html;

      this.bindSheetTabButtons(content);

      content.querySelector('#btn-vsheet-nav-castle')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.setMode('castle');
      });
      content.querySelector('#btn-vsheet-nav-valley-3d')?.addEventListener('click', () => {
        this.closeBottomSheet();
        if (this.mode !== 'valley') this.setMode('valley');
      });
      content.querySelector('#btn-vsheet-nav-quickbattle')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.startQuickBattle();
      });
      content.querySelector('#btn-vsheet-camp-new-day')?.addEventListener('click', () => {
        this.triggerAdvanceAdventureDay();
        this.renderValleySheet();
      });

      content.querySelectorAll('.btn-sheet-node-action').forEach((btn) => {
        btn.addEventListener('click', () => {
          const nid = btn.getAttribute('data-node-id');
          const node = nodes.find((n) => n.id === nid);
          if (!node) return;
          const isLocked = node.missionIndex && node.missionIndex > (save.maxUnlockedMission || 1);
          if (isLocked) return;

          this.closeBottomSheet();
          if (this.mode !== 'valley' && node.type !== 'battle') {
            this.setMode('valley');
          }
          Bus.emit('3d:nodeClick', { nodeId: node.id });
        });
      });
    },

    renderAtbSheet() {
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!content) return;

      const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
      if (!bState || bState.status !== 'active') {
        content.innerHTML = `
          ${this.renderSheetTabsHtml('atb')}
          <div style="text-align: center; padding: 24px 10px;">
            <div style="font-size: 28px; margin-bottom: 8px;">⚔️</div>
            <div style="font-size: 14px; font-weight: bold; color: #fbbf24; margin-bottom: 6px;">Тактический бой не активен</div>
            <div style="font-size: 12px; color: #94a3b8; margin-bottom: 16px;">Выберите узел долины или запустите Быстрый Бой!</div>
            <button class="homm5-btn homm5-btn-crimson" id="btn-sheet-start-combat" style="padding: 8px 16px;">
              ⚔️ Начать Быстрый Бой
            </button>
          </div>
        `;
        this.bindSheetTabButtons(content);
        content.querySelector('#btn-sheet-start-combat')?.addEventListener('click', () => {
          this.closeBottomSheet();
          this.startQuickBattle();
        });
        return;
      }

      const activeActorId = bState.activeActorId;
      const activeActor = (bState.stacks || []).find((s) => s.id === activeActorId) || (bState.heroPlayer && bState.heroPlayer.id === activeActorId ? bState.heroPlayer : null);

      let html = '<div class="sheet-atb-section">';
      html += this.renderSheetTabsHtml('atb');

      if (activeActor) {
        const isPlayer = activeActor.side === 'player';
        const isMachine = !!(activeActor.isWarMachine || activeActor.unitId === 'ballista' || (activeActor.unit && activeActor.unit.isWarMachine));
        const maxHp = activeActor.maxHp || ((activeActor.unit && activeActor.unit.hp) || activeActor.hp || 20);
        const curHp = activeActor.topHp ?? activeActor.currentHp ?? maxHp;
        html += `
          <div class="sheet-setting-group" style="border-color: ${isPlayer ? '#60a5fa' : '#ef4444'};">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 22px;">${activeActor.icon || '🛡️'}</span>
              <div>
                <b style="color: ${isPlayer ? '#93c5fd' : '#fca5a5'};">${activeActor.name || 'Юнит'}</b>
                <span style="font-size: 11px; color: #fbbf24;"> (${activeActor.isHeroActor ? 'Герой' : (isMachine ? 'Боевая машина' : activeActor.count + ' шт.')})</span>
                <div style="font-size: 11px; color: #cbd5e1;">${activeActor.isHeroActor ? `Мана: ${activeActor.mana ?? 50}/${activeActor.maxMana || 50}` : `ОЗ: ${curHp} / ${maxHp}`} | Инициатива: ${activeActor.initiative || 10}</div>
              </div>
            </div>
            ${isPlayer ? `
              <div class="sheet-row-actions">
                <button class="homm5-btn homm5-btn-gold" id="btn-sheet-defend" style="padding: 6px 10px; font-size: 11px;">🛡️ Оборона</button>
                <button class="homm5-btn" id="btn-sheet-wait" style="padding: 6px 10px; font-size: 11px;">⏳ Ждать</button>
              </div>
            ` : '<span style="color: #ef4444; font-size: 11px; font-weight: bold;">Ход Врага</span>'}
          </div>
        `;
      }

      html += '<div class="sheet-subhead">📋 Полная очередь ходов (ATB)</div>';
      const queue = this.atbQueue || [];
      if (queue.length === 0) {
        html += '<div style="font-size: 12px; color: #94a3b8; padding: 8px;">Очередь формируется...</div>';
      } else {
        html += '<div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">';
        queue.forEach((item, idx) => {
          const isPlayer = item.side === 'player';
          const stObj = (bState.stacks || []).find((s) => s.id === item.actorId);
          const isMachine = !!(stObj && (stObj.isWarMachine || stObj.unitId === 'ballista'));
          const maxHp = (stObj && stObj.maxHp) || item.maxHp || 100;
          const curHp = (stObj && stObj.topHp) ?? item.currentHp ?? maxHp;
          const cntLabel = item.isHero ? 'Герой' : (isMachine ? 'Машина' : ((stObj ? stObj.count : item.count) || 1) + ' шт.');
          html += `
            <div class="sheet-unit-row" style="padding: 6px 10px; ${idx === 0 ? 'background: rgba(30, 41, 59, 0.9); border-color: #fbbf24;' : ''}">
              <div class="sheet-row-info">
                <span style="font-size: 11px; color: #fbbf24; font-weight: bold; width: 22px;">#${idx + 1}</span>
                <span style="font-size: 16px;">${item.icon || '🛡️'}</span>
                <div>
                  <b style="color: ${isPlayer ? '#93c5fd' : '#fca5a5'}; font-size: 12px;">${item.name || 'Юнит'}</b>
                  <span style="font-size: 10px; color: #cbd5e1;"> (${cntLabel})</span>
                </div>
              </div>
              <div style="font-size: 11px; color: #94a3b8;">
                ${item.isHero ? '👑 Полководец' : `ОЗ: ${curHp}/${maxHp}`}
              </div>
            </div>
          `;
        });
        html += '</div>';
      }

      html += '</div>';
      content.innerHTML = html;

      this.bindSheetTabButtons(content);

      content.querySelector('#btn-sheet-defend')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.executeAction('defend');
      });

      content.querySelector('#btn-sheet-wait')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.executeAction('wait');
      });
    },

    renderSettingsSheet() {
      const content = this.elements.bottomSheetContent || document.getElementById('bottom-sheet-content');
      if (!content) return;

      const isMuted = Audio.isMuted();

      let html = `
        ${this.renderSheetTabsHtml('settings')}
        <div class="sheet-settings-list">
          <div class="sheet-setting-group">
            <div>
              <b>📱 Режим интерфейса</b>
              <div style="font-size: 10.5px; color: #94a3b8;">Микро-HUD (≤ 5% экрана) или Классика ПК</div>
            </div>
            <div class="sheet-btn-toggle-pair">
              <button class="homm5-btn ${this.isMinimalHud ? 'homm5-btn-gold' : ''}" id="btn-sheet-hud-minimal">
                📱 Мини 5%
              </button>
              <button class="homm5-btn ${!this.isMinimalHud ? 'homm5-btn-gold' : ''}" id="btn-sheet-hud-classic">
                🖥️ ПК
              </button>
            </div>
          </div>

          <div class="sheet-setting-group">
            <div>
              <b>🔊 Звук и Музыка</b>
              <div style="font-size: 10.5px; color: #94a3b8;">Синтезатор WebAudio и боевые фанфары</div>
            </div>
            <button class="homm5-btn" id="btn-sheet-toggle-sound">
              ${isMuted ? '🔇 Включить' : '🔊 Выключить'}
            </button>
          </div>

          <div class="sheet-setting-group">
            <div>
              <b>🌅 Освещение Асхана</b>
              <div style="font-size: 10.5px; color: #94a3b8;">Светлый полдень или Затмение/Закат</div>
            </div>
            <button class="homm5-btn" id="btn-sheet-toggle-light">
              🌅 День / Закат
            </button>
          </div>

          <div class="sheet-setting-group">
            <div>
              <b>📲 Мобильная игра</b>
              <div style="font-size: 10.5px; color: #94a3b8;">Установить PWA или скачать Android APK</div>
            </div>
            <button class="homm5-btn homm5-btn-gold" id="btn-sheet-open-install">
              📲 Установка
            </button>
          </div>

          <div class="sheet-setting-group">
            <div>
              <b>💾 Сохранения (v3)</b>
              <div style="font-size: 10.5px; color: #94a3b8;">IndexedDB + LocalStorage + Экспорт JSON</div>
            </div>
            <div class="sheet-btn-toggle-pair">
              <button class="homm5-btn" id="btn-sheet-quick-save">💾 Сохранить</button>
              <button class="homm5-btn" id="btn-sheet-open-saves">📂 Меню</button>
            </div>
          </div>
        </div>
      `;

      content.innerHTML = html;

      this.bindSheetTabButtons(content);

      content.querySelector('#btn-sheet-hud-minimal')?.addEventListener('click', () => {
        this.setHUDMode(true);
      });

      content.querySelector('#btn-sheet-hud-classic')?.addEventListener('click', () => {
        this.setHUDMode(false);
      });

      content.querySelector('#btn-sheet-toggle-sound')?.addEventListener('click', () => {
        Audio.toggleMute();
        this.renderSettingsSheet();
      });

      content.querySelector('#btn-sheet-toggle-light')?.addEventListener('click', () => {
        this.toggleLighting();
      });

      content.querySelector('#btn-sheet-open-install')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.openInstallModal();
      });

      content.querySelector('#btn-sheet-quick-save')?.addEventListener('click', () => {
        SaveV3.saveCurrentState();
        alert('💾 Прогресс кампании сохранён (Dual-Layer v3)!');
      });

      content.querySelector('#btn-sheet-open-saves')?.addEventListener('click', () => {
        this.closeBottomSheet();
        this.openSaveModal();
      });
    },

    castTargetedSpell(spellId, col, row, targetStackId) {
      if (HOMM5.CombatCore && typeof HOMM5.CombatCore.castSpell === 'function') {
        const res = HOMM5.CombatCore.castSpell(spellId, col, row, targetStackId);
        if (!res.ok) {
          this.addCombatLogEntry(res.message, 'spell');
        }
      }
    },

    openModal(htmlContent) {
      const container = this.elements.modalContainer;
      if (!container) return;
      container.innerHTML = htmlContent;
      container.classList.add('homm5-active');

      container.querySelectorAll('.homm5-modal-close, [data-modal-close]').forEach((btn) => {
        btn.addEventListener('click', () => this.closeModal());
      });
    },

    closeModal() {
      const container = this.elements.modalContainer;
      if (!container) return;
      container.classList.remove('homm5-active');
      container.innerHTML = '';
    },

    openCastleModal(focusBuildingId) {
      const save = SaveV3.getSaveData();
      const buildings = CFG.BUILDINGS || {};
      const units = CFG.UNITS || {};
      const dwellings = save.dwellingsAvailable || save.recruitsAvailable || {};

      let bldHtml = '<div class="homm5-buildings-grid">';
      Object.keys(buildings).forEach((bid) => {
        const b = buildings[bid];
        const isBuilt = !!(save.buildings && save.buildings[bid]);
        const canBuild = !isBuilt && save.gold >= b.costGold && save.crystals >= b.costCrystal;
        const avail = dwellings[b.unlocksUnit] || 0;

        bldHtml += `
          <div class="homm5-building-card ${isBuilt ? 'homm5-building-built' : ''} ${focusBuildingId === bid ? 'homm5-building-focus' : ''}">
            <div class="homm5-bld-top">
              <div class="homm5-bld-icon">${b.icon}</div>
              <div>
                <div class="homm5-bld-title">${b.name}</div>
                <div style="font-size:10px; color:${isBuilt ? 'var(--heal-green)' : 'var(--gold-imperial)'};">
                  ${isBuilt ? '✅ Построено' : `Стоимость: ${b.costGold} 💰, ${b.costCrystal} 💎`}
                </div>
              </div>
            </div>
            <div class="homm5-bld-desc">${b.desc}</div>
            <div class="homm5-bld-cost-row">
              <span style="font-size:11px; color:#94a3b8;">${isBuilt ? `В резерве: ${avail}` : `Прирост: +${b.weeklyGrowth}/нед.`}</span>
              ${!isBuilt ? `
                <button class="homm5-btn homm5-btn-gold" data-build-id="${bid}" ${canBuild ? '' : 'disabled'}>
                  Возвести
                </button>
              ` : `
                <button class="homm5-btn" data-recruit-unit="${b.unlocksUnit}">
                  Нанять
                </button>
              `}
            </div>
          </div>
        `;
      });
      bldHtml += '</div>';

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">🏛️ Цитадель «Коготь Грифона»: Отстройка и Наём</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div style="font-size:12px; color:#cbd5e1;">Возводите священные бастионы Ордена и пополняйте армию перед походом против демонов Шио.</div>
            ${bldHtml}
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      this.elements.modalContainer?.querySelectorAll('[data-build-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const bid = btn.getAttribute('data-build-id');
          if (!bid) return;
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.constructBuilding === 'function') {
            const res = HOMM5.CombatCore.constructBuilding(bid);
            if (res.ok) {
              Audio.playSFX('build');
              this.openCastleModal(bid);
            } else {
              alert(res.message);
            }
          }
        });
      });

      this.elements.modalContainer?.querySelectorAll('[data-recruit-unit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uid = btn.getAttribute('data-recruit-unit');
          if (!uid) return;
          if (HOMM5.CombatCore && typeof HOMM5.CombatCore.recruitUnit === 'function') {
            const camp = HOMM5.CombatCore.getCampaignState();
            const avail = (camp.dwellingsAvailable && camp.dwellingsAvailable[uid]) || 0;
            if (avail <= 0) {
              alert('Все доступные воины этого типа уже наняты на этой неделе!');
              return;
            }
            const countToRecruit = Math.min(avail, 5);
            const res = HOMM5.CombatCore.recruitUnit(uid, countToRecruit);
            if (res.ok) {
              Audio.playSFX('recruit');
              this.openCastleModal();
            } else {
              alert(res.message);
            }
          }
        });
      });
    },

    openSpellbookModal() {
      const spells = CFG.SPELLS || {};
      const save = SaveV3.getSaveData();
      const hero = save.hero || {};
      const curMana = hero.mana ?? 50;

      let spHtml = '<div class="homm5-spellbook-grid">';
      Object.keys(spells).forEach((sid) => {
        const s = spells[sid];
        const canCast = curMana >= s.manaCost;

        spHtml += `
          <div class="homm5-spell-card ${canCast ? '' : 'homm5-spell-disabled'}" data-spell-id="${sid}">
            <div class="homm5-spell-top">
              <div class="homm5-spell-icon-name">
                <span class="homm5-spell-icon">${s.icon}</span>
                <span class="homm5-spell-name">${s.name}</span>
              </div>
              <span class="homm5-spell-mana-tag">${s.manaCost} 🔮</span>
            </div>
            <div class="homm5-spell-school">${s.school}</div>
            <div class="homm5-spell-desc">${s.desc}</div>
            <button class="homm5-btn homm5-btn-magic" style="margin-top:auto;" ${canCast ? '' : 'disabled'}>
              ${canCast ? 'Сотворить заклинание' : 'Недостаточно маны'}
            </button>
          </div>
        `;
      });
      spHtml += '</div>';

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">📖 Книга Заклинаний Эльрата (Мана: ${curMana} / ${hero.maxMana || 50})</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div style="font-size:12px; color:#cbd5e1;">Выберите священное заклинание Света или разрушительное заклинание Хаоса. Затем укажите клетку цели на поле боя.</div>
            ${spHtml}
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      this.elements.modalContainer?.querySelectorAll('[data-spell-id]').forEach((card) => {
        card.addEventListener('click', () => {
          const sid = card.getAttribute('data-spell-id');
          const s = spells[sid];
          if (!s || curMana < s.manaCost) return;

          this.closeModal();
          this.prepareSpell(sid);
        });
      });
    },

    openUnitInspectModal(unitOrStackId) {
      let unit = null;
      let stack = null;
      const warMachines = HOMM5.WAR_MACHINES || CFG.WAR_MACHINES || {};

      if (typeof unitOrStackId === 'string') {
        const bState = HOMM5.CombatCore ? HOMM5.CombatCore.getBattleState() : null;
        if (bState && bState.stacks) {
          stack = bState.stacks.find((s) => s.id === unitOrStackId);
        }
        if (stack) {
          unit = CFG.UNITS[stack.unitId] || warMachines[stack.unitId] || stack;
        } else if (bState && bState.warMachine && (bState.warMachine.id === unitOrStackId || bState.warMachine.unitId === unitOrStackId)) {
          stack = bState.warMachine;
          unit = warMachines[stack.unitId || 'ballista'] || stack;
        } else if (bState && bState.heroPlayer && bState.heroPlayer.id === unitOrStackId) {
          unit = bState.heroPlayer;
        } else if (bState && bState.heroEnemy && bState.heroEnemy.id === unitOrStackId) {
          unit = bState.heroEnemy;
        } else if (CFG.UNITS[unitOrStackId]) {
          unit = CFG.UNITS[unitOrStackId];
        } else if (warMachines[unitOrStackId]) {
          unit = warMachines[unitOrStackId];
        }
      } else {
        unit = unitOrStackId;
      }

      if (!unit) return;

      const isMachine = !!(unit.isWarMachine || (stack && stack.isWarMachine) || unit.id === 'ballista');
      const spdVal = unit.speed !== undefined ? unit.speed : 5;
      const shotsVal = (unit.isRanged || unit.ranged)
        ? ((unit.shots >= 90 || (stack && stack.shotsLeft >= 90)) ? 'Без лимита' : (stack && stack.shotsLeft !== undefined ? stack.shotsLeft : unit.shots))
        : 'Ближний бой';
      const moveTypeLabel = isMachine ? 'Стационарная' : (unit.isFlying ? 'Полёт' : 'Пеший');

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:540px;">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">${unit.name} ${isMachine ? '(Боевая машина)' : (unit.tier ? `(Ранг ${unit.tier})` : '')}</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div class="homm5-inspect-body">
              <div class="homm5-inspect-avatar-box">
                <div class="homm5-inspect-avatar-icon">${unit.icon || '🛡️'}</div>
                <div style="font-size:11px; font-weight:700; color:var(--gold-bright);">
                  ${unit.faction === 'haven' || unit.side === 'player' ? 'Орден Порядка' : 'Инферно'}
                </div>
              </div>
              <div class="homm5-inspect-stats-grid">
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Здоровье (ОЗ):</span><span class="homm5-stat-value">${unit.hp ?? 100}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Атака:</span><span class="homm5-stat-value">${unit.attack ?? 0}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Защита:</span><span class="homm5-stat-value">${unit.defense ?? 0}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Урон:</span><span class="homm5-stat-value">${unit.minDmg ? `${unit.minDmg} - ${unit.maxDmg}` : (unit.attack ?? 6)}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Инициатива:</span><span class="homm5-stat-value">${unit.initiative ?? 10}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Скорость:</span><span class="homm5-stat-value">${spdVal}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Выстрелы:</span><span class="homm5-stat-value">${shotsVal}</span></div>
                <div class="homm5-stat-pill"><span class="homm5-stat-label">Тип движения:</span><span class="homm5-stat-value">${moveTypeLabel}</span></div>
              </div>
            </div>
            <div class="homm5-inspect-ability-box">
              <div style="font-weight:700; color:var(--gold-glow); margin-bottom:4px;">✨ Особая способность: ${unit.abilityName || 'Боевая выучка'}</div>
              <div>${unit.abilityDesc || unit.bio || 'Закалённые бойцы, верные своему полководцу.'}</div>
            </div>
          </div>
        </div>
      `;

      this.openModal(modalHtml);
    },

    openTreasureModal(node) {
      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:560px;">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">💰 Королевский Сундук Ордена</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div style="font-size:12px; color:#cbd5e1; text-align:center;">
              Ваш авангард обнаружил запечатанный ларец королей. Что избрать для блага кампании?
            </div>
            <div class="homm5-chest-choices">
              <div class="homm5-chest-card" id="btn-choice-gold">
                <div class="homm5-chest-icon">💰</div>
                <div style="font-family:var(--font-serif-royal); font-weight:700; color:var(--gold-bright);">950 Золота</div>
                <div style="font-size:11px; color:#94a3b8;">Пополнить казну замка для возведения Бастиона Грифонов и Собора.</div>
                <button class="homm5-btn homm5-btn-gold" style="width:100%;">Забрать Золото</button>
              </div>
              <div class="homm5-chest-card" id="btn-choice-xp">
                <div class="homm5-chest-icon">👑</div>
                <div style="font-family:var(--font-serif-royal); font-weight:700; color:var(--gold-bright);">Опыт Героя</div>
                <div style="font-size:11px; color:#94a3b8;">Раздать реликвии войску: +1 к Атаке и +1 к Силе Магии Лорда Годрика.</div>
                <button class="homm5-btn" style="width:100%;">Получить Опыт</button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      document.getElementById('btn-choice-gold')?.addEventListener('click', () => {
        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.interactValleyNode === 'function') {
          const res = HOMM5.CombatCore.interactValleyNode(node.id, 'gold');
          if (res.ok) {
            Audio.playSFX('build');
            this.closeModal();
            this.renderValleyLeftPanel();
          }
        }
      });

      document.getElementById('btn-choice-xp')?.addEventListener('click', () => {
        if (HOMM5.CombatCore && typeof HOMM5.CombatCore.interactValleyNode === 'function') {
          const res = HOMM5.CombatCore.interactValleyNode(node.id, 'xp');
          if (res.ok) {
            Audio.playSFX('spell_light');
            this.closeModal();
            this.renderValleyLeftPanel();
          }
        }
      });
    },

    openVictoryModal(payload) {
      const stars = Math.max(1, Math.min(3, payload.stars || 3));
      const starStr = '★'.repeat(stars) + '<span class="homm5-star-empty">' + '☆'.repeat(Math.max(0, 3 - stars)) + '</span>';
      const artifacts = HOMM5.ARTIFACTS || CFG.ARTIFACTS || {};
      const artId = payload.artifactReward || payload.rewardArtifact || null;
      const artDef = artId ? artifacts[artId] : null;
      const xpReward = payload.xpReward || payload.rewardXp || 0;
      const save = SaveV3.getSaveData();
      const hasSp = ((save.hero && save.hero.skillPoints) || 0) > 0;

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:520px; text-align:center;">
          <div class="homm5-modal-header" style="justify-content:center;">
            <span class="homm5-modal-title" style="color:var(--gold-bright);">✨ Торжество Света Эльрата!</span>
          </div>
          <div class="homm5-modal-body">
            <div class="homm5-victory-stars">${starStr}</div>
            <div style="font-size:14px; font-weight:700; color:#e2e8f0; margin-bottom:8px;">
              ${payload.missionName || 'Вражеский авангард повержен!'}
            </div>
            <div style="font-size:12px; color:#94a3b8; line-height:1.6;">
              Награда за подвиг:<br>
              💰 Золото: <b>+${payload.goldReward || 1100}</b> · 💎 Кристаллы Света: <b>+${payload.crystalReward || 3}</b>
              ${xpReward > 0 ? `<br>👑 Опыт Лорда Годрика: <b>+${xpReward}</b>` : ''}
              ${artDef ? `<br><span style="color:var(--gold-bright);">🗡️ Добыта реликвия: <b>${artDef.icon} ${artDef.name}</b></span>` : ''}
            </div>
            <div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap; margin-top:14px;">
              <button class="homm5-btn homm5-btn-gold" id="btn-victory-continue" style="padding:10px 18px; font-size:13px;">
                🗺️ В Поход
              </button>
              <button class="homm5-btn" id="btn-victory-castle" style="padding:10px 16px; font-size:13px;">
                🏰 В Замок
              </button>
              ${(hasSp || artDef) ? `
                <button class="homm5-btn" id="btn-victory-hero" style="padding:10px 16px; font-size:13px;">
                  🎖️ Герой${hasSp ? ' •' : ''}
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      document.getElementById('btn-victory-continue')?.addEventListener('click', () => {
        this.closeModal();
        this.setMode('valley');
      });

      document.getElementById('btn-victory-castle')?.addEventListener('click', () => {
        this.closeModal();
        this.setMode('castle');
      });

      document.getElementById('btn-victory-hero')?.addEventListener('click', () => {
        this.closeModal();
        this.setMode('valley');
        this.openBottomSheet('hero', { section: hasSp ? 'skills' : 'artifacts' });
      });
    },

    openDefeatModal(payload) {
      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:500px; text-align:center;">
          <div class="homm5-modal-header" style="justify-content:center;">
            <span class="homm5-modal-title" style="color:var(--inferno-flame);">☠️ Тьма поглотила авангард</span>
          </div>
          <div class="homm5-modal-body">
            <div style="font-size:48px; margin:10px 0;">🩸</div>
            <div style="font-size:13px; color:#cbd5e1; line-height:1.5;">
              Полки Шио оказались сильнее в этот час. Отступите в замок Коготь Грифона, перегруппируйте гарнизон и возведите Собор Эльрата!
            </div>
            <button class="homm5-btn homm5-btn-crimson" id="btn-defeat-retreat" style="margin-top:14px; padding:10px 20px; font-size:14px;">
              Вернуться в Замок
            </button>
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      document.getElementById('btn-defeat-retreat')?.addEventListener('click', () => {
        this.closeModal();
        this.setMode('castle');
      });
    },

    openSaveModal() {
      const save = SaveV3.getSaveData();

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:580px;">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">💾 Хранилище Сохранений (Save Engine v3)</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div class="homm5-save-storage-badge">
              <span>⚡ Хранилища:</span>
              <b>LocalStorage: Активно</b> | <b>IndexedDB: Синхронизировано</b>
            </div>

            <div style="display:flex; gap:10px; margin-top:4px;">
              <button class="homm5-btn homm5-btn-gold" id="btn-save-export-file" style="flex:1;">
                📥 Скачать файл .json
              </button>
              <button class="homm5-btn" id="btn-save-copy-code" style="flex:1;">
                📋 Копировать код
              </button>
            </div>

            <button class="homm5-btn homm5-btn-gold" id="btn-save-mobile-install" style="width:100%; margin-top:6px; min-height:38px;">
              📲 Версия для смартфона (PWA / Android APK)
            </button>

            <div style="font-size:11px; color:#94a3b8; margin-top:8px;">
              Импорт прогресса (вставьте JSON или Base64 код из буфера / другого устройства):
            </div>
            <textarea class="homm5-save-textarea" id="save-import-textarea" placeholder="Вставьте код сохранения сюда..."></textarea>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
              <button class="homm5-btn homm5-btn-crimson" id="btn-save-reset" style="font-size:11px;">
                🗑️ Новая Игра (Сброс)
              </button>
              <button class="homm5-btn homm5-btn-gold" id="btn-save-do-import">
                📤 Загрузить сохранение
              </button>
            </div>
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      document.getElementById('btn-save-export-file')?.addEventListener('click', () => {
        SaveV3.exportSaveJSON();
        Audio.playSFX('click');
        alert('Файл сохранения .json успешно сформирован и скачан!');
      });

      document.getElementById('btn-save-copy-code')?.addEventListener('click', () => {
        SaveV3.exportSaveJSON();
        Audio.playSFX('click');
        alert('Код сохранения скопирован в буфер обмена!');
      });

      document.getElementById('btn-save-mobile-install')?.addEventListener('click', () => {
        Audio.playSFX('click');
        this.closeModal();
        this.openInstallModal();
      });

      document.getElementById('btn-save-do-import')?.addEventListener('click', () => {
        const ta = document.getElementById('save-import-textarea');
        if (!ta || !ta.value.trim()) {
          alert('Пожалуйста, вставьте код сохранения в текстовое поле!');
          return;
        }
        try {
          SaveV3.importSaveJSON(ta.value);
          Audio.playSFX('build');
          alert('Сохранение успешно импортировано и объединено с вашим прогрессом!');
          this.closeModal();
        } catch (err) {
          alert(`Ошибка импорта: ${err.message}`);
        }
      });

      document.getElementById('btn-save-reset')?.addEventListener('click', () => {
        if (confirm('Вы уверены, что хотите начать Новую Игру? Текущий прогресс будет сброшен!')) {
          SaveV3.resetSaveData();
          Audio.playSFX('click');
          this.closeModal();
          this.setMode('castle');
        }
      });
    },

    /**
     * Модалка: Мобильная версия и Android APK (PWA)
     */
    openInstallModal() {
      const isStandalone = (typeof window !== 'undefined') && (
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        (window.navigator && window.navigator.standalone === true)
      );

      const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window && window.MSStream);

      const modalHtml = `
        <div class="homm5-panel homm5-modal-window" style="max-width:540px;">
          <div class="homm5-modal-header">
            <span class="homm5-modal-title">📲 Мобильная версия и Android APK</span>
            <button class="homm5-modal-close" title="Закрыть">✕</button>
          </div>
          <div class="homm5-modal-body">
            <div style="font-size:12px; color:#cbd5e1; line-height:1.45;">
              Игра полностью оптимизирована для мобильных экранов с сенсорным управлением, 60 FPS Three.js 3D-графикой и оффлайн-сохранениями.
            </div>

            <div class="homm5-install-grid">
              <!-- 1. PWA Установка -->
              <div class="homm5-install-card">
                <div class="homm5-install-card-title">
                  <span>📲</span>
                  <span>1. Web-App (PWA в 1 тап)</span>
                </div>
                <div class="homm5-install-desc">
                  Установка прямо из браузера на рабочий стол смартфона. Игра запустится на полный экран без рамок и будет работать оффлайн.
                </div>
                ${isStandalone ? `
                  <div style="color:var(--heal-green); font-weight:700; font-size:13px; padding:6px 0;">
                    ✅ Мобильное приложение активно!
                  </div>
                ` : `
                  <button class="homm5-btn homm5-btn-gold" id="btn-trigger-pwa-install" style="width:100%; min-height:42px;">
                    📲 Установить Web-App на телефон
                  </button>
                `}
                ${isIOS ? `
                  <div class="homm5-ios-tip">
                    🍏 <b>Для iPhone / iPad (Safari):</b> В Safari нажмите кнопку <b>[Поделиться ⬆️]</b> внизу и выберите <b>«На экран Домой»</b> — игра запустится на весь экран без рамок браузера и будет работать даже без интернета!
                  </div>
                ` : ''}
              </div>

              <!-- 2. Android APK -->
              <div class="homm5-install-card">
                <div class="homm5-install-card-title">
                  <span>🤖</span>
                  <span>2. Android .APK (Оффлайн-пакет)</span>
                </div>
                <div class="homm5-install-desc">
                  Автономный установочный файл APK для смартфонов и планшетов Android.
                </div>
                <a href="./Heroes5_3D_Mini_RU.apk" download="Heroes5_3D_Mini_RU.apk" class="homm5-btn homm5-btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:42px;">
                  🤖 Скачать Android .APK (Оффлайн-пакет)
                </a>
              </div>

              <!-- 3. Полноэкранный режим -->
              <div class="homm5-install-card">
                <div class="homm5-install-card-title">
                  <span>⛶</span>
                  <span>3. Полноэкранный режим браузера</span>
                </div>
                <div class="homm5-install-desc">
                  Скрыть адресную строку браузера для комфортного управления пальцами в 3D-сцене.
                </div>
                <button class="homm5-btn" id="btn-toggle-fullscreen" style="width:100%; min-height:42px;">
                  ⛶ Переключить полный экран
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.openModal(modalHtml);

      document.getElementById('btn-trigger-pwa-install')?.addEventListener('click', () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.then((choiceResult) => {
            if (choiceResult && choiceResult.outcome === 'accepted') {
              this.addCombatLogEntry('📲 Мобильное приложение успешно установлено!', 'haven');
            }
            deferredInstallPrompt = null;
          }).catch(() => {});
        } else {
          if (isIOS) {
            alert('Для iPhone в Safari нажмите значок «Поделиться ⬆️» внизу и выберите «На экран Домой»');
          } else {
            alert('Чтобы установить игру, откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран»');
          }
        }
      });

      document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
          }
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
          }
        }
      });
    }
  };

  HOMM5.SaveV3 = SaveV3;
  HOMM5.Audio = Audio;
  HOMM5.UI = UI;

  root.HOMM5 = HOMM5;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SaveV3, Audio, UI };
  }
})(typeof window !== 'undefined' ? window : globalThis);
