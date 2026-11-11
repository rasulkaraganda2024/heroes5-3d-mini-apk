/**
 * Герои Меча и Магии V: Эпоха Грифонов — 3D Мини (RU)
 * Модуль 3D WebGL & Procedural Low-Poly Engine (Three.js r128, 0 внешних текстур/моделей, 60 FPS)
 * Поставляет: window.HOMM5.World3D
 */
(function (root) {
  'use strict';

  const HOMM5 = root.HOMM5 = root.HOMM5 || {};

  // Защитная обёртка: если запускается в Node.js без браузера (ОТК-1), экспортируем чистый API без краша
  const hasThree = () => typeof root.THREE !== 'undefined';

  const THEMES = {
    noon: {
      id: 'noon',
      name: 'Золотой полдень Эльрата',
      skyTop: '#0c2754',
      skyMid: '#1e5091',
      skyBot: '#f7d288',
      fogColor: 0x22497a,
      fogDensity: 0.012,
      ambientColor: 0x8db3e2,
      ambientIntensity: 0.62,
      hemiSky: 0xfff3d1,
      hemiGround: 0x274e37,
      hemiIntensity: 0.58,
      sunColor: 0xffe49e,
      sunIntensity: 1.28,
      sunPos: [26, 38, 22],
      lanternColor: 0x38bdf8,
      lanternIntensity: 1.15,
      starOpacity: 0.22
    },
    eclipse: {
      id: 'eclipse',
      name: 'Багровый закат Затмения',
      skyTop: '#16061c',
      skyMid: '#4c1127',
      skyBot: '#dc4d28',
      fogColor: 0x341122,
      fogDensity: 0.015,
      ambientColor: 0x9b5a6a,
      ambientIntensity: 0.48,
      hemiSky: 0xff8c66,
      hemiGround: 0x1d1020,
      hemiIntensity: 0.5,
      sunColor: 0xff6b3d,
      sunIntensity: 1.15,
      sunPos: [-28, 22, -18],
      lanternColor: 0xfbbf24,
      lanternIntensity: 1.65,
      starOpacity: 0.78
    }
  };

  const MODE_PRESETS = {
    castle: {
      target: [0, 5.2, 0],
      radius: 25.5,
      phi: 1.14,
      theta: 0.55,
      minRadius: 14,
      maxRadius: 42,
      autoRotate: 0.13
    },
    valley: {
      target: [1.5, 1.2, 10.5],
      radius: 34.0,
      phi: 0.94,
      theta: 0.12,
      minRadius: 18,
      maxRadius: 54,
      autoRotate: 0.0
    },
    combat: {
      target: [0, 0.4, 0.3],
      radius: 24.5,
      phi: 0.86,
      theta: 0.0,
      minRadius: 13,
      maxRadius: 38,
      autoRotate: 0.0
    }
  };

  const state = {
    initialized: false,
    container: null,
    scene: null,
    camera: null,
    renderer: null,
    raycaster: null,
    mouseNDC: null,

    mode: 'castle',
    themeKey: 'noon',
    rafId: null,
    lastTime: 0,
    elapsed: 0,
    hitStopUntil: 0,

    // Орбитальная камера и кинематографический Action-Cam
    camTarget: { x: 0, y: 5.2, z: 0 },
    camDesiredTarget: { x: 0, y: 5.2, z: 0 },
    spherical: { radius: 25.5, phi: 1.14, theta: 0.55 },
    desiredSpherical: { radius: 25.5, phi: 1.14, theta: 0.55 },
    autoRotateSpeed: 0.13,
    userInteracting: false,
    idleTimer: 0,
    shakePower: 0,
    actionCam: null,

    // Группы сцены
    worldGroup: null,
    skyDome: null,
    starField: null,
    castleWorldGroup: null,
    castleGroup: null,
    valleyGroup: null,
    combatGroup: null,
    fxGroup: null,

    // Свет
    lights: {
      ambient: null,
      hemi: null,
      sun: null,
      magicLeft: null,
      magicRight: null
    },

    // Интерактивные реестры
    buildingsMap: {},      // buildingId -> { group, windows:[], halos:[], flags:[], built: bool }
    valleyNodesMap: {},    // nodeId -> { group, crystalMesh, ringMesh, beacon, completed: bool, cfg }
    waterfallParticles: null,
    castleClouds: [],

    // Поле боя 10x8
    gridCols: 10,
    gridRows: 8,
    cellSize: 2.2,
    originX: 0,
    originZ: 0,
    cellTiles: [],         // [{ col, row, mesh, highlightMesh, aoeMesh }]
    hoveredCell: null,
    obstaclesList: [],
    heroModels: { player: null, enemy: null },
    unitActors: {},        // stackId -> actorObj
    activeRing: null,

    // Активные анимации и спецэффекты
    tweens: [],
    particles: [],
    projectiles: [],
    floatingSprites: [],

    // Кэш базовых материалов
    mats: {}
  };

  // ============================================================================
  // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И ГЕНЕРАЦИЯ CANVAS-ТЕКСТУР (0 внешних ассетов)
  // ============================================================================

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function cellToWorld(col, row) {
    const cs = state.cellSize;
    const ox = -((state.gridCols - 1) * cs) * 0.5;
    const oz = -((state.gridRows - 1) * cs) * 0.5;
    return {
      x: ox + col * cs,
      y: 0.16,
      z: oz + row * cs
    };
  }

  function worldToScreen(vec3) {
    if (!state.camera || !state.renderer) return { x: 0, y: 0 };
    const v = vec3.clone().project(state.camera);
    const rect = state.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
    };
  }

  function createSkyTexture(theme) {
    const THREE = root.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, theme.skyTop);
    grad.addColorStop(0.55, theme.skyMid);
    grad.addColorStop(0.92, theme.skyBot);
    grad.addColorStop(1.0, theme.skyMid);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function createGlowTexture(innerRgba, outerRgba) {
    const THREE = root.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, innerRgba || 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, outerRgba || 'rgba(251,191,36,0.55)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function createRuneRingTexture(colorHex) {
    const THREE = root.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);

    ctx.strokeStyle = colorHex || '#fbbf24';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(128, 128, 90, 0, Math.PI * 2);
    ctx.stroke();

    // Рунические засечки Ордена Света
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x1 = 128 + Math.cos(a) * 90;
      const y1 = 128 + Math.sin(a) * 90;
      const x2 = 128 + Math.cos(a) * 116;
      const y2 = 128 + Math.sin(a) * 116;
      ctx.lineWidth = i % 3 === 0 ? 5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function drawUnitBadgeCanvas(canvas, count, hpRatio, isEnemy, hasBuff, isDefending) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const borderCol = isEnemy ? '#ef4444' : '#fbbf24';
    const bgTop = isEnemy ? 'rgba(48, 10, 16, 0.92)' : 'rgba(13, 28, 58, 0.92)';
    const bgBot = isEnemy ? 'rgba(24, 6, 10, 0.95)' : 'rgba(8, 16, 36, 0.95)';

    // Скруглённая плашка
    const rx = 14, ry = 10, rw = w - 28, rh = h - 20, rad = 16;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(rx + rad, ry);
    ctx.lineTo(rx + rw - rad, ry);
    ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
    ctx.lineTo(rx + rw, ry + rh - rad);
    ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
    ctx.lineTo(rx + rad, ry + rh);
    ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
    ctx.lineTo(rx, ry + rad);
    ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, ry, 0, ry + rh);
    grad.addColorStop(0, bgTop);
    grad.addColorStop(1, bgBot);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 4.5;
    ctx.strokeStyle = borderCol;
    ctx.stroke();

    // Полоса ОЗ текущего верхнего воина
    const barX = rx + 14;
    const barY = ry + rh - 18;
    const barW = rw - 28;
    const barH = 9;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(barX, barY, barW, barH);

    const safeHp = clamp(hpRatio, 0, 1);
    ctx.fillStyle = safeHp > 0.5 ? '#22c55e' : safeHp > 0.25 ? '#eab308' : '#ef4444';
    ctx.fillRect(barX, barY, Math.max(2, barW * safeHp), barH);

    // Число воинов
    ctx.font = 'bold 34px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 5;
    const icons = (isDefending ? '🛡' : '') + (hasBuff ? '✨' : '');
    const label = icons ? `${count} ${icons}` : String(count);
    ctx.fillText(label, w / 2, ry + 29);
    ctx.restore();
  }

  function createTextBannerSprite(text, borderHex, scaleW, scaleH) {
    const THREE = root.THREE;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 14, 0, 110);
    grad.addColorStop(0, 'rgba(13, 25, 48, 0.94)');
    grad.addColorStop(1, 'rgba(7, 13, 28, 0.96)');
    ctx.fillStyle = grad;
    ctx.strokeStyle = borderHex || '#fbbf24';
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(14, 14, 484, 96, 28);
    } else {
      ctx.rect(14, 14, 484, 96);
    }
    ctx.fill();
    ctx.stroke();

    // Тонкая внутренняя филигранная рамка
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(22, 22, 468, 80, 22);
    } else {
      ctx.rect(22, 22, 468, 80);
    }
    ctx.stroke();

    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillStyle = '#fef3c7';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 63);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(scaleW || 5.2, scaleH || 1.25, 1);
    spr.renderOrder = 18;
    return spr;
  }

  function createInvisibleTouchHitbox(radius) {
    const THREE = root.THREE;
    const hitMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius || 2.35, 8, 8), hitMat);
    sphere.userData.isHitbox = true;
    return sphere;
  }

  function initMaterials() {
    const THREE = root.THREE;
    state.mats = {
      stoneLight: new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.78, metalness: 0.08, flatShading: true }),
      stoneMarble: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.55, metalness: 0.14, flatShading: true }),
      stoneDark: new THREE.MeshStandardMaterial({ color: 0x525866, roughness: 0.85, metalness: 0.12, flatShading: true }),
      cliffRock: new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.92, metalness: 0.05, flatShading: true }),
      grassEmerald: new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.85, metalness: 0.04, flatShading: true }),
      grassBright: new THREE.MeshStandardMaterial({ color: 0x40916c, roughness: 0.82, metalness: 0.04, flatShading: true }),
      roofRoyalBlue: new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.45, metalness: 0.28, flatShading: true }),
      roofSapphire: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.38, metalness: 0.35, flatShading: true }),
      goldArmor: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.28, metalness: 0.82, flatShading: true }),
      goldBright: new THREE.MeshStandardMaterial({ color: 0xfde047, emissive: 0xb45309, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.78 }),
      steelArmor: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.32, metalness: 0.8, flatShading: true }),
      darkIron: new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.45, metalness: 0.75, flatShading: true }),
      woodRich: new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85, metalness: 0.05, flatShading: true }),
      havenCloth: new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.65, metalness: 0.1, flatShading: true }),
      whiteFeather: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55, metalness: 0.08, flatShading: true }),
      griffinCoat: new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.68, metalness: 0.12, flatShading: true }),
      demonRed: new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.58, metalness: 0.2, flatShading: true }),
      demonCharcoal: new THREE.MeshStandardMaterial({ color: 0x1f1924, roughness: 0.68, metalness: 0.32, flatShading: true }),
      demonCrimson: new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.48, metalness: 0.22, flatShading: true }),
      lavaGlow: new THREE.MeshStandardMaterial({ color: 0xff5722, emissive: 0xff3d00, emissiveIntensity: 0.95, roughness: 0.3 }),
      holyGlow: new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.9, roughness: 0.2 }),
      sapphireGlow: new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x2563eb, emissiveIntensity: 0.9, roughness: 0.18 }),
      skinHuman: new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.72, metalness: 0.04 }),
      glowSpriteTex: createGlowTexture('rgba(255,255,255,1)', 'rgba(251,191,36,0.6)'),
      fireSpriteTex: createGlowTexture('rgba(255,245,200,1)', 'rgba(239,68,68,0.72)'),
      blueSpriteTex: createGlowTexture('rgba(224,242,254,1)', 'rgba(56,189,248,0.7)')
    };
  }

  function tagInteractive(rootObj, tagType, payloadId, extraData) {
    rootObj.traverse((child) => {
      child.userData.hommType = tagType;
      child.userData.hommId = payloadId;
      if (extraData) {
        Object.keys(extraData).forEach((k) => {
          child.userData[k] = extraData[k];
        });
      }
    });
  }

  // ============================================================================
  // 1. НЕБЕСНЫЙ КУПОЛ, ЗВЁЗДЫ И ОСВЕЩЕНИЕ АСХАНА
  // ============================================================================

  function buildSkyAndLights() {
    const THREE = root.THREE;
    const theme = THEMES[state.themeKey];

    state.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity);

    // Небесная сфера
    const skyGeo = new THREE.SphereGeometry(145, 28, 20);
    const skyMat = new THREE.MeshBasicMaterial({
      map: createSkyTexture(theme),
      side: THREE.BackSide,
      depthWrite: false
    });
    state.skyDome = new THREE.Mesh(skyGeo, skyMat);
    state.scene.add(state.skyDome);

    // Звёздный свод Асхана
    const starCount = 420;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 125 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.48;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) + 8;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xfffbeb,
      size: 0.95,
      transparent: true,
      opacity: theme.starOpacity,
      depthWrite: false
    });
    state.starField = new THREE.Points(starGeo, starMat);
    state.scene.add(state.starField);

    // Освещение
    state.lights.ambient = new THREE.AmbientLight(theme.ambientColor, theme.ambientIntensity);
    state.scene.add(state.lights.ambient);

    state.lights.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
    state.lights.hemi.position.set(0, 45, 0);
    state.scene.add(state.lights.hemi);

    state.lights.sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
    state.lights.sun.position.set(theme.sunPos[0], theme.sunPos[1], theme.sunPos[2]);
    state.lights.sun.castShadow = true;
    state.lights.sun.shadow.mapSize.width = 1024;
    state.lights.sun.shadow.mapSize.height = 1024;
    state.lights.sun.shadow.camera.near = 5;
    state.lights.sun.shadow.camera.far = 95;
    const d = 26;
    state.lights.sun.shadow.camera.left = -d;
    state.lights.sun.shadow.camera.right = d;
    state.lights.sun.shadow.camera.top = d;
    state.lights.sun.shadow.camera.bottom = -d;
    state.lights.sun.shadow.bias = -0.0008;
    state.scene.add(state.lights.sun);

    // Магические точечные огни
    state.lights.magicLeft = new THREE.PointLight(theme.lanternColor, theme.lanternIntensity, 28);
    state.lights.magicLeft.position.set(-9, 8, 2);
    state.scene.add(state.lights.magicLeft);

    state.lights.magicRight = new THREE.PointLight(0xfbbf24, 1.15, 30);
    state.lights.magicRight.position.set(8, 10, -2);
    state.scene.add(state.lights.magicRight);
  }

  // ============================================================================
  // 2. ПАРЯЩИЙ ЗАМОК ОРДЕНА ПОРЯДКА «КОГОТЬ ГРИФОНА» И ИЗУМРУДНАЯ ДОЛИНА
  // ============================================================================

  function createGriffinStatueMesh(scale) {
    const THREE = root.THREE;
    const g = new THREE.Group();
    const m = state.mats.goldBright;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.05, 7), m);
    body.rotation.x = -0.35;
    body.position.y = 0.65;
    g.add(body);

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.65, 6), m);
    head.rotation.x = Math.PI * 0.42;
    head.position.set(0, 1.25, 0.35);
    g.add(head);

    for (const dir of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 0.62), m);
      wing.position.set(dir * 0.72, 1.08, -0.05);
      wing.rotation.z = dir * 0.48;
      wing.rotation.y = -dir * 0.22;
      g.add(wing);
    }
    g.scale.setScalar(scale || 1);
    return g;
  }

  function buildCastleAndValley() {
    const THREE = root.THREE;
    state.castleWorldGroup = new THREE.Group();
    state.castleGroup = new THREE.Group();
    state.valleyGroup = new THREE.Group();
    state.castleWorldGroup.add(state.castleGroup);
    state.castleWorldGroup.add(state.valleyGroup);
    state.worldGroup.add(state.castleWorldGroup);

    const M = state.mats;

    // --- А. Скалистый парящий остров Замка ---
    const rockCone = new THREE.Mesh(new THREE.ConeGeometry(9.6, 10.5, 9), M.cliffRock);
    rockCone.rotation.x = Math.PI;
    rockCone.position.y = -4.8;
    rockCone.receiveShadow = true;
    state.castleGroup.add(rockCone);

    const subSpire1 = new THREE.Mesh(new THREE.ConeGeometry(4.2, 6.8, 7), M.stoneDark);
    subSpire1.rotation.x = Math.PI;
    subSpire1.position.set(-5.2, -3.6, 3.2);
    state.castleGroup.add(subSpire1);

    const subSpire2 = new THREE.Mesh(new THREE.ConeGeometry(3.8, 6.2, 7), M.stoneDark);
    subSpire2.rotation.x = Math.PI;
    subSpire2.position.set(5.4, -3.4, -2.6);
    state.castleGroup.add(subSpire2);

    // Изумрудное верхнее плато замка
    const topDeck = new THREE.Mesh(new THREE.CylinderGeometry(9.3, 9.7, 1.2, 12), M.grassEmerald);
    topDeck.position.y = 0.1;
    topDeck.receiveShadow = true;
    state.castleGroup.add(topDeck);

    // Озеро истока и голубой водопад частиц
    const pool = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.55, roughness: 0.15 })
    );
    pool.position.set(2.6, 0.68, 5.4);
    state.castleGroup.add(pool);

    const wfCount = 130;
    const wfPos = new Float32Array(wfCount * 3);
    for (let i = 0; i < wfCount; i++) {
      const t = Math.random();
      wfPos[i * 3] = 2.6 + (Math.random() - 0.5) * 1.3;
      wfPos[i * 3 + 1] = 0.6 - t * 9.5;
      wfPos[i * 3 + 2] = 6.8 + t * 1.4 + (Math.random() - 0.5) * 0.4;
    }
    const wfGeo = new THREE.BufferGeometry();
    wfGeo.setAttribute('position', new THREE.BufferAttribute(wfPos, 3));
    const wfMat = new THREE.PointsMaterial({
      color: 0x7dd3fc,
      size: 0.48,
      transparent: true,
      opacity: 0.85
    });
    state.waterfallParticles = new THREE.Points(wfGeo, wfMat);
    state.castleGroup.add(state.waterfallParticles);

    // Крепостные стены и угловые башни + Главная Цитадель
    const wallRadius = 7.4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const tx = Math.cos(a) * wallRadius;
      const tz = Math.sin(a) * wallRadius;
      const bastion = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 3.1, 8), M.stoneLight);
      bastion.position.set(tx, 1.9, tz);
      bastion.castShadow = true;
      bastion.receiveShadow = true;
      state.castleGroup.add(bastion);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 8), M.roofRoyalBlue);
      roof.position.set(tx, 4.1, tz);
      roof.castShadow = true;
      state.castleGroup.add(roof);
    }

    // Главная Цитадель (центр)
    const keep = new THREE.Mesh(new THREE.BoxGeometry(3.8, 4.6, 3.8), M.stoneMarble);
    keep.position.set(0, 2.8, -0.8);
    keep.castShadow = true;
    keep.receiveShadow = true;
    state.castleGroup.add(keep);

    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.5, 4), M.roofRoyalBlue);
    keepRoof.rotation.y = Math.PI * 0.25;
    keepRoof.position.set(0, 6.3, -0.8);
    keepRoof.castShadow = true;
    state.castleGroup.add(keepRoof);

    // --- Б. 4 Интерактивных здания замка из контракта ---
    state.buildingsMap = {};

    const BUILDING_SHORT_EMBLEMS = {
      barracks: '🛡️ Казармы',
      marksmen_tower: '🏹 Башня',
      griffin_bastion: '🦅 Бастион',
      cathedral_of_light: '⚔️ Собор'
    };

    function registerBuilding(id, posX, posZ, builderFn) {
      const grp = new THREE.Group();
      grp.position.set(posX, 0.7, posZ);
      const record = { id, group: grp, windows: [], halos: [], flags: [], built: false };
      builderFn(grp, record);
      const cfg = (HOMM5.CONFIG && HOMM5.CONFIG.BUILDINGS && HOMM5.CONFIG.BUILDINGS[id]) || { name: id, icon: '🏰' };
      const emblemText = BUILDING_SHORT_EMBLEMS[id] || `${cfg.icon || '🏰'} ${cfg.name}`;
      const labelY = record.labelY || 5.2;

      const label = createTextBannerSprite(emblemText, '#fbbf24', 5.0, 1.22);
      label.position.set(0, labelY, 0);
      grp.add(label);
      record.label = label;

      // Увеличенные невидимые сферические хитбоксы для лёгкого тапа пальцем на смартфоне (и по зданию, и по эмблеме)
      const bodyHitbox = createInvisibleTouchHitbox(2.75);
      bodyHitbox.position.set(0, Math.min(3.2, labelY * 0.5), 0);
      grp.add(bodyHitbox);

      const emblemHitbox = createInvisibleTouchHitbox(2.25);
      emblemHitbox.position.set(0, labelY, 0);
      grp.add(emblemHitbox);

      tagInteractive(grp, 'building', id, { buildingId: id });
      state.castleGroup.add(grp);
      state.buildingsMap[id] = record;
    }

    // 1) Казармы Пехоты (barracks)
    registerBuilding('barracks', -4.2, 2.6, (grp, rec) => {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.1, 2.3), M.stoneLight);
      hall.position.y = 1.05;
      hall.castShadow = true;
      grp.add(hall);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 1.35, 4), M.roofRoyalBlue);
      roof.rotation.y = Math.PI * 0.25;
      roof.position.y = 2.75;
      grp.add(roof);

      const shieldSign = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.14, 6), M.goldArmor);
      shieldSign.rotation.x = Math.PI * 0.5;
      shieldSign.position.set(0, 1.5, 1.2);
      grp.add(shieldSign);

      for (const ox of [-0.8, 0.8]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.62, 0.12), M.holyGlow.clone());
        win.position.set(ox, 1.15, 1.16);
        grp.add(win);
        rec.windows.push(win);
      }
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.65), M.havenCloth.clone());
      flag.position.set(0, 3.7, 0.25);
      grp.add(flag);
      rec.flags.push(flag);
      rec.labelY = 4.7;
    });

    // 2) Стрелковая Башня (marksmen_tower)
    registerBuilding('marksmen_tower', 4.3, 2.3, (grp, rec) => {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.3, 4.4, 8), M.stoneMarble);
      shaft.position.y = 2.2;
      shaft.castShadow = true;
      grp.add(shaft);

      const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.15, 0.65, 8), M.stoneLight);
      crown.position.y = 4.55;
      grp.add(crown);

      const spire = new THREE.Mesh(new THREE.ConeGeometry(1.42, 2.1, 8), M.roofSapphire);
      spire.position.y = 5.9;
      grp.add(spire);

      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.75, 0.28), M.sapphireGlow.clone());
        win.position.set(Math.cos(a) * 1.08, 3.2, Math.sin(a) * 1.08);
        grp.add(win);
        rec.windows.push(win);
      }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 8, 24), M.goldBright);
      halo.rotation.x = Math.PI * 0.5;
      halo.position.y = 4.9;
      grp.add(halo);
      rec.halos.push(halo);
      rec.labelY = 7.4;
    });

    // 3) Бастион Грифонов (griffin_bastion) — высокий утёс со статуей золотого Грифона
    registerBuilding('griffin_bastion', -4.1, -3.2, (grp, rec) => {
      const crag = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.85, 5.4, 7), M.stoneMarble);
      crag.position.y = 2.7;
      crag.castShadow = true;
      grp.add(crag);

      const nest = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.35, 0.7, 10), M.goldArmor);
      nest.position.y = 5.6;
      grp.add(nest);

      const statue = createGriffinStatueMesh(1.25);
      statue.position.y = 5.95;
      grp.add(statue);

      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.85, 0.34), M.holyGlow.clone());
        win.position.set(Math.cos(a) * 1.38, 3.8, Math.sin(a) * 1.38);
        grp.add(win);
        rec.windows.push(win);
      }

      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.08, 8, 28), M.goldBright);
      halo.rotation.x = Math.PI * 0.5;
      halo.position.y = 6.1;
      grp.add(halo);
      rec.halos.push(halo);
      rec.labelY = 8.4;
    });

    // 4) Собор Эльрата (cathedral_of_light) — витражный купол и вращающийся солнечный ореол
    registerBuilding('cathedral_of_light', 3.9, -3.3, (grp, rec) => {
      const nave = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 3.8), M.stoneMarble);
      nave.position.y = 1.6;
      nave.castShadow = true;
      grp.add(nave);

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.55, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
        M.sapphireGlow.clone()
      );
      dome.position.y = 3.2;
      grp.add(dome);
      rec.windows.push(dome);

      // Две колокольни
      for (const sx of [-1.25, 1.25]) {
        const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 4.6, 8), M.stoneMarble);
        bell.position.set(sx, 2.3, 1.55);
        grp.add(bell);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.35, 8), M.goldArmor);
        cap.position.set(sx, 5.2, 1.55);
        grp.add(cap);
      }

      // Парящий солнечный ореол Эльрата
      const sunHalo = new THREE.Group();
      sunHalo.position.set(0, 6.2, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 8, 24), M.goldBright);
      sunHalo.add(ring);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.14), M.goldBright);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.14), M.goldBright);
      sunHalo.add(crossV, crossH);
      grp.add(sunHalo);
      rec.halos.push(sunHalo);
      rec.sunHalo = sunHalo;
      rec.labelY = 8.4;
    });

    // Облака вокруг острова
    state.castleClouds = [];
    for (let i = 0; i < 7; i++) {
      const cl = new THREE.Group();
      const cloudMat = new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.95,
        transparent: true,
        opacity: 0.62,
        flatShading: true
      });
      for (let j = 0; j < 3; j++) {
        const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1 + j * 0.35, 0), cloudMat);
        puff.position.set((j - 1) * 1.1, (j % 2) * 0.25, 0);
        cl.add(puff);
      }
      const angle = (i / 7) * Math.PI * 2;
      const dist = 12.5 + (i % 3) * 2.8;
      cl.position.set(Math.cos(angle) * dist, -1.8 + (i % 2) * 1.6, Math.sin(angle) * dist);
      cl.userData = { baseAngle: angle, dist, baseY: cl.position.y, speed: 0.04 + (i % 3) * 0.015 };
      state.castleGroup.add(cl);
      state.castleClouds.push(cl);
    }

    // --- В. Изумрудная Долина приключений вокруг замка ---
    const valleyTerrain = new THREE.Mesh(new THREE.CylinderGeometry(30, 33, 1.6, 24), M.grassEmerald);
    valleyTerrain.position.set(1, -1.0, 11);
    valleyTerrain.receiveShadow = true;
    state.valleyGroup.add(valleyTerrain);

    // Дорожки и рощи низкополигональных сосен/кипарисов
    const treePositions = [
      [-15, 4], [-14, 13], [-9, 19], [0, 21], [9, 20], [17, 11], [16, 4], [-3, 10], [8, 11]
    ];
    treePositions.forEach(([tx, tz], idx) => {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.2, 6), M.woodRich);
      trunk.position.y = 0.4;
      const crown1 = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.2, 7), M.grassBright);
      crown1.position.y = 1.8;
      crown1.castShadow = true;
      const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.8, 7), M.grassBright);
      crown2.position.y = 2.9;
      tree.add(trunk, crown1, crown2);
      tree.position.set(tx, -0.2, tz);
      tree.scale.setScalar(0.85 + (idx % 3) * 0.22);
      state.valleyGroup.add(tree);
    });

    // Узлы долины (VALLEY_NODES из контракта)
    state.valleyNodesMap = {};
    const nodes = (HOMM5.CONFIG && HOMM5.CONFIG.VALLEY_NODES) || [];
    nodes.forEach((nCfg) => {
      const nGrp = new THREE.Group();
      const [nx, ny, nz] = nCfg.pos3d || [0, 0.5, 12];
      nGrp.position.set(nx, ny - 0.5, nz);

      const baseRing = new THREE.Mesh(
        new THREE.CylinderGeometry(1.75, 1.95, 0.22, 16),
        nCfg.type === 'battle' ? M.demonCharcoal : M.stoneMarble
      );
      baseRing.receiveShadow = true;
      nGrp.add(baseRing);

      let focalMesh = null;
      let ringColor = '#fbbf24';

      if (nCfg.type === 'treasure') {
        // Королевский сундук
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 0.95), M.woodRich);
        box.position.y = 0.55;
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.35, 8, 1, false, 0, Math.PI), M.goldArmor);
        lid.rotation.z = Math.PI * 0.5;
        lid.position.y = 0.98;
        box.add(lid);
        nGrp.add(box);
        focalMesh = box;
        ringColor = '#fde047';
      } else if (nCfg.type === 'crystal_mine') {
        // Кристальная жила Эльрата
        const cluster = new THREE.Group();
        for (let c = 0; c < 4; c++) {
          const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.58 - c * 0.08, 0), M.sapphireGlow.clone());
          shard.scale.set(0.7, 1.9, 0.7);
          shard.position.set((c - 1.5) * 0.42, 0.95 + (c % 2) * 0.25, (c % 2 - 0.5) * 0.35);
          shard.rotation.z = (c - 1.5) * 0.22;
          cluster.add(shard);
        }
        nGrp.add(cluster);
        focalMesh = cluster;
        ringColor = '#38bdf8';
      } else {
        // Боевая миссия: врата Шио и страж демонов
        ringColor = '#ef4444';
        const archL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.45), M.demonCharcoal);
        archL.position.set(-1.05, 1.3, -0.3);
        const archR = archL.clone();
        archR.position.x = 1.05;
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.48, 0.55), M.demonRed);
        lintel.position.set(0, 2.65, -0.3);
        const portal = new THREE.Mesh(
          new THREE.CircleGeometry(0.95, 16),
          new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
        );
        portal.position.set(0, 1.35, -0.3);
        nGrp.add(archL, archR, lintel, portal);

        // Мини-страж перед порталом
        const guardId = nCfg.missionIndex === 3 ? 'pitlord' : nCfg.missionIndex === 2 ? 'succubus' : 'hellhound';
        const guard = createUnitProceduralMesh(guardId, true);
        guard.group.scale.setScalar(0.72);
        guard.group.position.set(0, 0.15, 0.55);
        nGrp.add(guard.group);
        focalMesh = portal;
      }

      const runePlate = new THREE.Mesh(
        new THREE.PlaneGeometry(3.8, 3.8),
        new THREE.MeshBasicMaterial({
          map: createRuneRingTexture(ringColor),
          transparent: true,
          opacity: 0.85,
          depthWrite: false
        })
      );
      runePlate.rotation.x = -Math.PI * 0.5;
      runePlate.position.y = 0.14;
      nGrp.add(runePlate);

      const NODE_SHORT_TITLES = {
        chest_1: '💰 Сундук Ордена',
        crystal_shrine: '💎 Жила Кристаллов',
        mission_1: '⚔️ Миссия I: Застава',
        mission_2: '🔥 Миссия II: Руины',
        mission_3: '👹 Миссия III: Аграил'
      };
      const bannerTitle = NODE_SHORT_TITLES[nCfg.id] || `${nCfg.icon || ''} ${nCfg.name}`;
      const banner = createTextBannerSprite(bannerTitle, ringColor, 5.6, 1.28);
      banner.position.set(0, 3.65, 0);
      nGrp.add(banner);

      // Увеличенные невидимые сферические хитбоксы для безошибочного нажатия пальцем на мобильном
      const nodeHitbox = createInvisibleTouchHitbox(2.75);
      nodeHitbox.position.set(0, 1.45, 0);
      nGrp.add(nodeHitbox);

      const bannerHitbox = createInvisibleTouchHitbox(2.25);
      bannerHitbox.position.set(0, 3.65, 0);
      nGrp.add(bannerHitbox);

      tagInteractive(nGrp, 'node', nCfg.id, { nodeId: nCfg.id });
      state.valleyGroup.add(nGrp);
      state.valleyNodesMap[nCfg.id] = {
        id: nCfg.id,
        cfg: nCfg,
        group: nGrp,
        focalMesh,
        runePlate,
        banner,
        completed: false
      };
    });

    // По умолчанию включаем стартовые здания
    syncCampaignState({
      buildings: { barracks: true, marksmen_tower: true, griffin_bastion: false, cathedral_of_light: false },
      completedNodes: []
    });
  }

  // ============================================================================
  // 3. ПРОЦЕДУРНЫЕ 3D-МОДЕЛИ ГЕРОЕВ И 8 ОТРЯДОВ СУЩЕСТВ
  // ============================================================================

  function createUnitProceduralMesh(unitId, isEnemy) {
    const THREE = root.THREE;
    const M = state.mats;
    const rootGrp = new THREE.Group();
    const bodyGrp = new THREE.Group();
    rootGrp.add(bodyGrp);

    const animParts = {
      body: bodyGrp,
      leftWing: null,
      rightWing: null,
      weaponArm: null,
      floatingOrbs: []
    };

    // Пьедестал отряда
    const baseRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.76, 0.86, 0.16, 14),
      isEnemy ? M.demonRed : M.goldArmor
    );
    baseRim.position.y = 0.08;
    baseRim.castShadow = true;
    baseRim.receiveShadow = true;
    rootGrp.add(baseRim);

    if (unitId === 'squire') {
      // Латник: стальные латы, синий плащ, шлем с забралом, башенный щит с крестом и меч
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.82, 8), M.steelArmor);
      torso.position.y = 0.68;
      const tabard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.68, 0.48), M.havenCloth);
      tabard.position.y = 0.64;
      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.25, 0.34, 8), M.steelArmor);
      helm.position.y = 1.28;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.28), M.goldArmor);
      visor.position.set(0, 1.27, 0.12);
      const plume = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.35), M.roofRoyalBlue);
      plume.position.set(0, 1.52, -0.04);

      // Башенный щит с золотым крестом
      const shield = new THREE.Group();
      shield.position.set(0.36, 0.72, 0.28);
      shield.rotation.y = -0.35;
      const sPlate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.92, 0.62), M.roofRoyalBlue);
      const sRim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.98, 0.68), M.goldArmor);
      sRim.scale.set(0.85, 1, 1);
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.76, 0.12), M.goldBright);
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.46), M.goldBright);
      shield.add(sRim, sPlate, crossV, crossH);

      // Меч
      const arm = new THREE.Group();
      arm.position.set(-0.38, 0.85, 0.1);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 0.14), M.steelArmor);
      blade.position.set(0, 0.38, 0.18);
      blade.rotation.x = 0.45;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.12), M.goldArmor);
      guard.position.set(0, 0.02, 0.06);
      arm.add(blade, guard);
      animParts.weaponArm = arm;

      bodyGrp.add(torso, tabard, helm, visor, plume, shield, arm);
    } else if (unitId === 'crossbowman') {
      // Арбалетчик: синий капюшон, кожаный нагрудник, тяжёлый арбалет в руках
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.8, 8), M.havenCloth);
      torso.position.y = 0.66;
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.38), M.woodRich);
      chest.position.y = 0.76;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), M.skinHuman);
      head.position.y = 1.24;
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.44, 7), M.roofRoyalBlue);
      hood.position.set(0, 1.38, -0.03);

      const xbow = new THREE.Group();
      xbow.position.set(0, 0.86, 0.38);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.72), M.woodRich);
      const prod = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.07, 0.1), M.steelArmor);
      prod.position.z = 0.28;
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), M.sapphireGlow);
      bolt.rotation.x = Math.PI * 0.5;
      bolt.position.set(0, 0.08, 0.25);
      xbow.add(stock, prod, bolt);
      animParts.weaponArm = xbow;

      bodyGrp.add(torso, chest, head, hood, xbow);
    } else if (unitId === 'griffin') {
      // Королевский Грифон: золотисто-белое тело, орлиная голова с клювом, распахнутые анимированные крылья
      const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.95, 8), M.griffinCoat);
      chest.rotation.x = 0.55;
      chest.position.set(0, 0.88, -0.05);

      const breast = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), M.whiteFeather);
      breast.position.set(0, 1.05, 0.24);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 8), M.whiteFeather);
      head.position.set(0, 1.42, 0.42);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.38, 6), M.goldBright);
      beak.rotation.x = Math.PI * 0.52;
      beak.position.set(0, 1.38, 0.72);

      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.34), M.goldArmor);
      crest.position.set(0, 1.62, 0.32);

      const makeWing = (dir) => {
        const pivot = new THREE.Group();
        pivot.position.set(dir * 0.28, 1.18, 0.05);
        const inner = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.09, 0.48), M.whiteFeather);
        inner.position.set(dir * 0.42, 0.12, -0.04);
        inner.rotation.z = dir * 0.28;
        const outer = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.07, 0.36), M.goldArmor);
        outer.position.set(dir * 0.98, 0.32, -0.12);
        outer.rotation.z = dir * 0.45;
        pivot.add(inner, outer);
        return pivot;
      };
      animParts.leftWing = makeWing(-1);
      animParts.rightWing = makeWing(1);

      bodyGrp.add(chest, breast, head, beak, crest, animParts.leftWing, animParts.rightWing);
    } else if (unitId === 'paladin') {
      // Паладин Света: сияющие золотые латы, белый плащ, нимб и двуручный световой клинок
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.32, 0.98, 8), M.goldArmor);
      torso.position.y = 0.78;
      const pauldrons = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.24, 0.48), M.goldBright);
      pauldrons.position.y = 1.18;
      const cape = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.02, 0.1), M.whiteFeather);
      cape.position.set(0, 0.72, -0.28);
      cape.rotation.x = 0.14;

      const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.38, 8), M.goldArmor);
      helm.position.y = 1.46;
      const crownHalo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.04, 6, 18), M.holyGlow);
      crownHalo.rotation.x = Math.PI * 0.5;
      crownHalo.position.y = 1.74;

      const swordGrp = new THREE.Group();
      swordGrp.position.set(-0.42, 0.95, 0.22);
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 6), M.woodRich);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.12), M.goldBright);
      cross.position.y = 0.18;
      const lightBlade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.06), M.holyGlow);
      lightBlade.position.y = 0.82;
      swordGrp.add(hilt, cross, lightBlade);
      swordGrp.rotation.x = 0.32;
      animParts.weaponArm = swordGrp;

      bodyGrp.add(torso, pauldrons, cape, helm, crownHalo, swordGrp);
    } else if (unitId === 'imp') {
      // Чёрт-Пожиратель: сгорбленный красный бесенок, рожки и трезубец
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), M.demonRed);
      body.scale.set(0.95, 1.15, 0.9);
      body.position.y = 0.58;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), M.demonRed);
      head.position.set(0, 1.0, 0.12);

      for (const dir of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 5), M.demonCharcoal);
        horn.position.set(dir * 0.16, 1.24, 0.08);
        horn.rotation.z = -dir * 0.42;
        bodyGrp.add(horn);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), M.holyGlow);
        eye.position.set(dir * 0.09, 1.04, 0.32);
        bodyGrp.add(eye);
      }

      const fork = new THREE.Group();
      fork.position.set(0.34, 0.65, 0.18);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), M.demonCharcoal);
      shaft.position.y = 0.35;
      const prongM = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 5), M.lavaGlow);
      prongM.position.y = 0.95;
      fork.add(shaft, prongM);
      fork.rotation.x = 0.35;
      animParts.weaponArm = fork;

      bodyGrp.add(body, head, fork);
    } else if (unitId === 'hellhound') {
      // Цербер Шио: трёхглавый тёмно-огненный зверь со светящимися глазами и лавовым хребтом
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.52, 1.12), M.demonCharcoal);
      torso.position.set(0, 0.58, -0.05);

      const spine = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.95), M.lavaGlow);
      spine.position.set(0, 0.88, -0.05);
      bodyGrp.add(torso, spine);

      // 4 лапы
      for (const lx of [-0.24, 0.24]) {
        for (const lz of [-0.36, 0.34]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.48, 6), M.demonCharcoal);
          leg.position.set(lx, 0.28, lz);
          bodyGrp.add(leg);
        }
      }

      // 3 пасти Цербера
      for (const hx of [-0.28, 0, 0.28]) {
        const hGrp = new THREE.Group();
        hGrp.position.set(hx, 0.86 + (hx === 0 ? 0.1 : 0), 0.52);
        hGrp.rotation.y = hx * -0.55;
        const skull = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.48, 6), M.demonRed);
        skull.rotation.x = Math.PI * 0.5;
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 5), M.lavaGlow);
        eyeL.position.set(-0.08, 0.08, 0.08);
        const eyeR = eyeL.clone();
        eyeR.position.x = 0.08;
        hGrp.add(skull, eyeL, eyeR);
        bodyGrp.add(hGrp);
      }
      animParts.weaponArm = bodyGrp;
    } else if (unitId === 'succubus') {
      // Демонесса Пламени: грациозный силуэт, крылья летучей мыши, корона рогов и сферы адского огня в ладонях
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.78, 8), M.demonCharcoal);
      skirt.position.y = 0.52;
      const corset = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.52, 8), M.demonCrimson);
      corset.position.y = 0.98;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), M.demonRed);
      head.position.y = 1.38;

      for (const dir of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 6), M.goldArmor);
        horn.position.set(dir * 0.16, 1.62, -0.04);
        horn.rotation.z = -dir * 0.35;
        horn.rotation.x = -0.25;
        bodyGrp.add(horn);

        // Крыло летучей мыши
        const wPivot = new THREE.Group();
        wPivot.position.set(dir * 0.18, 1.08, -0.14);
        const membrane = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.92, 4), M.demonRed);
        membrane.rotation.z = dir * 1.15;
        membrane.position.set(dir * 0.42, 0.15, -0.1);
        wPivot.add(membrane);
        bodyGrp.add(wPivot);
        if (dir < 0) animParts.leftWing = wPivot;
        else animParts.rightWing = wPivot;

        // Сферы пламени в ладонях
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), M.lavaGlow);
        orb.position.set(dir * 0.42, 1.06, 0.28);
        bodyGrp.add(orb);
        animParts.floatingOrbs.push(orb);
      }
      bodyGrp.add(skirt, corset, head);
    } else {
      // Пещерный Владыка (pitlord): массивный рогатый демон с пылающим рунным мечом
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.38, 1.15, 8), M.demonCharcoal);
      torso.position.y = 0.88;
      const chestCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), M.lavaGlow);
      chestCore.position.set(0, 0.96, 0.32);
      const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.28, 0.56), M.demonRed);
      shoulders.position.y = 1.36;

      const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.38), M.demonRed);
      head.position.y = 1.66;
      for (const dir of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.62, 6), M.goldArmor);
        horn.position.set(dir * 0.32, 1.92, 0.05);
        horn.rotation.z = -dir * 0.62;
        bodyGrp.add(horn);
      }

      const bladeGrp = new THREE.Group();
      bladeGrp.position.set(-0.56, 1.05, 0.25);
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6), M.darkIron);
      const runeSword = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.48, 0.08), M.lavaGlow);
      runeSword.position.y = 0.92;
      bladeGrp.add(hilt, runeSword);
      bladeGrp.rotation.x = 0.38;
      animParts.weaponArm = bladeGrp;

      bodyGrp.add(torso, chestCore, shoulders, head, bladeGrp);
    }

    bodyGrp.traverse((ch) => {
      if (ch.isMesh) {
        ch.castShadow = true;
        ch.receiveShadow = true;
      }
    });

    // Ориентация: отряды игрока (слева) смотрят вправо (+X), враги (справа) смотрят влево (-X)
    bodyGrp.rotation.y = isEnemy ? -Math.PI * 0.5 : Math.PI * 0.5;

    return { group: rootGrp, animParts };
  }

  function createHeroPedestalModel(isHaven) {
    const THREE = root.THREE;
    const M = state.mats;
    const grp = new THREE.Group();

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.65, 0.75, 12),
      isHaven ? M.stoneMarble : M.demonCharcoal
    );
    plinth.position.y = 0.38;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    grp.add(plinth);

    const trim = new THREE.Mesh(
      new THREE.TorusGeometry(1.38, 0.08, 8, 24),
      isHaven ? M.goldBright : M.lavaGlow
    );
    trim.rotation.x = Math.PI * 0.5;
    trim.position.y = 0.76;
    grp.add(trim);

    const rider = new THREE.Group();
    rider.position.y = 0.76;
    rider.rotation.y = isHaven ? Math.PI * 0.5 : -Math.PI * 0.5;

    if (isHaven) {
      // Лорд Годрик на боевом скакуне со знаменем Империи Грифона
      const steed = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.65, 1.35), M.whiteFeather);
      steed.position.y = 0.68;
      const barding = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.45, 1.4), M.roofRoyalBlue);
      barding.position.y = 0.58;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.68, 7), M.whiteFeather);
      neck.position.set(0, 1.12, 0.52);
      neck.rotation.x = 0.45;
      const knight = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.78, 8), M.goldArmor);
      knight.position.set(0, 1.32, -0.05);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.28, 8), M.goldBright);
      crown.position.set(0, 1.84, -0.05);

      // Знамя
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), M.goldArmor);
      pole.position.set(-0.38, 1.75, -0.15);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.68), M.roofSapphire);
      banner.position.set(-0.38, 2.45, -0.5);

      rider.add(steed, barding, neck, knight, crown, pole, banner);
    } else {
      // Аграил Пепельный в рогатом доспехе с огненной аурой и посохом Хаоса
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.68, 1.42), M.demonCharcoal);
      mount.position.y = 0.68;
      const lord = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.92, 8), M.demonRed);
      lord.position.set(0, 1.38, 0);
      const helm = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.52, 6), M.darkIron);
      helm.position.set(0, 2.02, 0);
      for (const d of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.55, 6), M.lavaGlow);
        horn.position.set(d * 0.26, 2.15, 0);
        horn.rotation.z = -d * 0.55;
        rider.add(horn);
      }
      const aura = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 8, 24), M.lavaGlow);
      aura.rotation.x = Math.PI * 0.5;
      aura.position.y = 0.22;
      rider.add(mount, lord, helm, aura);
    }

    grp.add(rider);
    const heroCfg = HOMM5.CONFIG.HEROES[isHaven ? 'haven_lord' : 'inferno_lord'];
    const tag = createTextBannerSprite(
      `${heroCfg.icon} ${heroCfg.name}`,
      isHaven ? '#fbbf24' : '#ef4444',
      4.8,
      1.08
    );
    tag.position.set(0, 3.85, 0);
    grp.add(tag);

    // Удобный сферический хитбокс для тапа по Герою на постаменте
    const heroHitbox = createInvisibleTouchHitbox(2.35);
    heroHitbox.position.set(0, 1.85, 0);
    grp.add(heroHitbox);

    const heroId = isHaven ? 'hero_player' : 'hero_enemy';
    const side = isHaven ? 'player' : 'enemy';
    grp.userData.heroId = heroId;
    grp.userData.side = side;
    tagInteractive(grp, 'hero', heroId, { heroId, side });

    return grp;
  }

  // ============================================================================
  // 4. ПОСТРОЕНИЕ ТАКТИЧЕСКОЙ АРЕНЫ 10x8 И СИНХРОНИЗАЦИЯ БОЯ
  // ============================================================================

  function clearGroupChildren(grp) {
    if (!grp) return;
    while (grp.children.length > 0) {
      grp.remove(grp.children[0]);
    }
  }

  function createObstacleMesh(kind) {
    const THREE = root.THREE;
    const M = state.mats;
    const g = new THREE.Group();
    if (kind === 'pillar') {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 1.4), M.stoneMarble);
      base.position.y = 0.18;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 2.35, 10), M.stoneLight);
      col.position.y = 1.5;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 1.25), M.goldArmor);
      cap.position.y = 2.75;
      g.add(base, col, cap);
    } else if (kind === 'lava_crag') {
      const crag = new THREE.Mesh(new THREE.ConeGeometry(0.88, 1.95, 6), M.demonCharcoal);
      crag.position.y = 0.95;
      const magma = new THREE.Mesh(new THREE.DodecahedronGeometry(0.52, 0), M.lavaGlow);
      magma.position.set(0.15, 0.55, 0.15);
      g.add(crag, magma);
    } else if (kind === 'ruin') {
      const wall1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.45, 0.42), M.stoneLight);
      wall1.position.set(0, 0.72, -0.2);
      wall1.rotation.z = 0.08;
      const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.46, 0), M.stoneDark);
      rubble.position.set(0.32, 0.35, 0.35);
      g.add(wall1, rubble);
    } else {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), M.cliffRock);
      rock.scale.set(1.1, 0.9, 1.0);
      rock.position.y = 0.65;
      g.add(rock);
    }
    g.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    return g;
  }

  function createUnitActor(stack) {
    const THREE = root.THREE;
    const isEnemy = stack.side === 'enemy' || stack.faction === 'inferno' || stack.isEnemy === true;
    const built = createUnitProceduralMesh(stack.unitId, isEnemy);

    // Спрайт численности и полосы ОЗ
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 256;
    badgeCanvas.height = 96;
    const badgeTex = new THREE.CanvasTexture(badgeCanvas);
    const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true, depthTest: false });
    const badgeSprite = new THREE.Sprite(badgeMat);
    badgeSprite.scale.set(2.35, 0.88, 1);
    badgeSprite.position.set(0, 2.55, 0);
    badgeSprite.renderOrder = 20;
    built.group.add(badgeSprite);

    // Сфера Обороны / Небесного Щита
    const shieldSphere = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.08, 1),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.55
      })
    );
    shieldSphere.position.y = 1.0;
    shieldSphere.visible = false;
    built.group.add(shieldSphere);

    // Нимб благословения Света
    const buffHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.06, 8, 24),
      state.mats.goldBright
    );
    buffHalo.rotation.x = Math.PI * 0.5;
    buffHalo.position.y = 2.08;
    buffHalo.visible = false;
    built.group.add(buffHalo);

    const stackId = stack.id || stack.stackId;
    const unitSide = isEnemy ? 'enemy' : 'player';

    // Невидимая сфера-хитбокс вокруг отряда для удобного тапа на смартфоне
    const unitHitbox = createInvisibleTouchHitbox(1.18);
    unitHitbox.position.set(0, 1.05, 0);
    built.group.add(unitHitbox);

    built.group.userData.stackId = stackId;
    built.group.userData.side = unitSide;
    tagInteractive(built.group, 'unit', stackId, { stackId, side: unitSide });

    const unitCfg = (HOMM5.CONFIG.UNITS && HOMM5.CONFIG.UNITS[stack.unitId]) || {};
    return {
      id: stackId,
      unitId: stack.unitId,
      side: unitSide,
      isEnemy,
      isFlying: Boolean(stack.isFlying || unitCfg.isFlying),
      isRanged: Boolean(stack.isRanged || unitCfg.isRanged),
      group: built.group,
      animParts: built.animParts,
      badgeCanvas,
      badgeTex,
      badgeSprite,
      shieldSphere,
      buffHalo,
      lastSignature: '',
      col: stack.col || 0,
      row: stack.row || 0,
      count: stack.count || 0,
      animBusy: false,
      phaseOffset: Math.random() * Math.PI * 2
    };
  }

  function buildCombatArena(battleState) {
    if (!state.initialized || !hasThree()) return;
    const THREE = root.THREE;
    const M = state.mats;

    clearGroupChildren(state.combatGroup);
    state.cellTiles = [];
    state.unitActors = {};
    state.obstaclesList = [];

    state.gridCols = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_COLS) || 10;
    state.gridRows = (HOMM5.CONFIG && HOMM5.CONFIG.GRID_ROWS) || 8;
    state.cellSize = (HOMM5.CONFIG && HOMM5.CONFIG.CELL_SIZE) || 2.2;

    const boardW = state.gridCols * state.cellSize;
    const boardD = state.gridRows * state.cellSize;

    // Массивное каменное основание арены
    const arenaPlinth = new THREE.Mesh(
      new THREE.BoxGeometry(boardW + 4.4, 1.2, boardD + 3.6),
      M.stoneDark
    );
    arenaPlinth.position.y = -0.58;
    arenaPlinth.receiveShadow = true;
    state.combatGroup.add(arenaPlinth);

    const goldBorder = new THREE.Mesh(
      new THREE.BoxGeometry(boardW + 1.0, 0.22, boardD + 1.0),
      M.goldArmor
    );
    goldBorder.position.y = 0.02;
    state.combatGroup.add(goldBorder);

    // Декоративные колонны и пылающие жаровни по 4 углам арены
    const cornerOffsets = [
      [-boardW * 0.5 - 1.3, -boardD * 0.5 - 1.0],
      [boardW * 0.5 + 1.3, -boardD * 0.5 - 1.0],
      [-boardW * 0.5 - 1.3, boardD * 0.5 + 1.0],
      [boardW * 0.5 + 1.3, boardD * 0.5 + 1.0]
    ];
    cornerOffsets.forEach(([cx, cz], idx) => {
      const brazier = new THREE.Group();
      brazier.position.set(cx, 0, cz);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, 2.4, 8), M.stoneMarble);
      col.position.y = 1.2;
      col.castShadow = true;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.35, 0.45, 8), M.darkIron);
      bowl.position.y = 2.55;
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 0.95, 7),
        idx % 2 === 0 ? M.holyGlow : M.lavaGlow
      );
      flame.position.y = 3.1;
      brazier.add(col, bowl, flame);
      state.combatGroup.add(brazier);
    });

    // Шахматная сетка 10x8
    const tileA = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.76, metalness: 0.1 });
    const tileB = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.82, metalness: 0.12 });
    const tileGeo = new THREE.BoxGeometry(state.cellSize * 0.95, 0.16, state.cellSize * 0.95);
    const hlGeo = new THREE.PlaneGeometry(state.cellSize * 0.9, state.cellSize * 0.9);

    for (let row = 0; row < state.gridRows; row++) {
      for (let col = 0; col < state.gridCols; col++) {
        const wp = cellToWorld(col, row);
        const tile = new THREE.Mesh(tileGeo, (col + row) % 2 === 0 ? tileA : tileB);
        tile.position.set(wp.x, 0.08, wp.z);
        tile.receiveShadow = true;
        tile.userData.hommType = 'cell';
        tile.userData.col = col;
        tile.userData.row = row;
        state.combatGroup.add(tile);

        const hlMesh = new THREE.Mesh(
          hlGeo,
          new THREE.MeshBasicMaterial({
            color: 0x34d399,
            transparent: true,
            opacity: 0.0,
            depthWrite: false
          })
        );
        hlMesh.rotation.x = -Math.PI * 0.5;
        hlMesh.position.set(wp.x, 0.18, wp.z);
        hlMesh.visible = false;
        state.combatGroup.add(hlMesh);

        const aoeMesh = new THREE.Mesh(
          hlGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf97316,
            transparent: true,
            opacity: 0.42,
            depthWrite: false
          })
        );
        aoeMesh.rotation.x = -Math.PI * 0.5;
        aoeMesh.position.set(wp.x, 0.2, wp.z);
        aoeMesh.visible = false;
        state.combatGroup.add(aoeMesh);

        state.cellTiles.push({ col, row, mesh: tile, highlightMesh: hlMesh, aoeMesh });
      }
    }

    // Вращающееся золотое рунное кольцо активного отряда
    state.activeRing = new THREE.Mesh(
      new THREE.PlaneGeometry(state.cellSize * 1.08, state.cellSize * 1.08),
      new THREE.MeshBasicMaterial({
        map: createRuneRingTexture('#fde047'),
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      })
    );
    state.activeRing.rotation.x = -Math.PI * 0.5;
    state.activeRing.position.y = 0.21;
    state.activeRing.visible = false;
    state.combatGroup.add(state.activeRing);

    // Герои на постаментах по краям арены
    state.heroModels.player = createHeroPedestalModel(true);
    state.heroModels.player.position.set(-boardW * 0.5 - 2.35, 0, 0);
    state.combatGroup.add(state.heroModels.player);

    state.heroModels.enemy = createHeroPedestalModel(false);
    state.heroModels.enemy.position.set(boardW * 0.5 + 2.35, 0, 0);
    state.combatGroup.add(state.heroModels.enemy);

    if (battleState) {
      // Препятствия
      const obs = battleState.obstacles || [];
      obs.forEach((o) => {
        const oMesh = createObstacleMesh(o.kind || 'rock');
        const wp = cellToWorld(o.col, o.row);
        oMesh.position.set(wp.x, 0.16, wp.z);
        state.combatGroup.add(oMesh);
        state.obstaclesList.push(oMesh);
      });

      syncBattleState(battleState);
    }
  }

  function syncBattleState(battleState) {
    if (!state.initialized || !battleState) return;
    const stacks = Array.isArray(battleState.stacks)
      ? battleState.stacks
      : Object.values(battleState.stacks || {});

    const activeId = battleState.activeUnitId || battleState.activeStackId || null;
    let activeRingPlaced = false;

    stacks.forEach((st) => {
      const id = st.id || st.stackId;
      if (!id) return;

      let actor = state.unitActors[id];
      if (!actor && st.count > 0) {
        actor = createUnitActor(st);
        state.unitActors[id] = actor;
        state.combatGroup.add(actor.group);
      }
      if (!actor) return;

      if (st.count <= 0 || st.dead) {
        actor.count = 0;
        actor.group.visible = false;
        return;
      }

      actor.count = st.count;
      actor.group.visible = true;
      actor.col = st.col;
      actor.row = st.row;

      if (!actor.animBusy) {
        const wp = cellToWorld(st.col, st.row);
        actor.group.position.set(wp.x, wp.y, wp.z);
      }

      const unitCfg = (HOMM5.CONFIG.UNITS && HOMM5.CONFIG.UNITS[st.unitId]) || { hp: 20 };
      const maxHpPerUnit = st.maxHp || unitCfg.hp || 20;
      const topHp = st.currentHp !== undefined ? st.currentHp : (st.topHp !== undefined ? st.topHp : maxHpPerUnit);
      const hpRatio = clamp(topHp / Math.max(1, maxHpPerUnit), 0, 1);

      const isDefending = Boolean(
        st.defending || st.isDefending ||
        (st.buffs && (st.buffs.divine_shield || st.buffs.defend))
      );
      const hasLightBuff = Boolean(
        (st.buffs && (st.buffs.righteous_might || (Array.isArray(st.buffs) && st.buffs.length > 0))) ||
        st.righteousMightTurns > 0 || st.divineShieldTurns > 0
      );

      actor.shieldSphere.visible = Boolean(isDefending || st.divineShieldTurns > 0);
      actor.buffHalo.visible = hasLightBuff;

      const sig = `${st.count}|${hpRatio.toFixed(2)}|${isDefending ? 1 : 0}|${hasLightBuff ? 1 : 0}`;
      if (actor.lastSignature !== sig) {
        actor.lastSignature = sig;
        drawUnitBadgeCanvas(actor.badgeCanvas, st.count, hpRatio, actor.isEnemy, hasLightBuff, isDefending);
        actor.badgeTex.needsUpdate = true;
      }

      if (activeId && id === activeId && state.activeRing) {
        const wp = cellToWorld(st.col, st.row);
        state.activeRing.position.set(wp.x, 0.21, wp.z);
        state.activeRing.visible = true;
        activeRingPlaced = true;
      }
    });

    if (!activeRingPlaced && state.activeRing) {
      state.activeRing.visible = false;
    }
  }

  function highlightCells(cellsInfo) {
    if (!state.initialized) return;
    const info = cellsInfo || {};
    const moveSet = new Set((info.moves || []).map((c) => `${c.col},${c.row}`));
    const targetSet = new Set((info.targets || []).map((c) => `${c.col},${c.row}`));
    const aoe = info.aoeCenter || null;

    state.cellTiles.forEach((tile) => {
      const key = `${tile.col},${tile.row}`;
      if (targetSet.has(key)) {
        tile.highlightMesh.visible = true;
        tile.highlightMesh.material.color.setHex(0xef4444);
        tile.highlightMesh.material.opacity = 0.62;
      } else if (moveSet.has(key)) {
        tile.highlightMesh.visible = true;
        tile.highlightMesh.material.color.setHex(0x2dd4bf);
        tile.highlightMesh.material.opacity = 0.45;
      } else {
        tile.highlightMesh.visible = false;
      }

      if (aoe && Math.abs(tile.col - aoe.col) <= 1 && Math.abs(tile.row - aoe.row) <= 1) {
        tile.aoeMesh.visible = true;
      } else {
        tile.aoeMesh.visible = false;
      }
    });
  }

  // ============================================================================
  // 5. БОЕВАЯ АНИМАЦИЯ ПЕРЕМЕЩЕНИЯ, АТАКИ (ACTION-CAM + HIT-STOP) И МАГИИ
  // ============================================================================

  function spawnBurstParticles(worldPos, colorHex, count, speedScale, riseBias) {
    if (!state.initialized) return;
    const THREE = root.THREE;
    const tex = colorHex === 0x38bdf8 ? state.mats.blueSpriteTex
      : (colorHex === 0xef4444 || colorHex === 0xf97316) ? state.mats.fireSpriteTex
      : state.mats.glowSpriteTex;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false
      });
      const sp = new THREE.Sprite(mat);
      const size = 0.35 + Math.random() * 0.45;
      sp.scale.set(size, size, 1);
      sp.position.copy(worldPos);
      sp.position.y += 0.4 + Math.random() * 0.8;
      state.fxGroup.add(sp);

      const angle = Math.random() * Math.PI * 2;
      const spd = (1.5 + Math.random() * 3.5) * (speedScale || 1);
      state.particles.push({
        mesh: sp,
        vx: Math.cos(angle) * spd,
        vy: (riseBias !== undefined ? riseBias : 2.2) + Math.random() * 3.2,
        vz: Math.sin(angle) * spd,
        gravity: riseBias && riseBias > 3 ? -0.5 : 6.2,
        age: 0,
        maxAge: 0.55 + Math.random() * 0.35
      });
    }
  }

  function emitFloatingWorldText(worldPos, text, kind) {
    if (!state.initialized) return;
    const THREE = root.THREE;
    const scr = worldToScreen(worldPos.clone().add(new THREE.Vector3(0, 2.2, 0)));
    HOMM5.Bus.emit('fx:floatingText', {
      screenX: scr.x,
      screenY: scr.y,
      text,
      kind: kind || 'damage'
    });

    // Дублирующий чёткий 3D-всплывающий текст в мире
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 42px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    ctx.strokeText(text, 192, 48);
    ctx.fillStyle = kind === 'heal' ? '#4ade80' : kind === 'crit' ? '#fde047' : kind === 'buff' ? '#60a5fa' : '#f87171';
    ctx.fillText(text, 192, 48);

    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.position.copy(worldPos);
    spr.position.y += 2.6;
    spr.scale.set(3.4, 0.85, 1);
    spr.renderOrder = 30;
    state.fxGroup.add(spr);
    state.floatingSprites.push({ sprite: spr, age: 0, maxAge: 1.05 });
  }

  function triggerActionCam(focusPos) {
    state.actionCam = {
      focus: { x: focusPos.x, y: 1.1, z: focusPos.z },
      age: 0,
      duration: 0.65
    };
    state.shakePower = 0.38;
  }

  function playUnitMove(stackId, pathCells, callback) {
    const done = typeof callback === 'function' ? callback : function () {};
    if (!state.initialized || !pathCells || pathCells.length === 0) {
      done();
      return;
    }
    const actor = state.unitActors[stackId];
    if (!actor) {
      done();
      return;
    }

    const waypoints = pathCells.map((c) => cellToWorld(c.col, c.row));
    const startPos = { x: actor.group.position.x, y: actor.group.position.y, z: actor.group.position.z };
    const endCell = pathCells[pathCells.length - 1];
    const endPos = waypoints[waypoints.length - 1];
    actor.animBusy = true;

    if (actor.isFlying) {
      // Полёт по высокой параболической дуге с ускоренными взмахами крыльев
      const dx = endPos.x - startPos.x;
      const dz = endPos.z - startPos.z;
      if (Math.hypot(dx, dz) > 0.05) {
        actor.animParts.body.rotation.y = Math.atan2(dx, dz);
      }
      state.tweens.push({
        age: 0,
        duration: 0.68,
        update(t) {
          const e = easeInOutQuad(t);
          actor.group.position.x = lerp(startPos.x, endPos.x, e);
          actor.group.position.z = lerp(startPos.z, endPos.z, e);
          actor.group.position.y = startPos.y + Math.sin(Math.PI * t) * 3.6;
          if (actor.animParts.leftWing && actor.animParts.rightWing) {
            const flap = Math.sin(t * Math.PI * 10) * 0.65;
            actor.animParts.leftWing.rotation.z = -flap;
            actor.animParts.rightWing.rotation.z = flap;
          }
        },
        complete() {
          actor.group.position.set(endPos.x, endPos.y, endPos.z);
          actor.animParts.body.rotation.y = actor.isEnemy ? -Math.PI * 0.5 : Math.PI * 0.5;
          actor.col = endCell.col;
          actor.row = endCell.row;
          actor.animBusy = false;
          spawnBurstParticles(actor.group.position, 0xfde047, 10, 0.7, 1.2);
          done();
        }
      });
    } else {
      // Шаговое перемещение по клеткам маршрута
      const points = [startPos].concat(waypoints);
      const segCount = points.length - 1;
      const totalDur = clamp(segCount * 0.14, 0.22, 0.85);

      state.tweens.push({
        age: 0,
        duration: totalDur,
        update(t) {
          const scaled = t * segCount;
          const idx = Math.min(segCount - 1, Math.floor(scaled));
          const localT = scaled - idx;
          const p0 = points[idx];
          const p1 = points[idx + 1];
          actor.group.position.x = lerp(p0.x, p1.x, localT);
          actor.group.position.z = lerp(p0.z, p1.z, localT);
          actor.group.position.y = p1.y + Math.abs(Math.sin(localT * Math.PI)) * 0.28;
          const dx = p1.x - p0.x;
          const dz = p1.z - p0.z;
          if (Math.hypot(dx, dz) > 0.02) {
            actor.animParts.body.rotation.y = Math.atan2(dx, dz);
          }
        },
        complete() {
          actor.group.position.set(endPos.x, endPos.y, endPos.z);
          actor.animParts.body.rotation.y = actor.isEnemy ? -Math.PI * 0.5 : Math.PI * 0.5;
          actor.col = endCell.col;
          actor.row = endCell.row;
          actor.animBusy = false;
          done();
        }
      });
    }
  }

  function playAttackAnim(attackerId, defenderId, opts, callback) {
    const done = typeof callback === 'function' ? callback : function () {};
    if (!state.initialized) {
      done();
      return;
    }
    const THREE = root.THREE;
    const options = opts || {};
    const defender = state.unitActors[defenderId];
    const attacker = state.unitActors[attackerId];

    if (!defender) {
      done();
      return;
    }

    let startWorld = null;
    let isEnemyAttacker = false;
    if (options.isHeroAttack || !attacker) {
      isEnemyAttacker = attackerId === 'inferno_lord' || attackerId === 'enemy_hero';
      const heroMesh = isEnemyAttacker ? state.heroModels.enemy : state.heroModels.player;
      startWorld = heroMesh ? heroMesh.position.clone().add(new THREE.Vector3(0, 1.8, 0)) : new THREE.Vector3(-12, 2, 0);
    } else {
      isEnemyAttacker = attacker.isEnemy;
      startWorld = attacker.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    }

    const defWorld = defender.group.position.clone();
    const isDramatic = Boolean(options.isCrit || (options.killed && options.killed >= 3));

    const resolveImpact = () => {
      if (isDramatic) {
        triggerActionCam(defWorld);
        state.hitStopUntil = performance.now() + 45;
      } else {
        state.shakePower = Math.max(state.shakePower, 0.14);
      }

      const fxCol = isEnemyAttacker ? 0xf97316 : 0xfde047;
      spawnBurstParticles(defWorld, fxCol, isDramatic ? 26 : 14, isDramatic ? 1.35 : 0.9, 2.5);

      const dmgText = options.damage !== undefined
        ? `-${options.damage}${options.killed ? ` (☠${options.killed})` : ''}`
        : 'УДАР!';
      emitFloatingWorldText(defWorld, options.isCrit ? `⚡ КРИТ ${dmgText}` : dmgText, options.isCrit ? 'crit' : 'damage');

      // Короткая отдача защищающегося
      const origX = defender.group.position.x;
      const pushDir = isEnemyAttacker ? -0.32 : 0.32;
      state.tweens.push({
        age: 0,
        duration: 0.22,
        update(t) {
          defender.group.position.x = origX + Math.sin(t * Math.PI) * pushDir;
        },
        complete() {
          defender.group.position.x = origX;
          done();
        }
      });
    };

    const rangedShot = Boolean(options.isRanged || options.isHeroAttack || (attacker && attacker.isRanged));

    if (rangedShot) {
      // Светящийся арбалетный болт / сгусток адского пламени по дуге со шлейфом
      const isFire = isEnemyAttacker || (attacker && attacker.unitId === 'succubus');
      const projMesh = new THREE.Mesh(
        isFire ? new THREE.SphereGeometry(0.24, 8, 8) : new THREE.ConeGeometry(0.12, 0.72, 6),
        isFire ? state.mats.lavaGlow : state.mats.sapphireGlow
      );
      projMesh.position.copy(startWorld);
      state.fxGroup.add(projMesh);

      const targetHit = defWorld.clone().add(new THREE.Vector3(0, 1.1, 0));
      state.tweens.push({
        age: 0,
        duration: 0.42,
        update(t) {
          const nx = lerp(startWorld.x, targetHit.x, t);
          const nz = lerp(startWorld.z, targetHit.z, t);
          const ny = lerp(startWorld.y, targetHit.y, t) + Math.sin(t * Math.PI) * 1.65;
          projMesh.lookAt(nx, ny, nz);
          projMesh.position.set(nx, ny, nz);
          if (Math.random() < 0.65) {
            spawnBurstParticles(projMesh.position, isFire ? 0xf97316 : 0x38bdf8, 1, 0.25, 0.2);
          }
        },
        complete() {
          state.fxGroup.remove(projMesh);
          resolveImpact();
        }
      });
    } else if (attacker) {
      // Ближний бой: стремительный выпад к врагу, взмах оружия и возврат
      const origPos = attacker.group.position.clone();
      const strikePos = origPos.clone().lerp(defWorld, 0.58);
      attacker.animBusy = true;

      state.tweens.push({
        age: 0,
        duration: 0.26,
        update(t) {
          const e = easeOutCubic(t);
          attacker.group.position.lerpVectors(origPos, strikePos, e);
          if (attacker.animParts.weaponArm) {
            attacker.animParts.weaponArm.rotation.x = 0.35 + Math.sin(t * Math.PI) * 1.35;
          }
        },
        complete() {
          resolveImpact();
          state.tweens.push({
            age: 0,
            duration: 0.2,
            update(t) {
              attacker.group.position.lerpVectors(strikePos, origPos, t);
            },
            complete() {
              attacker.group.position.copy(origPos);
              attacker.animBusy = false;
            }
          });
        }
      });
    } else {
      resolveImpact();
    }
  }

  function playSpellFX(spellId, targetCol, targetRow, opts, callback) {
    const done = typeof callback === 'function' ? callback : function () {};
    if (!state.initialized) {
      done();
      return;
    }
    const THREE = root.THREE;
    const wp = cellToWorld(targetCol || 0, targetRow || 0);
    const center = new THREE.Vector3(wp.x, 0.2, wp.z);

    if (spellId === 'righteous_might') {
      // Золотой столб света с небес и восходящие руны мечей
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.15, 14, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false })
      );
      pillar.position.set(center.x, 7.0, center.z);
      state.fxGroup.add(pillar);

      const runes = [];
      for (let i = 0; i < 4; i++) {
        const sword = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.06), state.mats.holyGlow);
        state.fxGroup.add(sword);
        runes.push(sword);
      }

      spawnBurstParticles(center, 0xfde047, 22, 0.9, 4.2);
      emitFloatingWorldText(center, '✨ Карающий Удар!', 'buff');

      state.tweens.push({
        age: 0,
        duration: 0.78,
        update(t) {
          pillar.scale.set(1 + t * 0.35, 1, 1 + t * 0.35);
          pillar.material.opacity = 0.72 * (1 - t);
          runes.forEach((sw, i) => {
            const a = (i / 4) * Math.PI * 2 + t * 5;
            sw.position.set(center.x + Math.cos(a) * 1.15, 0.6 + t * 3.8, center.z + Math.sin(a) * 1.15);
          });
        },
        complete() {
          state.fxGroup.remove(pillar);
          runes.forEach((sw) => state.fxGroup.remove(sw));
          done();
        }
      });
    } else if (spellId === 'divine_shield') {
      // Разворачивающаяся сапфировая геодезическая сфера
      const dome = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.55, 1),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.9 })
      );
      dome.position.set(center.x, 1.1, center.z);
      state.fxGroup.add(dome);
      spawnBurstParticles(center, 0x38bdf8, 20, 0.85, 2.8);
      emitFloatingWorldText(center, '🛡 Небесный Щит!', 'buff');

      state.tweens.push({
        age: 0,
        duration: 0.72,
        update(t) {
          const s = easeOutCubic(t) * 1.25;
          dome.scale.setScalar(Math.max(0.1, s));
          dome.rotation.y = t * 4.2;
          dome.material.opacity = 0.9 * (1 - t * 0.75);
        },
        complete() {
          state.fxGroup.remove(dome);
          done();
        }
      });
    } else if (spellId === 'holy_light') {
      // Изумрудно-золотой луч воскрешения и взлетающие перья света
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 1.35, 13, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false })
      );
      beam.position.set(center.x, 6.5, center.z);
      state.fxGroup.add(beam);

      spawnBurstParticles(center, 0x34d399, 18, 0.8, 4.8);
      spawnBurstParticles(center, 0xfef08a, 14, 0.7, 5.2);
      const healLabel = opts && opts.healed ? `+${opts.healed} ОЗ Воскрешение` : '💖 Святое Воскрешение';
      emitFloatingWorldText(center, healLabel, 'heal');

      state.tweens.push({
        age: 0,
        duration: 0.82,
        update(t) {
          beam.rotation.y = t * 3;
          beam.material.opacity = 0.78 * (1 - t);
        },
        complete() {
          state.fxGroup.remove(beam);
          done();
        }
      });
    } else {
      // fireball: пылающий метеор с неба и взрывная волна 3x3 с разлетающимися углями
      const meteor = new THREE.Mesh(new THREE.DodecahedronGeometry(0.88, 1), state.mats.lavaGlow);
      const startSky = new THREE.Vector3(center.x - 6, 15, center.z - 4);
      meteor.position.copy(startSky);
      state.fxGroup.add(meteor);

      state.tweens.push({
        age: 0,
        duration: 0.44,
        update(t) {
          meteor.position.lerpVectors(startSky, center, t);
          meteor.rotation.x += 0.25;
          meteor.rotation.z += 0.2;
          spawnBurstParticles(meteor.position, 0xf97316, 2, 0.45, 0.4);
        },
        complete() {
          state.fxGroup.remove(meteor);
          triggerActionCam(center);
          state.hitStopUntil = performance.now() + 45;
          spawnBurstParticles(center, 0xef4444, 34, 1.85, 3.6);
          spawnBurstParticles(center, 0xfde047, 18, 1.4, 2.8);
          emitFloatingWorldText(center, '☄️ ОГНЕННЫЙ ШАР!', 'crit');

          // Взрывное кольцо 3x3
          const wave = new THREE.Mesh(
            new THREE.RingGeometry(0.4, 3.4, 28),
            new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
          );
          wave.rotation.x = -Math.PI * 0.5;
          wave.position.set(center.x, 0.26, center.z);
          state.fxGroup.add(wave);

          state.tweens.push({
            age: 0,
            duration: 0.48,
            update(t) {
              const s = 0.25 + easeOutCubic(t) * 1.15;
              wave.scale.setScalar(s);
              wave.material.opacity = 0.9 * (1 - t);
            },
            complete() {
              state.fxGroup.remove(wave);
              done();
            }
          });
        }
      });
    }
  }

  // ============================================================================
  // 6. УПРАВЛЕНИЕ РЕЖИМАМИ, ВРЕМЕНЕМ СУТОК, СОСТОЯНИЕМ КАМПАНИИ И ВВОДОМ
  // ============================================================================

  function getViewportAspect() {
    if (state.container) {
      const w = Math.max(240, state.container.clientWidth || root.innerWidth || 1280);
      const h = Math.max(240, state.container.clientHeight || root.innerHeight || 720);
      return w / h;
    }
    return (root.innerWidth || 1280) / Math.max(1, root.innerHeight || 720);
  }

  function getPortraitRadiusScale(aspect) {
    if (aspect >= 1.0) return 1.0;
    // На узких портретных экранах (9:16 ~ 0.56, 9:20 ~ 0.45) плавно отодвигаем камеру,
    // чтобы вся тактическая арена 10x8 и парящий замок с героями помещались целиком без обрезки краёв
    const safeAsp = clamp(aspect, 0.44, 1.0);
    const extraScale = state.mode === 'combat' ? (1.08 / Math.pow(safeAsp, 0.58)) : (1.03 / Math.pow(safeAsp, 0.48));
    return clamp(extraScale, 1.05, 1.88);
  }

  function applyAdaptiveProjection(aspect) {
    if (!state.camera) return;
    state.camera.aspect = aspect;
    // Адаптация вертикального FOV под портретный экран смартфона (aspect < 1.0)
    state.camera.fov = aspect < 1.0
      ? Math.min(68, Math.round(48 / Math.max(0.68, aspect)))
      : 46;
    state.camera.updateProjectionMatrix();
  }

  function setMode(mode) {
    const targetMode = MODE_PRESETS[mode] ? mode : 'castle';
    state.mode = targetMode;
    const preset = MODE_PRESETS[targetMode];
    const aspect = getViewportAspect();
    const radiusScale = getPortraitRadiusScale(aspect);

    state.camDesiredTarget = { x: preset.target[0], y: preset.target[1], z: preset.target[2] };
    state.desiredSpherical = {
      radius: preset.radius * radiusScale,
      phi: aspect < 1.0 && targetMode === 'combat' ? clamp(preset.phi - 0.1, 0.55, 1.35) : preset.phi,
      theta: preset.theta
    };
    state.autoRotateSpeed = preset.autoRotate;

    applyAdaptiveProjection(aspect);

    if (state.castleWorldGroup && state.combatGroup) {
      const inCombat = targetMode === 'combat';
      state.castleWorldGroup.visible = !inCombat;
      state.combatGroup.visible = inCombat;
      if (state.valleyGroup) {
        state.valleyGroup.visible = targetMode === 'valley' || targetMode === 'castle';
      }
    }
  }

  function resetCamera() {
    setMode(state.mode);
  }

  function toggleTimeOfDay() {
    state.themeKey = state.themeKey === 'noon' ? 'eclipse' : 'noon';
    if (!state.initialized || !hasThree()) return state.themeKey;

    const theme = THEMES[state.themeKey];
    state.scene.fog.color.setHex(theme.fogColor);
    state.scene.fog.density = theme.fogDensity;

    if (state.skyDome) {
      if (state.skyDome.material.map) state.skyDome.material.map.dispose();
      state.skyDome.material.map = createSkyTexture(theme);
      state.skyDome.material.needsUpdate = true;
    }
    if (state.starField) {
      state.starField.material.opacity = theme.starOpacity;
    }
    state.lights.ambient.color.setHex(theme.ambientColor);
    state.lights.ambient.intensity = theme.ambientIntensity;
    state.lights.hemi.color.setHex(theme.hemiSky);
    state.lights.hemi.groundColor.setHex(theme.hemiGround);
    state.lights.sun.color.setHex(theme.sunColor);
    state.lights.sun.intensity = theme.sunIntensity;
    state.lights.sun.position.set(theme.sunPos[0], theme.sunPos[1], theme.sunPos[2]);
    state.lights.magicLeft.color.setHex(theme.lanternColor);
    state.lights.magicLeft.intensity = theme.lanternIntensity;

    return state.themeKey;
  }

  function syncCampaignState(campaignState) {
    if (!state.initialized || !campaignState) return;
    const builtObj = campaignState.buildings || campaignState.builtBuildings || {};
    const builtSet = Array.isArray(builtObj)
      ? new Set(builtObj)
      : new Set(Object.keys(builtObj).filter((k) => Boolean(builtObj[k])));

    Object.keys(state.buildingsMap).forEach((bId) => {
      const rec = state.buildingsMap[bId];
      const isBuilt = builtSet.has(bId);
      rec.built = isBuilt;
      rec.windows.forEach((w) => {
        if (w.material && w.material.emissiveIntensity !== undefined) {
          w.material.emissiveIntensity = isBuilt ? 1.05 : 0.06;
          w.material.opacity = isBuilt ? 1.0 : 0.45;
        }
      });
      rec.halos.forEach((h) => {
        h.visible = isBuilt;
      });
      rec.flags.forEach((f) => {
        f.visible = isBuilt;
      });
      rec.group.scale.setScalar(isBuilt ? 1.0 : 0.92);
    });

    const completedArr = campaignState.completedNodes || [];
    const completedSet = Array.isArray(completedArr)
      ? new Set(completedArr)
      : new Set(Object.keys(completedArr).filter((k) => Boolean(completedArr[k])));

    Object.keys(state.valleyNodesMap).forEach((nId) => {
      const node = state.valleyNodesMap[nId];
      const isDone = completedSet.has(nId);
      node.completed = isDone;
      if (node.cfg.type === 'treasure') {
        node.group.visible = !isDone;
      } else {
        node.group.visible = true;
        if (node.runePlate && node.runePlate.material) {
          node.runePlate.material.opacity = isDone ? 0.25 : 0.9;
        }
        if (node.focalMesh) {
          node.focalMesh.scale.setScalar(isDone ? 0.55 : 1.0);
        }
      }
    });
  }

  // ============================================================================
  // 7. ПРОСТРАНСТВЕННЫЕ КООРДИНАТЫ И ВВОД (RADIAL MENU, EMPTY TAP, CAMERA FADE)
  // ============================================================================

  function getActorScreenPosition(actorId) {
    const fallbackW = (state.container && state.container.clientWidth) || root.innerWidth || 1280;
    const fallbackH = (state.container && state.container.clientHeight) || root.innerHeight || 720;
    const fallback = { x: Math.round(fallbackW * 0.5), y: Math.round(fallbackH * 0.5) };

    if (!state.initialized || !hasThree() || !state.camera || !state.renderer) {
      return fallback;
    }

    const THREE = root.THREE;
    const worldVec = new THREE.Vector3();
    let found = false;

    if (actorId === 'hero_player' || actorId === 'haven_lord') {
      if (state.heroModels.player) {
        state.heroModels.player.getWorldPosition(worldVec);
        worldVec.y += 1.5;
        found = true;
      }
    } else if (actorId === 'hero_enemy' || actorId === 'inferno_lord') {
      if (state.heroModels.enemy) {
        state.heroModels.enemy.getWorldPosition(worldVec);
        worldVec.y += 1.5;
        found = true;
      }
    } else if (actorId && state.unitActors[actorId] && state.unitActors[actorId].group.visible) {
      state.unitActors[actorId].group.getWorldPosition(worldVec);
      worldVec.y += 1.2;
      found = true;
    }

    if (!found) return fallback;

    worldVec.project(state.camera);
    const width = Math.max(1, (state.container && state.container.clientWidth) || state.renderer.domElement.clientWidth || fallbackW);
    const height = Math.max(1, (state.container && state.container.clientHeight) || state.renderer.domElement.clientHeight || fallbackH);

    return {
      x: Math.round((worldVec.x * 0.5 + 0.5) * width),
      y: Math.round((-worldVec.y * 0.5 + 0.5) * height)
    };
  }

  function findAliveActorAtCell(col, row) {
    const actors = Object.values(state.unitActors);
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a && a.group && a.group.visible && a.count > 0 && a.col === col && a.row === row) {
        return a;
      }
    }
    return null;
  }

  function isObjectChainVisible(obj) {
    let cur = obj;
    while (cur) {
      if (cur.visible === false) return false;
      cur = cur.parent;
    }
    return true;
  }

  function bindInputEvents(domEl) {
    let pointerDown = false;
    let pointerButton = 0;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let dragged = false;
    let cameraManipActive = false;
    let wheelManipTimer = null;
    let longPressTimer = null;

    const setCameraManipulating = (active) => {
      const flag = Boolean(active);
      if (cameraManipActive === flag) return;
      cameraManipActive = flag;
      HOMM5.Bus.emit('3d:cameraManipulating', { active: flag });
    };

    const updateMouseNDC = (clientX, clientY) => {
      const rect = domEl.getBoundingClientRect();
      state.mouseNDC.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      state.mouseNDC.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const pickSceneObject = (clientX, clientY) => {
      updateMouseNDC(clientX, clientY);
      state.raycaster.setFromCamera(state.mouseNDC, state.camera);

      if (state.mode === 'combat') {
        // Приоритет 1: 3D-группы Героев на постаментах
        const heroRoots = [state.heroModels.player, state.heroModels.enemy].filter(Boolean);
        if (heroRoots.length > 0) {
          const heroHits = state.raycaster.intersectObjects(heroRoots, true);
          for (let i = 0; i < heroHits.length; i++) {
            const obj = heroHits[i].object;
            if (!isObjectChainVisible(obj)) continue;
            if (obj.userData && obj.userData.hommType === 'hero') {
              return obj.userData;
            }
          }
        }

        // Приоритет 2: живые отряды и клетки арены 10x8
        const combatHits = state.raycaster.intersectObjects([state.combatGroup], true);
        let firstCellHit = null;
        for (let i = 0; i < combatHits.length; i++) {
          const obj = combatHits[i].object;
          if (!isObjectChainVisible(obj)) continue;
          const ud = obj.userData;
          if (!ud || !ud.hommType) continue;
          if (ud.hommType === 'unit') {
            const act = state.unitActors[ud.hommId];
            if (act && act.group.visible && act.count > 0) {
              return ud;
            }
          } else if (ud.hommType === 'cell' && !firstCellHit) {
            firstCellHit = ud;
          }
        }
        return firstCellHit;
      }

      // Режимы 'castle' и 'valley': проверяем только интерактивные здания и узлы долины
      const worldHits = state.raycaster.intersectObjects([state.castleWorldGroup], true);
      for (let i = 0; i < worldHits.length; i++) {
        const obj = worldHits[i].object;
        if (!isObjectChainVisible(obj)) continue;
        if (obj.userData && (obj.userData.hommType === 'building' || obj.userData.hommType === 'node')) {
          return obj.userData;
        }
      }
      return null;
    };

    const dispatchSpatialTap = (clientX, clientY) => {
      const picked = pickSceneObject(clientX, clientY);

      if (state.mode === 'combat') {
        if (picked && picked.hommType === 'hero') {
          HOMM5.Bus.emit('3d:heroTap', {
            heroId: picked.heroId || picked.hommId,
            side: picked.side || 'player',
            screenX: clientX,
            screenY: clientY
          });
          return;
        }

        if (picked && (picked.hommType === 'unit' || picked.hommType === 'cell')) {
          let col = picked.col;
          let row = picked.row;
          let aliveActor = null;

          if (picked.hommType === 'unit') {
            aliveActor = state.unitActors[picked.hommId] || null;
            if (aliveActor) {
              col = aliveActor.col;
              row = aliveActor.row;
            }
          }
          if (!aliveActor && col !== undefined && row !== undefined) {
            aliveActor = findAliveActorAtCell(col, row);
          }

          const tappedStackId = aliveActor ? aliveActor.id : null;
          if (aliveActor) {
            HOMM5.Bus.emit('3d:actorTap', {
              stackId: aliveActor.id,
              col,
              row,
              side: aliveActor.side || (aliveActor.isEnemy ? 'enemy' : 'player'),
              screenX: clientX,
              screenY: clientY
            });
          }

          if (col !== undefined && row !== undefined) {
            HOMM5.Bus.emit('3d:cellClick', {
              col,
              row,
              screenX: clientX,
              screenY: clientY,
              tappedStackId
            });
          }
          return;
        }

        // Тап в пустое небо / за край арены
        HOMM5.Bus.emit('3d:emptyTap', { mode: state.mode });
        return;
      }

      // Режимы 'castle' и 'valley'
      if (picked && picked.hommType === 'building') {
        HOMM5.Bus.emit('3d:buildingClick', {
          buildingId: picked.hommId,
          screenX: clientX,
          screenY: clientY
        });
      } else if (picked && picked.hommType === 'node') {
        HOMM5.Bus.emit('3d:nodeClick', {
          nodeId: picked.hommId,
          screenX: clientX,
          screenY: clientY
        });
      } else {
        HOMM5.Bus.emit('3d:emptyTap', { mode: state.mode });
      }
    };

    domEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const picked = pickSceneObject(e.clientX, e.clientY);
      if (picked && picked.hommType === 'unit') {
        HOMM5.Bus.emit('3d:unitInspect', { stackId: picked.hommId });
      } else if (picked && picked.hommType === 'hero') {
        HOMM5.Bus.emit('3d:heroTap', {
          heroId: picked.heroId || picked.hommId,
          side: picked.side || 'player',
          screenX: e.clientX,
          screenY: e.clientY
        });
      } else if (picked && picked.hommType === 'building') {
        HOMM5.Bus.emit('3d:buildingClick', { buildingId: picked.hommId });
      }
    });

    domEl.addEventListener('mousedown', (e) => {
      pointerDown = true;
      pointerButton = e.button;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      dragged = false;
      state.userInteracting = true;
      state.idleTimer = 0;
    });

    root.addEventListener('mousemove', (e) => {
      if (pointerDown && (pointerButton === 0 || pointerButton === 2)) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        const distFromStart = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (distFromStart > 8) {
          setCameraManipulating(true);
        }
        if (distFromStart > 10) {
          dragged = true;
        }
        if (distFromStart > 8) {
          state.desiredSpherical.theta -= dx * 0.0075;
          state.desiredSpherical.phi = clamp(state.desiredSpherical.phi - dy * 0.0065, 0.38, 1.42);
        }
        return;
      }

      if (state.mode === 'combat') {
        const picked = pickSceneObject(e.clientX, e.clientY);
        let hCol = null;
        let hRow = null;
        if (picked && picked.hommType === 'cell') {
          hCol = picked.col;
          hRow = picked.row;
        } else if (picked && picked.hommType === 'unit') {
          const act = state.unitActors[picked.hommId];
          if (act) {
            hCol = act.col;
            hRow = act.row;
          }
        }
        const key = hCol !== null ? `${hCol},${hRow}` : null;
        if (state.hoveredCell !== key && hCol !== null) {
          state.hoveredCell = key;
          HOMM5.Bus.emit('3d:cellHover', {
            col: hCol,
            row: hRow,
            screenX: e.clientX,
            screenY: e.clientY
          });
        }
      }
    });

    root.addEventListener('mouseup', (e) => {
      if (!pointerDown) return;
      pointerDown = false;
      state.userInteracting = false;
      setCameraManipulating(false);

      const moveDist = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (!dragged && moveDist <= 10 && e.button === 0 && e.target === domEl) {
        dispatchSpatialTap(e.clientX, e.clientY);
      }
    });

    domEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      setCameraManipulating(true);
      clearTimeout(wheelManipTimer);
      wheelManipTimer = setTimeout(() => {
        if (!pointerDown) setCameraManipulating(false);
      }, 220);

      const preset = MODE_PRESETS[state.mode] || MODE_PRESETS.castle;
      const maxRad = preset.maxRadius * getPortraitRadiusScale(getViewportAspect());
      state.desiredSpherical.radius = clamp(
        state.desiredSpherical.radius + e.deltaY * 0.018,
        preset.minRadius,
        maxRad
      );
    }, { passive: false });

    // Сенсорное управление iOS / Android:
    // - 1 палец: плавное вращение орбиты / одиночный тап (если сдвиг < 10px) / долгий тап осмотра существа с виброоткликом
    // - 2 пальца: мультитач Pinch-to-Zoom масштабирования камеры + сигнал 3d:cameraManipulating
    let isPinching = false;
    let pinchLastDist = 0;

    const getTouchDist = (t0, t1) => Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);

    domEl.addEventListener('touchstart', (e) => {
      state.userInteracting = true;
      state.idleTimer = 0;

      if (e.touches.length === 2) {
        clearTimeout(longPressTimer);
        isPinching = true;
        pointerDown = false;
        dragged = true; // блокируем ложный одиночный тап после завершения зума двумя пальцами
        pinchLastDist = getTouchDist(e.touches[0], e.touches[1]);
        setCameraManipulating(true);
        return;
      }

      if (e.touches.length !== 1) return;
      isPinching = false;
      const t = e.touches[0];
      pointerDown = true;
      startX = lastX = t.clientX;
      startY = lastY = t.clientY;
      dragged = false;

      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (!dragged && !isPinching) {
          const picked = pickSceneObject(t.clientX, t.clientY);
          if (picked && picked.hommType === 'unit') {
            dragged = true;
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(25);
            }
            HOMM5.Bus.emit('3d:unitInspect', { stackId: picked.hommId });
          }
        }
      }, 520);
    }, { passive: true });

    domEl.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        clearTimeout(longPressTimer);
        isPinching = true;
        dragged = true;
        setCameraManipulating(true);
        const dist = getTouchDist(e.touches[0], e.touches[1]);
        if (pinchLastDist > 0) {
          const deltaDist = pinchLastDist - dist;
          const preset = MODE_PRESETS[state.mode] || MODE_PRESETS.castle;
          const maxRad = preset.maxRadius * getPortraitRadiusScale(getViewportAspect());
          state.desiredSpherical.radius = clamp(
            state.desiredSpherical.radius + deltaDist * 0.085,
            preset.minRadius * 0.85,
            maxRad
          );
        }
        pinchLastDist = dist;
        return;
      }

      if (isPinching || !pointerDown || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - lastX;
      const dy = t.clientY - lastY;
      lastX = t.clientX;
      lastY = t.clientY;

      const distFromStart = Math.hypot(t.clientX - startX, t.clientY - startY);
      if (distFromStart > 8) {
        setCameraManipulating(true);
      }
      // Защита от ложного тапа при вращении камеры: порог >= 10px
      if (distFromStart >= 10) {
        dragged = true;
        clearTimeout(longPressTimer);
      }
      if (distFromStart > 8) {
        state.desiredSpherical.theta -= dx * 0.008;
        state.desiredSpherical.phi = clamp(state.desiredSpherical.phi - dy * 0.007, 0.4, 1.42);
      }
    }, { passive: false });

    domEl.addEventListener('touchend', (e) => {
      clearTimeout(longPressTimer);

      if (e.touches.length === 0) {
        state.userInteracting = false;
        setCameraManipulating(false);
      }

      if (isPinching) {
        if (e.touches.length < 2) {
          pinchLastDist = 0;
        }
        if (e.touches.length === 0) {
          isPinching = false;
          pointerDown = false;
        }
        return;
      }

      if (!pointerDown) return;
      pointerDown = false;

      if (!dragged && e.changedTouches && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        if (Math.hypot(t.clientX - startX, t.clientY - startY) >= 10) return;
        dispatchSpatialTap(t.clientX, t.clientY);
      }
    }, { passive: true });

    domEl.addEventListener('touchcancel', () => {
      clearTimeout(longPressTimer);
      isPinching = false;
      pinchLastDist = 0;
      pointerDown = false;
      state.userInteracting = false;
      setCameraManipulating(false);
    }, { passive: true });
  }

  // ============================================================================
  // 8. ГЛАВНЫЙ ЦИКЛ РЕНДЕРА 60 FPS
  // ============================================================================

  function renderFrame(now) {
    state.rafId = root.requestAnimationFrame(renderFrame);

    const rawDt = state.lastTime ? (now - state.lastTime) / 1000 : 0.016;
    state.lastTime = now;

    // Hit-Stop заморозка кадра при сокрушительных ударах (45 мс)
    if (now < state.hitStopUntil) {
      state.renderer.render(state.scene, state.camera);
      return;
    }

    const dt = Math.min(rawDt, 0.05);
    state.elapsed += dt;
    const t = state.elapsed;

    // 1. Авто-вращение замка 360° и плавная интерполяция камеры
    if (!state.userInteracting) {
      state.idleTimer += dt;
      if (state.mode === 'castle' && state.idleTimer > 1.2) {
        state.desiredSpherical.theta += state.autoRotateSpeed * dt;
      }
    }

    const camLerp = 1 - Math.exp(-6.5 * dt);
    state.spherical.radius = lerp(state.spherical.radius, state.desiredSpherical.radius, camLerp);
    state.spherical.phi = lerp(state.spherical.phi, state.desiredSpherical.phi, camLerp);
    state.spherical.theta = lerp(state.spherical.theta, state.desiredSpherical.theta, camLerp);

    state.camTarget.x = lerp(state.camTarget.x, state.camDesiredTarget.x, camLerp);
    state.camTarget.y = lerp(state.camTarget.y, state.camDesiredTarget.y, camLerp);
    state.camTarget.z = lerp(state.camTarget.z, state.camDesiredTarget.z, camLerp);

    let effRadius = state.spherical.radius;
    let effTargetX = state.camTarget.x;
    let effTargetY = state.camTarget.y;
    let effTargetZ = state.camTarget.z;

    if (state.actionCam) {
      state.actionCam.age += dt;
      const p = state.actionCam.age / state.actionCam.duration;
      if (p >= 1) {
        state.actionCam = null;
      } else {
        const zoomWeight = Math.sin(p * Math.PI);
        effRadius = lerp(effRadius, 13.5, zoomWeight * 0.68);
        effTargetX = lerp(effTargetX, state.actionCam.focus.x, zoomWeight * 0.65);
        effTargetY = lerp(effTargetY, state.actionCam.focus.y, zoomWeight * 0.65);
        effTargetZ = lerp(effTargetZ, state.actionCam.focus.z, zoomWeight * 0.65);
      }
    }

    const sinPhi = Math.sin(state.spherical.phi);
    let camX = effTargetX + effRadius * sinPhi * Math.sin(state.spherical.theta);
    let camY = effTargetY + effRadius * Math.cos(state.spherical.phi);
    let camZ = effTargetZ + effRadius * sinPhi * Math.cos(state.spherical.theta);

    if (state.shakePower > 0.005) {
      camX += (Math.random() - 0.5) * state.shakePower;
      camY += (Math.random() - 0.5) * state.shakePower;
      state.shakePower = Math.max(0, state.shakePower - dt * 1.4);
    }

    state.camera.position.set(camX, camY, camZ);
    state.camera.lookAt(effTargetX, effTargetY, effTargetZ);

    // 2. Анимации парящего замка и долины
    if (state.castleWorldGroup && state.castleWorldGroup.visible) {
      state.castleGroup.position.y = Math.sin(t * 1.15) * 0.28;

      if (state.waterfallParticles) {
        const arr = state.waterfallParticles.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i + 1] -= dt * 5.8;
          arr[i + 2] += dt * 0.7;
          if (arr[i + 1] < -8.8) {
            arr[i + 1] = 0.65;
            arr[i + 2] = 6.7 + (Math.random() - 0.5) * 0.5;
          }
        }
        state.waterfallParticles.geometry.attributes.position.needsUpdate = true;
      }

      state.castleClouds.forEach((cl) => {
        const u = cl.userData;
        const a = u.baseAngle + t * u.speed;
        cl.position.x = Math.cos(a) * u.dist;
        cl.position.z = Math.sin(a) * u.dist;
        cl.position.y = u.baseY + Math.sin(t * 0.9 + u.baseAngle) * 0.3;
      });

      Object.values(state.buildingsMap).forEach((b) => {
        if (b.sunHalo && b.built) {
          b.sunHalo.rotation.z = t * 0.95;
          b.sunHalo.rotation.y = Math.sin(t * 0.6) * 0.4;
        }
      });

      Object.values(state.valleyNodesMap).forEach((n, idx) => {
        if (!n.group.visible) return;
        if (n.runePlate) n.runePlate.rotation.z = t * 0.55 * (idx % 2 === 0 ? 1 : -1);
        if (n.focalMesh && !n.completed) {
          n.focalMesh.rotation.y = t * 0.8;
        }
      });
    }

    // 3. Живое дыхание и взмахи крыльев отрядов на арене
    if (state.combatGroup && state.combatGroup.visible) {
      if (state.activeRing && state.activeRing.visible) {
        state.activeRing.rotation.z = t * 1.25;
        const pulse = 0.94 + Math.sin(t * 4.2) * 0.08;
        state.activeRing.scale.set(pulse, pulse, 1);
      }

      Object.values(state.unitActors).forEach((actor) => {
        if (!actor.group.visible) return;
        const ph = t * 2.6 + actor.phaseOffset;

        if (!actor.animBusy) {
          if (actor.isFlying) {
            actor.animParts.body.position.y = 0.22 + Math.sin(ph * 1.4) * 0.14;
          } else {
            actor.animParts.body.scale.y = 1 + Math.sin(ph) * 0.028;
          }
        }

        if (actor.animParts.leftWing && actor.animParts.rightWing && !actor.animBusy) {
          const flap = Math.sin(ph * 1.85) * 0.34;
          actor.animParts.leftWing.rotation.z = -flap;
          actor.animParts.rightWing.rotation.z = flap;
        }

        actor.animParts.floatingOrbs.forEach((orb, idx) => {
          orb.position.y = 1.06 + Math.sin(ph * 2 + idx * Math.PI) * 0.1;
        });

        if (actor.shieldSphere.visible) {
          actor.shieldSphere.rotation.y = t * 1.1;
        }
        if (actor.buffHalo.visible) {
          actor.buffHalo.rotation.z = t * 1.6;
        }
      });
    }

    // 4. Обновление твинов, 3D-частиц и всплывающего текста
    for (let i = state.tweens.length - 1; i >= 0; i--) {
      const tw = state.tweens[i];
      tw.age += dt;
      const p = clamp(tw.age / Math.max(0.001, tw.duration), 0, 1);
      tw.update(p);
      if (p >= 1) {
        state.tweens.splice(i, 1);
        if (tw.complete) tw.complete();
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.age += dt;
      if (pt.age >= pt.maxAge) {
        state.fxGroup.remove(pt.mesh);
        pt.mesh.material.dispose();
        state.particles.splice(i, 1);
        continue;
      }
      pt.vy -= pt.gravity * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.material.opacity = 1 - pt.age / pt.maxAge;
    }

    for (let i = state.floatingSprites.length - 1; i >= 0; i--) {
      const fs = state.floatingSprites[i];
      fs.age += dt;
      if (fs.age >= fs.maxAge) {
        state.fxGroup.remove(fs.sprite);
        if (fs.sprite.material.map) fs.sprite.material.map.dispose();
        fs.sprite.material.dispose();
        state.floatingSprites.splice(i, 1);
        continue;
      }
      fs.sprite.position.y += dt * 1.45;
      fs.sprite.material.opacity = 1 - Math.pow(fs.age / fs.maxAge, 2);
    }

    state.renderer.render(state.scene, state.camera);
  }

  function handleResize() {
    if (!state.initialized || !state.container || !state.renderer || !state.camera) return;
    const w = Math.max(240, state.container.clientWidth || root.innerWidth || 1280);
    const h = Math.max(240, state.container.clientHeight || root.innerHeight || 720);
    const aspect = w / h;

    applyAdaptiveProjection(aspect);
    state.renderer.setSize(w, h);

    // При смене ориентации смартфона (портрет <-> ландшафт) мягко пересчитываем базовый радиус обзора
    const preset = MODE_PRESETS[state.mode] || MODE_PRESETS.castle;
    const targetRad = preset.radius * getPortraitRadiusScale(aspect);
    const maxRad = preset.maxRadius * getPortraitRadiusScale(aspect);
    state.desiredSpherical.radius = clamp(targetRad, preset.minRadius, maxRad);
  }

  function init(canvasContainerEl) {
    if (state.initialized) return HOMM5.World3D;
    if (!hasThree() || !canvasContainerEl) return HOMM5.World3D;

    const THREE = root.THREE;
    state.container = canvasContainerEl;
    const w = Math.max(240, canvasContainerEl.clientWidth || root.innerWidth || 1280);
    const h = Math.max(240, canvasContainerEl.clientHeight || root.innerHeight || 720);
    const initAspect = w / h;
    const initFov = initAspect < 1.0 ? Math.min(68, Math.round(48 / Math.max(0.68, initAspect))) : 46;

    state.scene = new THREE.Scene();
    state.camera = new THREE.PerspectiveCamera(initFov, initAspect, 0.5, 260);
    state.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    state.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h);
    state.renderer.shadowMap.enabled = true;
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding !== undefined) {
      state.renderer.outputEncoding = THREE.sRGBEncoding;
    }

    canvasContainerEl.innerHTML = '';
    canvasContainerEl.appendChild(state.renderer.domElement);

    state.raycaster = new THREE.Raycaster();
    state.mouseNDC = new THREE.Vector2();

    state.worldGroup = new THREE.Group();
    state.combatGroup = new THREE.Group();
    state.combatGroup.visible = false;
    state.fxGroup = new THREE.Group();

    state.scene.add(state.worldGroup);
    state.scene.add(state.combatGroup);
    state.scene.add(state.fxGroup);

    initMaterials();
    buildSkyAndLights();
    buildCastleAndValley();

    state.initialized = true;
    setMode('castle');
    bindInputEvents(state.renderer.domElement);
    root.addEventListener('resize', handleResize);

    state.lastTime = performance.now();
    state.rafId = root.requestAnimationFrame(renderFrame);

    return HOMM5.World3D;
  }

  HOMM5.World3D = {
    init,
    setMode,
    toggleTimeOfDay,
    resetCamera,
    syncCampaignState,
    buildCombatArena,
    syncBattleState,
    highlightCells,
    playUnitMove,
    playAttackAnim,
    playSpellFX,
    getActorScreenPosition
  };
})(typeof window !== 'undefined' ? window : globalThis);
