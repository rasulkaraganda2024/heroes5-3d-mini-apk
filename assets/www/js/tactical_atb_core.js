/**
 * Герои Меча и Магии V: Эпоха Грифонов — 3D Мини (RU)
 * Тактическое ядро боя, механика ATB и экономика замка (Tactical & ATB Core)
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

  // ---------------------------------------------------------------------------
  // 1. СОСТОЯНИЕ КАМПАНИИ И ЗАМКА (Campaign & Castle State)
  // ---------------------------------------------------------------------------

  let campaignState = null;

  function createDefaultCampaign() {
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

    campaignState = {
      gold: 1650,
      crystals: 3,
      day: 1,
      week: 1,
      maxUnlockedMission: 1,
      victories: 0,
      bestStarsByMission: { 1: 0, 2: 0, 3: 0 },
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

    safeEmit('campaign:updated', campaignState);
    return campaignState;
  }

  function getCampaignState() {
    if (!campaignState) {
      campaignState = createDefaultCampaign();
    }
    return campaignState;
  }

  function loadCampaignState(savedObj) {
    const def = createDefaultCampaign();
    if (!savedObj || typeof savedObj !== 'object') {
      campaignState = def;
      return campaignState;
    }

    campaignState = {
      gold: typeof savedObj.gold === 'number' ? savedObj.gold : def.gold,
      crystals: typeof savedObj.crystals === 'number' ? savedObj.crystals : def.crystals,
      day: typeof savedObj.day === 'number' ? savedObj.day : def.day,
      week: typeof savedObj.week === 'number' ? savedObj.week : def.week,
      maxUnlockedMission: typeof savedObj.maxUnlockedMission === 'number' ? savedObj.maxUnlockedMission : def.maxUnlockedMission,
      victories: typeof savedObj.victories === 'number' ? savedObj.victories : def.victories,
      bestStarsByMission: Object.assign({}, def.bestStarsByMission, savedObj.bestStarsByMission || {}),
      hero: Object.assign({}, def.hero, savedObj.hero || {}),
      buildings: Object.assign({}, def.buildings, savedObj.buildings || {}),
      dwellingsAvailable: Object.assign({}, def.dwellingsAvailable, savedObj.dwellingsAvailable || {}),
      army: Object.assign({}, def.army, savedObj.army || {}),
      completedNodes: Object.assign({}, savedObj.completedNodes || {})
    };

    safeEmit('campaign:updated', campaignState);
    return campaignState;
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

    // Еженедельный налог в казну (+650 золота)
    const taxIncome = 650;
    campaign.gold += taxIncome;

    // Прирост существ во всех построенных зданиях
    if (HOMM5.CONFIG && HOMM5.CONFIG.BUILDINGS) {
      for (const bId of Object.keys(HOMM5.CONFIG.BUILDINGS)) {
        const bld = HOMM5.CONFIG.BUILDINGS[bId];
        if (campaign.buildings[bId] && bld.unlocksUnit && bld.weeklyGrowth) {
          const uId = bld.unlocksUnit;
          campaign.dwellingsAvailable[uId] = (campaign.dwellingsAvailable[uId] || 0) + bld.weeklyGrowth;
        }
      }
    }

    // Полное восстановление маны героя в начале новой недели
    if (campaign.hero) {
      campaign.hero.mana = campaign.hero.maxMana || 50;
    }

    safeEmit('campaign:updated', campaign);
    return {
      ok: true,
      message: 'Наступила неделя ' + campaign.week + '! Получен налог +' + taxIncome + ' 💰. Резервы найма пополнены.'
    };
  }

  function interactValleyNode(nodeId, choice) {
    const campaign = getCampaignState();
    const node = (HOMM5.CONFIG && HOMM5.CONFIG.VALLEY_NODES)
      ? HOMM5.CONFIG.VALLEY_NODES.find((n) => n.id === nodeId)
      : null;

    if (!node) {
      return { ok: false, message: 'Интерактивная точка не найдена: ' + nodeId };
    }

    if (campaign.completedNodes[nodeId] && node.type !== 'battle') {
      return { ok: false, message: 'Эта точка уже исследована: ' + node.name };
    }

    if (node.type === 'treasure') {
      if (choice === 'xp') {
        campaign.hero.attack = (campaign.hero.attack || 6) + 1;
        campaign.hero.spellPower = (campaign.hero.spellPower || 5) + 1;
        campaign.hero.level = (campaign.hero.level || 1) + 1;
        campaign.completedNodes[nodeId] = true;
        safeEmit('campaign:updated', campaign);
        return {
          ok: true,
          reward: 'xp',
          message: 'Лорд Годрик выбрал реликвию опыта: +1 Атака, +1 Сила Магии, новый уровень (' + campaign.hero.level + ')!'
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
      if (s.side === side && s.count > 0) return false;
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
          atb: s.atb,
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
        atb: battleState.heroPlayer.atb,
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
        atb: battleState.heroEnemy.atb,
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
        isHero: bestActor.isHero
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
        const needed = (1.0 - a.atb) / a.initiative;
        if (needed < minTime) minTime = needed;
      }

      if (minTime > 0 && Number.isFinite(minTime)) {
        for (let i = 0; i < aliveActors.length; i++) {
          aliveActors[i].atb += minTime * aliveActors[i].initiative;
        }
      }

      for (let i = 0; i < aliveActors.length; i++) {
        if (aliveActors[i].atb >= 1.0 - 1e-6) {
          ready.push(aliveActors[i]);
        }
      }
    }

    ready.sort((a, b) => (b.atb - a.atb) || (b.initiative - a.initiative));
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

    const queue = predictATBQueue(HOMM5.CONFIG.ATB_QUEUE_SIZE || 8);
    const validActions = getValidActions(active.id);

    safeEmit('battle:turn', {
      activeActor: active,
      queue: queue,
      validActions: validActions
    });

    return active;
  }

  function startMissionBattle(missionIndex) {
    const campaign = getCampaignState();
    missionIndex = missionIndex || 1;
    const node = (HOMM5.CONFIG && HOMM5.CONFIG.VALLEY_NODES)
      ? HOMM5.CONFIG.VALLEY_NODES.find((n) => n.missionIndex === missionIndex)
      : null;

    const obstacles = (node && node.obstacles) ? deepClone(node.obstacles) : [
      { col: 4, row: 2, kind: 'pillar' },
      { col: 5, row: 5, kind: 'rock' }
    ];

    const stacks = [];

    // Расстановка армии игрока (слева, col = 0..1)
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
          topHp: uCfg.hp,
          maxHp: uCfg.hp,
          shotsLeft: uCfg.shots || 0,
          retaliatedThisRound: false,
          defending: false,
          buffs: { righteous_might: 0, divine_shield: 0 },
          atb: 0.10 + pIndex * 0.04,
          initiative: uCfg.initiative,
          speed: uCfg.speed,
          isHeroActor: false
        });
        pIndex++;
      }
    }

    // Если армия игрока была пуста (крайний случай безопасности) — даём почётный эскорт латников
    if (stacks.length === 0) {
      const uCfg = HOMM5.CONFIG.UNITS.squire;
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
        topHp: uCfg.hp,
        maxHp: uCfg.hp,
        shotsLeft: 0,
        retaliatedThisRound: false,
        defending: false,
        buffs: { righteous_might: 0, divine_shield: 0 },
        atb: 0.12,
        initiative: uCfg.initiative,
        speed: uCfg.speed,
        isHeroActor: false
      });
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
        isHeroActor: false
      });
      eIndex++;
    }

    // Инициализация Героев на кромке поля боя
    const heroPlayerCfg = campaign.hero;
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

    const heroPlayer = {
      id: 'hero_player',
      name: heroPlayerCfg.name || 'Лорд Годрик',
      icon: heroPlayerCfg.icon || '👑',
      side: 'player',
      isHeroActor: true,
      initiative: heroPlayerCfg.initiative || 10,
      attack: heroPlayerCfg.attack || 6,
      defense: heroPlayerCfg.defense || 7,
      spellPower: heroPlayerCfg.spellPower || 5,
      mana: heroPlayerCfg.mana !== undefined ? heroPlayerCfg.mana : 50,
      maxMana: heroPlayerCfg.maxMana || 50,
      morale: heroPlayerCfg.morale || 2,
      luck: heroPlayerCfg.luck || 2,
      atb: 0.15,
      col: -1,
      row: -1
    };

    const heroEnemy = {
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
      atb: 0.14,
      col: -1,
      row: -1
    };

    battleState = {
      missionIndex: missionIndex,
      missionName: node ? node.name : 'Полевой бой',
      status: 'active', // 'active' | 'victory' | 'defeat'
      turnNumber: 1,
      gridCols: (HOMM5.CONFIG && HOMM5.CONFIG.GRID_COLS) || 10,
      gridRows: (HOMM5.CONFIG && HOMM5.CONFIG.GRID_ROWS) || 8,
      obstacles: obstacles,
      stacks: stacks,
      heroPlayer: heroPlayer,
      heroEnemy: heroEnemy,
      activeActorId: null,
      log: ['⚔️ Битва началась! Полководцы выстраивают фаланги на тактической арене.']
    };

    safeEmit('battle:started', battleState);
    advanceATBToNextActor();
    return battleState;
  }

  function startCustomSkirmish(options) {
    options = options || {};
    const campaign = getCampaignState();

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
      if (cnt > 0) {
        const uCfg = HOMM5.CONFIG.UNITS[uId];
        const coord = pCoords[pIdx % pCoords.length];
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
          topHp: uCfg.hp,
          maxHp: uCfg.hp,
          shotsLeft: uCfg.shots || 0,
          retaliatedThisRound: false,
          defending: false,
          buffs: { righteous_might: 0, divine_shield: 0 },
          atb: 0.10 + pIdx * 0.03,
          initiative: uCfg.initiative,
          speed: uCfg.speed,
          isHeroActor: false
        });
        pIdx++;
      }
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
      if (cnt > 0) {
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
          isHeroActor: false
        });
        eIdx++;
      }
    }

    const heroPlayerCfg = campaign.hero;
    const heroEnemyCfg = HOMM5.CONFIG.HEROES.inferno_lord;

    battleState = {
      missionIndex: 0,
      missionName: 'Тренировочная Дуэль (Скирмиш)',
      status: 'active',
      turnNumber: 1,
      gridCols: (HOMM5.CONFIG && HOMM5.CONFIG.GRID_COLS) || 10,
      gridRows: (HOMM5.CONFIG && HOMM5.CONFIG.GRID_ROWS) || 8,
      obstacles: obstacles,
      stacks: stacks,
      heroPlayer: {
        id: 'hero_player',
        name: heroPlayerCfg.name || 'Лорд Годрик',
        icon: heroPlayerCfg.icon || '👑',
        side: 'player',
        isHeroActor: true,
        initiative: heroPlayerCfg.initiative || 10,
        attack: heroPlayerCfg.attack || 6,
        defense: heroPlayerCfg.defense || 7,
        spellPower: heroPlayerCfg.spellPower || 5,
        mana: heroPlayerCfg.mana || 50,
        maxMana: heroPlayerCfg.maxMana || 50,
        morale: heroPlayerCfg.morale || 2,
        luck: heroPlayerCfg.luck || 2,
        atb: 0.15,
        col: -1,
        row: -1
      },
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

    const speed = stack.speed || stack.unit.speed || 4;
    const isFlying = !!stack.unit.isFlying;
    const moves = [];

    // Клетка, на которой отряд уже стоит (дистанция 0)
    moves.push({
      col: stack.col,
      row: stack.row,
      dist: 0,
      path: [{ col: stack.col, row: stack.row }]
    });

    if (isFlying) {
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
    } else {
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

    // Проверяем, заблокирован ли стрелок врагом на соседней 8-связной клетке
    let isShooterBlocked = false;
    for (let i = 0; i < enemyStacks.length; i++) {
      const es = enemyStacks[i];
      if (Math.max(Math.abs(es.col - stack.col), Math.abs(es.row - stack.row)) <= 1) {
        isShooterBlocked = true;
        break;
      }
    }

    // Дальнобойная атака (если стрелок, есть стрелы и не заблокирован в упор)
    if (stack.unit.isRanged && (stack.shotsLeft > 0) && !isShooterBlocked) {
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
          // Проверяем, нет ли уже такого перехода к этой цели
          const already = targets.some((t) => t.targetStackId === es.id && t.moveFromCol === move.col && t.moveFromRow === move.row);
          if (!already) {
            targets.push({
              targetStackId: es.id,
              col: es.col,
              row: es.row,
              mode: 'melee',
              moveFromCol: move.col,
              moveFromRow: move.row,
              path: move.path
            });
          }
        }
      }
    }

    return { moves: moves, targets: targets };
  }

  // ---------------------------------------------------------------------------
  // 4. КОМАНДЫ «ЖДАТЬ», «ОБОРОНА», ПЕРЕМЕЩЕНИЕ И АТАКА
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

  // Честный расчёт урона по формуле Heroes of Might and Magic V
  function calculateDamage(attacker, defender, mode, distMoved) {
    const allyHero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const enemyHero = defender.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;

    const uAtk = attacker.unit;
    const uDef = defender.unit;

    // 1. Эффективная Атака
    let effAtk = uAtk.attack + (allyHero ? allyHero.attack : 0);
    if (attacker.buffs && attacker.buffs.righteous_might > 0) {
      effAtk += 6;
    }

    // 2. Эффективная Защита
    let effDef = uDef.defense + (enemyHero ? enemyHero.defense : 0);
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

    // 5. Учёт специальных способностей существ
    // Рыцарский разбег Паладина (+8% за клетку разбега, до +48%)
    if (uAtk.joustingBonus && distMoved > 0) {
      const joustBonus = Math.min(0.48, Math.round(distMoved) * 0.08);
      rawDamage *= (1.0 + joustBonus);
    }

    // Штраф стрелку в ближнем бою (0.5x)
    if (uAtk.isRanged && mode === 'melee') {
      rawDamage *= 0.50;
    }

    // Штраф стрелку на дистанции > 5 клеток (0.5x, кроме Арбалетчиков с noRangePenalty)
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
      // Ищем любое подходящее действие против этой цели
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

    if (chosenTargetAction.mode === 'ranged') {
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
      logMsg += ' Пало воинов: ' + impact.killed + '.';
    }
    if (target.count <= 0) {
      logMsg += ' 💀 Отряд [' + target.name + '] полностью уничтожен!';
    }

    battleState.log.push(logMsg);

    // Дополнительные свойства удара
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

    // Обработка Ответного Удара (Retaliation)
    let retalData = null;
    if (chosenTargetAction.mode === 'melee' && target.count > 0 && !attacker.unit.noRetaliationAttack) {
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

    // Проверка Боевого Духа после атаки
    const hero = attacker.side === 'player' ? battleState.heroPlayer : battleState.heroEnemy;
    const morale = (hero && hero.morale) ? hero.morale : 0;
    const hasHighMorale = attacker.count > 0 && Math.random() < (morale * 0.08);

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

  function castSpell(spellId, targetCol, targetRow, targetStackId) {
    if (!battleState || battleState.status !== 'active') return { ok: false, message: 'Битва не активна' };
    const actor = getLivingActors().find((a) => a.id === battleState.activeActorId);
    if (!actor || !actor.isHeroActor) {
      return { ok: false, message: 'Заклинания может творить только Герой во время своего хода!' };
    }

    const spellCfg = HOMM5.CONFIG && HOMM5.CONFIG.SPELLS && HOMM5.CONFIG.SPELLS[spellId];
    if (!spellCfg) return { ok: false, message: 'Неизвестное заклинание: ' + spellId };

    const manaCost = spellCfg.manaCost || 10;
    if ((actor.mana || 0) < manaCost) {
      return { ok: false, message: 'Недостаточно маны! Требуется: ' + manaCost + ', доступно: ' + actor.mana };
    }

    actor.mana -= manaCost;
    let logMsg = '';
    const spPower = actor.spellPower || 5;

    if (spellId === 'righteous_might') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для благословения' };
      targetStack.buffs.righteous_might = 3;
      logMsg = '✨ [' + actor.name + '] сотворил «' + spellCfg.name + '» на [' + targetStack.name +
        ']! (+6 к Атаке и максимальный урон на 3 хода).';
      battleState.log.push(logMsg);
    } else if (spellId === 'divine_shield') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для Небесного Щита' };
      targetStack.buffs.divine_shield = 3;
      logMsg = '🛡️ [' + actor.name + '] окружил [' + targetStack.name +
        '] куполом «' + spellCfg.name + '»! (+8 к Защите и -25% входящего урона на 3 хода).';
      battleState.log.push(logMsg);
    } else if (spellId === 'holy_light') {
      const targetStack = battleState.stacks.find((s) => s.id === targetStackId && s.count > 0);
      if (!targetStack) return { ok: false, message: 'Укажите союзный отряд для исцеления' };

      const healAmount = Math.round(45 + 22 * spPower);
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
      targetCol = targetCol !== undefined ? targetCol : 5;
      targetRow = targetRow !== undefined ? targetRow : 4;
      const baseDmg = Math.round(28 + 18 * spPower);

      logMsg = '☄️ [' + actor.name + '] обрушил пылающий «' + spellCfg.name +
        '» в зону [' + targetCol + ', ' + targetRow + ']!';
      battleState.log.push(logMsg);

      let totalVictims = 0;
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.count > 0 && Math.abs(s.col - targetCol) <= 1 && Math.abs(s.row - targetRow) <= 1) {
          let dmg = baseDmg;
          if (s.buffs && s.buffs.divine_shield > 0) {
            dmg = Math.round(dmg * 0.75);
          }
          const imp = applyDamageToStack(s, dmg);
          totalVictims += imp.killed;
          const hitMsg = '🔥 Взрыв огненного шара опаляет [' + s.name + ']: ' + dmg + ' урона (пало ' + imp.killed + ').';
          battleState.log.push(hitMsg);
        }
      }
    }

    actor.atb = 0;

    safeEmit('battle:action', {
      type: 'spell',
      actor: actor,
      spellId: spellId,
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
    const heroDmg = Math.round(18 + (actor.attack || 6) * 7 + (actor.spellPower || 5) * 3);
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
        // Ищем оптимальный центр 3x3 для Огненного Шара, чтобы задеть максимум отрядов игрока
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
                  score += (s.unitId === 'crossbowman' ? 4 : 2);
                } else {
                  score -= 3; // Штраф за задевание своих
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

      // Если нет маны или нет хорошей зоны — прямой удар по стрелкам или самому слабому
      const playerStacks = battleState.stacks.filter((s) => s.side === 'player' && s.count > 0);
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

    // 1. Если стрелок и есть дальнобойные цели — фокусим арбалетчиков игрока
    const rangedTargets = actions.targets.filter((t) => t.mode === 'ranged');
    if (rangedTargets.length > 0) {
      rangedTargets.sort((a, b) => {
        const stackA = battleState.stacks.find((s) => s.id === a.targetStackId);
        const stackB = battleState.stacks.find((s) => s.id === b.targetStackId);
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

    // 2. Если есть цели для ближнего боя — атакуем наиболее опасную цель
    const meleeTargets = actions.targets.filter((t) => t.mode === 'melee');
    if (meleeTargets.length > 0) {
      meleeTargets.sort((a, b) => {
        const stackA = battleState.stacks.find((s) => s.id === a.targetStackId);
        const stackB = battleState.stacks.find((s) => s.id === b.targetStackId);
        // Приоритет: связать боем арбалетчиков
        if (stackA && stackA.unitId === 'crossbowman') return -1;
        if (stackB && stackB.unitId === 'crossbowman') return 1;
        // Затем добить раненых
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

    // 3. Если атаковать никого нельзя — перемещаемся ближе к арбалетчикам или центру армии игрока
    if (actions.moves.length > 1) {
      const playerTargets = battleState.stacks.filter((s) => s.side === 'player' && s.count > 0);
      let focusTarget = playerTargets.find((s) => s.unitId === 'crossbowman') || playerTargets[0];

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
  // 7. ЗАВЕРШЕНИЕ БОЯ, НАГРАДЫ И ЗВЁЗДЫ (checkBattleEnd)
  // ---------------------------------------------------------------------------

  function checkBattleEnd() {
    if (!battleState || battleState.status !== 'active') return false;

    const playerDead = isSideEliminated('player');
    const enemyDead = isSideEliminated('enemy');

    if (!playerDead && !enemyDead) return false;

    const campaign = getCampaignState();

    if (enemyDead) {
      battleState.status = 'victory';

      // Расчёт звёзд мастерства (1..3★) по сохранности армии игрока
      let initialTotal = 0;
      let survivingTotal = 0;
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.side === 'player') {
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

      // Награда за миссию
      const node = (HOMM5.CONFIG && HOMM5.CONFIG.VALLEY_NODES)
        ? HOMM5.CONFIG.VALLEY_NODES.find((n) => n.missionIndex === battleState.missionIndex)
        : null;

      const goldReward = (node && node.rewardGold) || (battleState.missionIndex * 900 + 400);
      const crystalReward = (node && node.rewardCrystal) || (battleState.missionIndex * 2 + 1);

      campaign.gold += goldReward;
      campaign.crystals += crystalReward;
      campaign.victories += 1;

      const mIdx = battleState.missionIndex || 1;
      campaign.bestStarsByMission[mIdx] = Math.max(campaign.bestStarsByMission[mIdx] || 0, stars);
      campaign.maxUnlockedMission = Math.max(campaign.maxUnlockedMission, mIdx + 1);
      if (node) {
        campaign.completedNodes[node.id] = true;
      }

      // Полевые лекари: частичное возвращение павших воинов после боя (25% потерь латников)
      for (let i = 0; i < battleState.stacks.length; i++) {
        const s = battleState.stacks[i];
        if (s.side === 'player') {
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

      const victoryStarsText = stars === 3 ? '★★★ (Безупречно)' : (stars === 2 ? '★★☆ (Ветеран)' : '★☆☆ (Тяжёлая победа)');
      const vicLog = '🏆 Славная Победа Ордена Порядка! Награда: +' + goldReward + ' 💰, +' +
        crystalReward + ' 💎. Оценка: ' + victoryStarsText;
      battleState.log.push(vicLog);

      safeEmit('battle:ended', {
        status: 'victory',
        stars: stars,
        goldReward: goldReward,
        crystalReward: crystalReward,
        campaign: campaign
      });
      safeEmit('campaign:updated', campaign);
      return true;
    }

    if (playerDead) {
      battleState.status = 'defeat';
      const defLog = '☠️ Поражение! Армия Лорда Годрика рассеяна легионами Шио. Отступите в замок и наберите новые полки!';
      battleState.log.push(defLog);

      // При поражении даём минимальный гарнизон спасения, чтобы не было софтлока
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
  // Экспорт CombatCore
  // ---------------------------------------------------------------------------

  const CombatCore = {
    // Состояние кампании
    createDefaultCampaign: createDefaultCampaign,
    getCampaignState: getCampaignState,
    loadCampaignState: loadCampaignState,
    constructBuilding: constructBuilding,
    recruitUnit: recruitUnit,
    nextWeek: nextWeek,
    interactValleyNode: interactValleyNode,

    // Тактический бой и ATB
    startMissionBattle: startMissionBattle,
    startCustomSkirmish: startCustomSkirmish,
    getBattleState: getBattleState,
    getLivingActors: getLivingActors,
    advanceATBToNextActor: advanceATBToNextActor,
    predictATBQueue: predictATBQueue,
    getValidActions: getValidActions,
    commandWait: commandWait,
    commandDefend: commandDefend,
    executeUnitMove: executeUnitMove,
    executeUnitAttack: executeUnitAttack,
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
