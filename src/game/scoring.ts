/**
 * Photo Scoring, Raycast Line-of-Sight Obstruction, Rank Evaluation,
 * Score Code (Seed + Score) & Local Leaderboard Module ("Son Tur" — Stage 3 & 5).
 * Pure, deterministic evaluation functions (0–100 quality score, < 60 invalid).
 */

import { DifficultyLevel, GAME_CONFIG } from './config';
import type { AABBBox } from './level';
import type { PlayerObstacleCylinder } from './player';

export type JournalistRank = 'Amatör' | 'Muhabir' | 'Usta';

export interface JournalistRankMeta {
  rank: JournalistRank;
  fullTitleTr: string;
  descriptionTr: string;
  nextRankMinScore: number | null;
}

export interface ScoreCodeInput {
  seed: string;
  difficulty: DifficultyLevel;
  totalScore: number;
  completedTasks: number;
  totalTasks: number;
  photosCount?: number;
}

export interface ParsedScoreCodeResult {
  isScoreCode: boolean;
  validChecksum: boolean;
  seed: string;
  difficulty?: DifficultyLevel;
  claimedScore?: number;
  claimedRank?: JournalistRank;
  completedTasks?: number;
  totalTasks?: number;
}

export interface LeaderboardEntry {
  id: string;
  seed: string;
  difficulty: DifficultyLevel;
  totalScore: number;
  rank: JournalistRank;
  completedTasks: number;
  totalTasks: number;
  photosCount: number;
  livesRemaining: number;
  outcome: 'tour_finished' | 'caught_by_police';
  scoreCode: string;
  createdAtIso: string;
  dateLabelTr: string;
}


export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface RayObstructionResult {
  obstructed: boolean;
  blockerType: 'none' | 'wall' | 'npc';
}

export interface PhotoShotInput {
  ndcX: number;
  ndcY: number;
  inFrontOfCamera: boolean;
  viewAngleDiffDeg: number;
  toleranceDeg: number;
  distanceMeters: number;
  minDist: number;
  maxDist: number;
  obstructedBy: 'none' | 'wall' | 'npc';
  playerSpeed: number;
  requiresFlash: boolean;
  flashUsed: boolean;
  remainingTimeRatio: number;
  basePoints: number;
}

export interface PhotoEvaluationResult {
  qualityScore: number; // 0 to 100
  isValid: boolean; // >= 60
  awardedPoints: number;
  framingScore: number; // 0 to 35
  angleScore: number; // 0 to 20
  distanceScore: number; // 0 to 20
  flashScore: number; // 0 to 15
  timingBonus: number; // 0 to 10
  motionBlurPenalty: number; // 0 to 22
  obstructionPenalty: number; // 0 to 65
  feedbackTr: string;
}

/**
 * Checks whether a 3D line segment from `origin` to `target` is blocked by any wall AABB
 * or any tourist NPC cylinder.
 */
export function checkRayObstruction(
  origin: Vec3Like,
  target: Vec3Like,
  colliders: AABBBox[],
  npcObstacles: PlayerObstacleCylinder[],
): RayObstructionResult {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const segLen = Math.hypot(dx, dy, dz);
  if (segLen < 0.05) {
    return { obstructed: false, blockerType: 'none' };
  }

  // 1. Check wall AABBs (stop slightly before target endpoint so wall-mounted posters don't self-occlude)
  const maxT = Math.max(0.05, (segLen - 0.38) / segLen);
  for (let i = 0; i < colliders.length; i++) {
    const box = colliders[i];
    if (box.tag && box.tag !== 'wall') continue;

    let tmin = 0.02;
    let tmax = maxT;

    // X slab
    if (Math.abs(dx) < 1e-6) {
      if (origin.x < box.minX || origin.x > box.maxX) continue;
    } else {
      const invX = 1 / dx;
      let t1 = (box.minX - origin.x) * invX;
      let t2 = (box.maxX - origin.x) * invX;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    // Y slab
    if (Math.abs(dy) < 1e-6) {
      if (origin.y < box.minY || origin.y > box.maxY) continue;
    } else {
      const invY = 1 / dy;
      let t1 = (box.minY - origin.y) * invY;
      let t2 = (box.maxY - origin.y) * invY;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    // Z slab
    if (Math.abs(dz) < 1e-6) {
      if (origin.z < box.minZ || origin.z > box.maxZ) continue;
    } else {
      const invZ = 1 / dz;
      let t1 = (box.minZ - origin.z) * invZ;
      let t2 = (box.maxZ - origin.z) * invZ;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }

    return { obstructed: true, blockerType: 'wall' };
  }

  // 2. Check Tourist NPC Cylinders (XZ segment distance + Y height check [0, 1.82])
  const lenSqXZ = dx * dx + dz * dz;
  if (lenSqXZ > 0.01) {
    for (let i = 0; i < npcObstacles.length; i++) {
      const npc = npcObstacles[i];
      const t = ((npc.x - origin.x) * dx + (npc.z - origin.z) * dz) / lenSqXZ;
      if (t <= 0.05 || t >= 0.96) continue;
      const closestX = origin.x + t * dx;
      const closestZ = origin.z + t * dz;
      const closestY = origin.y + t * dy;
      const distXZ = Math.hypot(npc.x - closestX, npc.z - closestZ);
      if (distXZ < npc.radius + 0.12 && closestY >= 0 && closestY <= 1.82) {
        return { obstructed: true, blockerType: 'npc' };
      }
    }
  }

  return { obstructed: false, blockerType: 'none' };
}

/**
 * Evaluates a single photo shot on a 0–100 scale based on framing/centering, view angle,
 * distance, line-of-sight obstruction, player motion blur, flash usage, and timing bonus.
 * Scores below 60 are marked invalid (`isValid = false`).
 */
export function evaluatePhotoShot(input: PhotoShotInput): PhotoEvaluationResult {
  if (
    !input.inFrontOfCamera ||
    Math.abs(input.ndcX) > 1.05 ||
    Math.abs(input.ndcY) > 1.05
  ) {
    return {
      qualityScore: 0,
      isValid: false,
      awardedPoints: 0,
      framingScore: 0,
      angleScore: 0,
      distanceScore: 0,
      flashScore: 0,
      timingBonus: 0,
      motionBlurPenalty: 0,
      obstructionPenalty: 0,
      feedbackTr: 'Geçersiz: Hedef nesne kadrajda değil!',
    };
  }

  // 1. Framing & Centering Score (0–35 pts)
  const radialOffset = Math.hypot(input.ndcX, input.ndcY);
  let framingScore = 0;
  if (radialOffset <= 0.18) {
    framingScore = 35;
  } else {
    const norm = Math.min(1, (radialOffset - 0.18) / 0.95);
    framingScore = Math.round(35 - norm * 25);
  }

  // 2. View Angle Alignment Score (0–20 pts)
  let angleScore = 0;
  const tol = Math.max(15, input.toleranceDeg);
  if (input.viewAngleDiffDeg <= tol) {
    angleScore = Math.round(20 - (input.viewAngleDiffDeg / tol) * 4);
  } else if (input.viewAngleDiffDeg <= tol * 2.4) {
    const overRatio = (input.viewAngleDiffDeg - tol) / (tol * 1.4);
    angleScore = Math.round(16 - overRatio * 10);
  } else {
    angleScore = 5;
  }

  // 3. Distance Range Score (0–20 pts)
  let distanceScore = 0;
  if (input.distanceMeters >= input.minDist && input.distanceMeters <= input.maxDist) {
    distanceScore = 20;
  } else {
    const err =
      input.distanceMeters < input.minDist
        ? input.minDist - input.distanceMeters
        : input.distanceMeters - input.maxDist;
    if (err <= 4.0) {
      distanceScore = Math.max(4, Math.round(20 - (err / 4.0) * 16));
    } else {
      distanceScore = 0;
    }
  }

  // 4. Flash & Darkness Score (0–15 pts + darkness penalty if required flash is missing)
  let flashScore = 15;
  let darknessPenalty = 0;
  if (input.requiresFlash) {
    if (input.flashUsed) {
      flashScore = 15;
    } else {
      flashScore = 0;
      darknessPenalty = 28;
    }
  }

  // 5. Timing Bonus (0–10 pts)
  const clampedTimeRatio = Math.max(0, Math.min(1, input.remainingTimeRatio));
  const timingBonus = Math.round(clampedTimeRatio * 10);

  // 6. Motion Blur Penalty (0–22 pts based on player movement speed)
  let motionBlurPenalty = 0;
  if (input.playerSpeed > 0.65) {
    const speedRatio = Math.min(1, (input.playerSpeed - 0.65) / 6.5);
    motionBlurPenalty = Math.round(6 + speedRatio * 16);
  }

  // 7. Line-of-Sight Obstruction Penalty (Wall or Tourist NPC)
  let obstructionPenalty = 0;
  if (input.obstructedBy === 'wall') {
    obstructionPenalty = 65;
  } else if (input.obstructedBy === 'npc') {
    obstructionPenalty = 42;
  }

  const rawTotal =
    framingScore +
    angleScore +
    distanceScore +
    flashScore +
    timingBonus -
    darknessPenalty -
    motionBlurPenalty -
    obstructionPenalty;

  const qualityScore = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const isValid = qualityScore >= GAME_CONFIG.photoCamera.minPassingScore;
  const awardedPoints = isValid
    ? Math.round(input.basePoints * (qualityScore / 100))
    : 0;

  // Determine clear Turkish feedback message
  let feedbackTr = 'Mükemmel çekim! Görev tamamlandı.';
  if (input.obstructedBy === 'wall') {
    feedbackTr = 'Geçersiz: Hedef ile kamera arasında duvar engeli var!';
  } else if (input.obstructedBy === 'npc') {
    feedbackTr = 'Görüş hattında turist NPC var, kadraj kapandı!';
  } else if (input.requiresFlash && !input.flashUsed) {
    feedbackTr = 'Karanlık bölge: Flaş [R] açık olmalıydı!';
  } else if (!isValid && distanceScore < 8) {
    feedbackTr =
      input.distanceMeters < input.minDist
        ? 'Geçersiz: Hedefe çok yakınsın, biraz geri çekil!'
        : 'Geçersiz: Hedefe çok uzaksın, daha fazla yaklaş!';
  } else if (!isValid && motionBlurPenalty >= 12) {
    feedbackTr = 'Geçersiz: Hareket bulanıklığı! Çekerken sabit dur.';
  } else if (!isValid) {
    feedbackTr = 'Geçersiz: Hedefi vizörün merkezine al ve açıyı düzelt (<60 puan).';
  } else if (motionBlurPenalty >= 8) {
    feedbackTr = 'Geçerli çekim (Hafif hareket bulanıklığı puan kırdı).';
  } else if (qualityScore >= 88) {
    feedbackTr = 'Usta İşi Kusursuz Kare! (+Zamanlama ve Merkezleme Bonusu)';
  }

  return {
    qualityScore,
    isValid,
    awardedPoints,
    framingScore,
    angleScore,
    distanceScore,
    flashScore,
    timingBonus,
    motionBlurPenalty,
    obstructionPenalty,
    feedbackTr,
  };
}

export function evaluateJournalistRank(totalScore: number): JournalistRank {
  if (totalScore >= GAME_CONFIG.scoring.ustaMinScore) return 'Usta';
  if (totalScore >= GAME_CONFIG.scoring.muhabirMinScore) return 'Muhabir';
  return 'Amatör';
}

export function getJournalistRankMeta(totalScore: number): JournalistRankMeta {
  const rank = evaluateJournalistRank(totalScore);
  if (rank === 'Usta') {
    return {
      rank: 'Usta',
      fullTitleTr: 'USTA (Usta Belgeselci)',
      descriptionTr:
        'Kusursuz kadraj ve soğukkanlı gizlilik! Kültür Sarayı’nın tüm karanlık arşivlerini Pulitzer kalitesinde belgeledin.',
      nextRankMinScore: null,
    };
  }
  if (rank === 'Muhabir') {
    return {
      rank: 'Muhabir',
      fullTitleTr: 'MUHABİR (Gizli Foto Muhabiri)',
      descriptionTr:
        'Başarılı saha haberciliği! Polis Memuru İgor’un devriyesine rağmen kritik kanıt karelerini gazeteye yetiştirdin.',
      nextRankMinScore: GAME_CONFIG.scoring.ustaMinScore,
    };
  }
  return {
    rank: 'Amatör',
    fullTitleTr: 'AMATÖR (Turist Fotoğrafçısı)',
    descriptionTr:
      'Kadrajların çoğu bulanık veya eksik kaldı. Bir sonraki turda vizör merkezlemesine, mesafeye ve karanlıkta flaş [R] kullanımına dikkat et.',
    nextRankMinScore: GAME_CONFIG.scoring.muhabirMinScore,
  };
}

/**
 * Deterministic 2-hex-character checksum for score codes so players can verify & share runs.
 */
export function computeScoreCodeChecksum(corePayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < corePayload.length; i++) {
    hash ^= corePayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const byte = (hash >>> 0) & 0xff;
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Generates a shareable "Skor Kodu" combining Seed + Difficulty + Score + Rank + Tasks + Checksum.
 * Format: `ST:<SEED>:<K|N|Z>:<PUAN>:<AMATOR|MUHABIR|USTA>:<TAMAMLANAN>/<TOPLAM>:<CRC>`
 */
export function generateScoreCode(input: ScoreCodeInput): string {
  const cleanSeed =
    (input.seed || GAME_CONFIG.defaultSeed)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .slice(0, 24) || GAME_CONFIG.defaultSeed;

  const diffCode =
    input.difficulty === 'easy' ? 'K' : input.difficulty === 'hard' ? 'Z' : 'N';
  const scoreClamped = Math.max(0, Math.round(input.totalScore));
  const scoreStr = String(scoreClamped).padStart(4, '0');
  const rank = evaluateJournalistRank(scoreClamped);
  const rankAscii =
    rank === 'Usta' ? 'USTA' : rank === 'Muhabir' ? 'MUHABIR' : 'AMATOR';
  const tasksStr = `${Math.max(0, input.completedTasks)}/${Math.max(1, input.totalTasks)}`;

  const core = `ST:${cleanSeed}:${diffCode}:${scoreStr}:${rankAscii}:${tasksStr}`;
  const crc = computeScoreCodeChecksum(core);
  return `${core}:${crc}`;
}

/**
 * Parses either a full "Skor Kodu" (`ST:SOVYET-1984:N:0640:USTA:7/9:A4`) or a plain seed string.
 * Allows players to paste a friend's Score Code into the Seed box to load the exact Seed & Difficulty.
 */
export function parseScoreCode(rawInput: string): ParsedScoreCodeResult {
  const trimmed = (rawInput || '').trim().toUpperCase();
  if (!trimmed.startsWith('ST:')) {
    return {
      isScoreCode: false,
      validChecksum: false,
      seed: trimmed || GAME_CONFIG.defaultSeed,
    };
  }

  const parts = trimmed.split(':');
  if (parts.length !== 7) {
    return {
      isScoreCode: false,
      validChecksum: false,
      seed: trimmed,
    };
  }

  const [, seedPart, diffPart, scorePart, rankPart, tasksPart, crcPart] = parts;
  const core = `ST:${seedPart}:${diffPart}:${scorePart}:${rankPart}:${tasksPart}`;
  const expectedCrc = computeScoreCodeChecksum(core);
  const validChecksum = crcPart === expectedCrc;

  const difficulty: DifficultyLevel =
    diffPart === 'K' ? 'easy' : diffPart === 'Z' ? 'hard' : 'normal';
  const claimedScore = Number.parseInt(scorePart, 10) || 0;
  const claimedRank: JournalistRank =
    rankPart === 'USTA' ? 'Usta' : rankPart === 'MUHABIR' ? 'Muhabir' : 'Amatör';

  const [compStr, totStr] = tasksPart.split('/');
  const completedTasks = Number.parseInt(compStr, 10) || 0;
  const totalTasks = Number.parseInt(totStr, 10) || GAME_CONFIG.photoCamera.tasksPerTour;

  return {
    isScoreCode: true,
    validChecksum,
    seed: seedPart || GAME_CONFIG.defaultSeed,
    difficulty,
    claimedScore,
    claimedRank,
    completedTasks,
    totalTasks,
  };
}

/**
 * Pure helper that inserts a new LeaderboardEntry, deduplicates by `id`, sorts by `totalScore` descending
 * (breaking ties by `completedTasks` descending, then newest first), and caps to `maxEntries`.
 */
export function insertLeaderboardEntry(
  existing: LeaderboardEntry[],
  newEntry: LeaderboardEntry,
  maxEntries: number = GAME_CONFIG.scoring.maxLeaderboardEntries,
): LeaderboardEntry[] {
  const filtered = existing.filter((item) => item.id !== newEntry.id);
  const merged = [newEntry, ...filtered];
  merged.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.completedTasks !== a.completedTasks) return b.completedTasks - a.completedTasks;
    return b.createdAtIso.localeCompare(a.createdAtIso);
  });
  return merged.slice(0, Math.max(1, maxEntries));
}

export function loadLeaderboardFromStorage(): LeaderboardEntry[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(GAME_CONFIG.scoring.leaderboardStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveLeaderboardEntryToStorage(entry: LeaderboardEntry): LeaderboardEntry[] {
  const current = loadLeaderboardFromStorage();
  const updated = insertLeaderboardEntry(
    current,
    entry,
    GAME_CONFIG.scoring.maxLeaderboardEntries,
  );
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        GAME_CONFIG.scoring.leaderboardStorageKey,
        JSON.stringify(updated),
      );
    }
  } catch {
    // Ignore storage quota errors in restricted iframe modes
  }
  return updated;
}

export function clearLeaderboardStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(GAME_CONFIG.scoring.leaderboardStorageKey);
    }
  } catch {
    // Ignore
  }
}

