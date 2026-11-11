/**
 * Герои Меча и Магии V: Эпоха Грифонов — 3D Мини (RU)
 * Тактическое ядро кампании, конного похода, Колеса Умений, Реликвий, 3D-Баллисты и боя ATB (v3.0)
 *
 * Совместимо с браузером (window.HOMM5.CombatCore) и Node.js безголовыми тестами ОТК-1.
 */
(function (root) {
  'use strict';

  let HOMM5 = root.HOMM5;
  if (!HOMM5 && typeof require !== 'undefined') {
    try {
      HOMM5 = require('./homm5_contract.js');
    } catch (e) {
      // Игнорируем ошибку загрузки, если запускается в специальной среде
    }
  }
  HOMM5 = HOMM5 || root.HOMM5 || {};

  // Вспомогательная функция для безопасного вызова событий шины
  function safeEmit(event, payload) {
    if (HOMM5 && HOMM5.Bus && typeof HOMM5.Bus.emit === 'function') {
      HOMM5.Bus.emit(event, payload);
    }
  }

  // Вспомогательное глубокое клонирование
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // Доступ к реестрам контракта v3.0 с защитными фолбэками
  function getAdventureConfig() {
    return HOMM5.ADVENTURE_CONFIG || (HOMM5.CONFIG && HOMM5.CONFIG.ADVENTURE_CONFIG) || {
      baseMovePoints: 12,
      startPos: { x: 0, z: 6.5 },
      moveCostPerUnitDist: 0.42,
      interactionRadius: 2.6,
      xpPerLevel: 500,
      fogSectors: [
        { id: 'sector_castle_gate', name: 'Врата Когтя Грифона', x: 0, z: 8.5, radius: 11.5, defaultRevealed: true },
        { id: 'sector_west_woods', name: 'Западная Застава и Роща', x: -10.5, z: 11.5, radius: 9.5, defaultRevealed: true },
        { id: 'sector_east_crystals', name: 'Восточные Кристальные Скалы', x: 12.0, z: 9.5, radius: 9.5, defaultRevealed: true },
        { id: 'sector_ashen_ruins', name: 'Пепельные Руины и Святилища', x: 1.5, z: 18.0, radius: 10.5, defaultRevealed: false },
        { id: 'sector_citadel_ash', name: 'Цитадель Пепла Шио', x: 12.5, z: 21.5, radius: 11.0, defaultRevealed: false }
      ]
    };
  }

  function getSkillsRegistry() {
    return HOMM5.SKILLS || (HOMM5.CONFIG && HOMM5.CONFIG.SKILLS) || {};
  }

  function getArtifactsRegistry() {
    return HOMM5.ARTIFACTS || (HOMM5.CONFIG && HOMM5.CONFIG.ARTIFACTS) || {};
  }

  function getWarMachinesRegistry() {
    return HOMM5.WAR_MACHINES || (HOMM5.CONFIG && HOMM5.CONFIG.WAR_MACHINES) || {};
  }

  function getValleyNodes() {
    return HOMM5.VALLEY_NODES || (HOMM5.CONFIG && HOMM5.CONFIG.VALLEY_NODES) || [];
  }

  function getMissionNode(missionIndex) {
    const missions = HOMM5.MISSIONS || (HOMM5.CONFIG && HOMM5.CONFIG.MISSIONS);
    if (missions && missions[missionIndex]) {
      return missions[missionIndex];
    }
    return getValleyNodes().find((n) => n.missionIndex === missionIndex) || null;
  }

  function buildDefaultRevealedSectors() {
    const adv = getAdventureConfig();
    const sectors = adv.fogSectors || [];
    const map = {};
    for (let i = 0; i < sectors.length; i++) {
      const s = sectors[i];
      if (s && s.id && s.defaultRevealed) {
        map[s.id] = true;
      }
    }
    if (Object.keys(map).length === 0) {
      map.sector_castle_gate = true;
      map.sector_west_woods = true;
      map.sector_east_crystals = true;
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // 1. СОСТОЯНИЕ КАМПАНИИ, ПОХОДА, КОЛЕСА УМЕНИЙ И РЕЛИКВИЙ (v3.0)
  // ---------------------------------------------------------------------------

  let campaignState = null;

  function createDefaultCampaign() {
    const adv = getAdventureConfig();
    const startPos = adv.startPos || { x: 0, z: 6.5 };
    const baseMP = adv.baseMovePoints || 12;

    const lord = (HOMM5.CONFIG && HOMM5.CONFIG.HEROES && HOMM5.CONFIG.HEROES.haven_lord)
      ? deepClone(HOMM5.CONFIG.HEROES.haven_lord)
      : {
          id: 'haven_lord',
          name: 'Лорд Годрик',
          faction: 'haven',
          icon: '👑',
          attack: 6,
          defense: 7,
          spellPower: 5,
          knowledge: 5,
          maxMana: 50,
          initiative: 10,
          morale: 2,
          luck: 2
        };

    lord.level = 1;
    lord.xp = 0;
    lord.mana = lord.maxMana || 50;
    lord.skillPoints = 1;
    lord.unlockedSkills = [];

    campaignState = {
      gold: 1650,
      crystals: 3,
      day: 1,
      week: 1,
      maxUnlockedMission: 1,
      victories: 0,
      bestStarsByMission: { 1: 0, 2: 0, 3: 0, 4: 0 },
      heroPos: { x: Number(startPos.x) || 0, z: Number(startPos.z) || 6.5 },
      movePoints: baseMP,
      maxMovePoints: baseMP,
      capturedMines: {},
      revealedSectors: buildDefaultRevealedSectors(),
      ownedArtifacts: [],
      equippedArtifacts: {
        weapon: null,
        shield: null,
        helm: null,
        boots: null
      },
      hero: lord,
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

    syncCampaignDerivedStats(campaignState);
    safeEmit('campaign:updated', campaignState);
    return campaignState;
  }

  function getCampaignState() {
    if (!campaignState) {
      campaignState = createDefaultCampaign();
    }
    return campaignState;
  }

  // Сводный расчёт эффективных статов Героя с учётом реликвий и Колеса Умений
  function getHeroEffectiveStats() {
    const campaign = getCampaignState();
    const adv = getAdventureConfig();
    const skillsReg = getSkillsRegistry();
    const artsReg = getArtifactsRegistry();

    const hero = campaign.hero || {};
    const unlocked = Array.isArray(hero.unlockedSkills) ? hero.unlockedSkills : [];
    const equipped = campaign.equippedArtifacts || {};

    let attack = typeof hero.attack === 'number' ? hero.attack : 6;
    let defense = typeof hero.defense === 'number' ? hero.defense : 7;
    let spellPower = typeof hero.spellPower === 'number' ? hero.spellPower : 5;
    let knowledge = typeof hero.knowledge === 'number' ? hero.knowledge : 5;
    let baseHeroMaxMana = typeof hero.baseMaxMana === 'number'
      ? hero.baseMaxMana
      : (typeof hero.maxMana === 'number' ? hero.maxMana : 50);
    let maxMana = baseHeroMaxMana;
    let luck = typeof hero.luck === 'number' ? hero.luck : 2;
    let morale = typeof hero.morale === 'number' ? hero.morale : 2;
    let maxMovePoints = adv.baseMovePoints || 12;
    let unitInitiativeBonus = 0;
    let armyHpPct = 0;
    let moraleDamagePct = 0;
    let lightPowerPct = 0;
    let preBattleMana = 0;
    let manaDiscount = 0;
    let hasBallista = false;

    // 1. Бонусы от надетых реликвий
    const slots = ['weapon', 'shield', 'helm', 'boots'];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const artId = equipped[slot];
      if (!artId) continue;
      const art = artsReg[artId];
      if (!art || !art.stats) continue;
      const st = art.stats;
      if (st.attack) attack += st.attack;
      if (st.defense) defense += st.defense;
      if (st.spellPower) spellPower += st.spellPower;
      if (st.knowledge) knowledge += st.knowledge;
      if (st.maxMana) maxMana += st.maxMana;
      if (st.luck) luck += st.luck;
      if (st.morale) morale += st.morale;
      if (st.movePoints) maxMovePoints += st.movePoints;
      if (st.unitInitiative) unitInitiativeBonus += st.unitInitiative;
    }

    // 2. Бонусы от изученных перков Колеса Умений
    for (let i = 0; i < unlocked.length; i++) {
      const skId = unlocked[i];
      const sk = skillsReg[skId];
      const b = (sk && sk.bonus) || {};

      if (skId === 'logistics' || b.movePoints) {
        maxMovePoints += (b.movePoints || 4);
      }
      if (skId === 'elrath_blessing') {
        luck += (b.luck !== undefined ? b.luck : 1);
        armyHpPct += (b.armyHpPct !== undefined ? b.armyHpPct : 0.15);
      } else {
        if (b.luck) luck += b.luck;
        if (b.armyHpPct) armyHpPct += b.armyHpPct;
      }
      if (skId === 'retribution' || b.moraleDamagePct) {
        moraleDamagePct += (b.moraleDamagePct !== undefined ? b.moraleDamagePct : 0.15);
      }
      if (skId === 'master_of_light' || b.lightPowerPct) {
        lightPowerPct += (b.lightPowerPct !== undefined ? b.lightPowerPct : 0.35);
      }
      if (skId === 'arcane_insight') {
        preBattleMana += (b.preBattleMana !== undefined ? b.preBattleMana : 12);
        manaDiscount += (b.manaDiscount !== undefined ? b.manaDiscount : 2);
      } else {
        if (b.preBattleMana) preBattleMana += b.preBattleMana;
        if (b.manaDiscount) manaDiscount += b.manaDiscount;
      }
      if (skId === 'ballista' || b.summonBallista) {
        hasBallista = true;
      }
    }

    return {
      attack: attack,
      defense: defense,
      spellPower: spellPower,
      knowledge: knowledge,
      maxMana: maxMana,
      luck: luck,
      morale: morale,
      maxMovePoints: maxMovePoints,
      unitInitiativeBonus: unitInitiativeBonus,
      armyHpPct: armyHpPct,
      moraleDamagePct: moraleDamagePct,
      lightPowerPct: lightPowerPct,
      preBattleMana: preBattleMana,
      manaDiscount: manaDiscount,
      hasBallista: hasBallista
    };
  }

  function syncCampaignDerivedStats(campaign) {
    if (!campaign || !campaign.hero) return;
    if (typeof campaign.hero.baseMaxMana !== 'number') {
      // Вычисляем чистую базу маны героя без бонуса Короны Света, чтобы избежать двойного сложения
      let helmBonus = 0;
      const eq = campaign.equippedArtifacts || {};
      const artsReg = getArtifactsRegistry();
      for (const s of ['weapon', 'shield', 'helm', 'boots']) {
        const aid = eq[s];
        if (aid && artsReg[aid] && artsReg[aid].stats && artsReg[aid].stats.maxMana) {
          helmBonus += artsReg[aid].stats.maxMana;
        }
      }
      campaign.hero.baseMaxMana = Math.max(50, (campaign.hero.maxMana || 50) - helmBonus);
    }
    const eff = getHeroEffectiveStats();
    campaign.maxMovePoints = eff.maxMovePoints;
    if (typeof campaign.movePoints !== 'number' || Number.isNaN(campaign.movePoints)) {
      campaign.movePoints = eff.maxMovePoints;
    } else if (campaign.movePoints > eff.maxMovePoints) {
      campaign.movePoints = eff.maxMovePoints;
    }
    campaign.hero.maxMana = eff.maxMana;
    if (typeof campaign.hero.mana !== 'number' || Number.isNaN(campaign.hero.mana)) {
      campaign.hero.mana = eff.maxMana;
    } else if (campaign.hero.mana > eff.maxMana) {
      campaign.hero.mana = eff.maxMana;
    }
  }

  function loadCampaignState(savedObj) {
    const def = createDefaultCampaign();
    if (!savedObj || typeof savedObj !== 'object') {
      campaignState = def;
      return campaignState;
    }

    const savedHero = savedObj.hero || {};
    const hadUnlockedField = Array.isArray(savedHero.unlockedSkills);
    const unlockedSkills = hadUnlockedField
      ? Array.from(new Set(savedHero.unlockedSkills.filter(Boolean)))
      : [];

    const mergedHero = Object.assign({}, def.hero, savedHero);
    mergedHero.level = Math.max(1, Number(mergedHero.level) || 1);
    mergedHero.xp = Math.max(0, Number(mergedHero.xp) || 0);
    mergedHero.unlockedSkills = unlockedSkills;

    if (!hadUnlockedField) {
      // Загрузка старого сейва v2.x без Колеса Умений: гарантируем стартовые/уровневые очки умений
      const fallbackSP = Math.max(1, mergedHero.level - unlockedSkills.length);
      mergedHero.skillPoints = Math.max(Number(savedHero.skillPoints) || 0, fallbackSP);
    } else if (typeof savedHero.skillPoints !== 'number') {
      mergedHero.skillPoints = Math.max(1, mergedHero.level - unlockedSkills.length);
    } else {
      mergedHero.skillPoints = Math.max(0, Math.floor(savedHero.skillPoints));
      if (mergedHero.level >= 1 && mergedHero.skillPoints === 0 && unlockedSkills.length === 0) {
        mergedHero.skillPoints = Math.max(1, mergedHero.level - unlockedSkills.length);
      }
    }

    const savedPos = savedObj.heroPos && typeof savedObj.heroPos === 'object' ? savedObj.heroPos : null;
    const heroPos = {
      x: savedPos && typeof savedPos.x === 'number' ? savedPos.x : def.heroPos.x,
      z: savedPos && typeof savedPos.z === 'number' ? savedPos.z : def.heroPos.z
    };

    const ownedArtifacts = Array.isArray(savedObj.ownedArtifacts)
      ? Array.from(new Set(savedObj.ownedArtifacts.filter(Boolean)))
      : [];

    const rawEq = (savedObj.equippedArtifacts && typeof savedObj.equippedArtifacts === 'object')
      ? savedObj.equippedArtifacts
      : {};
    const equippedArtifacts = {
      weapon: rawEq.weapon || null,
      shield: rawEq.shield || null,
      helm: rawEq.helm || null,
      boots: rawEq.boots || null
    };
    // Гарантируем, что надетые реликвии присутствуют и в ownedArtifacts
    for (const slot of ['weapon', 'shield', 'helm', 'boots']) {
      if (equippedArtifacts[slot] && ownedArtifacts.indexOf(equippedArtifacts[slot]) === -1) {
        ownedArtifacts.push(equippedArtifacts[slot]);
      }
    }

    const revealedSectors = Object.assign({}, def.revealedSectors, savedObj.revealedSectors || {});
    const capturedMines = Object.assign({}, savedObj.capturedMines || {});

    campaignState = {
      gold: typeof savedObj.gold === 'number' ? savedObj.gold : def.gold,
      crystals: typeof savedObj.crystals === 'number' ? savedObj.crystals : def.crystals,
      day: typeof savedObj.day === 'number' ? savedObj.day : def.day,
      week: typeof savedObj.week === 'number' ? savedObj.week : def.week,
      maxUnlockedMission: typeof savedObj.maxUnlockedMission === 'number' ? savedObj.maxUnlockedMission : def.maxUnlockedMission,
      victories: typeof savedObj.victories === 'number' ? savedObj.victories : def.victories,
      bestStarsByMission: Object.assign({}, def.bestStarsByMission, savedObj.bestStarsByMission || {}),
      heroPos: heroPos,
      movePoints: typeof savedObj.movePoints === 'number' ? savedObj.movePoints : def.movePoints,
      maxMovePoints: typeof savedObj.maxMovePoints === 'number' ? savedObj.maxMovePoints : def.maxMovePoints,
      capturedMines: capturedMines,
      revealedSectors: revealedSectors,
      ownedArtifacts: ownedArtifacts,
      equippedArtifacts: equippedArtifacts,
      hero: mergedHero,
      buildings: Object.assign({}, def.buildings, savedObj.buildings || {}),
      dwellingsAvailable: Object.assign({}, def.dwellingsAvailable, savedObj.dwellingsAvailable || {}),
      army: Object.assign({}, def.army, savedObj.army || {}),
      completedNodes: Object.assign({}, savedObj.completedNodes || {})
    };

    syncCampaignDerivedStats(campaignState);
    // Открываем туман вокруг сохранённой позиции конного Героя
    revealFogAround(campaignState.heroPos.x, campaignState.heroPos.z, 0, true);

    safeEmit('campaign:updated', campaignState);
    return campaignState;
  }

  // Начисление опыта Герою с повышением уровней, статов и очков Колеса Умений
  function grantHeroXP(amount) {
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    const campaign = getCampaignState();
    const hero = campaign.hero;
    if (amount <= 0) {
      return { ok: true, addedXp: 0, levelsGained: 0, level: hero.level, skillPoints: hero.skillPoints };
    }

    const adv = getAdventureConfig();
    const xpPerLevel = adv.xpPerLevel || 500;

    hero.xp = (hero.xp || 0) + amount;
    const targetLevel = 1 + Math.floor(hero.xp / xpPerLevel);
    let levelsGained = 0;
    const statRotation = ['attack', 'defense', 'spellPower', 'knowledge'];

    while ((hero.level || 1) < targetLevel) {
      hero.level = (hero.level || 1) + 1;
      levelsGained += 1;

      const statKey = statRotation[(hero.level - 2) % statRotation.length];
      hero[statKey] = (hero[statKey] || 5) + 1;
      hero.baseMaxMana = (hero.baseMaxMana || hero.maxMana || 50) + 10;
      hero.mana = (hero.mana || 50) + 10;
      hero.skillPoints = (hero.skillPoints || 0) + 1;
    }

    syncCampaignDerivedStats(campaign);

    if (levelsGained > 0) {
      safeEmit('hero:levelUp', {
        level: hero.level,
        levelsGained: levelsGained,
        skillPoints: hero.skillPoints,
        hero: hero
      });
    }
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      addedXp: amount,
      levelsGained: levelsGained,
      level: hero.level,
      skillPoints: hero.skillPoints
    };
  }

  // Изучение перка в Колесе Умений Героя
  function unlockHeroSkill(skillId) {
    const campaign = getCampaignState();
    const hero = campaign.hero;
    const skillsReg = getSkillsRegistry();
    const skill = skillsReg[skillId];

    if (!skill) {
      return { ok: false, reason: 'unknown_skill', message: 'Неизвестное умение: ' + skillId };
    }

    if (!Array.isArray(hero.unlockedSkills)) {
      hero.unlockedSkills = [];
    }

    if (hero.unlockedSkills.indexOf(skillId) !== -1) {
      return { ok: false, reason: 'already_unlocked', message: 'Умение «' + skill.name + '» уже изучено!' };
    }

    if ((hero.skillPoints || 0) <= 0) {
      return { ok: false, reason: 'no_skill_points', message: 'Недостаточно очков умений для изучения «' + skill.name + '»!' };
    }

    const prevMaxMP = getHeroEffectiveStats().maxMovePoints;
    hero.skillPoints -= 1;
    hero.unlockedSkills.push(skillId);

    const eff = getHeroEffectiveStats();
    const deltaMP = Math.max(0, eff.maxMovePoints - prevMaxMP);
    campaign.maxMovePoints = eff.maxMovePoints;
    if (deltaMP > 0) {
      campaign.movePoints = Math.min(eff.maxMovePoints, (campaign.movePoints || 0) + deltaMP);
    }

    syncCampaignDerivedStats(campaign);

    safeEmit('hero:skillUnlocked', {
      skillId: skillId,
      skill: skill,
      campaign: campaign
    });
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      skillId: skillId,
      message: 'Изучено умение Ордена: «' + skill.name + '»!'
    };
  }

  // Получение реликвии Асхана в сокровищницу Героя (с опциональным авто-надеванием)
  function grantArtifact(artifactId, autoEquip) {
    if (autoEquip === undefined) autoEquip = true;
    const campaign = getCampaignState();
    const artsReg = getArtifactsRegistry();
    const art = artsReg[artifactId];

    if (!art) {
      return { ok: false, reason: 'unknown_artifact', message: 'Неизвестная реликвия: ' + artifactId };
    }

    if (!Array.isArray(campaign.ownedArtifacts)) {
      campaign.ownedArtifacts = [];
    }
    if (!campaign.equippedArtifacts) {
      campaign.equippedArtifacts = { weapon: null, shield: null, helm: null, boots: null };
    }

    const alreadyOwned = campaign.ownedArtifacts.indexOf(artifactId) !== -1;
    if (!alreadyOwned) {
      campaign.ownedArtifacts.push(artifactId);
    }

    const prevEff = getHeroEffectiveStats();
    let equippedNow = false;
    if (autoEquip && art.slot && !campaign.equippedArtifacts[art.slot]) {
      campaign.equippedArtifacts[art.slot] = artifactId;
      equippedNow = true;
    }

    const newEff = getHeroEffectiveStats();
    const deltaMP = newEff.maxMovePoints - prevEff.maxMovePoints;
    const deltaMana = newEff.maxMana - prevEff.maxMana;
    campaign.maxMovePoints = newEff.maxMovePoints;
    if (deltaMP > 0) {
      campaign.movePoints = Math.min(newEff.maxMovePoints, (campaign.movePoints || 0) + deltaMP);
    }
    campaign.hero.maxMana = newEff.maxMana;
    if (deltaMana > 0) {
      campaign.hero.mana = Math.min(newEff.maxMana, (campaign.hero.mana || 0) + deltaMana);
    }
    syncCampaignDerivedStats(campaign);

    safeEmit('hero:artifactEquipped', {
      artifactId: artifactId,
      equipped: equippedNow,
      equippedArtifacts: campaign.equippedArtifacts
    });
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      artifactId: artifactId,
      alreadyOwned: alreadyOwned,
      equipped: equippedNow,
      equippedArtifacts: campaign.equippedArtifacts,
      message: 'Получена реликвия «' + art.name + '»!'
    };
  }

  // Снятие реликвии из слота
  function unequipArtifact(slot) {
    const campaign = getCampaignState();
    if (!campaign.equippedArtifacts || !Object.prototype.hasOwnProperty.call(campaign.equippedArtifacts, slot)) {
      return { ok: false, reason: 'invalid_slot', message: 'Неизвестный слот экипировки: ' + slot };
    }

    const removedId = campaign.equippedArtifacts[slot];
    campaign.equippedArtifacts[slot] = null;
    syncCampaignDerivedStats(campaign);

    safeEmit('hero:artifactEquipped', {
      artifactId: removedId,
      equipped: false,
      equippedArtifacts: campaign.equippedArtifacts
    });
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      equippedArtifacts: campaign.equippedArtifacts
    };
  }

  // Надевание (или переключение) реликвии из ownedArtifacts
  function equipArtifact(artifactId) {
    const campaign = getCampaignState();
    const artsReg = getArtifactsRegistry();
    const art = artsReg[artifactId];

    if (!art) {
      return { ok: false, reason: 'unknown_artifact', message: 'Неизвестная реликвия: ' + artifactId };
    }
    if (!Array.isArray(campaign.ownedArtifacts) || campaign.ownedArtifacts.indexOf(artifactId) === -1) {
      return { ok: false, reason: 'not_owned', message: 'Реликвия «' + art.name + '» ещё не добыта!' };
    }

    const slot = art.slot;
    const prevEff = getHeroEffectiveStats();

    if (campaign.equippedArtifacts[slot] === artifactId) {
      // Повторный выбор уже надетой реликвии снимает её
      campaign.equippedArtifacts[slot] = null;
    } else {
      campaign.equippedArtifacts[slot] = artifactId;
    }

    const newEff = getHeroEffectiveStats();
    const deltaMP = newEff.maxMovePoints - prevEff.maxMovePoints;
    const deltaMana = newEff.maxMana - prevEff.maxMana;
    campaign.maxMovePoints = newEff.maxMovePoints;
    if (deltaMP > 0) {
      campaign.movePoints = Math.min(newEff.maxMovePoints, (campaign.movePoints || 0) + deltaMP);
    } else if (campaign.movePoints > newEff.maxMovePoints) {
      campaign.movePoints = newEff.maxMovePoints;
    }

    campaign.hero.maxMana = newEff.maxMana;
    if (deltaMana > 0) {
      campaign.hero.mana = Math.min(newEff.maxMana, (campaign.hero.mana || 0) + deltaMana);
    } else if (campaign.hero.mana > newEff.maxMana) {
      campaign.hero.mana = newEff.maxMana;
    }

    syncCampaignDerivedStats(campaign);

    safeEmit('hero:artifactEquipped', {
      artifactId: campaign.equippedArtifacts[slot],
      equippedArtifacts: campaign.equippedArtifacts
    });
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      equippedArtifacts: campaign.equippedArtifacts
    };
  }

  // Рассеивание секторов тумана войны вокруг точки (x, z)
  function revealFogAround(x, z, extraRadius, silent) {
    extraRadius = Number(extraRadius) || 0;
    const campaign = getCampaignState();
    const adv = getAdventureConfig();
    const sectors = adv.fogSectors || [];
    if (!campaign.revealedSectors) {
      campaign.revealedSectors = buildDefaultRevealedSectors();
    }

    const newlyRevealed = [];
    for (let i = 0; i < sectors.length; i++) {
      const s = sectors[i];
      if (!s || !s.id) continue;
      if (campaign.revealedSectors[s.id]) continue;
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= (s.radius || 10) + 6 + extraRadius) {
        campaign.revealedSectors[s.id] = true;
        newlyRevealed.push(s.id);
      }
    }

    if (newlyRevealed.length > 0 && !silent) {
      safeEmit('adventure:fogRevealed', {
        sectors: newlyRevealed,
        revealedSectors: campaign.revealedSectors
      });
    }

    return newlyRevealed;
  }

  // Перемещение конного Лорда Годрика по 3D-долине с расходом Очков Движения (ОД)
  function moveAdventureHero(targetX, targetZ, targetNodeId, nodeChoice) {
    const campaign = getCampaignState();
    const adv = getAdventureConfig();
    targetX = Number(targetX);
    targetZ = Number(targetZ);

    if (Number.isNaN(targetX) || Number.isNaN(targetZ)) {
      return { ok: false, reason: 'invalid_coords', message: 'Некорректные координаты похода.' };
    }

    if (!campaign.heroPos) {
      const sp = adv.startPos || { x: 0, z: 6.5 };
      campaign.heroPos = { x: sp.x, z: sp.z };
    }

    const fromPos = { x: campaign.heroPos.x, z: campaign.heroPos.z };
    const dx = targetX - fromPos.x;
    const dz = targetZ - fromPos.z;
    const dist = Math.hypot(dx, dz);
    const costFactor = adv.moveCostPerUnitDist || 0.42;
    const cost = dist < 0.8 ? 0 : Math.max(1, Math.round(dist * costFactor));

    if ((campaign.movePoints || 0) <= 0 && cost > 0) {
      return {
        ok: false,
        reason: 'no_move_points',
        message: 'Очки движения исчерпаны! Разбейте лагерь до утра (Новый день).'
      };
    }

    // Частичное перемещение по вектору, если ОД меньше полной стоимости маршрута
    if ((campaign.movePoints || 0) < cost) {
      const used = campaign.movePoints;
      const ratio = cost > 0 ? (used / cost) : 0;
      const newX = Math.round((fromPos.x + dx * ratio) * 100) / 100;
      const newZ = Math.round((fromPos.z + dz * ratio) * 100) / 100;

      campaign.heroPos = { x: newX, z: newZ };
      campaign.movePoints = 0;
      revealFogAround(newX, newZ, 0);

      safeEmit('adventure:heroMoved', {
        from: fromPos,
        to: { x: newX, z: newZ },
        cost: used,
        remainingMP: 0,
        partial: true,
        targetNodeId: null
      });
      safeEmit('campaign:updated', campaign);

      return {
        ok: true,
        partial: true,
        pos: { x: newX, z: newZ },
        remainingMP: 0,
        message: 'Конный отряд прошёл часть пути и разбил привал (0 ОД).'
      };
    }

    // Полное прибытие в целевую точку
    const finalX = Math.round(targetX * 100) / 100;
    const finalZ = Math.round(targetZ * 100) / 100;
    campaign.heroPos = { x: finalX, z: finalZ };
    campaign.movePoints = Math.max(0, (campaign.movePoints || 0) - cost);
    revealFogAround(finalX, finalZ, 3);

    safeEmit('adventure:heroMoved', {
      from: fromPos,
      to: { x: finalX, z: finalZ },
      cost: cost,
      remainingMP: campaign.movePoints,
      partial: false,
      targetNodeId: targetNodeId || null
    });
    safeEmit('campaign:updated', campaign);

    const result = {
      ok: true,
      partial: false,
      pos: { x: finalX, z: finalZ },
      cost: cost,
      remainingMP: campaign.movePoints,
      reachedNode: targetNodeId || null
    };

    if (targetNodeId) {
      const node = getValleyNodes().find((n) => n.id === targetNodeId);
      // Для сундука с выбором (золота/опыта) без явного choice позволяем UI открыть диалог выбора
      if (node && (node.type !== 'treasure' || nodeChoice !== undefined)) {
        result.nodeResult = interactValleyNode(targetNodeId, nodeChoice);
      }
    }

    return result;
  }

  // Пополнение недельных резервов найма замка (общая внутренняя процедура без двойного сдвига дня)
  function replenishCastleWeeklyGrowth(campaign) {
    if (HOMM5.CONFIG && HOMM5.CONFIG.BUILDINGS) {
      for (const bId of Object.keys(HOMM5.CONFIG.BUILDINGS)) {
        const bld = HOMM5.CONFIG.BUILDINGS[bId];
        if (campaign.buildings[bId] && bld.unlocksUnit && bld.weeklyGrowth) {
          const uId = bld.unlocksUnit;
          campaign.dwellingsAvailable[uId] = (campaign.dwellingsAvailable[uId] || 0) + bld.weeklyGrowth;
        }
      }
    }
  }

  // Завершение текущего дня похода в Долине (с доходом шахт, восстановлением ОД и Маны)
  function advanceAdventureDay() {
    const campaign = getCampaignState();
    campaign.day = (campaign.day || 1) + 1;

    let startedNewWeek = false;
    let weeklyTaxGold = 0;
    if ((campaign.day - 1) % 7 === 0) {
      campaign.week = (campaign.week || 1) + 1;
      startedNewWeek = true;
      weeklyTaxGold = 650;
      campaign.gold += weeklyTaxGold;
      replenishCastleWeeklyGrowth(campaign);
    }

    // Начисление ежедневного дохода от всех захваченных шахт по контракту VALLEY_NODES
    let incomeGold = weeklyTaxGold;
    let incomeCrystals = 0;
    const mines = campaign.capturedMines || {};
    const nodes = getValleyNodes();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || n.type !== 'mine' || !mines[n.id]) continue;
      if (n.resource === 'gold') {
        const g = n.dailyIncome !== undefined ? n.dailyIncome : 350;
        campaign.gold += g;
        incomeGold += g;
      } else if (n.resource === 'crystals') {
        const c = n.dailyIncome !== undefined ? n.dailyIncome : 1;
        campaign.crystals += c;
        incomeCrystals += c;
      }
    }

    const eff = getHeroEffectiveStats();
    campaign.maxMovePoints = eff.maxMovePoints;
    campaign.movePoints = eff.maxMovePoints;
    if (campaign.hero) {
      campaign.hero.maxMana = eff.maxMana;
      campaign.hero.mana = eff.maxMana;
    }

    safeEmit('adventure:newDay', {
      day: campaign.day,
      week: campaign.week,
      startedNewWeek: startedNewWeek,
      incomeGold: incomeGold,
      incomeCrystals: incomeCrystals,
      movePoints: campaign.movePoints
    });
    safeEmit('campaign:updated', campaign);

    return {
      ok: true,
      day: campaign.day,
      week: campaign.week,
      startedNewWeek: startedNewWeek,
      incomeGold: incomeGold,
      incomeCrystals: incomeCrystals,
      movePoints: campaign.movePoints,
      message: 'Наступил День ' + campaign.day + ' (Неделя ' + campaign.week + ')! ОД восстановлены до ' +
        campaign.movePoints + (incomeGold > 0 ? ', +' + incomeGold + ' 💰' : '') +
        (incomeCrystals > 0 ? ', +' + incomeCrystals + ' 💎' : '') + '.'
    };
  }

  function constructBuilding(buildingId) {
    const campaign = getCampaignState();
    const bldCfg = HOMM5.CONFIG && HOMM5.CONFIG.BUILDINGS && HOMM5.CONFIG.BUILDINGS[buildingId];
    if (!bldCfg) {
      return { ok: false, message: 'Неизвестное здание: ' + buildingId };
    }

    if (campaign.buildings[buildingId]) {
      return { ok: false, message: 'Здание «' + bldCfg.name + '» уже возведено!' };
    }

    const costGold = bldCfg.costGold || 0;
    const costCrystal = bldCfg.costCrystal || 0;

    if (campaign.gold < costGold || campaign.crystals < costCrystal) {
      return {
        ok: false,
        message: 'Недостаточно ресурсов! Требуется: ' + costGold + ' 💰, ' + costCrystal + ' 💎.'
      };
    }

    campaign.gold -= costGold;
    campaign.crystals -= costCrystal;
    campaign.buildings[buildingId] = true;

    // Бонус к характеристикам героя (например Собор Эльрата +2 Сила Магии)
    if (bldCfg.bonusSpellPower) {
      campaign.hero.spellPower = (campaign.hero.spellPower || 5) + bldCfg.bonusSpellPower;
    }

    // Первичный прирост в резерв найма при постройке
    if (bldCfg.unlocksUnit && bldCfg.weeklyGrowth) {
      const uId = bldCfg.unlocksUnit;
      campaign.dwellingsAvailable[uId] = (campaign.dwellingsAvailable[uId] || 0) + bldCfg.weeklyGrowth;
    }

    safeEmit('campaign:updated', campaign);
    return {
      ok: true,
      message: 'Здание «' + bldCfg.name + '» успешно возведено в замке «Коготь Грифона»!'
    };
  }

  function recruitUnit(unitId, count) {
    count = Math.floor(count);
    if (!count || count <= 0) {
      return { ok: false, message: 'Укажите положительное количество воинов для найма.' };
    }

    const campaign = getCampaignState();
    const unitCfg = HOMM5.CONFIG && HOMM5.CONFIG.UNITS && HOMM5.CONFIG.UNITS[unitId];
    if (!unitCfg) {
      return { ok: false, message: 'Неизвестный тип отряда: ' + unitId };
    }

    // Проверяем, построено ли необходимое жилище
    let requiredBld = null;
    if (HOMM5.CONFIG && HOMM5.CONFIG.BUILDINGS) {
      for (const bId of Object.keys(HOMM5.CONFIG.BUILDINGS)) {
        if (HOMM5.CONFIG.BUILDINGS[bId].unlocksUnit === unitId) {
          requiredBld = HOMM5.CONFIG.BUILDINGS[bId];
          break;
        }
      }
    }

    if (requiredBld && !campaign.buildings[requiredBld.id]) {
      return {
        ok: false,
        message: 'Для найма «' + unitCfg.name + '» необходимо сначала возвести «' + requiredBld.name + '»!'
      };
    }

    const available = campaign.dwellingsAvailable[unitId] || 0;
    if (available < count) {
      return {
        ok: false,
        message: 'В казармах доступно только ' + available + ' воинов «' + unitCfg.name + '».'
      };
    }

    const totalGold = (unitCfg.costGold || 0) * count;
    const totalCrystal = (unitCfg.costCrystal || 0) * count;

    if (campaign.gold < totalGold || campaign.crystals < totalCrystal) {
      return {
        ok: false,
        message: 'В казне недостаточно средств! Требуется: ' + totalGold + ' 💰, ' + totalCrystal + ' 💎.'
      };
    }

    campaign.gold -= totalGold;
    campaign.crystals -= totalCrystal;
    campaign.dwellingsAvailable[unitId] -= count;
    campaign.army[unitId] = (campaign.army[unitId] || 0) + count;

    safeEmit('campaign:updated', campaign);
    return {
      ok: true,
      recruited: count,
      message: 'Нанято: ' + count + ' «' + unitCfg.name + '». Отряд пополнил армию Лорда Годрика!'
    };
  }

  function nextWeek() {
    const campaign = getCampaignState();
    campaign.week += 1;
    campaign.day += 7;

    // Еженедельный налог в казну (+650 золота) + 7 дней дохода от захваченных шахт
    let taxIncome = 650;
    let crystalIncome = 0;
    const mines = campaign.capturedMines || {};
    const nodes = getValleyNodes();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n || n.type !== 'mine' || !mines[n.id]) continue;
      if (n.resource === 'gold') taxIncome += (n.dailyIncome || 350) * 7;
      if (n.resource === 'crystals') crystalIncome += (n.dailyIncome || 1) * 7;
    }

    campaign.gold += taxIncome;
    campaign.crystals += crystalIncome;

    // Прирост существ во всех построенных зданиях
    replenishCastleWeeklyGrowth(campaign);

    // Полное восстановление маны и ОД героя в начале новой недели
    const eff = getHeroEffectiveStats();
    campaign.maxMovePoints = eff.maxMovePoints;
    campaign.movePoints = eff.maxMovePoints;
    if (campaign.hero) {
      campaign.hero.maxMana = eff.maxMana;
      campaign.hero.mana = eff.maxMana;
    }

    safeEmit('campaign:updated', campaign);
    return {
      ok: true,
      message: 'Наступила неделя ' + campaign.week + '! Получен доход +' + taxIncome + ' 💰' +
        (crystalIncome > 0 ? ', +' + crystalIncome + ' 💎' : '') + '. Резервы найма пополнены.'
    };
  }

  function interactValleyNode(nodeId, choice) {
    const campaign = getCampaignState();
    const node = getValleyNodes().find((n) => n.id === nodeId);

    if (!node) {
      return { ok: false, message: 'Интерактивная точка не найдена: ' + nodeId };
    }

    // При прямом вызове из вкладки Долины или тапом по узлу подводим конного Героя к точке при наличии ОД,
    // не блокируя взаимодействие и старые безголовые тесты при нехватке ОД
    if (Array.isArray(node.pos3d) && node.pos3d.length >= 3) {
      const nx = Number(node.pos3d[0]) || 0;
      const nz = Number(node.pos3d[2]) || 0;
      const curPos = campaign.heroPos || { x: 0, z: 6.5 };
      const dist = Math.hypot(nx - curPos.x, nz - curPos.z);
      if (dist > 0.8) {
        const adv = getAdventureConfig();
        const cost = Math.max(1, Math.round(dist * (adv.moveCostPerUnitDist || 0.42)));
        if ((campaign.movePoints || 0) >= cost) {
          const fromPos = { x: curPos.x, z: curPos.z };
          campaign.heroPos = { x: nx, z: nz };
          campaign.movePoints -= cost;
          revealFogAround(nx, nz, 3);
          safeEmit('adventure:heroMoved', {
            from: fromPos,
            to: { x: nx, z: nz },
            cost: cost,
            remainingMP: campaign.movePoints,
            partial: false,
            targetNodeId: nodeId
          });
        } else {
          // Смещаем позицию к узлу для визуальной синхронизации, расходуя остаток ОД без блокировки
          const used = Math.max(0, campaign.movePoints || 0);
          const fromPos = { x: curPos.x, z: curPos.z };
          campaign.heroPos = { x: nx, z: nz };
          campaign.movePoints = 0;
          revealFogAround(nx, nz, 2);
          if (used > 0) {
            safeEmit('adventure:heroMoved', {
              from: fromPos,
              to: { x: nx, z: nz },
              cost: used,
              remainingMP: 0,
              partial: false,
              targetNodeId: nodeId
            });
          }
        }
      }
    }

    // Для шахт при повторном визите показываем статус ежедневного дохода
    if (node.type === 'mine') {
      if (!campaign.capturedMines) campaign.capturedMines = {};
      if (campaign.capturedMines[nodeId]) {
        const resLabel = node.resource === 'crystals'
          ? ('+' + (node.dailyIncome || 1) + ' 💎 Кристалл в день')
          : ('+' + (node.dailyIncome || 350) + ' 💰 Золота в день');
        return {
          ok: true,
          alreadyCaptured: true,
          message: 'Знамя Ордена уже реет над объектом «' + node.name + '»! Доход в казну: ' + resLabel + '.'
        };
      }

      campaign.capturedMines[nodeId] = true;
      campaign.completedNodes[nodeId] = true;

      const bonusGold = node.captureGoldBonus || 0;
      const bonusCrystals = node.captureCrystalBonus || 0;
      campaign.gold += bonusGold;
      campaign.crystals += bonusCrystals;

      const xpGain = node.xpReward || 150;
      grantHeroXP(xpGain);

      safeEmit('adventure:mineCaptured', {
        nodeId: nodeId,
        node: node,
        bonusGold: bonusGold,
        bonusCrystals: bonusCrystals,
        xpGain: xpGain,
        capturedMines: campaign.capturedMines
      });
      safeEmit('campaign:updated', campaign);

      const bonusParts = [];
      if (bonusGold > 0) bonusParts.push('+' + bonusGold + ' 💰');
      if (bonusCrystals > 0) bonusParts.push('+' + bonusCrystals + ' 💎');
      bonusParts.push('+' + xpGain + ' Опыта');
      const dailyText = node.resource === 'crystals'
        ? ('+' + (node.dailyIncome || 1) + ' 💎/день')
        : ('+' + (node.dailyIncome || 350) + ' 💰/день');

      return {
        ok: true,
        captured: true,
        message: 'Захвачена «' + node.name + '»! Награда: ' + bonusParts.join(', ') + '. Ежедневный доход: ' + dailyText + '.'
      };
    }

    if (campaign.completedNodes[nodeId] && node.type !== 'battle') {
      return { ok: false, message: 'Эта точка уже исследована: ' + node.name };
    }

    if (node.type === 'treasure') {
      if (choice === 'xp') {
        campaign.hero.attack = (campaign.hero.attack || 6) + 1;
        campaign.hero.spellPower = (campaign.hero.spellPower || 5) + 1;
        campaign.completedNodes[nodeId] = true;
        grantHeroXP(node.xpReward || 500);
        safeEmit('campaign:updated', campaign);
        return {
          ok: true,
          reward: 'xp',
          message: 'Лорд Годрик выбрал реликвию опыта: +1 Атака, +1 Сила Магии, уровень ' + campaign.hero.level + '!'
        };
      } else {
        const goldVal = node.goldReward || 950;
        campaign.gold += goldVal;
        campaign.completedNodes[nodeId] = true;
        safeEmit('campaign:updated', campaign);
        return {
          ok: true,
          reward: 'gold',
          message: 'В казну замка поступило +' + goldVal + ' 💰 из Королевского Сундука!'
        };
      }
    } else if (node.type === 'crystal_mine') {
      const crystalsVal = node.crystalReward || 5;
      const goldVal = node.goldReward || 400;
      campaign.crystals += crystalsVal;
      campaign.gold += goldVal;
      campaign.completedNodes[nodeId] = true;
      safeEmit('campaign:updated', campaign);
      return {
        ok: true,
        message: 'Кристальная Жила Эльрата освящена! Получено +' + crystalsVal + ' 💎 и +' + goldVal + ' 💰.'
      };
    } else if (node.type === 'relic') {
      const owned = campaign.ownedArtifacts || [];
      let chosenArtId = node.rewardArtifact || 'griffin_blade';
      if (owned.indexOf(chosenArtId) !== -1 && node.altArtifact) {
        chosenArtId = node.altArtifact;
      }
      const artRes = grantArtifact(chosenArtId, true);
      const xpGain = node.xpReward || 250;
      grantHeroXP(xpGain);
      campaign.completedNodes[nodeId] = true;
      safeEmit('campaign:updated', campaign);

      const artsReg = getArtifactsRegistry();
      const artName = (artsReg[chosenArtId] && artsReg[chosenArtId].name) || chosenArtId;
      return {
        ok: true,
        artifactId: chosenArtId,
        equipped: !!(artRes && artRes.equipped),
        message: 'Алтарь «' + node.name + '» даровал реликвию «' + artName + '» и +' + xpGain + ' Опыта!'
      };
    } else if (node.type === 'obelisk') {
      const adv = getAdventureConfig();
      const sectors = adv.fogSectors || [];
      if (!campaign.revealedSectors) campaign.revealedSectors = {};

      if (node.revealsAllFog) {
        for (let i = 0; i < sectors.length; i++) {
          if (sectors[i] && sectors[i].id) {
            campaign.revealedSectors[sectors[i].id] = true;
          }
        }
      }
      if (Array.isArray(node.revealsSectors)) {
        for (let i = 0; i < node.revealsSectors.length; i++) {
          campaign.revealedSectors[node.revealsSectors[i]] = true;
        }
      }

      const xpGain = node.xpReward || 350;
      grantHeroXP(xpGain);
      campaign.completedNodes[nodeId] = true;

      safeEmit('adventure:fogRevealed', {
        sectors: Object.keys(campaign.revealedSectors),
        revealedSectors: campaign.revealedSectors
      });
      safeEmit('campaign:updated', campaign);

      return {
        ok: true,
        message: '«' + node.name + '» рассеял туман войны над всей долиной и даровал +' + xpGain + ' Опыта!'
      };
    } else if (node.type === 'battle') {
      const battle = startMissionBattle(node.missionIndex || 1);
      return {
        ok: true,
        isBattle: true,
        battleState: battle,
        message: 'Армия выдвинулась на битву: ' + node.name
      };
    }

    return { ok: false, message: 'Неизвестный тип объекта: ' + node.type };
  }

  // ---------------------------------------------------------------------------
  // 2. ПОШАГОВАЯ ТАКТИЧЕСКАЯ АРЕНА 10x8 И ШКАЛА ATB (Battle Arena Engine)
  // ---------------------------------------------------------------------------

  let battleState = null;

  function getBattleState() {
    return battleState;
  }

  function getLivingActors() {
    if (!battleState) return [];
    const actors = [];
    for (let i = 0; i < battleState.stacks.length; i++) {
      const s = battleState.stacks[i];
      if (s.count > 0) actors.push(s);
    }
    if (battleState.heroPlayer && !isSideEliminated('player')) {
      actors.push(battleState.heroPlayer);
    }
    if (battleState.heroEnemy && !isSideEliminated('enemy')) {
      actors.push(battleState.heroEnemy);
    }
    return actors;
  }

  function isSideEliminated(side) {
    if (!battleState) return true;
    for (let i = 0; i < battleState.stacks.length; i++) {
      const s = battleState.stacks[i];
      // В каноне HoMM V боевые машины (Баллиста) не удерживают армию от поражения, если все обычные отряды пали
      if (s.side === side && s.count > 0 && !s.isWarMachine && !(s.unit && s.unit.isWarMachine)) {
        return false;
      }
    }
    return true;
  }

  function predictATBQueue(length) {
    length = length || 8;
    if (!battleState) return [];

    const actors = [];
    for (let i = 0; i < battleState.stacks.length; i++) {
      const s = battleState.stacks[i];
      if (s.count > 0) {
        actors.push({
          actorId: s.id,
          name: s.name,
          icon: s.icon,
          side: s.side,
          isHero: false,
          isWarMachine: !!s.isWarMachine,
          atb: Number.isFinite(s.atb) ? s.atb : 0,
          initiative: Math.max(1, s.initiative || 10)
        });
      }
    }

    if (battleState.heroPlayer && !isSideEliminated('player')) {
      actors.push({
        actorId: battleState.heroPlayer.id,
        name: battleState.heroPlayer.name,
        icon: battleState.heroPlayer.icon,
        side: battleState.heroPlayer.side,
        isHero: true,
        isWarMachine: false,
        atb: Number.isFinite(battleState.heroPlayer.atb) ? battleState.heroPlayer.atb : 0,
        initiative: Math.max(1, battleState.heroPlayer.initiative || 10)
      });
    }

    if (battleState.heroEnemy && !isSideEliminated('enemy')) {
      actors.push({
        actorId: battleState.heroEnemy.id,
        name: battleState.heroEnemy.name,
        icon: battleState.heroEnemy.icon,
        side: battleState.heroEnemy.side,
        isHero: true,
        isWarMachine: false,
        atb: Number.isFinite(battleState.heroEnemy.atb) ? battleState.heroEnemy.atb : 0,
        initiative: Math.max(1, battleState.heroEnemy.initiative || 10)
      });
    }

    if (actors.length === 0) return [];

    const queue = [];
    for (let step = 0; step < length; step++) {
      let minTime = Infinity;
      for (let j = 0; j < actors.length; j++) {
        const a = actors[j];
        if (a.atb >= 1.0) {
          minTime = 0;
          break;
        }
        const needed = (1.0 - a.atb) / a.initiative;
        if (needed < minTime) minTime = needed;
      }

      if (minTime > 0 && Number.isFinite(minTime)) {
        for (let j = 0; j < actors.length; j++) {
          actors[j].atb += minTime * actors[j].initiative;
        }
      }

      let bestActor = null;
      let maxAtb = -Infinity;
      for (let j = 0; j < actors.length; j++) {
        const a = actors[j];
        if (a.atb >= 1.0 - 1e-6 && a.atb > maxAtb) {
          maxAtb = a.atb;
          bestActor = a;
        }
      }

      if (!bestActor) {
        bestActor = actors[0];
      }

      queue.push({
        actorId: bestActor.actorId,
        name: bestActor.name,
        icon: bestActor.icon,
        side: bestActor.side,
        isHero: bestActor.isHero,
        isWarMachine: bestActor.isWarMachine
      });

      bestActor.atb = 0;
    }

    return queue;
  }

  function advanceATBToNextActor() {
    if (!battleState || battleState.status !== 'active') return null;

    if (checkBattleEnd()) {
      return null;
    }

    const aliveActors = getLivingActors();
    if (aliveActors.length === 0) {
      checkBattleEnd();
      return null;
    }

    // Проверяем, есть ли уже готовый к ходу актор
    let ready = [];
    for (let i = 0; i < aliveActors.length; i++) {
      if (aliveActors[i].atb >= 1.0 - 1e-6) {
        ready.push(aliveActors[i]);
      }
    }

    // Если нет, двигаем время шкалы ATB вперёд
    if (ready.length === 0) {
      let minTime = Infinity;
      for (let i = 0; i < aliveActors.length; i++) {
        const a = aliveActors[i];
        const init = Math.max(1, a.initiative || 10);
        const needed = (1.0 - a.atb) / init;
        if (needed < minTime) minTime = needed;
      }

      if (minTime > 0 && Number.isFinite(minTime)) {
        for (let i = 0; i < aliveActors.length; i++) {
          const init = Math.max(1, aliveActors[i].initiative || 10);
          aliveActors[i].atb += minTime * init;
        }
      }

      for (let i = 0; i < aliveActors.length; i++) {
        if (aliveActors[i].atb >= 1.0 - 1e-6) {
          ready.push(aliveActors[i]);
        }
      }
    }

    ready.sort((a, b) => (b.atb - a.atb) || ((b.initiative || 10) - (a.initiative || 10)));
    const active = ready[0] || aliveActors[0];
    battleState.activeActorId = active.id;

    // Сброс временных состояний при начале своего хода
    if (!active.isHeroActor) {
      active.defending = false;
      active.retaliatedThisRound = false;
      if (active.buffs) {
        if (active.buffs.righteous_might > 0) active.buffs.righteous_might--;
        if (active.buffs.divine_shield > 0) active.buffs.divine_shield--;
      }
    }

    const queue = predictATBQueue((HOMM5.CONFIG && HOMM5.CONFIG.ATB_QUEUE_SIZE) || 8);
    const validActions = getValidActions(active.id);

    safeEmit('battle:turn', {
      activeActor: active,
      queue: queue,
      validActions: validActions
    });

    return active;
  }

  // Поиск свободной тыловой клетки в колонке 0 (или 1) для размещения 3D-Баллисты Ордена
  function findFreeCellForWarMachine(stacks, obstacles, gridRows) {
    const candidateRows = [7, 0, 6, 2, 4, 5, 1, 3];
    const candidateCols = [0, 1];
    for (let cIdx = 0; cIdx < candidateCols.length; cIdx++) {
      const col = candidateCols[cIdx];
      for (let rIdx = 0; rIdx < candidateRows.length; rIdx++) {
        const row = candidateRows[rIdx];
        if (row < 0 || row >= gridRows) continue;
        const obsBlocked = obstacles.some((o) => o.col === col && o.row === row);
        if (obsBlocked) continue;
        const stackBlocked = stacks.some((s) => s.count > 0 && s.col === col && s.row === row);
        if (!stackBlocked) {
          return { col: col, row: row };
        }
      }
    }
    return { col: 0, row: 7 };
  }

  function createPlayerBallistaStack(stacks, obstacles, gridRows, eff) {
    const wmReg = getWarMachinesRegistry();
    const balCfg = wmReg.ballista || {
      id: 'ballista',
      name: 'Баллиста Ордена',
      singular: 'Баллиста Ордена',
      faction: 'haven',
      tier: 5,
      icon: '🏹',
      hp: 220,
      attack: 10,
      defense: 10,
      minDmg: 14,
      maxDmg: 22,
      initiative: 9,
      speed: 0,
      ranged: true,
      isRanged: true,
      isFlying: false,
      shots: 99,
      noRangePenalty: true,
      infiniteRetaliation: false,
      isWarMachine: true
    };

    const cell = findFreeCellForWarMachine(stacks, obstacles, gridRows);
    const unitHp = Math.max(1, Math.round(balCfg.hp * (1 + (eff.armyHpPct || 0))));
    const unitInit = (balCfg.initiative || 9) + (eff.unitInitiativeBonus || 0);

    return {
      id: 'stack_p_ballista',
      unitId: 'ballista',
      unit: Object.assign({}, balCfg, { isRanged: true, ranged: true, speed: 0, isWarMachine: true }),
      name: balCfg.name || 'Баллиста Ордена',
      icon: balCfg.icon || '🏹',
      side: 'player',
      col: cell.col,
      row: cell.row,
      count: 1,
      initialCount: 1,
      topHp: unitHp,
      maxHp: unitHp,
      shotsLeft: balCfg.shots || 99,
      shots: balCfg.shots || 99,
      ranged: true,
      isWarMachine: true,
      retaliatedThisRound: false,
      defending: false,
      buffs: { righteous_might: 0, divine_shield: 0 },
      atb: 0.11,
      initiative: unitInit,
      speed: 0,
      isHeroActor: false
    };
  }

  function buildBattlePlayerHero(campaign, eff) {
    const heroPlayerCfg = campaign.hero || {};
    const baseMana = heroPlayerCfg.mana !== undefined ? heroPlayerCfg.mana : eff.maxMana;
    const startMana = Math.min(eff.maxMana, baseMana + (eff.preBattleMana || 0));

    return {
      id: 'hero_player',
      name: heroPlayerCfg.name || 'Лорд Годрик',
      icon: heroPlayerCfg.icon || '👑',
      side: 'player',
      isHeroActor: true,
      initiative: heroPlayerCfg.initiative || 10,
      attack: eff.attack,
      defense: eff.defense,
      spellPower: eff.spellPower,
      knowledge: eff.knowledge,
      mana: startMana,
      maxMana: eff.maxMana,
      morale: eff.morale,
      luck: eff.luck,
      moraleDamagePct: eff.moraleDamagePct || 0,
      lightPowerPct: eff.lightPowerPct || 0,
      manaDiscount: eff.manaDiscount || 0,
      atb: 0.15,
      col: -1,
      row: -1
    };
  }

  function startMissionBattle(missionIndex) {
    const campaign = getCampaignState();
    const eff = getHeroEffectiveStats();
    missionIndex = missionIndex || 1;
    const node = getMissionNode(missionIndex);

    const gridCols = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_COLS) || 10;
    const gridRows = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_ROWS) || 8;

    const obstacles = (node && node.obstacles) ? deepClone(node.obstacles) : [
      { col: 4, row: 2, kind: 'pillar' },
      { col: 5, row: 5, kind: 'rock' }
    ];

    const stacks = [];

    // Расстановка армии игрока (слева, col = 0..1) с учётом перков elrath_blessing и Сапог Странника
    const playerArmy = campaign.army || { squire: 20, crossbowman: 12, griffin: 3, paladin: 0 };
    const preferredPlacements = [
      { unitId: 'squire', col: 1, row: 1 },
      { unitId: 'crossbowman', col: 0, row: 3 },
      { unitId: 'griffin', col: 1, row: 5 },
      { unitId: 'paladin', col: 0, row: 6 }
    ];

    let pIndex = 0;
    for (const p of preferredPlacements) {
      const count = playerArmy[p.unitId] || 0;
      if (count > 0) {
        const uCfg = (HOMM5.CONFIG && HOMM5.CONFIG.UNITS && HOMM5.CONFIG.UNITS[p.unitId]) || {
          id: p.unitId,
          name: p.unitId,
          attack: 5,
          defense: 5,
          minDmg: 2,
          maxDmg: 4,
          hp: 20,
          initiative: 9,
          speed: 4,
          isRanged: false,
          isFlying: false,
          shots: 0
        };

        // Проверяем занятость клетки препятствием
        let targetCol = p.col;
        let targetRow = p.row;
        if (obstacles.some((o) => o.col === targetCol && o.row === targetRow)) {
          targetCol = targetCol === 0 ? 1 : 0;
        }

        const buffedMaxHp = Math.max(1, Math.round(uCfg.hp * (1 + (eff.armyHpPct || 0))));
        const buffedInit = (uCfg.initiative || 9) + (eff.unitInitiativeBonus || 0);

        stacks.push({
          id: 'stack_p_' + p.unitId + '_' + pIndex,
          unitId: p.unitId,
          unit: uCfg,
          name: uCfg.name,
          icon: uCfg.icon || '🛡️',
          side: 'player',
          col: targetCol,
          row: targetRow,
          count: count,
          initialCount: count,
          topHp: buffedMaxHp,
          maxHp: buffedMaxHp,
          shotsLeft: uCfg.shots || 0,
          retaliatedThisRound: false,
          defending: false,
          buffs: { righteous_might: 0, divine_shield: 0 },
          atb: 0.10 + pIndex * 0.04,
          initiative: buffedInit,
          speed: uCfg.speed,
          isWarMachine: false,
          isHeroActor: false
        });
        pIndex++;
      }
    }

    // Если армия игрока была пуста (крайний случай безопасности) — даём почётный эскорт латников
    if (stacks.length === 0) {
      const uCfg = HOMM5.CONFIG.UNITS.squire;
      const buffedMaxHp = Math.max(1, Math.round(uCfg.hp * (1 + (eff.armyHpPct || 0))));
      stacks.push({
        id: 'stack_p_squire_0',
        unitId: 'squire',
        unit: uCfg,
        name: uCfg.name,
        icon: uCfg.icon,
        side: 'player',
        col: 1,
        row: 2,
        count: 15,
        initialCount: 15,
        topHp: buffedMaxHp,
        maxHp: buffedMaxHp,
        shotsLeft: 0,
        retaliatedThisRound: false,
        defending: false,
        buffs: { righteous_might: 0, divine_shield: 0 },
        atb: 0.12,
        initiative: (uCfg.initiative || 8) + (eff.unitInitiativeBonus || 0),
        speed: uCfg.speed,
        isWarMachine: false,
        isHeroActor: false
      });
    }

    // Призыв 3D-Баллисты Ордена, если изучен перк ballista
    if (eff.hasBallista) {
      stacks.push(createPlayerBallistaStack(stacks, obstacles, gridRows, eff));
    }

    // Расстановка врагов (справа)
    const enemiesCfg = (node && node.enemies) ? node.enemies : [
      { unitId: 'imp', count: 20, col: 8, row: 1 },
      { unitId: 'hellhound', count: 8, col: 8, row: 4 },
      { unitId: 'imp', count: 15, col: 8, row: 6 }
    ];

    let eIndex = 0;
    for (const e of enemiesCfg) {
      const uCfg = (HOMM5.CONFIG && HOMM5.CONFIG.UNITS && HOMM5.CONFIG.UNITS[e.unitId]) || {
        id: e.unitId,
        name: e.unitId,
        attack: 4,
        defense: 4,
        minDmg: 2,
        maxDmg: 4,
        hp: 15,
        initiative: 10,
        speed: 5,
        isRanged: false,
        isFlying: false,
        shots: 0
      };

      stacks.push({
        id: 'stack_e_' + e.unitId + '_' + eIndex,
        unitId: e.unitId,
        unit: uCfg,
        name: uCfg.name,
        icon: uCfg.icon || '😈',
        side: 'enemy',
        col: e.col,
        row: e.row,
        count: e.count,
        initialCount: e.count,
        topHp: uCfg.hp,
        maxHp: uCfg.hp,
        shotsLeft: uCfg.shots || 0,
        retaliatedThisRound: false,
        defending: false,
        buffs: { righteous_might: 0, divine_shield: 0 },
        atb: 0.08 + eIndex * 0.04,
        initiative: uCfg.initiative,
        speed: uCfg.speed,
        isWarMachine: false,
        isHeroActor: false
      });
      eIndex++;
    }

    const heroPlayer = buildBattlePlayerHero(campaign, eff);
    const heroEnemyCfg = (HOMM5.CONFIG && HOMM5.CONFIG.HEROES && HOMM5.CONFIG.HEROES.inferno_lord)
      ? HOMM5.CONFIG.HEROES.inferno_lord
      : {
          name: 'Аграил Пепельный',
          icon: '🔥',
          attack: 7,
          defense: 4,
          spellPower: 6,
          maxMana: 45,
          initiative: 10,
          luck: 1,
          morale: 1
        };

    // В финальной 4-й миссии Генерал Аграил выходит в полной боевой мощи Цитадели Пепла
    const bossBonus = missionIndex >= 4 ? 2 : 0;
    const heroEnemy = {
      id: 'hero_enemy',
      name: heroEnemyCfg.name || 'Аграил Пепельный',
      icon: heroEnemyCfg.icon || '🔥',
      side: 'enemy',
      isHeroActor: true,
      initiative: heroEnemyCfg.initiative || 10,
      attack: (heroEnemyCfg.attack || 7) + bossBonus,
      defense: (heroEnemyCfg.defense || 4) + bossBonus,
      spellPower: (heroEnemyCfg.spellPower || 6) + bossBonus,
      mana: (heroEnemyCfg.maxMana || 45) + bossBonus * 10,
      maxMana: (heroEnemyCfg.maxMana || 45) + bossBonus * 10,
      morale: heroEnemyCfg.morale || 1,
      luck: heroEnemyCfg.luck || 1,
      moraleDamagePct: 0,
      lightPowerPct: 0,
      manaDiscount: 0,
      atb: 0.14,
      col: -1,
      row: -1
    };

    const startLogs = ['⚔️ Битва началась! Полководцы выстраивают фаланги на тактической арене.'];
    if (eff.hasBallista) {
      startLogs.push('🏹 На поле боя развёрнута 3D-Баллиста Ордена (220 ОЗ, прицельный залп без штрафа дистанции)!');
    }

    battleState = {
      missionIndex: missionIndex,
      missionName: node ? node.name : 'Полевой бой',
      status: 'active', // 'active' | 'victory' | 'defeat'
      turnNumber: 1,
      gridCols: gridCols,
      gridRows: gridRows,
      obstacles: obstacles,
      stacks: stacks,
      heroPlayer: heroPlayer,
      heroEnemy: heroEnemy,
      activeActorId: null,
      log: startLogs
    };

    safeEmit('battle:started', battleState);
    advanceATBToNextActor();
    return battleState;
  }

  function startCustomSkirmish(options) {
    options = options || {};
    const campaign = getCampaignState();
    const eff = getHeroEffectiveStats();
    const gridCols = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_COLS) || 10;
    const gridRows = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_ROWS) || 8;

    const obstacles = options.obstacles || [
      { col: 4, row: 2, kind: 'pillar' },
      { col: 5, row: 5, kind: 'rock' }
    ];

    const playerArmy = options.playerArmy || campaign.army || {
      squire: 24,
      crossbowman: 14,
      griffin: 3,
      paladin: 1
    };

    const enemyArmy = options.enemyArmy || {
      imp: 25,
      hellhound: 10,
      succubus: 8,
      pitlord: 2
    };

    const stacks = [];

    let pIdx = 0;
    const pCoords = [
      { col: 1, row: 1 },
      { col: 0, row: 3 },
      { col: 1, row: 5 },
      { col: 0, row: 6 }
    ];

    for (const uId of Object.keys(playerArmy)) {
      const cnt = playerArmy[uId];
      if (cnt > 0 && HOMM5.CONFIG.UNITS[uId]) {
        const uCfg = HOMM5.CONFIG.UNITS[uId];
        const coord = pCoords[pIdx % pCoords.length];
        const buffedMaxHp = Math.max(1, Math.round(uCfg.hp * (1 + (eff.armyHpPct || 0))));
        stacks.push({
          id: 'stack_p_' + uId + '_' + pIdx,
          unitId: uId,
          unit: uCfg,
          name: uCfg.name,
          icon: uCfg.icon,
          side: 'player',
          col: coord.col,
          row: coord.row,
          count: cnt,
          initialCount: cnt,
          topHp: buffedMaxHp,
          maxHp: buffedMaxHp,
          shotsLeft: uCfg.shots || 0,
          retaliatedThisRound: false,
          defending: false,
          buffs: { righteous_might: 0, divine_shield: 0 },
          atb: 0.10 + pIdx * 0.03,
          initiative: (uCfg.initiative || 9) + (eff.unitInitiativeBonus || 0),
          speed: uCfg.speed,
          isWarMachine: false,
          isHeroActor: false
        });
        pIdx++;
      }
    }

    if (eff.hasBallista) {
      stacks.push(createPlayerBallistaStack(stacks, obstacles, gridRows, eff));
    }

    let eIdx = 0;
    const eCoords = [
      { col: 8, row: 1 },
      { col: 9, row: 3 },
      { col: 8, row: 5 },
      { col: 9, row: 6 }
    ];

    for (const uId of Object.keys(enemyArmy)) {
      const cnt = enemyArmy[uId];
      if (cnt > 0 && HOMM5.CONFIG.UNITS[uId]) {
        const uCfg = HOMM5.CONFIG.UNITS[uId];
        const coord = eCoords[eIdx % eCoords.length];
        stacks.push({
          id: 'stack_e_' + uId + '_' + eIdx,
          unitId: uId,
          unit: uCfg,
          name: uCfg.name,
          icon: uCfg.icon,
          side: 'enemy',
          col: coord.col,
          row: coord.row,
          count: cnt,
          initialCount: cnt,
          topHp: uCfg.hp,
          maxHp: uCfg.hp,
          shotsLeft: uCfg.shots || 0,
          retaliatedThisRound: false,
          defending: false,
          buffs: { righteous_might: 0, divine_shield: 0 },
          atb: 0.08 + eIdx * 0.03,
          initiative: uCfg.initiative,
          speed: uCfg.speed,
          isWarMachine: false,
          isHeroActor: false
        });
        eIdx++;
      }
    }

    const heroPlayer = buildBattlePlayerHero(campaign, eff);
    const heroEnemyCfg = HOMM5.CONFIG.HEROES.inferno_lord;

    battleState = {
      missionIndex: 0,
      missionName: 'Тренировочная Дуэль (Скирмиш)',
      status: 'active',
      turnNumber: 1,
      gridCols: gridCols,
      gridRows: gridRows,
      obstacles: obstacles,
      stacks: stacks,
      heroPlayer: heroPlayer,
      heroEnemy: {
        id: 'hero_enemy',
        name: heroEnemyCfg.name || 'Аграил Пепельный',
        icon: heroEnemyCfg.icon || '🔥',
        side: 'enemy',
        isHeroActor: true,
        initiative: heroEnemyCfg.initiative || 10,
        attack: heroEnemyCfg.attack || 7,
        defense: heroEnemyCfg.defense || 4,
        spellPower: heroEnemyCfg.spellPower || 6,
        mana: heroEnemyCfg.maxMana || 45,
        maxMana: heroEnemyCfg.maxMana || 45,
        morale: heroEnemyCfg.morale || 1,
        luck: heroEnemyCfg.luck || 1,
        moraleDamagePct: 0,
        lightPowerPct: 0,
        manaDiscount: 0,
        atb: 0.14,
        col: -1,
        row: -1
      },
      activeActorId: null,
      log: ['⚔️ Тренировочный скирмиш запущен!']
    };

    safeEmit('battle:started', battleState);
    advanceATBToNextActor();
    return battleState;
  }

  // ---------------------------------------------------------------------------
  // 3. ДОСТИЖИМЫЕ КЛЕТКИ, BFS И ЦЕЛИ АТАКИ (getValidActions)
  // ---------------------------------------------------------------------------

  function isCellBlocked(col, row, ignoreStackId) {
    if (!battleState) return true;
    if (col < 0 || col >= battleState.gridCols || row < 0 || row >= battleState.gridRows) {
      return true;
    }
    // Проверка препятствий
    for (let i = 0; i < battleState.obstacles.length; i++) {
      const o = battleState.obstacles[i];
      if (o.col === col && o.row === row) return true;
    }
    // Проверка живых отрядов
    for (let i = 0; i < battleState.stacks.length; i++) {
      const s = battleState.stacks[i];
      if (s.id !== ignoreStackId && s.count > 0 && s.col === col && s.row === row) {
        return true;
      }
    }
    return false;
  }

  function getValidActions(actorId) {
    if (!battleState) return { moves: [], targets: [] };
    const stack = battleState.stacks.find((s) => s.id === actorId);

    // Если это ход героя (находится вне сетки)
    if (!stack) {
      const hero = (battleState.heroPlayer && battleState.heroPlayer.id === actorId)
        ? battleState.heroPlayer
        : (battleState.heroEnemy && battleState.heroEnemy.id === actorId ? battleState.heroEnemy : null);

      if (!hero) return { moves: [], targets: [] };

      // Герой может ударить любого живого вражеского юнита или сотворить заклинание
      const targets = [];
      const enemySide = hero.side === 'player' ? 'enemy' : 'player';
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.side === enemySide && s.count > 0) {
          targets.push({
            targetStackId: s.id,
            col: s.col,
            row: s.row,
            mode: 'hero_strike',
            moveFromCol: -1,
            moveFromRow: -1,
            path: []
          });
        }
      }
      return { moves: [], targets: targets };
    }

    if (stack.count <= 0) return { moves: [], targets: [] };

    const isWarMachine = !!(stack.isWarMachine || (stack.unit && stack.unit.isWarMachine));
    const rawSpeed = stack.speed !== undefined ? stack.speed : (stack.unit && stack.unit.speed !== undefined ? stack.unit.speed : 4);
    const speed = isWarMachine ? 0 : Math.max(0, rawSpeed);
    const isFlying = !isWarMachine && !!(stack.unit && stack.unit.isFlying);
    const moves = [];

    // Клетка, на которой отряд уже стоит (дистанция 0)
    moves.push({
      col: stack.col,
      row: stack.row,
      dist: 0,
      path: [{ col: stack.col, row: stack.row }]
    });

    if (speed > 0 && isFlying) {
      // Летающие существа (Королевские Грифоны): перелетают препятствия и отряды,
      // но приземляются строго на свободную клетку в радиусе speed
      for (let c = 0; c < battleState.gridCols; c++) {
        for (let r = 0; r < battleState.gridRows; r++) {
          if (c === stack.col && r === stack.row) continue;
          const dist = Math.max(Math.abs(c - stack.col), Math.abs(r - stack.row));
          if (dist <= speed && !isCellBlocked(c, r, stack.id)) {
            moves.push({
              col: c,
              row: r,
              dist: dist,
              path: [{ col: stack.col, row: stack.row }, { col: c, row: r }]
            });
          }
        }
      }
    } else if (speed > 0) {
      // Наземные существа: честный BFS с учётом 8 направлений и блокировок
      const visited = {};
      visited[stack.col + '_' + stack.row] = 0;
      const queue = [{
        col: stack.col,
        row: stack.row,
        dist: 0,
        path: [{ col: stack.col, row: stack.row }]
      }];

      const neighbors8 = [
        [-1, -1], [0, -1], [1, -1],
        [-1,  0],          [1,  0],
        [-1,  1], [0,  1], [1,  1]
      ];

      while (queue.length > 0) {
        const curr = queue.shift();
        if (curr.dist >= speed) continue;

        for (let i = 0; i < neighbors8.length; i++) {
          const nc = curr.col + neighbors8[i][0];
          const nr = curr.row + neighbors8[i][1];
          const key = nc + '_' + nr;

          if (nc < 0 || nc >= battleState.gridCols || nr < 0 || nr >= battleState.gridRows) continue;
          if (visited[key] !== undefined) continue;

          if (isCellBlocked(nc, nr, stack.id)) continue;

          visited[key] = curr.dist + 1;
          const nextPath = curr.path.concat([{ col: nc, row: nr }]);
          const moveEntry = {
            col: nc,
            row: nr,
            dist: curr.dist + 1,
            path: nextPath
          };
          moves.push(moveEntry);
          queue.push(moveEntry);
        }
      }
    }

    // Расчёт целей для атаки
    const targets = [];
    const enemySide = stack.side === 'player' ? 'enemy' : 'player';
    const enemyStacks = battleState.stacks.filter((s) => s.side === enemySide && s.count > 0);

    // Боевая машина (3D-Баллиста): не ходит и стреляет по любому живому врагу через всё поле без блокировки ближним боем
    if (isWarMachine) {
      for (let i = 0; i < enemyStacks.length; i++) {
        const es = enemyStacks[i];
        targets.push({
          targetStackId: es.id,
          col: es.col,
          row: es.row,
          mode: 'ranged',
          moveFromCol: stack.col,
          moveFromRow: stack.row,
          path: []
        });
      }
      return { moves: moves, targets: targets };
    }

    // Проверяем, заблокирован ли обычный стрелок врагом на соседней 8-связной клетке
    let isShooterBlocked = false;
    for (let i = 0; i < enemyStacks.length; i++) {
      const es = enemyStacks[i];
      if (Math.max(Math.abs(es.col - stack.col), Math.abs(es.row - stack.row)) <= 1) {
        isShooterBlocked = true;
        break;
      }
    }

    // Дальнобойная атака (если стрелок, есть стрелы и не заблокирован в упор)
    const isRangedUnit = !!(stack.unit && (stack.unit.isRanged || stack.unit.ranged));
    if (isRangedUnit && (stack.shotsLeft > 0) && !isShooterBlocked) {
      for (let i = 0; i < enemyStacks.length; i++) {
        const es = enemyStacks[i];
        targets.push({
          targetStackId: es.id,
          col: es.col,
          row: es.row,
          mode: 'ranged',
          moveFromCol: stack.col,
          moveFromRow: stack.row,
          path: []
        });
      }
    }

    // Ближний бой (melee):
    // 1) Если уже стоим рядом с врагом
    for (let i = 0; i < enemyStacks.length; i++) {
      const es = enemyStacks[i];
      const isAdjacentNow = Math.max(Math.abs(es.col - stack.col), Math.abs(es.row - stack.row)) === 1;
      if (isAdjacentNow) {
        targets.push({
          targetStackId: es.id,
          col: es.col,
          row: es.row,
          mode: 'melee',
          moveFromCol: stack.col,
          moveFromRow: stack.row,
          path: []
        });
      }
    }

    // 2) Если можем подойти к соседней свободной клетке врага
    for (let i = 0; i < enemyStacks.length; i++) {
      const es = enemyStacks[i];
      for (let m = 0; m < moves.length; m++) {
        const move = moves[m];
        if (move.col === stack.col && move.row === stack.row) continue; // Учтено выше
        const isAdj = Math.max(Math.abs(es.col - move.col), Math.abs(es.row - move.row)) === 1;
        if (isAdj) {
          const already = targets.some((t) => t.targetStackId === es.id && t.moveFromCol === move.col && t.moveFromRow === move.row);
          if (!already) {
            targets.push({
              targetStackId: es.id,
              col: es.col,
              row: es.row,
              mode: 'melee',
              moveFromCol: move.col,
              moveFromRow: move.row,
              moveDist: move.dist,
              path: move.path
            });
          }
        }
      }
    }

    return { moves: moves, targets: targets };
  }

  // ---------------------------------------------------------------------------
  // 4. КОМАНДЫ «ЖДАТЬ», «ОБОРОНА», ПЕРЕМЕЩЕНИЕ, БАЛЛИСТА И АТАКА
  // ---------------------------------------------------------------------------

  function commandWait() {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor) return { ok: false, message: 'Нет активного участника' };

    // Ход откладывается наполовину шкалы ATB (-0.50)
    actor.atb = Math.max(0, actor.atb - 0.50);
    const logMsg = '⏳ [' + actor.name + '] выжидает момент (шкала ATB -0.50).';
    battleState.log.push(logMsg);

    safeEmit('battle:action', {
      type: 'wait',
      actor: actor,
      log: logMsg
    });

    advanceATBToNextActor();
    return { ok: true, message: logMsg };
  }

  function commandDefend() {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor) return { ok: false, message: 'Нет активного участника' };

    let logMsg = '';
    if (actor.isHeroActor) {
      const manaRestored = 6;
      actor.mana = Math.min(actor.maxMana, (actor.mana || 0) + manaRestored);
      actor.atb = 0;
      logMsg = '🛡️ Герой [' + actor.name + '] концентрирует силы в глухой обороне (+' + manaRestored + ' Маны).';
    } else {
      actor.defending = true;
      actor.atb = 0;
      logMsg = '🛡️ [' + actor.name + '] встаёт в глухую оборону (+30% к Защите до следующего хода).';
    }

    battleState.log.push(logMsg);

    safeEmit('battle:action', {
      type: 'defend',
      actor: actor,
      log: logMsg
    });

    advanceATBToNextActor();
    return { ok: true, message: logMsg };
  }

  function executeUnitMove(targetCol, targetRow) {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const stack = battleState.stacks.find((s) => s.id === battleState.activeActorId);
    if (!stack || stack.count <= 0) return { ok: false, message: 'Нельзя переместить данного юнита' };
    if (stack.isWarMachine || (stack.unit && stack.unit.isWarMachine)) {
      return { ok: false, message: 'Боевая машина стационарна и ведёт прицельный огонь с позиции!' };
    }

    const validActions = getValidActions(stack.id);
    const move = validActions.moves.find((m) => m.col === targetCol && m.row === targetRow);
    if (!move) {
      return { ok: false, message: 'Клетка (' + targetCol + ', ' + targetRow + ') недостижима для ' + stack.name };
    }

    stack.col = targetCol;
    stack.row = targetRow;

    // Проверка Боевого Духа (Morale): шанс morale * 8% сохранить atb = 0.50
    const hero = stack.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const morale = (hero && hero.morale) ? hero.morale : 0;
    const hasHighMorale = Math.random() < (morale * 0.08);

    let logMsg = '🚶 [' + stack.name + '] перемещается на клетку [' + targetCol + ', ' + targetRow + '].';
    if (hasHighMorale) {
      stack.atb = 0.50;
      logMsg += ' 🌟 Высокий боевой дух! Отряд готов действовать повторно!';
    } else {
      stack.atb = 0;
    }

    battleState.log.push(logMsg);

    safeEmit('battle:action', {
      type: 'move',
      actor: stack,
      targetCol: targetCol,
      targetRow: targetRow,
      path: move.path,
      highMorale: hasHighMorale,
      log: logMsg
    });

    advanceATBToNextActor();
    return { ok: true, message: logMsg, path: move.path };
  }

  // Автоматический прицельный залп активной боевой машины (3D-Баллисты Ордена)
  function autoFireWarMachine() {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const stack = battleState.stacks.find((s) => s.id === battleState.activeActorId);
    if (!stack || stack.count <= 0 || !(stack.isWarMachine || (stack.unit && stack.unit.isWarMachine))) {
      return { ok: false, message: 'Сейчас не ход боевой машины' };
    }
    const actions = getValidActions(stack.id);
    if (!actions.targets || actions.targets.length === 0) {
      return commandDefend();
    }
    // Приоритет обстрела Баллисты: вражеские стрелки (Демонессы) -> тяжёлые демоны -> ближайшая цель
    const sorted = actions.targets.slice().sort((a, b) => {
      const sa = battleState.stacks.find((s) => s.id === a.targetStackId);
      const sb = battleState.stacks.find((s) => s.id === b.targetStackId);
      const ra = (sa && sa.unit && sa.unit.isRanged) ? 1 : 0;
      const rb = (sb && sb.unit && sb.unit.isRanged) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      const ta = (sa && sa.unit && sa.unit.tier) || 1;
      const tb = (sb && sb.unit && sb.unit.tier) || 1;
      return tb - ta;
    });
    return executeUnitAttack(sorted[0].targetStackId, null);
  }

  // Честный расчёт урона по формуле Heroes of Might and Magic V + перк Воздаяние (retribution)
  function calculateDamage(attacker, defender, mode, distMoved) {
    const allyHero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const enemyHero = defender.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;

    const uAtk = attacker.unit;
    const uDef = defender.unit;

    // 1. Эффективная Атака
    let effAtk = (uAtk.attack || 5) + (allyHero ? (allyHero.attack || 0) : 0);
    if (attacker.buffs && attacker.buffs.righteous_might > 0) {
      effAtk += 6;
    }

    // 2. Эффективная Защита
    let effDef = (uDef.defense || 5) + (enemyHero ? (enemyHero.defense || 0) : 0);
    if (defender.buffs && defender.buffs.divine_shield > 0) {
      effDef += 8;
    }
    if (defender.defending) {
      effDef = Math.round(effDef * 1.30);
    }

    // 3. Множитель статов
    let statMultiplier = 1.0;
    if (effAtk >= effDef) {
      statMultiplier = Math.min(3.0, 1.0 + 0.05 * (effAtk - effDef));
    } else {
      statMultiplier = 1.0 / (1.0 + 0.05 * (effDef - effAtk));
    }

    // 4. Базовый разброс урона каждого воина
    let baseDmgPerWarrior;
    if (attacker.buffs && attacker.buffs.righteous_might > 0) {
      baseDmgPerWarrior = uAtk.maxDmg;
    } else {
      baseDmgPerWarrior = uAtk.minDmg + Math.random() * (uAtk.maxDmg - uAtk.minDmg);
    }

    let rawDamage = attacker.count * baseDmgPerWarrior * statMultiplier;

    // 5. Перк «Воздаяние» (retribution): +15% физического урона за каждую единицу Боевого духа
    if (allyHero && allyHero.moraleDamagePct > 0) {
      const moraleVal = Math.max(0, allyHero.morale || 0);
      rawDamage *= (1.0 + allyHero.moraleDamagePct * moraleVal);
    }

    // 6. Учёт специальных способностей существ
    // Рыцарский разбег Паладина (+8% за клетку разбега, до +48%)
    if (uAtk.joustingBonus && distMoved > 0) {
      const joustBonus = Math.min(0.48, Math.round(distMoved) * 0.08);
      rawDamage *= (1.0 + joustBonus);
    }

    // Штраф стрелку в ближнем бою (0.5x, не применяется к боевым машинам)
    const isRangedAtk = !!(uAtk.isRanged || uAtk.ranged);
    if (isRangedAtk && mode === 'melee' && !uAtk.isWarMachine && !attacker.isWarMachine) {
      rawDamage *= 0.50;
    }

    // Штраф стрелку на дистанции > 5 клеток (0.5x, кроме Арбалетчиков и Баллисты с noRangePenalty)
    if (mode === 'ranged') {
      const dist = Math.max(Math.abs(attacker.col - defender.col), Math.abs(attacker.row - defender.row));
      if (dist > 5 && !uAtk.noRangePenalty) {
        rawDamage *= 0.50;
      }
    }

    // Большой щит Латника (-35% от стрел)
    if (uDef.id === 'squire' && mode === 'ranged') {
      rawDamage *= 0.65;
    }

    // Купол Небесного Щита (-25% любого входящего урона)
    if (defender.buffs && defender.buffs.divine_shield > 0) {
      rawDamage *= 0.75;
    }

    // Клинок Погибели Пещерного Владыки (+20% чистого урона пламени)
    if (uAtk.cleaveBurn) {
      rawDamage *= 1.20;
    }

    // Удача Асхана (luck * 7% шанс удвоения урона)
    const luck = (allyHero && allyHero.luck) ? allyHero.luck : 0;
    const isLucky = Math.random() < (luck * 0.07);
    if (isLucky) {
      rawDamage *= 2.0;
    }

    const finalDamage = Math.max(1, Math.round(rawDamage));
    return {
      damage: finalDamage,
      isLucky: isLucky,
      statMultiplier: statMultiplier
    };
  }

  function applyDamageToStack(stack, damage) {
    const prevCount = stack.count;
    const totalHpBefore = (stack.count - 1) * stack.maxHp + stack.topHp;
    const totalHpAfter = Math.max(0, totalHpBefore - damage);

    if (totalHpAfter <= 0) {
      stack.count = 0;
      stack.topHp = 0;
    } else {
      stack.count = Math.ceil(totalHpAfter / stack.maxHp);
      const rem = totalHpAfter % stack.maxHp;
      stack.topHp = rem === 0 ? stack.maxHp : rem;
    }

    const killed = prevCount - stack.count;
    return {
      killed: killed,
      remainingCount: stack.count,
      remainingHp: stack.topHp
    };
  }

  // Неразрушающий прогноз урона (синхронизирован с перком retribution, реликвиями и 3D-Баллистой)
  function estimateDamagePreview(attackerId, defenderId, moveDist) {
    moveDist = moveDist || 0;
    if (!battleState) {
      return { ok: false, message: 'Битва не начата' };
    }

    const defender = battleState.stacks.find((s) => s.id === defenderId);
    if (!defender || defender.count <= 0) {
      return { ok: false, message: 'Цель не найдена или уже уничтожена' };
    }

    // Случай 1: Атака Героя (находится вне сетки, прямой удар полководца)
    if (attackerId === 'hero_player' || attackerId === 'hero_enemy') {
      const hero = attackerId === 'hero_player' ? battleState.heroPlayer : battleState.heroEnemy;
      if (!hero) {
        return { ok: false, message: 'Герой не найден' };
      }

      let heroDmg = Math.round(18 + (hero.attack || 6) * 7 + (hero.spellPower || 5) * 3);
      if (defender.buffs && defender.buffs.divine_shield > 0) {
        heroDmg = Math.round(heroDmg * 0.75);
      }
      heroDmg = Math.max(1, heroDmg);

      const totalHpBefore = (defender.count - 1) * defender.maxHp + defender.topHp;
      const totalHpAfter = Math.max(0, totalHpBefore - heroDmg);
      const remCount = totalHpAfter > 0 ? Math.ceil(totalHpAfter / defender.maxHp) : 0;
      const kills = Math.max(0, Math.min(defender.count, defender.count - remCount));

      return {
        ok: true,
        minDamage: heroDmg,
        maxDamage: heroDmg,
        minKills: kills,
        maxKills: kills,
        willRetaliate: false,
        targetName: defender.name
      };
    }

    // Случай 2: Атака отряда или 3D-Баллисты
    const attacker = battleState.stacks.find((s) => s.id === attackerId);
    if (!attacker || attacker.count <= 0) {
      return { ok: false, message: 'Атакующий отряд не найден' };
    }

    const allyHero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const enemyHero = defender.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;

    const uAtk = attacker.unit;
    const uDef = defender.unit;
    const isWarMachine = !!(attacker.isWarMachine || uAtk.isWarMachine);

    // 1. Эффективная Атака
    let effAtk = (uAtk.attack || 5) + (allyHero ? (allyHero.attack || 0) : 0);
    if (attacker.buffs && attacker.buffs.righteous_might > 0) {
      effAtk += 6;
    }

    // 2. Эффективная Защита
    let effDef = (uDef.defense || 5) + (enemyHero ? (enemyHero.defense || 0) : 0);
    if (defender.buffs && defender.buffs.divine_shield > 0) {
      effDef += 8;
    }
    if (defender.defending) {
      effDef = Math.round(effDef * 1.30);
    }

    // 3. Множитель статов
    let statMultiplier = 1.0;
    if (effAtk >= effDef) {
      statMultiplier = Math.min(3.0, 1.0 + 0.05 * (effAtk - effDef));
    } else {
      statMultiplier = 1.0 / (1.0 + 0.05 * (effDef - effAtk));
    }

    // Определение режима (ближний / дальний бой)
    const enemySide = attacker.side === 'player' ? 'enemy' : 'player';
    const isRangedAtk = !!(uAtk.isRanged || uAtk.ranged || isWarMachine);
    let isShooterBlocked = false;
    if (isRangedAtk && !isWarMachine) {
      for (let i = 0; i < battleState.stacks.length; i++) {
        const es = battleState.stacks[i];
        if (es.side === enemySide && es.count > 0) {
          if (Math.max(Math.abs(es.col - attacker.col), Math.abs(es.row - attacker.row)) <= 1) {
            isShooterBlocked = true;
            break;
          }
        }
      }
    }

    const isMelee = isWarMachine
      ? false
      : (!isRangedAtk || moveDist > 0 || isShooterBlocked || attacker.shotsLeft <= 0);
    const mode = isMelee ? 'melee' : 'ranged';

    // 4. Модификаторы урона (синхронизировано с calculateDamage)
    let modMultiplier = 1.0;

    // Перк «Воздаяние» (retribution): +15% * Math.max(0, morale)
    if (allyHero && allyHero.moraleDamagePct > 0) {
      const moraleVal = Math.max(0, allyHero.morale || 0);
      modMultiplier *= (1.0 + allyHero.moraleDamagePct * moraleVal);
    }

    // Рыцарский разбег Паладина (+8% за клетку разбега, до +48%)
    if (uAtk.joustingBonus && moveDist > 0) {
      const joustBonus = Math.min(0.48, Math.round(moveDist) * 0.08);
      modMultiplier *= (1.0 + joustBonus);
    }

    // Штраф стрелку в ближнем бою (0.5x)
    if (isRangedAtk && mode === 'melee' && !isWarMachine) {
      modMultiplier *= 0.50;
    }

    // Штраф стрелку на дистанции > 5 клеток (0.5x, кроме Арбалетчиков и Баллисты с noRangePenalty)
    if (mode === 'ranged') {
      const dist = Math.max(Math.abs(attacker.col - defender.col), Math.abs(attacker.row - defender.row));
      if (dist > 5 && !uAtk.noRangePenalty) {
        modMultiplier *= 0.50;
      }
    }

    // Большой щит Латника (-35% от стрел)
    if (uDef.id === 'squire' && mode === 'ranged') {
      modMultiplier *= 0.65;
    }

    // Купол Небесного Щита (-25% любого входящего урона)
    if (defender.buffs && defender.buffs.divine_shield > 0) {
      modMultiplier *= 0.75;
    }

    // Клинок Погибели Пещерного Владыки (+20% чистого урона пламени)
    if (uAtk.cleaveBurn) {
      modMultiplier *= 1.20;
    }

    // 5. Диапазон базового урона
    let minBase = uAtk.minDmg;
    let maxBase = uAtk.maxDmg;
    if (attacker.buffs && attacker.buffs.righteous_might > 0) {
      minBase = uAtk.maxDmg;
      maxBase = uAtk.maxDmg;
    }

    const minDamage = Math.max(1, Math.round(attacker.count * minBase * statMultiplier * modMultiplier));
    const maxDamage = Math.max(1, Math.round(attacker.count * maxBase * statMultiplier * modMultiplier));

    // 6. Расчёт потерь в отряде цели (minKills..maxKills)
    const totalHpBefore = (defender.count - 1) * defender.maxHp + defender.topHp;

    const afterMinDmg = Math.max(0, totalHpBefore - minDamage);
    const remCountAfterMin = afterMinDmg > 0 ? Math.ceil(afterMinDmg / defender.maxHp) : 0;
    const minKills = Math.max(0, Math.min(defender.count, defender.count - remCountAfterMin));

    const afterMaxDmg = Math.max(0, totalHpBefore - maxDamage);
    const remCountAfterMax = afterMaxDmg > 0 ? Math.ceil(afterMaxDmg / defender.maxHp) : 0;
    const maxKills = Math.max(0, Math.min(defender.count, defender.count - remCountAfterMax));

    // 7. Возможность ответного удара (боевые машины не отвечают в рукопашной)
    const defenderIsMachine = !!(defender.isWarMachine || uDef.isWarMachine);
    const willRetaliate = isMelee &&
      !defenderIsMachine &&
      !uAtk.noRetaliationAttack &&
      (!defender.retaliatedThisRound || !!uDef.infiniteRetaliation);

    return {
      ok: true,
      minDamage: minDamage,
      maxDamage: maxDamage,
      minKills: minKills,
      maxKills: maxKills,
      willRetaliate: willRetaliate,
      targetName: defender.name
    };
  }

  function executeUnitAttack(targetStackId, preferredMoveCell) {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const attacker = battleState.stacks.find((s) => s.id === battleState.activeActorId);
    if (!attacker || attacker.count <= 0) return { ok: false, message: 'Атакующий отряд не найден' };

    const target = battleState.stacks.find((s) => s.id === targetStackId);
    if (!target || target.count <= 0) return { ok: false, message: 'Цель атаки уже уничтожена' };

    const validActions = getValidActions(attacker.id);
    let chosenTargetAction = null;

    if (preferredMoveCell) {
      chosenTargetAction = validActions.targets.find((t) =>
        t.targetStackId === targetStackId &&
        t.moveFromCol === preferredMoveCell.col &&
        t.moveFromRow === preferredMoveCell.row
      );
    }

    if (!chosenTargetAction) {
      chosenTargetAction = validActions.targets.find((t) => t.targetStackId === targetStackId);
    }

    if (!chosenTargetAction) {
      return { ok: false, message: 'Отряд ' + attacker.name + ' не может атаковать эту цель!' };
    }

    // Если требуется подход к клетке перед ударом
    let distMoved = 0;
    const startCol = attacker.col;
    const startRow = attacker.row;

    if (chosenTargetAction.mode === 'melee' &&
        (chosenTargetAction.moveFromCol !== attacker.col || chosenTargetAction.moveFromRow !== attacker.row)) {
      distMoved = Math.hypot(chosenTargetAction.moveFromCol - startCol, chosenTargetAction.moveFromRow - startRow);
      attacker.col = chosenTargetAction.moveFromCol;
      attacker.row = chosenTargetAction.moveFromRow;
    }

    const attackerIsMachine = !!(attacker.isWarMachine || (attacker.unit && attacker.unit.isWarMachine));
    if (chosenTargetAction.mode === 'ranged' && !attackerIsMachine) {
      attacker.shotsLeft = Math.max(0, attacker.shotsLeft - 1);
    }

    // Расчёт и нанесение урона
    const calc = calculateDamage(attacker, target, chosenTargetAction.mode, distMoved);
    const impact = applyDamageToStack(target, calc.damage);

    let logMsg = (chosenTargetAction.mode === 'ranged' ? '🏹 ' : '⚔️ ') +
      '[' + attacker.name + '] атакует [' + target.name + '], нанося ' + calc.damage + ' урона!';

    if (calc.isLucky) {
      logMsg += ' 🍀 Удача Асхана! Удвоенный урон!';
    }
    if (impact.killed > 0) {
      logMsg += target.isWarMachine ? ' Машина разрушена!' : (' Пало воинов: ' + impact.killed + '.');
    }
    if (target.count <= 0) {
      logMsg += ' 💀 [' + target.name + '] полностью уничтожен!';
    }

    battleState.log.push(logMsg);

    // Оглушение Латником (25% шанс сдвинуть ATB цели назад на 0.30)
    let stunned = false;
    if (attacker.unit.id === 'squire' && chosenTargetAction.mode === 'melee' && target.count > 0) {
      if (Math.random() < 0.25) {
        target.atb = Math.max(0, target.atb - 0.30);
        stunned = true;
        const stunMsg = '🛡️ Оглушающий удар щитом! Шкала ATB [' + target.name + '] сдвинута назад на 0.30.';
        battleState.log.push(stunMsg);
      }
    }

    // Кража маны Чертями
    let stolenMana = 0;
    if (attacker.unit.manaSteal) {
      const enemyHero = attacker.side === 'player' ? battleState.heroEnemy : battleState.heroPlayer;
      const allyHero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
      if (enemyHero && enemyHero.mana > 0) {
        stolenMana = Math.min(enemyHero.mana, attacker.unit.manaSteal);
        enemyHero.mana -= stolenMana;
        if (allyHero) allyHero.mana = Math.min(allyHero.maxMana, allyHero.mana + stolenMana);
        const manaMsg = '😈 Черти выжигают ' + stolenMana + ' маны у вражеского героя!';
        battleState.log.push(manaMsg);
      }
    }

    // Обработка Ответного Удара (боевые машины не наносят ответный удар)
    const targetIsMachine = !!(target.isWarMachine || (target.unit && target.unit.isWarMachine));
    let retalData = null;
    if (chosenTargetAction.mode === 'melee' && target.count > 0 && !targetIsMachine && !attacker.unit.noRetaliationAttack) {
      const canRetaliate = !target.retaliatedThisRound || target.unit.infiniteRetaliation;
      if (canRetaliate) {
        target.retaliatedThisRound = true;
        const retalCalc = calculateDamage(target, attacker, 'melee', 0);
        const retalImpact = applyDamageToStack(attacker, retalCalc.damage);

        let retalLog = '💥 Ответный удар: [' + target.name + '] отвечает и наносит ' + retalCalc.damage + ' урона!';
        if (retalCalc.isLucky) retalLog += ' 🍀 Удача!';
        if (retalImpact.killed > 0) retalLog += ' Пало ' + retalImpact.killed + ' воинов.';
        if (attacker.count <= 0) retalLog += ' 💀 [' + attacker.name + '] повержен!';

        battleState.log.push(retalLog);
        retalData = {
          damage: retalCalc.damage,
          killed: retalImpact.killed,
          log: retalLog
        };
      }
    }

    // Проверка Боевого Духа после атаки (механические машины не подвержены воодушевлению)
    const hero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const morale = (!attackerIsMachine && hero && hero.morale) ? hero.morale : 0;
    const hasHighMorale = attacker.count > 0 && !attackerIsMachine && Math.random() < (morale * 0.08);

    if (hasHighMorale) {
      attacker.atb = 0.50;
      battleState.log.push('🌟 Высокий боевой дух! [' + attacker.name + '] сохраняет половину шкалы инициативы!');
    } else {
      attacker.atb = 0;
    }

    safeEmit('battle:action', {
      type: 'attack',
      actor: attacker,
      target: target,
      mode: chosenTargetAction.mode,
      damage: calc.damage,
      isCrit: calc.isLucky,
      killed: impact.killed,
      retaliation: retalData,
      stunned: stunned,
      stolenMana: stolenMana,
      highMorale: hasHighMorale,
      log: logMsg
    });

    if (checkBattleEnd()) {
      return { ok: true, message: logMsg, battleEnded: true };
    }

    advanceATBToNextActor();
    return { ok: true, message: logMsg };
  }

  // ---------------------------------------------------------------------------
  // 5. КНИГА МАГИИ И ГЕРОИЧЕСКИЙ УДАР (Spells & Hero Strike)
  // ---------------------------------------------------------------------------

  function getEffectiveSpellManaCost(spellId, heroActor) {
    const spellCfg = HOMM5.CONFIG && HOMM5.CONFIG.SPELLS && HOMM5.CONFIG.SPELLS[spellId];
    if (!spellCfg) return 10;
    const baseCost = spellCfg.manaCost || 10;
    const discount = (heroActor && heroActor.manaDiscount) ? heroActor.manaDiscount : 0;
    return discount > 0 ? Math.max(2, baseCost - discount) : baseCost;
  }

  function castSpell(spellId, targetCol, targetRow, targetStackId) {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor || !actor.isHeroActor) {
      return { ok: false, message: 'Заклинания может творить только Герой во время своего хода!' };
    }

    const spellCfg = HOMM5.CONFIG && HOMM5.CONFIG.SPELLS && HOMM5.CONFIG.SPELLS[spellId];
    if (!spellCfg) return { ok: false, message: 'Неизвестное заклинание: ' + spellId };

    // Перк arcane_insight снижает стоимость всех заклинаний на 2 маны (минимум 2)
    const manaCost = getEffectiveSpellManaCost(spellId, actor);
    if ((actor.mana || 0) < manaCost) {
      return { ok: false, message: 'Недостаточно маны! Требуется: ' + manaCost + ', доступно: ' + actor.mana };
    }

    // Перк master_of_light усиливает заклинания Магии Света на +35%
    const lightMul = 1.0 + (actor.lightPowerPct || 0);
    const buffDuration = Math.max(3, Math.round(3 * lightMul));
    const spPower = actor.spellPower || 5;
    let logMsg = '';

    if (spellId === 'righteous_might') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для благословения' };
      actor.mana -= manaCost;
      targetStack.buffs.righteous_might = buffDuration;
      logMsg = '✨ [' + actor.name + '] сотворил «' + spellCfg.name + '» на [' + targetStack.name +
        ']! (+6 к Атаке и максимальный урон на ' + buffDuration + ' хода).';
      battleState.log.push(logMsg);
    } else if (spellId === 'divine_shield') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для Небесного Щита' };
      actor.mana -= manaCost;
      targetStack.buffs.divine_shield = buffDuration;
      logMsg = '🛡️ [' + actor.name + '] окружил [' + targetStack.name +
        '] куполом «' + spellCfg.name + '»! (+8 к Защите и -25% входящего урона на ' + buffDuration + ' хода).';
      battleState.log.push(logMsg);
    } else if (spellId === 'holy_light') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для исцеления' };

      actor.mana -= manaCost;
      const healAmount = Math.round((45 + 22 * spPower) * lightMul);
      const maxPossibleHp = targetStack.initialCount * targetStack.maxHp;
      const currentHp = (targetStack.count - 1) * targetStack.maxHp + targetStack.topHp;
      const newTotalHp = Math.min(maxPossibleHp, currentHp + healAmount);

      const prevCount = targetStack.count;
      targetStack.count = Math.ceil(newTotalHp / targetStack.maxHp);
      const rem = newTotalHp % targetStack.maxHp;
      targetStack.topHp = rem === 0 ? targetStack.maxHp : rem;

      const resurrected = targetStack.count - prevCount;
      logMsg = '💖 [' + actor.name + '] сотворил «' + spellCfg.name + '» на [' + targetStack.name +
        ']! Исцелено ' + healAmount + ' ОЗ' + (resurrected > 0 ? ', воскрешено воинов: ' + resurrected : '') + '.';
      battleState.log.push(logMsg);
    } else if (spellId === 'fireball') {
      actor.mana -= manaCost;
      targetCol = targetCol !== undefined ? targetCol : 5;
      targetRow = targetRow !== undefined ? targetRow : 4;
      const baseDmg = Math.round(28 + 18 * spPower);

      logMsg = '☄️ [' + actor.name + '] обрушил пылающий «' + spellCfg.name +
        '» в зону [' + targetCol + ', ' + targetRow + ']!';
      battleState.log.push(logMsg);

      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.count > 0 && Math.abs(s.col - targetCol) <= 1 && Math.abs(s.row - targetRow) <= 1) {
          let dmg = baseDmg;
          if (s.buffs && s.buffs.divine_shield > 0) {
            dmg = Math.round(dmg * 0.75);
          }
          const imp = applyDamageToStack(s, dmg);
          const hitMsg = '🔥 Взрыв огненного шара опаляет [' + s.name + ']: ' + dmg + ' урона (пало ' + imp.killed + ').';
          battleState.log.push(hitMsg);
        }
      }
    } else {
      return { ok: false, message: 'Неизвестное заклинание: ' + spellId };
    }

    actor.atb = 0;

    // Синхронизируем остаток маны героя игрока в кампании
    if (actor.side === 'player') {
      const camp = getCampaignState();
      if (camp && camp.hero) {
        camp.hero.mana = Math.max(0, actor.mana);
      }
    }

    safeEmit('battle:action', {
      type: 'spell',
      actor: actor,
      spellId: spellId,
      manaCost: manaCost,
      targetCol: targetCol,
      targetRow: targetRow,
      targetStackId: targetStackId,
      log: logMsg
    });

    if (checkBattleEnd()) {
      return { ok: true, message: logMsg, battleEnded: true };
    }

    advanceATBToNextActor();
    return { ok: true, message: logMsg };
  }

  function executeHeroStrike(targetStackId) {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor || !actor.isHeroActor) {
      return { ok: false, message: 'Героический удар может совершать только Герой!' };
    }

    const target = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
    if (!target) return { ok: false, message: 'Цель для героического удара не найдена' };

    // Урон прямого удара полководца (не провоцирует ответный удар, так как герой вне сетки)
    let heroDmg = Math.round(18 + (actor.attack || 6) * 7 + (actor.spellPower || 5) * 3);
    if (target.buffs && target.buffs.divine_shield > 0) {
      heroDmg = Math.round(heroDmg * 0.75);
    }
    heroDmg = Math.max(1, heroDmg);
    const imp = applyDamageToStack(target, heroDmg);

    const logMsg = '👑 [' + actor.name + '] наносит разящий Героический удар по [' + target.name +
      '] на ' + heroDmg + ' урона! Пало: ' + imp.killed + '.';
    battleState.log.push(logMsg);

    actor.atb = 0;

    safeEmit('battle:action', {
      type: 'hero_strike',
      actor: actor,
      target: target,
      damage: heroDmg,
      killed: imp.killed,
      log: logMsg
    });

    if (checkBattleEnd()) {
      return { ok: true, message: logMsg, battleEnded: true };
    }

    advanceATBToNextActor();
    return { ok: true, message: logMsg };
  }

  // ---------------------------------------------------------------------------
  // 6. ТАКТИЧЕСКИЙ ИИ ВРАГА И АГРАИЛА (computeEnemyAIDecision & stepAI)
  // ---------------------------------------------------------------------------

  function computeEnemyAIDecision() {
    if (!battleState || battleState.status !== 'active') return null;
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor || actor.side !== 'enemy') return null;

    // Ход Вражеского Героя (Аграил Пепельный)
    if (actor.isHeroActor) {
      const spCfg = HOMM5.CONFIG.SPELLS.fireball;
      if ((actor.mana || 0) >= (spCfg.manaCost || 15)) {
        let bestCol = 3;
        let bestRow = 3;
        let maxScore = -1;

        for (let c = 1; c < battleState.gridCols - 1; c++) {
          for (let r = 1; r < battleState.gridRows - 1; r++) {
            let score = 0;
            for (let i = 0; i < battleState.stacks.length; i++) {
              const s = battleState.stacks[i];
              if (s.count > 0 && Math.abs(s.col - c) <= 1 && Math.abs(s.row - r) <= 1) {
                if (s.side === 'player') {
                  score += (s.unitId === 'crossbowman' ? 4 : (s.isWarMachine ? 1 : 2));
                } else {
                  score -= 3;
                }
              }
            }
            if (score > maxScore) {
              maxScore = score;
              bestCol = c;
              bestRow = r;
            }
          }
        }

        if (maxScore > 0) {
          return {
            type: 'castSpell',
            spellId: 'fireball',
            targetCol: bestCol,
            targetRow: bestRow
          };
        }
      }

      // Прямой удар по обычным стрелкам или живым отрядам игрока (не фокусим Баллисту в первую очередь)
      const playerStacks = battleState.stacks.filter((s) => s.side === 'player' && s.count > 0 && !s.isWarMachine);
      if (playerStacks.length > 0) {
        playerStacks.sort((a, b) => {
          if (a.unitId === 'crossbowman') return -1;
          if (b.unitId === 'crossbowman') return 1;
          return a.count - b.count;
        });
        return {
          type: 'heroStrike',
          targetStackId: playerStacks[0].id
        };
      }
      return { type: 'defend' };
    }

    // Ход вражеского отряда на сетке
    const actions = getValidActions(actor.id);

    // 1. Если стрелок и есть дальнобойные цели — фокусим живые войска игрока (арбалетчиков первыми)
    const rangedTargets = actions.targets.filter((t) => t.mode === 'ranged');
    if (rangedTargets.length > 0) {
      rangedTargets.sort((a, b) => {
        const stackA = battleState.stacks.find((s) => s.id === a.targetStackId);
        const stackB = battleState.stacks.find((s) => s.id === b.targetStackId);
        if (stackA && stackA.isWarMachine && (!stackB || !stackB.isWarMachine)) return 1;
        if (stackB && stackB.isWarMachine && (!stackA || !stackA.isWarMachine)) return -1;
        if (stackA && stackA.unitId === 'crossbowman') return -1;
        if (stackB && stackB.unitId === 'crossbowman') return 1;
        return 0;
      });
      return {
        type: 'attack',
        targetStackId: rangedTargets[0].targetStackId,
        mode: 'ranged'
      };
    }

    // 2. Если есть цели для ближнего боя — атакуем наиболее опасный живой отряд
    const meleeTargets = actions.targets.filter((t) => t.mode === 'melee');
    if (meleeTargets.length > 0) {
      meleeTargets.sort((a, b) => {
        const stackA = battleState.stacks.find((s) => s.id === a.targetStackId);
        const stackB = battleState.stacks.find((s) => s.id === b.targetStackId);
        if (stackA && stackA.isWarMachine && (!stackB || !stackB.isWarMachine)) return 1;
        if (stackB && stackB.isWarMachine && (!stackA || !stackA.isWarMachine)) return -1;
        if (stackA && stackA.unitId === 'crossbowman') return -1;
        if (stackB && stackB.unitId === 'crossbowman') return 1;
        return (stackA ? stackA.count : 0) - (stackB ? stackB.count : 0);
      });
      const best = meleeTargets[0];
      return {
        type: 'attack',
        targetStackId: best.targetStackId,
        mode: 'melee',
        preferredMoveCell: { col: best.moveFromCol, row: best.moveFromRow }
      };
    }

    // 3. Если атаковать никого нельзя — перемещаемся ближе к живым отрядам игрока
    if (actions.moves.length > 1) {
      const playerTargets = battleState.stacks.filter((s) => s.side === 'player' && s.count > 0 && !s.isWarMachine);
      const focusTarget = playerTargets.find((s) => s.unitId === 'crossbowman') || playerTargets[0];

      if (focusTarget) {
        let bestMove = actions.moves[0];
        let minDist = Infinity;

        for (let i = 0; i < actions.moves.length; i++) {
          const m = actions.moves[i];
          const dist = Math.hypot(m.col - focusTarget.col, m.row - focusTarget.row);
          if (dist < minDist) {
            minDist = dist;
            bestMove = m;
          }
        }

        return {
          type: 'move',
          targetCol: bestMove.col,
          targetRow: bestMove.row
        };
      }
    }

    // 4. Если идти некуда — глухая оборона
    return { type: 'defend' };
  }

  function executeAIDecision(decision) {
    if (!decision) return { ok: false, message: 'Нет решения ИИ' };

    if (decision.type === 'castSpell') {
      return castSpell(decision.spellId, decision.targetCol, decision.targetRow, decision.targetStackId);
    } else if (decision.type === 'heroStrike') {
      return executeHeroStrike(decision.targetStackId);
    } else if (decision.type === 'attack') {
      return executeUnitAttack(decision.targetStackId, decision.preferredMoveCell);
    } else if (decision.type === 'move') {
      return executeUnitMove(decision.targetCol, decision.targetRow);
    } else if (decision.type === 'wait') {
      return commandWait();
    } else {
      return commandDefend();
    }
  }

  function stepAI() {
    const decision = computeEnemyAIDecision();
    if (!decision) return null;
    return executeAIDecision(decision);
  }

  // ---------------------------------------------------------------------------
  // 7. ЗАВЕРШЕНИЕ БОЯ, НАГРАДЫ (XP + РЕЛИКВИИ МИССИЙ 1..4) И ЗВЁЗДЫ (checkBattleEnd)
  // ---------------------------------------------------------------------------

  function checkBattleEnd() {
    if (!battleState || battleState.status !== 'active') return false;

    const playerDead = isSideEliminated('player');
    const enemyDead = isSideEliminated('enemy');

    if (!playerDead && !enemyDead) return false;

    const campaign = getCampaignState();

    if (enemyDead) {
      battleState.status = 'victory';

      // Расчёт звёзд мастерства (1..3★) по сохранности регулярной армии игрока (без Баллисты)
      let initialTotal = 0;
      let survivingTotal = 0;
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.side === 'player' && !s.isWarMachine && !(s.unit && s.unit.isWarMachine)) {
          initialTotal += s.initialCount;
          survivingTotal += s.count;
        }
      }

      const ratio = initialTotal > 0 ? survivingTotal / initialTotal : 1.0;
      let stars = 1;
      if (ratio >= 0.80) {
        stars = 3;
      } else if (ratio >= 0.50) {
        stars = 2;
      }

      const mIdx = battleState.missionIndex || 0;
      const node = mIdx > 0 ? getMissionNode(mIdx) : null;

      const goldReward = (node && node.rewardGold) || (Math.max(1, mIdx) * 900 + 400);
      const crystalReward = (node && node.rewardCrystal) || (Math.max(1, mIdx) * 2 + 1);
      const xpReward = (node && node.rewardXp) || (Math.max(1, mIdx) * 350);

      campaign.gold += goldReward;
      campaign.crystals += crystalReward;
      campaign.victories += 1;

      if (mIdx > 0) {
        campaign.bestStarsByMission[mIdx] = Math.max(campaign.bestStarsByMission[mIdx] || 0, stars);
        campaign.maxUnlockedMission = Math.min(4, Math.max(campaign.maxUnlockedMission || 1, mIdx + 1));
      }
      if (node && node.id) {
        campaign.completedNodes[node.id] = true;
      }

      // Полевые лекари и сохранение регулярной армии замка (без включения Баллисты в campaign.army)
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.side === 'player' && !s.isWarMachine && !(s.unit && s.unit.isWarMachine)) {
          let finalCount = s.count;
          const lost = s.initialCount - s.count;
          if (lost > 0 && s.unitId === 'squire') {
            const healed = Math.max(1, Math.round(lost * 0.25));
            finalCount += healed;
            battleState.log.push('🩺 Полевые лекари вернули в строй +' + healed + ' павших Латников!');
          }
          campaign.army[s.unitId] = finalCount;
        }
      }

      // Выдача боевого опыта Герою и реликвии миссии 1..4
      let xpResult = null;
      if (xpReward > 0) {
        xpResult = grantHeroXP(xpReward);
      }

      let grantedArtifactId = null;
      let grantedArtifactName = null;
      if (node && node.rewardArtifact) {
        const artsReg = getArtifactsRegistry();
        if (artsReg[node.rewardArtifact]) {
          grantArtifact(node.rewardArtifact, true);
          grantedArtifactId = node.rewardArtifact;
          grantedArtifactName = artsReg[node.rewardArtifact].name;
          battleState.log.push('🗡️ Добыта реликвия Асхана: «' + grantedArtifactName + '»!');
        }
      }

      const victoryStarsText = stars === 3 ? '★★★ (Безупречно)' : (stars === 2 ? '★★☆ (Ветеран)' : '★☆☆ (Тяжёлая победа)');
      const vicLog = '🏆 Славная Победа Ордена Порядка! Награда: +' + goldReward + ' 💰, +' +
        crystalReward + ' 💎, +' + xpReward + ' Опыта. Оценка: ' + victoryStarsText;
      battleState.log.push(vicLog);

      safeEmit('battle:ended', {
        status: 'victory',
        stars: stars,
        goldReward: goldReward,
        crystalReward: crystalReward,
        xpReward: xpReward,
        levelsGained: xpResult ? xpResult.levelsGained : 0,
        rewardArtifact: grantedArtifactId,
        rewardArtifactName: grantedArtifactName,
        campaign: campaign
      });
      safeEmit('campaign:updated', campaign);
      return true;
    }

    if (playerDead) {
      battleState.status = 'defeat';
      const defLog = '☠️ Поражение! Армия Лорда Годрика рассеяна легионами Шио. Отступите в замок и наберите новые полки!';
      battleState.log.push(defLog);

      // При поражении даём минимальный гарнизон спасения, чтобы не было софтлока (Баллиста не записывается в army)
      campaign.army.squire = Math.max(8, campaign.army.squire || 0);
      campaign.army.crossbowman = Math.max(4, campaign.army.crossbowman || 0);

      safeEmit('battle:ended', {
        status: 'defeat',
        stars: 0,
        campaign: campaign
      });
      safeEmit('campaign:updated', campaign);
      return true;
    }

    return false;
  }

  function resetBattle() {
    battleState = null;
    safeEmit('battle:reset', null);
  }

  // ---------------------------------------------------------------------------
  // Экспорт CombatCore (v3.0)
  // ---------------------------------------------------------------------------

  const CombatCore = {
    // Состояние кампании, похода, Колеса Умений и Реликвий v3.0
    createDefaultCampaign: createDefaultCampaign,
    getCampaignState: getCampaignState,
    loadCampaignState: loadCampaignState,
    getHeroEffectiveStats: getHeroEffectiveStats,
    grantHeroXP: grantHeroXP,
    unlockHeroSkill: unlockHeroSkill,
    grantArtifact: grantArtifact,
    equipArtifact: equipArtifact,
    unequipArtifact: unequipArtifact,
    revealFogAround: revealFogAround,
    moveAdventureHero: moveAdventureHero,
    advanceAdventureDay: advanceAdventureDay,
    constructBuilding: constructBuilding,
    recruitUnit: recruitUnit,
    nextWeek: nextWeek,
    interactValleyNode: interactValleyNode,

    // Тактический бой, 3D-Баллиста и ATB
    startMissionBattle: startMissionBattle,
    startCustomSkirmish: startCustomSkirmish,
    getBattleState: getBattleState,
    getLivingActors: getLivingActors,
    advanceATBToNextActor: advanceATBToNextActor,
    predictATBQueue: predictATBQueue,
    getValidActions: getValidActions,
    getEffectiveSpellManaCost: getEffectiveSpellManaCost,
    commandWait: commandWait,
    commandDefend: commandDefend,
    executeUnitMove: executeUnitMove,
    executeUnitAttack: executeUnitAttack,
    autoFireWarMachine: autoFireWarMachine,
    estimateDamagePreview: estimateDamagePreview,
    castSpell: castSpell,
    executeHeroStrike: executeHeroStrike,
    computeEnemyAIDecision: computeEnemyAIDecision,
    executeAIDecision: executeAIDecision,
    stepAI: stepAI,
    checkBattleEnd: checkBattleEnd,
    resetBattle: resetBattle
  };

  HOMM5.CombatCore = CombatCore;
  root.HOMM5 = HOMM5;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CombatCore;
  }
})(typeof window !== 'undefined' ? window : globalThis);
