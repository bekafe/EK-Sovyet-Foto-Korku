/**
 * Procedural Soviet Building Level Generator ("Son Tur").
 * Builds 7 interconnected rooms with loops, Soviet props (propaganda posters,
 * broken red star monument, vintage typewriter, gas masks, lockers, boiler),
 * AABB wall colliders, hiding spots, flickering lights, photo zones, and waypoint graph.
 */

import * as THREE from 'three';
import { WaypointNode } from './prng';

export interface AABBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  tag?: string;
}

export interface RoomDefinition {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  isDark: boolean;
  ambientHint: string;
}

export interface FlickeringLamp {
  light: THREE.PointLight;
  bulbMesh: THREE.Mesh;
  bulbMat: THREE.MeshStandardMaterial;
  baseIntensity: number;
  phase: number;
  flickerSpeed: number;
  isBrokenSpark: boolean;
}

export interface PhotoZoneTarget {
  id: string;
  title: string;
  roomId: string;
  roomName: string;
  position: THREE.Vector3;
  idealViewDir: THREE.Vector3; // Direction from camera to target
  toleranceDeg: number;
  minDist: number;
  maxDist: number;
  requiresFlash: boolean;
  basePoints: number;
  hintText: string;
}

export interface HidingSpot {
  id: string;
  roomId: string;
  position: THREE.Vector3;
  insidePosition: THREE.Vector3;
  outsidePosition: THREE.Vector3;
  facingYaw: number;
  label: string;
  doorPivot: THREE.Group;
  currentDoorAngle: number;
  targetDoorAngle: number;
}

export interface LevelBuildResult {
  levelGroup: THREE.Group;
  colliders: AABBBox[];
  rooms: RoomDefinition[];
  waypoints: Map<string, WaypointNode>;
  tourStopOrder: string[];
  flickeringLamps: FlickeringLamp[];
  photoTargets: PhotoZoneTarget[];
  hidingSpots: HidingSpot[];
  elevatorDoorLeft: THREE.Mesh;
  elevatorDoorRight: THREE.Mesh;
  babushkaNpcGroup: THREE.Group;
  dustParticles: THREE.Points;
}

/**
 * Generates procedural grimy Soviet plaster, tile, propaganda poster, and vintage uniform portrait textures.
 */
function createProceduralTexture(
  type:
    | 'plaster'
    | 'floor_tile'
    | 'dark_concrete'
    | 'poster_star'
    | 'poster_eye'
    | 'metal_rust'
    | 'uniform_portrait'
    | 'elevator_sign'
    | 'elevator_door',
  rendererMaxAnisotropy = 4,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = type === 'elevator_sign' ? 256 : 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  if (type === 'plaster') {
    ctx.fillStyle = '#535c54';
    ctx.fillRect(0, 0, 128, 128);
    // Lower wainscotting olive-green stripe common in Soviet corridors
    ctx.fillStyle = '#364439';
    ctx.fillRect(0, 74, 128, 54);
    ctx.fillStyle = '#242d26';
    ctx.fillRect(0, 71, 128, 4);
    // Grime noise
    for (let i = 0; i < 450; i++) {
      const x = (i * 73) % 128;
      const y = (i * 41) % 128;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(20,24,20,0.18)' : 'rgba(160,165,150,0.08)';
      ctx.fillRect(x, y, 3, 3);
    }
  } else if (type === 'floor_tile') {
    ctx.fillStyle = '#3b3a35';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#262521';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 128; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 128);
      ctx.stroke();
    }
    for (let y = 0; y <= 128; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    for (let i = 0; i < 300; i++) {
      const x = (i * 59) % 128;
      const y = (i * 97) % 128;
      ctx.fillStyle = 'rgba(15,15,12,0.16)';
      ctx.fillRect(x, y, 2, 2);
    }
  } else if (type === 'dark_concrete') {
    ctx.fillStyle = '#2c2e2b';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      const x = (i * 37) % 128;
      const y = (i * 83) % 128;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(10,10,10,0.28)' : 'rgba(90,95,88,0.12)';
      ctx.fillRect(x, y, 3, 2);
    }
  } else if (type === 'poster_star') {
    ctx.fillStyle = '#d4c39a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#9e2a23';
    ctx.fillRect(8, 8, 112, 112);
    // Sunburst rays
    ctx.fillStyle = '#d4c39a';
    ctx.beginPath();
    ctx.arc(64, 54, 28, 0, Math.PI * 2);
    ctx.fill();
    // Red star in center
    ctx.fillStyle = '#8c1d16';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const innerA = outerA + Math.PI / 5;
      const ox = 64 + Math.cos(outerA) * 22;
      const oy = 54 + Math.sin(outerA) * 22;
      const ix = 64 + Math.cos(innerA) * 9;
      const iy = 54 + Math.sin(innerA) * 9;
      if (i === 0) ctx.moveTo(ox, oy);
      else ctx.lineTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
    // Constructivist bars
    ctx.fillStyle = '#1f1c18';
    ctx.fillRect(18, 92, 92, 10);
    ctx.fillRect(28, 106, 72, 6);
  } else if (type === 'poster_eye') {
    ctx.fillStyle = '#c8b892';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#232927';
    ctx.fillRect(10, 10, 108, 72);
    // Big constructivist watchful eye ("Gruptan Ayrılma!")
    ctx.fillStyle = '#d8c9a3';
    ctx.beginPath();
    ctx.ellipse(64, 46, 36, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9e2a23';
    ctx.beginPath();
    ctx.arc(64, 46, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(64, 46, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9e2a23';
    ctx.fillRect(14, 90, 100, 14);
    ctx.fillStyle = '#232927';
    ctx.fillRect(24, 108, 80, 8);
  } else if (type === 'uniform_portrait') {
    // Sepia vintage photograph of young Babushka Valentina in decorated Soviet officer uniform
    ctx.fillStyle = '#3a2b1c';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#c8b48e';
    ctx.fillRect(8, 8, 112, 112);
    // Vignette backdrop
    ctx.fillStyle = '#9c8663';
    ctx.fillRect(14, 14, 100, 100);
    // Uniform Tunic & Gold Epaulettes
    ctx.fillStyle = '#2d382c';
    ctx.beginPath();
    ctx.moveTo(26, 114);
    ctx.lineTo(38, 72);
    ctx.lineTo(90, 72);
    ctx.lineTo(102, 114);
    ctx.closePath();
    ctx.fill();
    // Gold shoulder boards (Epaulettes)
    ctx.fillStyle = '#d4af37';
    ctx.fillRect(34, 71, 18, 6);
    ctx.fillRect(76, 71, 18, 6);
    // Medals on chest
    ctx.fillStyle = '#b8251e';
    ctx.fillRect(45, 84, 6, 8);
    ctx.fillRect(54, 84, 6, 8);
    ctx.fillStyle = '#e5c158';
    ctx.beginPath();
    ctx.arc(48, 95, 4, 0, Math.PI * 2);
    ctx.arc(57, 95, 4, 0, Math.PI * 2);
    ctx.fill();
    // Young face & Officer Cap with Red Star
    ctx.fillStyle = '#e2ceb0';
    ctx.beginPath();
    ctx.arc(64, 52, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#253024';
    ctx.fillRect(46, 30, 36, 11);
    ctx.fillStyle = '#9e261f';
    ctx.fillRect(48, 38, 32, 4);
    ctx.fillStyle = '#e5c158';
    ctx.fillRect(62, 33, 4, 4);
  } else if (type === 'elevator_sign') {
    // Illuminated Soviet Elevator Header Sign ("▲ ASANSÖR · ЛИФТ ▼" + Floor Indicator B1 1 2 3)
    ctx.fillStyle = '#181a18';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#c59b43';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 120);
    // Top Illuminated Banner
    ctx.fillStyle = '#2a1512';
    ctx.fillRect(12, 12, 232, 54);
    ctx.fillStyle = '#ffbe44';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('▲ ASANSÖR ▼', 128, 48);
    // Bottom Floor Indicator Strip (B1 - 1 - 2 - 3)
    ctx.fillStyle = '#111412';
    ctx.fillRect(12, 72, 232, 42);
    const labels = ['B1', 'K1', 'K2', 'K3'];
    for (let i = 0; i < 4; i++) {
      const bx = 22 + i * 54;
      ctx.fillStyle = i === 1 ? '#d93829' : '#262b28';
      ctx.fillRect(bx, 77, 46, 32);
      ctx.strokeStyle = '#c59b43';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, 77, 46, 32);
      ctx.fillStyle = i === 1 ? '#fff3d1' : '#8d968e';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(labels[i], bx + 23, 99);
    }
  } else if (type === 'elevator_door') {
    // Heavy metallic sliding elevator door leaf with vertical ribs, caution stripe, and window frame
    ctx.fillStyle = '#48524b';
    ctx.fillRect(0, 0, 128, 128);
    // Outer steel frame
    ctx.strokeStyle = '#262c28';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    // Recessed vertical metal panel ribs
    ctx.fillStyle = '#38403a';
    ctx.fillRect(16, 14, 96, 94);
    ctx.strokeStyle = '#626e65';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 14, 96, 94);
    for (let x = 32; x < 104; x += 24) {
      ctx.fillStyle = '#2d342f';
      ctx.fillRect(x, 62, 6, 40);
    }
    // Bottom industrial hazard stripe (amber & black)
    ctx.fillStyle = '#c59b43';
    ctx.fillRect(8, 112, 112, 10);
    ctx.fillStyle = '#1a1c1a';
    for (let sx = 12; sx < 116; sx += 16) {
      ctx.fillRect(sx, 112, 8, 10);
    }
  } else {
    // metal_rust
    ctx.fillStyle = '#3f4642';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 220; i++) {
      const x = (i * 47) % 128;
      const y = (i * 61) % 128;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(110,56,32,0.28)' : 'rgba(25,28,26,0.25)';
      ctx.fillRect(x, y, 4, 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter; // Crisp low-poly PS1 pixel feel
  tex.minFilter = THREE.NearestFilter;
  tex.anisotropy = Math.min(4, rendererMaxAnisotropy);
  return tex;
}

/**
 * Builds the entire interconnected Soviet building level, props, lights, and waypoint graph.
 */
export function buildSovietLevel(maxAnisotropy = 4): LevelBuildResult {
  const levelGroup = new THREE.Group();
  levelGroup.name = 'SovietBuildingLevel';

  const colliders: AABBBox[] = [];
  const flickeringLamps: FlickeringLamp[] = [];
  const photoTargets: PhotoZoneTarget[] = [];
  const hidingSpots: HidingSpot[] = [];

  // Shared procedural textures & materials
  const plasterTex = createProceduralTexture('plaster', maxAnisotropy);
  const floorTex = createProceduralTexture('floor_tile', maxAnisotropy);
  const darkConcreteTex = createProceduralTexture('dark_concrete', maxAnisotropy);
  const posterStarTex = createProceduralTexture('poster_star', maxAnisotropy);
  const posterEyeTex = createProceduralTexture('poster_eye', maxAnisotropy);
  const metalRustTex = createProceduralTexture('metal_rust', maxAnisotropy);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: plasterTex,
    roughness: 0.88,
    metalness: 0.05,
  });

  const darkWallMat = new THREE.MeshStandardMaterial({
    color: 0x99a19a,
    map: darkConcreteTex,
    roughness: 0.92,
    metalness: 0.08,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorTex,
    roughness: 0.82,
    metalness: 0.06,
  });

  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x70756e,
    map: darkConcreteTex,
    roughness: 0.95,
    metalness: 0.02,
  });

  const redStarMat = new THREE.MeshStandardMaterial({
    color: 0xa8241d,
    roughness: 0.45,
    metalness: 0.25,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xb8964c,
    roughness: 0.35,
    metalness: 0.65,
  });

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5c4028,
    roughness: 0.78,
    metalness: 0.05,
  });

  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: metalRustTex,
    roughness: 0.55,
    metalness: 0.55,
  });

  const posterStarMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: posterStarTex,
    roughness: 0.7,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const posterEyeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: posterEyeTex,
    roughness: 0.7,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  // 7 Interconnected Rooms Definition
  // Layout covers X: [-23, 35], Z: [-52, 8]
  const rooms: RoomDefinition[] = [
    {
      id: 'giris_holu',
      name: '1. Giriş Holü (Kültür Sarayı Fuayesi)',
      minX: -9,
      maxX: 9,
      minZ: -8,
      maxZ: 8,
      height: 6.0,
      isDark: false,
      ambientHint: 'Soğuk mermer zemin ve kırık Sovyet yıldızı anıtı.',
    },
    {
      id: 'uzun_koridor',
      name: '2. Uzun Koridor ve Kat Asansörü',
      minX: -4,
      maxX: 4,
      minZ: -32,
      maxZ: -8,
      height: 4.5,
      isDark: false,
      ambientHint: 'Koridorun sonundaki duvarda yaşlı kadının anons yaptığı Sovyet Kat Asansörü.',
    },
    {
      id: 'eski_sinif',
      name: '3. Eski Sınıf ve Komiserlik Ofisi',
      minX: -23,
      maxX: -4,
      minZ: -28,
      maxZ: -2,
      height: 6.0,
      isDark: false,
      ambientHint: 'Devrik sıralar, kara tahta ve eski Sovyet daktilosu.',
    },
    {
      id: 'tiyatro_salonu',
      name: '4. Kızıl Yıldız Tiyatro Salonu',
      minX: -16,
      maxX: 6,
      minZ: -52,
      maxZ: -32,
      height: 7.0,
      isDark: false,
      ambientHint: 'Tozlu kadife perdeler, sahne kürsüsü ve yıkık koltuklar.',
    },
    {
      id: 'kazan_dairesi',
      name: '5. Karanlık Kazan Dairesi',
      minX: 4,
      maxX: 22,
      minZ: -44,
      maxZ: -22,
      height: 5.5,
      isDark: true,
      ambientHint: 'KARANLIK BÖLGE: Kömür kazanları, buhar boruları ve gaz maskesi sandığı.',
    },
    {
      id: 'merdiven_boslugu',
      name: '6. Doğu Merdiven Boşluğu ve Galeri',
      minX: 4,
      maxX: 20,
      minZ: -22,
      maxZ: 8,
      height: 6.5,
      isDark: false,
      ambientHint: 'Korkuluklu beton sahanlıklar ve gözetleme afişi.',
    },
    {
      id: 'cati_kati',
      name: '7. 2. Kat: Çatı Katı Gizli Arşiv Odası',
      minX: 20,
      maxX: 34,
      minZ: -26,
      maxZ: -2,
      height: 4.6,
      isDark: true,
      ambientHint: 'KARANLIK BÖLGE: Gizli telsiz istasyonu, paslı dolaplar ve arşiv rafları.',
    },
    {
      id: 'babushka_odasi',
      name: '8. Son Kat (3. Kat): Yaşlı Kadının (Babuşka) Odası',
      minX: 20,
      maxX: 34,
      minZ: -2,
      maxZ: 8,
      height: 4.6,
      isDark: false,
      ambientHint: 'Asansördeki yaşlı kadının odası: Matruşka koleksiyonu ve eski üniformalı fotoğrafları.',
    },
  ];

  // Helper to add a solid box with optional AABB collider
  const addBox = (
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    addCollider = true,
    tag = 'wall',
  ) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    levelGroup.add(mesh);
    if (addCollider) {
      colliders.push({
        minX: cx - sx / 2,
        maxX: cx + sx / 2,
        minY: cy - sy / 2,
        maxY: cy + sy / 2,
        minZ: cz - sz / 2,
        maxZ: cz + sz / 2,
        tag,
      });
    }
    return mesh;
  };

  // Build Floors & Ceilings for each room
  for (const r of rooms) {
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;

    // Floor slab
    addBox(cx, -0.1, cz, w, 0.2, d, floorMat, false);
    // Ceiling slab
    addBox(cx, r.height + 0.1, cz, w, 0.2, d, ceilingMat, false);
  }

  // Helper to build a wall along X or Z with optional doorway openings
  const wallThickness = 0.45;
  const doorHeight = 3.2;

  const addWallSegmentX = (
    x1: number,
    x2: number,
    z: number,
    height: number,
    mat: THREE.Material,
    doors: { center: number; width: number }[] = [],
  ) => {
    const sorted = [...doors].sort((a, b) => a.center - b.center);
    let cursor = x1;
    for (const door of sorted) {
      const dStart = door.center - door.width / 2;
      const dEnd = door.center + door.width / 2;
      if (dStart > cursor + 0.05) {
        const segW = dStart - cursor;
        addBox(cursor + segW / 2, height / 2, z, segW, height, wallThickness, mat, true);
      }
      // Door lintel above doorway
      if (height > doorHeight) {
        const lintelH = height - doorHeight;
        addBox(
          door.center,
          doorHeight + lintelH / 2,
          z,
          door.width,
          lintelH,
          wallThickness,
          mat,
          false,
        );
      }
      // Doorframe wooden/metal jambs on both sides
      addBox(dStart + 0.08, doorHeight / 2, z, 0.16, doorHeight, wallThickness + 0.08, woodMat, false);
      addBox(dEnd - 0.08, doorHeight / 2, z, 0.16, doorHeight, wallThickness + 0.08, woodMat, false);
      cursor = dEnd;
    }
    if (x2 > cursor + 0.05) {
      const segW = x2 - cursor;
      addBox(cursor + segW / 2, height / 2, z, segW, height, wallThickness, mat, true);
    }
  };

  const addWallSegmentZ = (
    z1: number,
    z2: number,
    x: number,
    height: number,
    mat: THREE.Material,
    doors: { center: number; width: number }[] = [],
  ) => {
    const sorted = [...doors].sort((a, b) => a.center - b.center);
    let cursor = z1;
    for (const door of sorted) {
      const dStart = door.center - door.width / 2;
      const dEnd = door.center + door.width / 2;
      if (dStart > cursor + 0.05) {
        const segD = dStart - cursor;
        addBox(x, height / 2, cursor + segD / 2, wallThickness, height, segD, mat, true);
      }
      if (height > doorHeight) {
        const lintelH = height - doorHeight;
        addBox(
          x,
          doorHeight + lintelH / 2,
          door.center,
          wallThickness,
          lintelH,
          door.width,
          mat,
          false,
        );
      }
      addBox(x, doorHeight / 2, dStart + 0.08, wallThickness + 0.08, doorHeight, 0.16, woodMat, false);
      addBox(x, doorHeight / 2, dEnd - 0.08, wallThickness + 0.08, doorHeight, 0.16, woodMat, false);
      cursor = dEnd;
    }
    if (z2 > cursor + 0.05) {
      const segD = z2 - cursor;
      addBox(x, height / 2, cursor + segD / 2, wallThickness, height, segD, mat, true);
    }
  };

  // --- Construct Perimeter & Interior Partition Walls with Loop Doorways ---
  // 1. Entrance Hall (giris_holu: X[-9, 9], Z[-8, 8])
  addWallSegmentX(-9, 9, 8, 6.0, wallMat, []); // South outer wall
  addWallSegmentZ(-2, 8, -9, 6.0, wallMat, []); // West outer lower
  addWallSegmentZ(2, 8, 9, 6.0, wallMat, []); // East outer lower
  // Partition between Entrance Hall & Corridor / Adjacent at Z = -8
  addWallSegmentX(-9, 9, -8, 6.0, wallMat, [{ center: 0, width: 3.8 }]);
  // Partition between Entrance Hall & Old Classroom along X = -9, Z[-8, -2] -> Door at Z = -5
  addWallSegmentZ(-8, -2, -9, 5.5, wallMat, [{ center: -5, width: 3.4 }]);
  // Partition between Entrance Hall & Stairwell along X = 9, Z[-8, 2] -> Door at Z = -3
  addWallSegmentZ(-8, 2, 9, 6.0, wallMat, [{ center: -3, width: 3.4 }]);

  // 2. Old Classroom (eski_sinif: X[-23, -4], Z[-28, -2])
  addWallSegmentX(-23, -9, -2, 4.5, wallMat, []); // South outer wall of classroom
  addWallSegmentZ(-28, -2, -23, 4.5, wallMat, []); // West outer wall of classroom
  addWallSegmentX(-23, -16, -28, 4.5, wallMat, []); // North-west outer wall
  // Partition between Classroom & Theater along Z = -28 / -32
  addWallSegmentZ(-32, -28, -16, 5.5, wallMat, []);
  addWallSegmentX(-16, -4, -28, 5.0, wallMat, [{ center: -10, width: 3.6 }]); // Door between Classroom & Theater/Corridor North
  // Partition between Classroom & Long Corridor along X = -4, Z[-32, -8] -> Doors at Z = -14 and Z = -24
  addWallSegmentZ(-32, -8, -4, 4.5, wallMat, [
    { center: -14, width: 3.4 },
    { center: -24, width: 3.4 },
  ]);

  // 3. Long Corridor (uzun_koridor: X[-4, 4], Z[-32, -8])
  // North end wall of Corridor at Z = -32 is SOLID at X[-4, 4] so the Elevator sits flush against its center (X = 0)!
  addWallSegmentX(-16, 6, -32, 6.5, wallMat, [
    { center: -10, width: 3.6 },
  ]);
  // East wall of Corridor along X = 4, Z[-32, -8] -> Connects to Stairwell (Z = -15) and Boiler Room (Z = -27)
  addWallSegmentZ(-32, -8, 4, 5.0, wallMat, [
    { center: -15, width: 3.4 },
    { center: -27, width: 3.4 },
  ]);

  // 4. Theater Hall (tiyatro_salonu: X[-16, 6], Z[-52, -32])
  addWallSegmentX(-16, 6, -52, 7.0, darkWallMat, []); // North back-of-stage wall
  addWallSegmentZ(-52, -32, -16, 7.0, darkWallMat, []); // West theater wall
  // East wall of Theater along X = 6, Z[-52, -32] -> Connects to Boiler Room at Z = -38
  addWallSegmentZ(-52, -32, 6, 7.0, darkWallMat, [{ center: -38, width: 3.4 }]);

  // 5. Boiler Room (kazan_dairesi: X[4, 22], Z[-44, -22])
  addWallSegmentX(6, 22, -44, 5.5, darkWallMat, []); // North boiler wall
  addWallSegmentZ(-44, -22, 22, 5.5, darkWallMat, []); // East boiler wall
  // Partition between Boiler Room & Stairwell along Z = -22, X[4, 20] -> Door at X = 12
  addWallSegmentX(4, 20, -22, 6.0, darkWallMat, [{ center: 12, width: 3.6 }]);

  // 6. Stairwell & Elevator Hall (merdiven_boslugu: X[4, 20], Z[-22, 8])
  addWallSegmentX(9, 20, 8, 6.5, wallMat, []); // South stairwell wall aligned with Entrance Hall
  // Partition between Stairwell & Attic Archive along X = 20, Z[-26, -2] -> Two loop doors at Z = -7 and Z = -18
  addWallSegmentZ(-26, -2, 20, 6.0, wallMat, [
    { center: -7, width: 3.4 },
    { center: -18, width: 3.4 },
  ]);
  // Partition between Elevator Hall & Top-Floor Babushka's Room along X = 20, Z[-2, 8] -> Door at Z = 3.0
  addWallSegmentZ(-2, 8, 20, 6.0, wallMat, [{ center: 3.0, width: 3.2 }]);

  // 7. Attic Archive (cati_kati: X[20, 34], Z[-26, -2])
  addWallSegmentX(20, 34, -2, 4.6, darkWallMat, [{ center: 26.5, width: 3.0 }]); // Connecting door between Archive & Babushka's Top Floor Room
  addWallSegmentX(20, 34, -26, 4.6, darkWallMat, []); // North attic wall
  addWallSegmentZ(-26, -2, 34, 4.6, darkWallMat, []); // East attic wall

  // 8. Top Floor Old Woman's Room (babushka_odasi: X[20, 34], Z[-2, 8])
  addWallSegmentX(20, 34, 8, 4.6, wallMat, []); // South wall of Babushka's room
  addWallSegmentZ(-2, 8, 34, 4.6, wallMat, []); // East wall of Babushka's room

  // --- Composite Soviet Props (3–12 parts each, bottom-center grounded) ---

  // Prop 1: Broken Soviet Red Star Monument in Giriş Holü (0, 0, 0)
  const starMonument = new THREE.Group();
  starMonument.position.set(0, 0, 0);
  // Tiered marble pedestal (3 parts)
  const pedBase = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 2.6), darkWallMat);
  pedBase.position.y = 0.175;
  const pedMid = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.85, 2.0), wallMat);
  pedMid.position.y = 0.775;
  const pedTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 2.2), brassMat);
  pedTop.position.y = 1.29;
  starMonument.add(pedBase, pedMid, pedTop);
  // Broken 5-point Star blades (5 parts, one fractured on pedestal)
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.35, 4), redStarMat);
    if (i === 1) {
      // Broken shard fallen onto pedestal
      blade.position.set(0.65, 1.48, 0.45);
      blade.rotation.set(Math.PI / 2.2, 0.4, 0.8);
    } else {
      const angle = (i * Math.PI * 2) / 5;
      blade.position.set(Math.sin(angle) * 0.45, 2.25 + Math.cos(angle) * 0.45, 0);
      blade.rotation.z = -angle;
    }
    starMonument.add(blade);
  }
  const centerMedallion = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.25, 8), brassMat);
  centerMedallion.rotation.x = Math.PI / 2;
  centerMedallion.position.set(0, 2.25, 0);
  starMonument.add(centerMedallion);
  levelGroup.add(starMonument);
  colliders.push({
    minX: -1.3,
    maxX: 1.3,
    minY: 0,
    maxY: 3.2,
    minZ: -1.3,
    maxZ: 1.3,
    tag: 'prop_star',
  });

  // Prop 2: Commissar Desk & Vintage Soviet Typewriter in Eski Sınıf (-16, 0, -14)
  const deskGroup = new THREE.Group();
  deskGroup.position.set(-16, 0, -14);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.2), woodMat);
  deskTop.position.y = 0.82;
  const deskLeft = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.76, 1.1), woodMat);
  deskLeft.position.set(-0.75, 0.38, 0);
  const deskRight = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.76, 1.1), woodMat);
  deskRight.position.set(0.75, 0.38, 0);
  // Typewriter (5 parts: body, platen roller, paper sheet, keybank, return lever)
  const twBody = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.42), metalMat);
  twBody.position.set(0, 0.97, 0);
  const twRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.56, 8), darkWallMat);
  twRoller.rotation.z = Math.PI / 2;
  twRoller.position.set(0, 1.1, -0.1);
  const twPaper = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.02), posterStarMat);
  twPaper.position.set(0, 1.22, -0.12);
  twPaper.rotation.x = -0.25;
  const twKeys = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.18), brassMat);
  twKeys.position.set(0, 0.94, 0.18);
  deskGroup.add(deskTop, deskLeft, deskRight, twBody, twRoller, twPaper, twKeys);
  levelGroup.add(deskGroup);
  colliders.push({
    minX: -17.1,
    maxX: -14.9,
    minY: 0,
    maxY: 1.4,
    minZ: -14.6,
    maxZ: -13.4,
    tag: 'prop_typewriter',
  });

  // Classroom Blackboard & Student Desks
  addBox(-22.65, 2.1, -14, 0.12, 1.8, 5.2, darkWallMat, false);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const dx = -12.5 + col * 3.2;
      const dz = -9 - row * 4.5;
      addBox(dx, 0.42, dz, 1.3, 0.84, 0.8, woodMat, true, 'desk');
    }
  }

  // Prop 3: Theater Stage, Podium, Red Curtains & Seating in Tiyatro Salonu (-5, 0, -47)
  const stagePlatform = addBox(-5, 0.45, -48.5, 16, 0.9, 6.2, woodMat, true, 'stage');
  void stagePlatform;
  // Walkable steps up to stage
  addBox(-5, 0.22, -45.0, 3.2, 0.44, 0.9, woodMat, false);
  // Stage Soviet Podium & Microphones (6 parts)
  const podiumGroup = new THREE.Group();
  podiumGroup.position.set(-5, 0.9, -47.5);
  const podBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.25, 0.75), redStarMat);
  podBody.position.y = 0.625;
  const podCrest = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 6), brassMat);
  podCrest.rotation.x = Math.PI / 2;
  podCrest.position.set(0, 0.8, 0.39);
  const micLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), metalMat);
  micLeft.position.set(-0.25, 1.4, 0.2);
  micLeft.rotation.x = 0.3;
  const micRight = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), metalMat);
  micRight.position.set(0.25, 1.4, 0.2);
  micRight.rotation.x = 0.3;
  podiumGroup.add(podBody, podCrest, micLeft, micRight);
  levelGroup.add(podiumGroup);
  // Tall Red Stage Curtains left and right
  addBox(-12.2, 3.8, -46.2, 2.2, 5.8, 0.4, redStarMat, false);
  addBox(2.2, 3.8, -46.2, 2.2, 5.8, 0.4, redStarMat, false);

  // Prop 4: Industrial Coal Boiler & Gas Masks Crate in Kazan Dairesi (14, 0, -34)
  const boilerGroup = new THREE.Group();
  boilerGroup.position.set(15.5, 0, -36);
  const boilerTank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.4, 10), metalMat);
  boilerTank.rotation.z = Math.PI / 2;
  boilerTank.position.set(0, 1.8, 0);
  const boilerLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 2.6), darkWallMat);
  boilerLeg1.position.set(-1.3, 0.4, 0);
  const boilerLeg2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 2.6), darkWallMat);
  boilerLeg2.position.set(1.3, 0.4, 0);
  const pipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 3.6, 8), brassMat);
  pipe1.position.set(-0.8, 3.8, 0);
  const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 3.6, 8), metalMat);
  pipe2.position.set(0.8, 3.8, 0);
  const furnaceDoor = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.2, 8), redStarMat);
  furnaceDoor.rotation.z = Math.PI / 2;
  furnaceDoor.position.set(-2.22, 1.8, 0);
  boilerGroup.add(boilerTank, boilerLeg1, boilerLeg2, pipe1, pipe2, furnaceDoor);
  levelGroup.add(boilerGroup);
  colliders.push({
    minX: 13.1,
    maxX: 17.9,
    minY: 0,
    maxY: 4.5,
    minZ: -37.7,
    maxZ: -34.3,
    tag: 'prop_boiler',
  });

  // Gas Masks on Military Crate in Kazan Dairesi (11.5, 0, -29.5)
  const maskCrateGroup = new THREE.Group();
  maskCrateGroup.position.set(11.5, 0, -29.5);
  const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.85, 1.1), woodMat);
  crateMesh.position.y = 0.425;
  maskCrateGroup.add(crateMesh);
  for (let m = 0; m < 3; m++) {
    const maskHead = new THREE.Mesh(new THREE.SphereGeometry(0.18, 7, 6), wallMat);
    maskHead.position.set(-0.4 + m * 0.4, 0.98, 0);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 6), metalMat);
    snout.rotation.x = Math.PI / 2.5;
    snout.position.set(-0.4 + m * 0.4, 0.9, 0.18);
    const goggleL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6), darkWallMat);
    goggleL.rotation.x = Math.PI / 2;
    goggleL.position.set(-0.46 + m * 0.4, 1.02, 0.16);
    const goggleR = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6), darkWallMat);
    goggleR.rotation.x = Math.PI / 2;
    goggleR.position.set(-0.34 + m * 0.4, 1.02, 0.16);
    maskCrateGroup.add(maskHead, snout, goggleL, goggleR);
  }
  levelGroup.add(maskCrateGroup);
  colliders.push({
    minX: 10.7,
    maxX: 12.3,
    minY: 0,
    maxY: 1.3,
    minZ: -30.1,
    maxZ: -28.9,
    tag: 'prop_gasmasks',
  });

  // Prop 5: Secret Radio Transmitter & Archive Shelves in Çatı Katı (28, 0, -14)
  const radioGroup = new THREE.Group();
  radioGroup.position.set(28.5, 0, -14);
  const radioTable = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.82, 1.1), woodMat);
  radioTable.position.y = 0.41;
  const radioUnit = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.55, 0.48), metalMat);
  radioUnit.position.set(-0.3, 1.08, 0);
  const dialLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), brassMat);
  dialLeft.rotation.x = Math.PI / 2;
  dialLeft.position.set(-0.5, 1.1, 0.25);
  const dialRight = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), redStarMat);
  dialRight.rotation.x = Math.PI / 2;
  dialRight.position.set(-0.1, 1.1, 0.25);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 1.4, 6), brassMat);
  antenna.position.set(0.45, 1.5, -0.15);
  const reelL = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 8), metalMat);
  reelL.rotation.x = Math.PI / 2;
  reelL.position.set(0.35, 1.15, 0.22);
  radioGroup.add(radioTable, radioUnit, dialLeft, dialRight, antenna, reelL);
  levelGroup.add(radioGroup);
  colliders.push({
    minX: 27.5,
    maxX: 29.5,
    minY: 0,
    maxY: 1.8,
    minZ: -14.6,
    maxZ: -13.4,
    tag: 'prop_radio',
  });

  // Prop 6: Hollow, Enterable Soviet Metal Lockers (Soyunma Dolapları - Hiding Spots) placed across rooms
  const lockerBadgeMat = new THREE.MeshStandardMaterial({
    color: 0xffd27d,
    emissive: 0xd97706,
    emissiveIntensity: 0.75,
    roughness: 0.35,
  });

  const addLockerBank = (
    id: string,
    roomId: string,
    x: number,
    z: number,
    rotY: number,
    label: string,
  ) => {
    const bank = new THREE.Group();
    bank.position.set(x, 0, z);
    bank.rotation.y = rotY;

    // Left and Right companion lockers flanking the hollow enterable center locker
    for (const side of [-1, 1]) {
      const sideX = side * 0.84;
      const sideBody = new THREE.Mesh(new THREE.BoxGeometry(0.64, 2.22, 0.86), metalMat);
      sideBody.position.set(sideX, 1.11, 0);
      const sideHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.06), brassMat);
      sideHandle.position.set(sideX + side * -0.18, 1.12, 0.45);
      bank.add(sideBody, sideHandle);
    }

    // Center Enterable Hollow Locker Cabinet (Width: 0.98m, Height: 2.22m, Depth: 0.88m)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.22, 0.06), darkWallMat);
    backWall.position.set(0, 1.11, -0.41);
    const leftInnerWall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.22, 0.88), metalMat);
    leftInnerWall.position.set(-0.47, 1.11, 0);
    const rightInnerWall = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.22, 0.88), metalMat);
    rightInnerWall.position.set(0.47, 1.11, 0);
    const bottomPlate = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.88), darkWallMat);
    bottomPlate.position.set(0, 0.04, 0);
    const topRoof = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 0.92), metalMat);
    topRoof.position.set(0, 2.18, 0);
    const upperHeader = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.14, 0.06), brassMat);
    upperHeader.position.set(0, 2.09, 0.42);
    const coatHook = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.12), brassMat);
    coatHook.position.set(0, 1.82, -0.34);

    bank.add(
      backWall,
      leftInnerWall,
      rightInnerWall,
      bottomPlate,
      topRoof,
      upperHeader,
      coatHook,
    );

    // Hinged Enterable Locker Door with Open Eye-Level Ventilation Louver Slits
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-0.46, 0, 0.43);

    // Lower solid door panel (y: 0.08 .. 1.32)
    const doorLower = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.24, 0.045), metalMat);
    doorLower.position.set(0.46, 0.7, 0);
    // Upper solid door header (y: 1.86 .. 2.04)
    const doorUpper = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.045), metalMat);
    doorUpper.position.set(0.46, 1.95, 0);
    // Left & Right vertical stiles framing the eye-level ventilation slits (y: 1.32 .. 1.86)
    const doorStileL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.56, 0.045), metalMat);
    doorStileL.position.set(0.055, 1.59, 0);
    const doorStileR = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.56, 0.045), metalMat);
    doorStileR.position.set(0.865, 1.59, 0);

    doorPivot.add(doorLower, doorUpper, doorStileL, doorStileR);

    // 5 Horizontal Louver Slats with real see-through gaps at player eye level (y: 1.36 .. 1.80)
    for (let s = 0; s < 5; s++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.032, 0.055), darkWallMat);
      slat.position.set(0.46, 1.37 + s * 0.105, 0);
      slat.rotation.x = 0.22;
      doorPivot.add(slat);
    }

    // Brass handle & glowing indicator tag on the enterable door
    const doorHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.09), brassMat);
    doorHandle.position.set(0.8, 1.12, 0.04);
    const doorBadge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.06), lockerBadgeMat);
    doorBadge.position.set(0.46, 1.95, 0.025);
    doorPivot.add(doorHandle, doorBadge);

    // Default slightly ajar angle (0.62 rad outward) so player sees it's an enterable locker
    const initialAngle = 0.62;
    doorPivot.rotation.y = -initialAngle;
    bank.add(doorPivot);

    levelGroup.add(bank);

    // Compute world-space inside & outside positions and outward facingYaw
    const outX = Math.sin(rotY);
    const outZ = Math.cos(rotY);
    const insidePosition = new THREE.Vector3(x + outX * 0.04, 0, z + outZ * 0.04);
    const outsidePosition = new THREE.Vector3(x + outX * 1.18, 0, z + outZ * 1.18);
    const facingYaw = rotY + Math.PI;

    hidingSpots.push({
      id,
      roomId,
      position: new THREE.Vector3(x, 0, z),
      insidePosition,
      outsidePosition,
      facingYaw,
      label,
      doorPivot,
      currentDoorAngle: initialAngle,
      targetDoorAngle: initialAngle,
    });
  };

  addLockerBank('hide_hol', 'giris_holu', -8.2, 5.5, Math.PI / 2, 'Giriş Holü Dolabı');
  addLockerBank('hide_koridor', 'uzun_koridor', -3.25, -20.0, Math.PI / 2, 'Koridor Soyunma Dolabı');
  addLockerBank('hide_sinif', 'eski_sinif', -22.2, -22.0, Math.PI / 2, 'Eski Sınıf Arşiv Dolabı');
  addLockerBank('hide_tiyatro', 'tiyatro_salonu', -15.2, -38.0, Math.PI / 2, 'Tiyatro Kulis Dolabı');
  addLockerBank('hide_kazan', 'kazan_dairesi', 21.2, -26.0, -Math.PI / 2, 'Kazan Dairesi Dolabı');
  addLockerBank('hide_merdiven', 'merdiven_boslugu', 19.2, -12.0, -Math.PI / 2, 'Merdiven Sahanlığı Dolabı');
  addLockerBank('hide_cati', 'cati_kati', 33.2, -8.0, -Math.PI / 2, 'Çatı Katı Arşiv Dolabı');

  // --- Soviet Propaganda Posters on Walls ---
  const addPoster = (x: number, y: number, z: number, rotY: number, isEye: boolean) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2.0),
      isEye ? posterEyeMat : posterStarMat,
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    levelGroup.add(mesh);
  };

  addPoster(-5.5, 2.6, -7.72, 0, false); // Entrance Hall North wall
  addPoster(5.5, 2.6, -7.72, 0, true); // Entrance Hall Watchful Eye poster
  addPoster(-3.72, 2.3, -11.0, Math.PI / 2, true); // Corridor West wall
  addPoster(3.72, 2.3, -21.0, -Math.PI / 2, false); // Corridor East wall
  addPoster(-14.0, 2.4, -2.28, Math.PI, false); // Classroom South wall
  addPoster(14.0, 2.8, 7.72, Math.PI, true); // Stairwell South wall ("Gözetleme Afişi")

  // --- Prop 7: Iconic Soviet Elevator Flush Against the Center of the Corridor North Wall (0, 0, -30.75) ---
  const elevatorSignTex = createProceduralTexture('elevator_sign', maxAnisotropy);
  const elevatorDoorTex = createProceduralTexture('elevator_door', maxAnisotropy);

  const elevatorSignMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: elevatorSignTex,
    emissive: 0xffb340,
    emissiveMap: elevatorSignTex,
    emissiveIntensity: 0.78,
    roughness: 0.35,
  });

  const elevatorDoorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: elevatorDoorTex,
    roughness: 0.45,
    metalness: 0.65,
  });

  const glowingAmberMat = new THREE.MeshStandardMaterial({
    color: 0xffd27d,
    emissive: 0xffa826,
    emissiveIntensity: 1.35,
    roughness: 0.25,
  });

  const glowingGreenMat = new THREE.MeshStandardMaterial({
    color: 0x7dff9b,
    emissive: 0x26e659,
    emissiveIntensity: 1.25,
    roughness: 0.25,
  });

  const glowingRedMat = new THREE.MeshStandardMaterial({
    color: 0xff6b5e,
    emissive: 0xe62919,
    emissiveIntensity: 1.35,
    roughness: 0.25,
  });

  const elevatorGroup = new THREE.Group();
  // Positioned flush against the center of the corridor's North end wall (X = 0, Z = -32)
  elevatorGroup.position.set(0, 0, -30.75);

  // 1. Heavy Concrete & Steel Shaft Portal Jambs (Left & Right Pillars + Top Transom Header)
  const leftShaftWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 4.45, 2.35), darkWallMat);
  leftShaftWall.position.set(-1.58, 2.225, 0.05);
  const rightShaftWall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 4.45, 2.35), darkWallMat);
  rightShaftWall.position.set(1.58, 2.225, 0.05);
  const backShaftWall = new THREE.Mesh(new THREE.BoxGeometry(3.48, 4.45, 0.16), darkWallMat);
  backShaftWall.position.set(0, 2.225, -1.02);

  // Front Brushed Steel & Brass Portal Architrave (Facing South +Z down the corridor)
  const leftBrassJamb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.35, 0.16), brassMat);
  leftBrassJamb.position.set(-1.38, 1.675, 1.24);
  const rightBrassJamb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.35, 0.16), brassMat);
  rightBrassJamb.position.set(1.38, 1.675, 1.24);
  const headerTransom = new THREE.Mesh(new THREE.BoxGeometry(3.52, 1.25, 0.34), metalMat);
  headerTransom.position.set(0, 3.82, 1.18);
  const headerBrassTrim = new THREE.Mesh(new THREE.BoxGeometry(3.58, 0.1, 0.38), brassMat);
  headerBrassTrim.position.set(0, 3.22, 1.18);

  // 2. Illuminated "▲ ASANSÖR ▼" & Floor Indicator Marquee Sign Above the Doors
  const signBox = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.78, 0.1), brassMat);
  signBox.position.set(0, 3.68, 1.37);
  const signFace = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 0.68), elevatorSignMat);
  signFace.position.set(0, 3.68, 1.43);

  // Classic Soviet Half-Moon Brass Floor Dial & Red Pointer Needle Above Sign
  const dialArch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.08, 12, 1, false, 0, Math.PI),
    brassMat,
  );
  dialArch.rotation.z = Math.PI / 2;
  dialArch.rotation.y = Math.PI / 2;
  dialArch.position.set(0, 4.12, 1.38);
  const dialNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), glowingRedMat);
  dialNeedle.position.set(-0.08, 4.22, 1.44);
  dialNeedle.rotation.z = 0.28;

  // Left & Right Glowing Arrival Lantern Globes on the Header
  const lanternLeft = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), glowingAmberMat);
  lanternLeft.position.set(-1.35, 3.68, 1.39);
  const lanternRight = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), glowingGreenMat);
  lanternRight.position.set(1.35, 3.68, 1.39);

  // 3. Exterior Elevator Call Button Box on the Right Pillar (Up ▲ / Down ▼ Buttons)
  const extCallPlate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.56, 0.08), brassMat);
  extCallPlate.position.set(1.56, 1.38, 1.26);
  const extUpBtn = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.09, 4), glowingGreenMat);
  extUpBtn.position.set(1.56, 1.49, 1.32);
  const extDownBtn = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.09, 4), glowingAmberMat);
  extDownBtn.rotation.z = Math.PI;
  extDownBtn.position.set(1.56, 1.28, 1.32);

  // 4. Walk-In Elevator Cabin Interior (Grooved Threshold, Red Carpet, Wood Panelling, Handrail, Control Panel, Intercom)
  const thresholdSill = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.06, 0.28), brassMat);
  thresholdSill.position.set(0, 0.03, 1.2);
  const cabinFloor = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.08, 2.2), metalMat);
  cabinFloor.position.set(0, 0.04, 0.05);
  const cabinCarpet = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 1.75), redStarMat);
  cabinCarpet.position.set(0, 0.09, 0.05);
  const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.16, 2.25), metalMat);
  cabinRoof.position.set(0, 3.22, 0.05);
  const cabinLightDiffuser = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.05, 0.95),
    glowingAmberMat,
  );
  cabinLightDiffuser.position.set(0, 3.12, 0.05);

  // Wood Wainscotting Panels & Brass Handrails Inside Cabin
  const backWoodPanel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 0.08), woodMat);
  backWoodPanel.position.set(0, 1.5, -0.9);
  const handrailBack = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), brassMat);
  handrailBack.rotation.z = Math.PI / 2;
  handrailBack.position.set(0, 1.02, -0.8);

  // Steel Hoist Cables Rising Above Cabin into Shaft
  const cableL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), metalMat);
  cableL.position.set(-0.35, 3.85, 0);
  const cableR = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), metalMat);
  cableR.position.set(0.35, 3.85, 0);

  // Interior Floor Control Panel (B1, K1, K2, K3 Illuminated Buttons) on Back Wall & Inner Front Jamb
  const intPanelBack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.95, 0.08), brassMat);
  intPanelBack.position.set(0.92, 1.45, -0.84);
  const intPanelFront = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.95, 0.08), brassMat);
  intPanelFront.position.set(1.12, 1.48, 1.06);
  for (let b = 0; b < 4; b++) {
    const bMat = b === 3 ? glowingRedMat : b === 1 ? glowingGreenMat : glowingAmberMat;
    const btnBack = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), bMat);
    btnBack.position.set(0.92, 1.15 + b * 0.19, -0.79);
    const btnFront = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.05), bMat);
    btnFront.position.set(1.12, 1.18 + b * 0.19, 1.01);
    elevatorGroup.add(btnBack, btnFront);
  }

  // Inner Illuminated Sign Above Doors Inside Cabin
  const innerSignFace = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.48), elevatorSignMat);
  innerSignFace.rotation.y = Math.PI;
  innerSignFace.position.set(0, 2.82, 1.01);
  elevatorGroup.add(innerSignFace);

  // Overhead PA Intercom Speakers (Where the Old Woman's Voice Comes From — Visible Outside & Inside)
  const speakerBack = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.14, 0.26, 8), redStarMat);
  speakerBack.rotation.x = Math.PI / 2;
  speakerBack.position.set(0, 2.38, -0.82);
  const speakerFront = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.13, 0.24, 8), redStarMat);
  speakerFront.rotation.x = -Math.PI / 2;
  speakerFront.position.set(-1.12, 2.28, 1.02);
  const speakerLed = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), glowingRedMat);
  speakerLed.position.set(0, 2.66, -0.82);

  // 5. Animated Double Sliding Metallic Elevator Doors (Sliding along X-axis at Z = 1.18)
  // Each door leaf has a vertical wired-glass inspection window glowing warmly from the cabin
  const elevatorDoorLeft = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 3.1, 0.12),
    elevatorDoorMat,
  );
  const leftWindow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.14), glowingAmberMat);
  leftWindow.position.set(0.22, 0.45, 0);
  const leftBumper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.1, 0.14), brassMat);
  leftBumper.position.set(0.57, 0, 0);
  elevatorDoorLeft.add(leftWindow, leftBumper);
  elevatorDoorLeft.position.set(-1.12, 1.55, 1.18);

  const elevatorDoorRight = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 3.1, 0.12),
    elevatorDoorMat,
  );
  const rightWindow = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.95, 0.14), glowingAmberMat);
  rightWindow.position.set(-0.22, 0.45, 0);
  const rightBumper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.1, 0.14), brassMat);
  rightBumper.position.set(-0.57, 0, 0);
  elevatorDoorRight.add(rightWindow, rightBumper);
  elevatorDoorRight.position.set(1.12, 1.55, 1.18);

  elevatorGroup.add(
    leftShaftWall,
    rightShaftWall,
    backShaftWall,
    leftBrassJamb,
    rightBrassJamb,
    headerTransom,
    headerBrassTrim,
    signBox,
    signFace,
    dialArch,
    dialNeedle,
    lanternLeft,
    lanternRight,
    extCallPlate,
    extUpBtn,
    extDownBtn,
    thresholdSill,
    cabinFloor,
    cabinCarpet,
    cabinRoof,
    cabinLightDiffuser,
    backWoodPanel,
    handrailBack,
    cableL,
    cableR,
    intPanelBack,
    intPanelFront,
    speakerBack,
    speakerFront,
    speakerLed,
    elevatorDoorLeft,
    elevatorDoorRight,
  );
  levelGroup.add(elevatorGroup);

  // Add AABB colliders for the left and right elevator shaft jambs so player walks cleanly through the center doors
  colliders.push(
    {
      minX: -1.8,
      maxX: -1.2,
      minY: 0,
      maxY: 4.5,
      minZ: -31.9,
      maxZ: -29.4,
      tag: 'elevator_shaft_left',
    },
    {
      minX: 1.2,
      maxX: 1.8,
      minY: 0,
      maxY: 4.5,
      minZ: -31.9,
      maxZ: -29.4,
      tag: 'elevator_shaft_right',
    },
  );

  // --- Prop 8: Top-Floor Room 8 — Old Woman (Babushka Valentina), Matryoshkas & Uniform Photos ---
  const uniformPortraitTex = createProceduralTexture('uniform_portrait', maxAnisotropy);
  const uniformPortraitMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: uniformPortraitTex,
    roughness: 0.55,
    metalness: 0.05,
  });

  // Babushka Valentina 3D Composite Character (10 parts: floral headscarf, silver hair, aged face, shawl, skirt, apron, arms, holding mini Matryoshka)
  const babushkaNpcGroup = new THREE.Group();
  babushkaNpcGroup.position.set(26.8, 0, 3.2);
  babushkaNpcGroup.rotation.y = -Math.PI / 2; // Facing the player entering from the elevator landing

  const bShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 10),
    new THREE.MeshBasicMaterial({ color: 0x050706, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  bShadow.rotation.x = -Math.PI / 2;
  bShadow.position.y = 0.015;
  const skirtMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.38, 0.82, 8),
    new THREE.MeshStandardMaterial({ color: 0x3b2d38, roughness: 0.85 }),
  );
  skirtMesh.position.y = 0.41;
  const apronMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.65, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xe6dec8, roughness: 0.8 }),
  );
  apronMesh.position.set(0, 0.44, -0.22);
  const shawlTorso = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.52, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x7c2329, roughness: 0.78 }),
  );
  shawlTorso.position.y = 1.04;
  const bHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xd9bda5, roughness: 0.75 }),
  );
  bHead.position.y = 1.44;
  // Red & Gold Traditional Babushka Headscarf
  const headscarf = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.32, 7),
    redStarMat,
  );
  headscarf.position.set(0, 1.52, 0.02);
  headscarf.rotation.x = 0.25;
  const bArmL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.46, 0.14), redStarMat);
  bArmL.position.set(-0.3, 0.98, -0.1);
  bArmL.rotation.x = -0.5;
  const bArmR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.46, 0.14), redStarMat);
  bArmR.position.set(0.3, 0.98, -0.15);
  bArmR.rotation.x = -0.75;
  // Held miniature Matryoshka in her outstretched hand
  const heldDoll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.18, 7), brassMat);
  heldDoll.position.set(0, -0.22, -0.08);
  bArmR.add(heldDoll);

  babushkaNpcGroup.add(bShadow, skirtMesh, apronMesh, shawlTorso, bHead, headscarf, bArmL, bArmR);
  levelGroup.add(babushkaNpcGroup);

  // Babushka's Display Table with 5 Nested Matryoshka Dolls & Uniform Photo Album (28.8, 0, 3.2)
  const bTableGroup = new THREE.Group();
  bTableGroup.position.set(28.8, 0, 3.2);
  const bTableTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 2.6), woodMat);
  bTableTop.position.y = 0.82;
  const bTableLeg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.78, 2.2), woodMat);
  bTableLeg.position.y = 0.39;
  const laceRunner = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.02, 2.3),
    new THREE.MeshStandardMaterial({ color: 0xdfd5bd, roughness: 0.7 }),
  );
  laceRunner.position.y = 0.88;
  bTableGroup.add(bTableTop, bTableLeg, laceRunner);

  // 5 Nested Matryoshka Dolls (Descending sizes from 1 to 5)
  for (let m = 0; m < 5; m++) {
    const scale = 1 - m * 0.16;
    const dollGroup = new THREE.Group();
    dollGroup.position.set(-0.2, 0.89, -0.85 + m * 0.36);
    const lowerBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13 * scale, 0.16 * scale, 0.28 * scale, 8),
      redStarMat,
    );
    lowerBody.position.y = 0.14 * scale;
    const bellyApron = new THREE.Mesh(
      new THREE.CylinderGeometry(0.135 * scale, 0.15 * scale, 0.16 * scale, 8),
      brassMat,
    );
    bellyApron.position.y = 0.14 * scale;
    const upperHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.115 * scale, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xf3dec0, roughness: 0.4 }),
    );
    upperHead.position.y = 0.32 * scale;
    const topHood = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 * scale, 8, 8),
      redStarMat,
    );
    topHood.position.set(0.02 * scale, 0.34 * scale, 0);
    dollGroup.add(lowerBody, bellyApron, upperHead, topHood);
    bTableGroup.add(dollGroup);
  }

  // Vintage Uniform Photo Frame standing on Table + Large Framed Uniform Portraits on Wall
  const tableFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.38), brassMat);
  tableFrame.position.set(0.15, 1.12, 0.65);
  tableFrame.rotation.z = 0.18;
  const tablePhoto = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), uniformPortraitMat);
  tablePhoto.rotation.y = -Math.PI / 2;
  tablePhoto.position.set(0.11, 1.12, 0.65);
  bTableGroup.add(tableFrame, tablePhoto);
  levelGroup.add(bTableGroup);

  // Two large framed vintage uniform portraits mounted on the East wall behind Babushka
  for (let p = 0; p < 2; p++) {
    const pz = 1.6 + p * 2.8;
    const wallFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.65, 1.35), brassMat);
    wallFrame.position.set(33.68, 2.35, pz);
    const wallPhoto = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.48), uniformPortraitMat);
    wallPhoto.rotation.y = -Math.PI / 2;
    wallPhoto.position.set(33.62, 2.35, pz);
    levelGroup.add(wallFrame, wallPhoto);
  }

  colliders.push({
    minX: 28.0,
    maxX: 29.6,
    minY: 0,
    maxY: 1.6,
    minZ: 1.8,
    maxZ: 4.6,
    tag: 'prop_matryoshka_table',
  });

  // --- Flickering Ceiling Lamps ---
  const lampConfigs: { x: number; y: number; z: number; intensity: number; speed: number; spark: boolean }[] = [
    { x: 0, y: 5.6, z: 0, intensity: 4.8, speed: 2.2, spark: false },
    { x: 0, y: 4.2, z: -13, intensity: 3.4, speed: 9.5, spark: true }, // Flickering corridor south lamp
    { x: 0, y: 4.2, z: -26.5, intensity: 4.6, speed: 2.4, spark: false }, // Warm lamp illuminating the Elevator at the end of the corridor
    { x: -14, y: 4.2, z: -14, intensity: 3.8, speed: 3.1, spark: false },
    { x: -5, y: 6.5, z: -43, intensity: 4.6, speed: 4.5, spark: false },
    { x: 27, y: 4.3, z: 3.2, intensity: 4.5, speed: 1.8, spark: false }, // Warm lamp in Top-Floor Babushka's Room
    { x: 14, y: 6.0, z: -2, intensity: 3.6, speed: 2.8, spark: false },
    { x: 14, y: 5.1, z: -34, intensity: 1.3, speed: 14.0, spark: true }, // Dim dying lamp in dark Boiler Room
    { x: 27, y: 4.3, z: -14, intensity: 1.1, speed: 12.0, spark: true }, // Dim dying lamp in dark Attic
  ];

  lampConfigs.forEach((cfg, idx) => {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), darkWallMat);
    cord.position.set(cfg.x, cfg.y + 0.2, cfg.z);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.22, 8), metalMat);
    shade.position.set(cfg.x, cfg.y, cfg.z);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffebb3,
      emissive: 0xffbe55,
      emissiveIntensity: 1.0,
      roughness: 0.2,
    });
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), bulbMat);
    bulbMesh.position.set(cfg.x, cfg.y - 0.1, cfg.z);
    levelGroup.add(cord, shade, bulbMesh);

    // Keep active PointLights within GPU/Software-WebGL budget (6 PointLights on primary rooms)
    const light = new THREE.PointLight(0xffd89b, cfg.intensity, 18, 1.7);
    light.position.set(cfg.x, cfg.y - 0.25, cfg.z);
    if (idx < 6) {
      levelGroup.add(light);
    }

    flickeringLamps.push({
      light,
      bulbMesh,
      bulbMat,
      baseIntensity: cfg.intensity,
      phase: idx * 1.7,
      flickerSpeed: cfg.speed,
      isBrokenSpark: cfg.spark,
    });
  });

  // --- Photo Zone Targets (Visible in F1 Debug Mode & Ready for Stage 3) ---
  photoTargets.push(
    {
      id: 'photo_star',
      title: 'Kırık Kızıl Yıldız Anıtı',
      roomId: 'giris_holu',
      roomName: 'Giriş Holü',
      position: new THREE.Vector3(0, 1.9, 0),
      idealViewDir: new THREE.Vector3(0, -0.05, -1).normalize(),
      toleranceDeg: 28,
      minDist: 3.0,
      maxDist: 9.0,
      requiresFlash: false,
      basePoints: 100,
      hintText: 'Giriş holündeki kırık yıldız anıtını güney cepheden fotoğrafla.',
    },
    {
      id: 'photo_poster_corridor',
      title: 'Gözetleyen Göz Propaganda Afişi',
      roomId: 'uzun_koridor',
      roomName: 'Uzun Koridor',
      position: new THREE.Vector3(-3.7, 2.3, -11.0),
      idealViewDir: new THREE.Vector3(-1, 0, 0).normalize(),
      toleranceDeg: 25,
      minDist: 2.0,
      maxDist: 6.5,
      requiresFlash: false,
      basePoints: 100,
      hintText: 'Uzun koridorun batı duvarındaki dev göz afişini karşıdan çek.',
    },
    {
      id: 'photo_typewriter',
      title: 'Komiserin Eski Daktilosu',
      roomId: 'eski_sinif',
      roomName: 'Eski Sınıf ve Ofis',
      position: new THREE.Vector3(-16, 1.05, -14),
      idealViewDir: new THREE.Vector3(-0.6, -0.2, 0.7).normalize(),
      toleranceDeg: 30,
      minDist: 1.8,
      maxDist: 6.0,
      requiresFlash: false,
      basePoints: 120,
      hintText: 'Eski sınıftaki ahşap masanın üzerindeki daktiloyu yakın mesafeden çek.',
    },
    {
      id: 'photo_stage',
      title: 'Tiyatro Sahnesi Kızıl Kürsü',
      roomId: 'tiyatro_salonu',
      roomName: 'Tiyatro Salonu',
      position: new THREE.Vector3(-5, 1.6, -47.5),
      idealViewDir: new THREE.Vector3(0, 0.05, -1).normalize(),
      toleranceDeg: 25,
      minDist: 4.0,
      maxDist: 11.5,
      requiresFlash: false,
      basePoints: 130,
      hintText: 'Tiyatro salonundaki sahne kürsüsünü tam karşıdan kadraja al.',
    },
    {
      id: 'photo_boiler',
      title: 'Karanlık Kömür Kazanı (Flaş Gerekli)',
      roomId: 'kazan_dairesi',
      roomName: 'Kazan Dairesi',
      position: new THREE.Vector3(15.5, 1.8, -36),
      idealViewDir: new THREE.Vector3(0.8, 0, -0.6).normalize(),
      toleranceDeg: 28,
      minDist: 3.0,
      maxDist: 8.5,
      requiresFlash: true,
      basePoints: 150,
      hintText: 'Karanlık kazan dairesindeki dev buhar kazanını FLAŞ açıkken çek.',
    },
    {
      id: 'photo_gasmasks',
      title: 'Sovyet Gaz Maskesi Sandığı (Flaş Gerekli)',
      roomId: 'kazan_dairesi',
      roomName: 'Kazan Dairesi',
      position: new THREE.Vector3(11.5, 0.95, -29.5),
      idealViewDir: new THREE.Vector3(0, -0.15, -1).normalize(),
      toleranceDeg: 30,
      minDist: 2.0,
      maxDist: 6.5,
      requiresFlash: true,
      basePoints: 140,
      hintText: 'Kazan dairesindeki sandık üstünde dizili gaz maskelerini fotoğrafla.',
    },
    {
      id: 'photo_stair_mural',
      title: 'Koridor Sonu Sovyet Kat Asansörü',
      roomId: 'uzun_koridor',
      roomName: 'Uzun Koridor',
      position: new THREE.Vector3(0.0, 2.2, -29.6),
      idealViewDir: new THREE.Vector3(0, 0.05, -1).normalize(),
      toleranceDeg: 28,
      minDist: 2.5,
      maxDist: 8.5,
      requiresFlash: false,
      basePoints: 120,
      hintText: 'Uzun koridorun sonundaki ışıklı Sovyet Kat Asansörünü karşıdan çek.',
    },
    {
      id: 'photo_radio',
      title: 'Çatı Katı Gizli Telsiz İstasyonu (Flaş Gerekli)',
      roomId: 'cati_kati',
      roomName: 'Çatı Katı Arşivi',
      position: new THREE.Vector3(28.5, 1.1, -14),
      idealViewDir: new THREE.Vector3(1, -0.1, 0).normalize(),
      toleranceDeg: 28,
      minDist: 2.0,
      maxDist: 6.5,
      requiresFlash: true,
      basePoints: 160,
      hintText: 'Çatı katı arşivindeki gizli Sovyet telsiz masasını flaşla çek.',
    },
    {
      id: 'photo_matryoshka_uniform',
      title: 'Babuşka\'nın Matruşkaları ve Eski Üniformalı Fotoğrafları',
      roomId: 'babushka_odasi',
      roomName: 'Son Kat: Yaşlı Kadının Odası',
      position: new THREE.Vector3(28.8, 1.15, 3.2),
      idealViewDir: new THREE.Vector3(1, -0.05, 0).normalize(),
      toleranceDeg: 32,
      minDist: 1.8,
      maxDist: 7.5,
      requiresFlash: false,
      basePoints: 200,
      hintText: 'Son kattaki yaşlı kadının odasında matruşka dizisini ve üniformalı gençlik fotoğraflarını çek.',
    },
  );

  // --- Waypoint Graph & Tour Stops ---
  const rawWaypoints: WaypointNode[] = [
    // Giriş Holü
    {
      id: 'wp_hol_south',
      x: 0,
      y: 0,
      z: 4.5,
      roomId: 'giris_holu',
      neighbors: ['wp_hol_east', 'wp_hol_west', 'wp_door_hol_koridor'],
      isTourStop: true,
      stopTitle: 'Durak 1: Kültür Sarayı Giriş Fuayesi',
      guideSpeech: [
        'Rehber Olga: "Yoldaş turistler, 1962 yapımı Kültür Sarayı fuayesine hoş geldiniz!"',
        'Rehber Olga: "Ortadaki Kırık Yıldız anıtına dikkat edin... lütfen gruptan ayrılmayın."',
        'Rehber Olga: "Binada güvenlik görevlisi devriye geziyor, koridorlarda tek başınıza dolaşmayın!"',
      ],
      lookTarget: { x: 0, y: 1.8, z: 0 },
    },
    {
      id: 'wp_hol_west',
      x: -5.5,
      y: 0,
      z: -3.5,
      roomId: 'giris_holu',
      neighbors: ['wp_hol_south', 'wp_door_hol_koridor', 'wp_door_hol_sinif'],
    },
    {
      id: 'wp_hol_east',
      x: 5.5,
      y: 0,
      z: -3.0,
      roomId: 'giris_holu',
      neighbors: ['wp_hol_south', 'wp_door_hol_koridor', 'wp_door_hol_merdiven'],
    },
    // Doors out of Giriş Holü
    {
      id: 'wp_door_hol_koridor',
      x: 0,
      y: 0,
      z: -8.0,
      roomId: 'uzun_koridor',
      neighbors: ['wp_hol_south', 'wp_hol_west', 'wp_hol_east', 'wp_koridor_south'],
    },
    {
      id: 'wp_door_hol_sinif',
      x: -9.0,
      y: 0,
      z: -5.0,
      roomId: 'eski_sinif',
      neighbors: ['wp_hol_west', 'wp_sinif_south'],
    },
    {
      id: 'wp_door_hol_merdiven',
      x: 9.0,
      y: 0,
      z: -3.0,
      roomId: 'merdiven_boslugu',
      neighbors: ['wp_hol_east', 'wp_merdiven_south'],
    },

    // Uzun Koridor
    {
      id: 'wp_koridor_south',
      x: 0,
      y: 0,
      z: -14.0,
      roomId: 'uzun_koridor',
      neighbors: ['wp_door_hol_koridor', 'wp_door_koridor_sinif1', 'wp_door_koridor_merdiven', 'wp_koridor_north'],
      isTourStop: true,
      stopTitle: 'Durak 2: Uzun Omurga Koridoru',
      guideSpeech: [
        'Rehber Olga: "Bu koridor binanın tüm kanatlarını birbirine bağlar."',
        'Rehber Olga: "Karşıda, koridorun sonundaki duvarın tam ortasında Sovyet Kat Asansörünü görebilirsiniz."',
        'Rehber Olga: "Şimdi batı kanadındaki eski komiserlik sınıfına geçiyoruz."',
      ],
      lookTarget: { x: 0, y: 2.2, z: -29.8 },
    },
    {
      id: 'wp_koridor_north',
      x: -1.3,
      y: 0,
      z: -23.5,
      roomId: 'uzun_koridor',
      neighbors: ['wp_koridor_south', 'wp_door_koridor_sinif2', 'wp_door_koridor_kazan'],
      isTourStop: true,
      stopTitle: 'Durak 6: Koridor Sonu — Sovyet Kat Asansörü (Yaşlı Kadının Sesi)',
      guideSpeech: [
        'Rehber Olga: "İşte koridorun sonundaki ünlü Sovyet Kat Asansörü! İçine girince yaşlı santral görevlisi kadının sesini duyacaksınız."',
        'Yaşlı Kadın (Asansör Hoparlörü): "Dikkat... Gideceğiniz katı seçin yavrum. Son kata çıkarsanız odama beklerim..."',
        'Rehber Olga: "Asansörle katlar arasında geçiş yapabilir veya son kattaki çatı odasına çıkabilirsiniz."',
      ],
      lookTarget: { x: 0, y: 2.0, z: -30.5 },
    },
    {
      id: 'wp_door_koridor_sinif1',
      x: -4.0,
      y: 0,
      z: -14.0,
      roomId: 'eski_sinif',
      neighbors: ['wp_koridor_south', 'wp_sinif_center'],
    },
    {
      id: 'wp_door_koridor_sinif2',
      x: -4.0,
      y: 0,
      z: -24.0,
      roomId: 'eski_sinif',
      neighbors: ['wp_koridor_north', 'wp_sinif_north'],
    },

    // Eski Sınıf / Ofis
    {
      id: 'wp_sinif_south',
      x: -13.0,
      y: 0,
      z: -7.0,
      roomId: 'eski_sinif',
      neighbors: ['wp_door_hol_sinif', 'wp_sinif_center'],
    },
    {
      id: 'wp_sinif_center',
      x: -13.5,
      y: 0,
      z: -14.0,
      roomId: 'eski_sinif',
      neighbors: ['wp_sinif_south', 'wp_door_koridor_sinif1', 'wp_sinif_north'],
      isTourStop: true,
      stopTitle: 'Durak 3: Eski Sınıf ve Komiserlik Ofisi',
      guideSpeech: [
        'Rehber Olga: "Burası teorik eğitim sınıfı ve başkomiserin çalışma masasıydı."',
        'Rehber Olga: "Masadaki orijinal daktiloya dokunmak kesinlikle yasaktır!"',
        'Rehber Olga: "Birazdan kuzey kapısından Kızıl Yıldız Tiyatro Salonu\'na ilerleyeceğiz."',
      ],
      lookTarget: { x: -16, y: 1.1, z: -14 },
    },
    {
      id: 'wp_sinif_north',
      x: -11.0,
      y: 0,
      z: -23.5,
      roomId: 'eski_sinif',
      neighbors: ['wp_sinif_center', 'wp_door_koridor_sinif2', 'wp_door_sinif_tiyatro'],
    },
    {
      id: 'wp_door_sinif_tiyatro',
      x: -10.0,
      y: 0,
      z: -30.0,
      roomId: 'tiyatro_salonu',
      neighbors: ['wp_sinif_north', 'wp_tiyatro_west'],
    },

    // Tiyatro Salonu
    {
      id: 'wp_tiyatro_west',
      x: -9.5,
      y: 0,
      z: -38.0,
      roomId: 'tiyatro_salonu',
      neighbors: ['wp_door_sinif_tiyatro', 'wp_tiyatro_center'],
    },
    {
      id: 'wp_tiyatro_center',
      x: -4.5,
      y: 0,
      z: -40.5,
      roomId: 'tiyatro_salonu',
      neighbors: ['wp_tiyatro_west', 'wp_door_tiyatro_kazan'],
      isTourStop: true,
      stopTitle: 'Durak 4: Kızıl Yıldız Tiyatro Salonu',
      guideSpeech: [
        'Rehber Olga: "İşte binanın kalbi: 400 kişilik büyük konferans ve tiyatro salonu!"',
        'Rehber Olga: "Sahnedeki kızıl kürsüde yıllarca resmi tören konuşmaları yapıldı."',
        'Rehber Olga: "Sıradaki durağımız biraz karanlık olan Kazan Dairesi, adımlarınıza dikkat edin."',
      ],
      lookTarget: { x: -5, y: 1.8, z: -47.5 },
    },
    {
      id: 'wp_door_tiyatro_kazan',
      x: 6.0,
      y: 0,
      z: -38.0,
      roomId: 'kazan_dairesi',
      neighbors: ['wp_tiyatro_center', 'wp_kazan_north'],
    },

    // Kazan Dairesi
    {
      id: 'wp_door_koridor_kazan',
      x: 4.0,
      y: 0,
      z: -27.0,
      roomId: 'kazan_dairesi',
      neighbors: ['wp_koridor_north', 'wp_kazan_center'],
    },
    {
      id: 'wp_kazan_north',
      x: 11.0,
      y: 0,
      z: -36.5,
      roomId: 'kazan_dairesi',
      neighbors: ['wp_door_tiyatro_kazan', 'wp_kazan_center'],
    },
    {
      id: 'wp_kazan_center',
      x: 11.5,
      y: 0,
      z: -28.0,
      roomId: 'kazan_dairesi',
      neighbors: ['wp_kazan_north', 'wp_door_koridor_kazan', 'wp_door_kazan_merdiven'],
      isTourStop: true,
      stopTitle: 'Durak 5: Karanlık Kazan Dairesi',
      guideSpeech: [
        'Rehber Olga: "Öhö öhö... Burası oldukça tozlu ve karanlık, lütfen birbirinizi kaybetmeyin."',
        'Rehber Olga: "Dev kömür kazanı ve acil durum gaz maskeleri hâlâ bıraktıkları yerde duruyor."',
        'Rehber Olga: "Şimdi koridorun sonundaki Sovyet Kat Asansörüne doğru geçiyoruz, gruba yakın kalın!"',
      ],
      lookTarget: { x: 15.5, y: 1.8, z: -36.0 },
    },
    {
      id: 'wp_door_kazan_merdiven',
      x: 12.0,
      y: 0,
      z: -22.0,
      roomId: 'merdiven_boslugu',
      neighbors: ['wp_kazan_center', 'wp_merdiven_north'],
    },

    // Merdiven Boşluğu
    {
      id: 'wp_door_koridor_merdiven',
      x: 4.0,
      y: 0,
      z: -15.0,
      roomId: 'merdiven_boslugu',
      neighbors: ['wp_koridor_south', 'wp_merdiven_north'],
    },
    {
      id: 'wp_merdiven_north',
      x: 12.5,
      y: 0,
      z: -15.5,
      roomId: 'merdiven_boslugu',
      neighbors: ['wp_door_kazan_merdiven', 'wp_door_koridor_merdiven', 'wp_merdiven_south', 'wp_door_merdiven_cati2'],
    },
    {
      id: 'wp_merdiven_south',
      x: 13.0,
      y: 0,
      z: -2.0,
      roomId: 'merdiven_boslugu',
      neighbors: ['wp_merdiven_north', 'wp_door_hol_merdiven', 'wp_door_merdiven_cati1', 'wp_door_babushka'],
    },

    // Çatı Katı / Arşiv
    {
      id: 'wp_door_merdiven_cati1',
      x: 20.0,
      y: 0,
      z: -7.0,
      roomId: 'cati_kati',
      neighbors: ['wp_merdiven_south', 'wp_cati_south'],
    },
    {
      id: 'wp_door_merdiven_cati2',
      x: 20.0,
      y: 0,
      z: -18.0,
      roomId: 'cati_kati',
      neighbors: ['wp_merdiven_north', 'wp_cati_north'],
    },
    {
      id: 'wp_cati_south',
      x: 25.0,
      y: 0,
      z: -8.5,
      roomId: 'cati_kati',
      neighbors: ['wp_door_merdiven_cati1', 'wp_cati_center', 'wp_babushka_oda'],
    },
    {
      id: 'wp_cati_center',
      x: 25.5,
      y: 0,
      z: -14.0,
      roomId: 'cati_kati',
      neighbors: ['wp_cati_south', 'wp_cati_north'],
      isTourStop: true,
      stopTitle: 'Durak 7: 2. Kat — Gizli Arşiv Odası',
      guideSpeech: [
        'Rehber Olga: "Şşşt! Burası eski dinleme ve arşiv odası, polis memuru görmeden inceleyin."',
        'Rehber Olga: "Masadaki telsiz cihazları Soğuk Savaş döneminden kalma."',
        'Rehber Olga: "Şimdi asansörle veya koridor kapısından Son Kat\'a, yaşlı kadının odasına geçiyoruz!"',
      ],
      lookTarget: { x: 28.5, y: 1.1, z: -14.0 },
    },
    {
      id: 'wp_cati_north',
      x: 25.0,
      y: 0,
      z: -18.5,
      roomId: 'cati_kati',
      neighbors: ['wp_cati_center', 'wp_door_merdiven_cati2'],
    },

    // Son Kat (3. Kat): Yaşlı Kadının (Babuşka Valentina) Odası
    {
      id: 'wp_door_babushka',
      x: 20.0,
      y: 0,
      z: 3.0,
      roomId: 'babushka_odasi',
      neighbors: ['wp_merdiven_south', 'wp_babushka_oda'],
    },
    {
      id: 'wp_babushka_oda',
      x: 24.5,
      y: 0,
      z: 3.0,
      roomId: 'babushka_odasi',
      neighbors: ['wp_door_babushka', 'wp_cati_south'],
      isTourStop: true,
      stopTitle: 'Durak 8 (Son Kat): Yaşlı Kadının Odası — Matruşka ve Üniformalı Fotoğraflar',
      guideSpeech: [
        'Yaşlı Kadın (Babuşka Valentina): "Son kata hoş geldiniz yavrularım... Asansörde sesimi duyanlar beni buldu!"',
        'Yaşlı Kadın (Babuşka Valentina): "Bakın, masanın üstünde 5\'li Sovyet matruşkalarım ve duvarda gençliğimdeki üniformalı fotoğraflarım var."',
        'Yaşlı Kadın (Babuşka Valentina): "G tuşuna basarak matruşkalarımı ve eski üniformalı albümümü yakından inceleyebilirsiniz."',
      ],
      lookTarget: { x: 28.8, y: 1.3, z: 3.2 },
    },
  ];

  const waypoints = new Map<string, WaypointNode>();
  for (const wp of rawWaypoints) {
    waypoints.set(wp.id, wp);
  }

  const tourStopOrder = [
    'wp_hol_south',
    'wp_koridor_south',
    'wp_sinif_center',
    'wp_tiyatro_center',
    'wp_kazan_center',
    'wp_koridor_north',
    'wp_cati_center',
    'wp_babushka_oda',
  ];

  // --- Stage 6 Atmosphere Polish: Floating 3D Dust Motes Across the Soviet Halls ---
  const dustCount = 340;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    // Deterministic pseudo-random distribution across the building footprint
    const h1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const h2 = Math.sin(i * 93.9898 + 19.135) * 23421.6312;
    const h3 = Math.sin(i * 45.1642 + 51.789) * 65432.1234;
    const rx = h1 - Math.floor(h1);
    const ry = h2 - Math.floor(h2);
    const rz = h3 - Math.floor(h3);

    dustPositions[i * 3] = -20 + rx * 52; // X: -20 .. +32
    dustPositions[i * 3 + 1] = 0.35 + ry * 3.8; // Y: 0.35 .. 4.15
    dustPositions[i * 3 + 2] = -42 + rz * 50; // Z: -42 .. +8
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xd8cdb4,
    size: 0.085,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const dustParticles = new THREE.Points(dustGeo, dustMat);
  levelGroup.add(dustParticles);

  return {
    levelGroup,
    colliders,
    rooms,
    waypoints,
    tourStopOrder,
    flickeringLamps,
    photoTargets,
    hidingSpots,
    elevatorDoorLeft,
    elevatorDoorRight,
    babushkaNpcGroup,
    dustParticles,
  };
}

/**
 * Determines which room the given (x, z) coordinates belong to.
 */
export function findRoomAtPosition(
  rooms: RoomDefinition[],
  x: number,
  z: number,
): RoomDefinition {
  for (const r of rooms) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
      return r;
    }
  }
  return rooms[0];
}
