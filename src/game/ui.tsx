/**
 * World-Matched HUD, ZENIT-E SLR Viewfinder, Task List & Sepia Gallery (Tab),
 * Police Suspicion Meter, 3-Lives & Stun Overlay, Funny-Threatening Turkish Police Subtitles,
 * Soviet Elevator Panel, Babushka's Matryoshka & Uniform Photo Showcase,
 * End-of-Tour 35mm Contact Strip Results Screen, Score Code & Local Leaderboard ("Son Tur" — Stage 1–5).
 * Built with zero backdrop-filter over WebGL canvas, tabular numerals, custom SVG schematic sketches,
 * and full Turkish interface text.
 */

import React, { useState } from 'react';
import { DifficultyLevel, GAME_CONFIG } from './config';
import { DistanceZone } from './prng';
import type {
  CapturedPhotoRecord,
  LiveViewfinderPreview,
  PhotoTaskInstance,
} from './photo-camera';
import type { PoliceState } from './police';
import {
  generateScoreCode,
  getJournalistRankMeta,
  JournalistRank,
  LeaderboardEntry,
  parseScoreCode,
} from './scoring';

export type GameLifecycleState = 'title' | 'playing' | 'paused' | 'gameover';

export interface HudSnapshot {
  roomName: string;
  roomIsDark: boolean;
  roomHint: string;
  tourRemainingSec: number;
  currentStopIndex: number;
  totalStops: number;
  currentStopTitle: string;
  groupState: 'waiting_at_stop' | 'moving_to_next';
  stopCountdownSec: number;
  currentSubtitle: string | null;
  playerDistanceMeters: number;
  distanceZone: DistanceZone;
  stamina: number;
  battery: number;
  isCrouching: boolean;
  isSprinting: boolean;
  flashlightOn: boolean;
  // Stage 4: Lives, Stun, Hiding & Police AI
  lives: number;
  stunRemainingSec: number;
  damageFlashAlpha: number;
  lastHitWasLockerKiss: boolean;
  isHidden: boolean;
  isInsideLocker: boolean;
  nearbyLockerLabel: string | null;
  activeHidingSpotLabel: string | null;
  policeState: PoliceState;
  policeStateLabelTr: string;
  suspicion: number;
  policeCooldownSec: number;
  policeActiveQuote: string | null;
  policeInVisionCone: boolean;
  policeSpottedFlashlight: boolean;
  policeHeardFootsteps: boolean;
  gameOverReason: 'tour_finished' | 'caught_by_police';
  // Stage 3: Camera & Tasks
  flashEnabled: boolean;
  flashCooldownSec: number;
  screenFlashAlpha: number;
  isAiming: boolean;
  zoomFov: number;
  filmRemaining: number;
  totalScore: number;
  tasks: PhotoTaskInstance[];
  gallery: CapturedPhotoRecord[];
  livePreview: LiveViewfinderPreview | null;
  lastCapturedPhoto: CapturedPhotoRecord | null;
  lastCaptureBannerTimer: number;
  taskModalOpen: boolean;
  pointerLocked: boolean;
  tutorialRemainingSec: number;
  debugEnabled: boolean;
  playerCoords: { x: number; y: number; z: number };
  policeDistanceMeters: number;
  activePathStr: string;
  fps: number;
  // Elevator & Top-Floor Old Woman (Babushka) state
  currentFloor: number;
  nearElevator: boolean;
  elevatorPanelOpen: boolean;
  elevatorMovingToFloor: number | null;
  elevatorAnnouncement: string | null;
  nearBabushka: boolean;
  babushkaModalOpen: boolean;
}

interface GameUIProps {
  gameState: GameLifecycleState;
  seed: string;
  onSeedChange: (s: string) => void;
  difficulty: DifficultyLevel;
  onDifficultyChange: (d: DifficultyLevel) => void;
  mouseSensitivity: number;
  onSensitivityChange: (v: number) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onStartGame: () => void;
  onResumeGame: () => void;
  onRestartGame: () => void;
  onReturnToTitle: () => void;
  onFinishTourNow: () => void;
  onToggleDebug: () => void;
  onRequestPointerLock: () => void;
  onToggleElevatorPanel: () => void;
  onSelectElevatorFloor: (floorNum: number) => void;
  onToggleBabushkaModal: () => void;
  onToggleTaskModal: () => void;
  onToggleAiming: () => void;
  onCapturePhoto: () => void;
  onTriggerPoliceTest: () => void;
  onToggleLocker: () => void;
  leaderboard: LeaderboardEntry[];
  onClearLeaderboard: () => void;
  hud: HudSnapshot;
}

function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Triggers a direct client-side PNG download of a single captured 35mm frame.
 */
function downloadSinglePhotoFrame(photo: CapturedPhotoRecord, seed: string): void {
  const link = document.createElement('a');
  const frameTag = String(photo.frameNumber).padStart(2, '0');
  const cleanSeed = (seed || 'SOVYET-1984').replace(/[^A-Z0-9_-]/gi, '-');
  link.download = `son-tur-kare-${frameTag}-${cleanSeed}.png`;
  link.href = photo.dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Composites all captured photos (or an unexposed darkroom negative strip if 0 photos were taken)
 * onto a high-resolution 35mm Darkroom Contact Sheet PNG with sprocket holes, frame numbers,
 * individual quality scores, total score, journalist rank, and score code, then downloads it.
 */
async function downloadContactStripSheetPng(params: {
  gallery: CapturedPhotoRecord[];
  seed: string;
  difficulty: DifficultyLevel;
  totalScore: number;
  rank: JournalistRank;
  completedCount: number;
  totalTasks: number;
  scoreCode: string;
}): Promise<void> {
  const cols = 3;
  const rows = Math.max(1, Math.ceil(Math.max(1, params.gallery.length) / cols));
  const width = 1040;
  const headerH = 148;
  const rowH = 264;
  const footerH = 56;
  const height = headerH + rows * rowH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Darkroom Matte Paper Background
  ctx.fillStyle = '#0e1210';
  ctx.fillRect(0, 0, width, height);

  // Outer Double Border
  ctx.strokeStyle = '#b8964c';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // 2. Soviet Press Archive Header Banner
  ctx.fillStyle = '#181e1a';
  ctx.fillRect(22, 22, width - 44, 108);
  ctx.strokeStyle = '#9e261f';
  ctx.lineWidth = 2;
  ctx.strokeRect(22, 22, width - 44, 108);

  ctx.fillStyle = '#ece6d5';
  ctx.font = 'bold 26px "Chakra Petch", sans-serif';
  ctx.fillText('SON TUR — 35MM KARANLIK ODA KONTAK ŞERİDİ RAPORU', 40, 58);

  ctx.fillStyle = '#e5c158';
  ctx.font = 'bold 15px "IBM Plex Mono", monospace';
  ctx.fillText(
    `RÜTBE: ${params.rank.toUpperCase()}  |  TOPLAM PUAN: ${params.totalScore}  |  GÖREVLER: ${params.completedCount}/${params.totalTasks}  |  KARELER: ${params.gallery.length}`,
    40,
    88,
  );

  ctx.fillStyle = '#a8a29e';
  ctx.font = '13px "IBM Plex Mono", monospace';
  ctx.fillText(
    `TOHUM (SEED): ${params.seed}  |  ZORLUK: ${GAME_CONFIG.difficulties[params.difficulty].label}  |  SKOR KODU: ${params.scoreCode}`,
    40,
    114,
  );

  // Load images asynchronously so every captured photo draws cleanly onto the contact sheet
  const loadedImages: Array<HTMLImageElement | null> = await Promise.all(
    params.gallery.map(
      (item) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = item.dataUrl;
        }),
    ),
  );

  // 3. Draw 35mm Film Strip Rows with Sprocket Holes
  for (let r = 0; r < rows; r++) {
    const stripY = headerH + r * rowH;
    const stripH = rowH - 16;

    // Film base strip
    ctx.fillStyle = '#151310';
    ctx.fillRect(22, stripY, width - 44, stripH);
    ctx.strokeStyle = '#3f382c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(22, stripY, width - 44, stripH);

    // Top & Bottom 35mm Sprocket Perforations
    ctx.fillStyle = '#090b0a';
    for (let sx = 34; sx < width - 42; sx += 24) {
      ctx.fillRect(sx, stripY + 6, 12, 8);
      ctx.fillRect(sx, stripY + stripH - 14, 12, 8);
    }

    if (params.gallery.length === 0 && r === 0) {
      ctx.fillStyle = '#c79e61';
      ctx.font = 'bold 16px "IBM Plex Mono", monospace';
      ctx.fillText(
        'BU TURDA DEKLANŞÖRE BASILMADI — POZLANMAMIŞ 35MM FİLM ŞERİDİ',
        210,
        stripY + stripH / 2 + 6,
      );
      continue;
    }

    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= params.gallery.length) break;
      const item = params.gallery[idx];
      const img = loadedImages[idx];

      const frameW = 308;
      const frameX = 38 + c * (frameW + 20);
      const frameY = stripY + 22;
      const imgH = 152;

      // Negative frame border
      ctx.fillStyle = '#0c0a08';
      ctx.fillRect(frameX, frameY, frameW, imgH + 50);
      ctx.strokeStyle = item.evaluation.isValid ? '#10b981' : '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(frameX, frameY, frameW, imgH + 50);

      if (img) {
        ctx.drawImage(img, frameX + 4, frameY + 4, frameW - 8, imgH - 8);
      }

      // Frame number & Score stamp
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 12px "IBM Plex Mono", monospace';
      ctx.fillText(
        `#${String(item.frameNumber).padStart(2, '0')}A · ${item.timestampStr}`,
        frameX + 8,
        frameY + imgH + 16,
      );

      ctx.fillStyle = item.evaluation.isValid ? '#6ee7b7' : '#fca5a5';
      ctx.font = 'bold 12px "IBM Plex Mono", monospace';
      ctx.fillText(
        `${item.evaluation.qualityScore}/100 Puan (${item.evaluation.isValid ? `+${item.evaluation.awardedPoints}p` : 'GEÇERSİZ'})`,
        frameX + 125,
        frameY + imgH + 16,
      );

      ctx.fillStyle = '#d6d3d1';
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(
        item.targetTitle.slice(0, 36),
        frameX + 8,
        frameY + imgH + 38,
      );
    }
  }

  // 4. Footer Stamp
  ctx.fillStyle = '#78716c';
  ctx.font = '12px "IBM Plex Mono", monospace';
  ctx.fillText(
    'ZENIT-E 35MM GİZLİ MUHABİR ARŞİVİ · KÜLTÜR SARAYI SON TUR BELGESELİ',
    38,
    height - 24,
  );

  const dataUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const cleanSeed = (params.seed || 'SOVYET-1984').replace(/[^A-Z0-9_-]/gi, '-');
  link.download = `son-tur-kontak-seridi-${cleanSeed}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


/**
 * Custom schematic SVG sketch icon for each photo task target in the Tab Task List.
 */
const TaskHintSketch: React.FC<{ targetId: string }> = ({ targetId }) => {
  return (
    <svg
      viewBox="0 0 64 64"
      className="w-12 h-12 shrink-0 bg-[#121613] border border-amber-700/40 p-1"
      aria-hidden="true"
    >
      {targetId === 'photo_star' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="14" y="44" width="36" height="12" fill="#2c332e" />
          <polygon
            points="32,10 37,24 51,24 40,32 44,44 32,36 20,44 24,32 13,24 27,24"
            fill="#9e261f"
          />
        </g>
      )}
      {targetId === 'photo_poster_corridor' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="12" y="8" width="40" height="48" fill="#232927" />
          <ellipse cx="32" cy="28" rx="14" ry="8" fill="#d8c9a3" />
          <circle cx="32" cy="28" r="4.5" fill="#9e261f" />
          <line x1="18" y1="44" x2="46" y2="44" stroke="#9e261f" strokeWidth="3" />
        </g>
      )}
      {targetId === 'photo_typewriter' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="14" y="30" width="36" height="18" fill="#3a423d" />
          <rect x="22" y="14" width="20" height="16" fill="#d4c39a" />
          <line x1="18" y1="42" x2="46" y2="42" stroke="#e5c158" strokeWidth="2.5" />
        </g>
      )}
      {targetId === 'photo_stage' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="8" y="10" width="10" height="42" fill="#7c1d18" />
          <rect x="46" y="10" width="10" height="42" fill="#7c1d18" />
          <rect x="24" y="28" width="16" height="24" fill="#9e261f" />
          <circle cx="32" cy="36" r="3.5" fill="#e5c158" />
        </g>
      )}
      {targetId === 'photo_boiler' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="12" y="22" width="40" height="26" rx="8" fill="#363d39" />
          <circle cx="24" cy="35" r="6" fill="#9e261f" />
          <line x1="24" y1="10" x2="24" y2="22" stroke="#b8964c" strokeWidth="3" />
          <line x1="40" y1="10" x2="40" y2="22" stroke="#b8964c" strokeWidth="3" />
        </g>
      )}
      {targetId === 'photo_gasmasks' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="10" y="36" width="44" height="18" fill="#4d3622" />
          <circle cx="22" cy="24" r="7" fill="#7d857e" />
          <circle cx="42" cy="24" r="7" fill="#7d857e" />
          <circle cx="20" cy="23" r="2" fill="#181c19" />
          <circle cx="25" cy="23" r="2" fill="#181c19" />
          <circle cx="40" cy="23" r="2" fill="#181c19" />
          <circle cx="45" cy="23" r="2" fill="#181c19" />
        </g>
      )}
      {targetId === 'photo_stair_mural' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="12" y="8" width="40" height="12" fill="#2a1512" />
          <rect x="14" y="22" width="17" height="34" fill="#48524b" />
          <rect x="33" y="22" width="17" height="34" fill="#48524b" />
          <rect x="19" y="28" width="5" height="12" fill="#ffb84d" />
          <rect x="40" y="28" width="5" height="12" fill="#ffb84d" />
        </g>
      )}
      {targetId === 'photo_radio' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <rect x="12" y="26" width="40" height="24" fill="#323a35" />
          <circle cx="23" cy="38" r="5" fill="#b8964c" />
          <circle cx="39" cy="38" r="5" fill="#9e261f" />
          <line x1="46" y1="8" x2="46" y2="26" stroke="#e5c158" strokeWidth="2" />
        </g>
      )}
      {targetId === 'photo_matryoshka_uniform' && (
        <g stroke="#e5c158" strokeWidth="1.5" fill="none">
          <ellipse cx="20" cy="40" rx="8" ry="12" fill="#9e261f" />
          <circle cx="20" cy="24" r="6" fill="#f3dec0" />
          <rect x="34" y="14" width="20" height="26" fill="#c8b48e" />
          <polygon points="38,38 41,26 47,26 50,38" fill="#2d382c" />
        </g>
      )}
    </svg>
  );
};

export const GameUI: React.FC<GameUIProps> = ({
  gameState,
  seed,
  onSeedChange,
  difficulty,
  onDifficultyChange,
  mouseSensitivity,
  onSensitivityChange,
  isMuted,
  onToggleMute,
  onStartGame,
  onResumeGame,
  onRestartGame,
  onReturnToTitle,
  onFinishTourNow,
  onToggleDebug,
  onRequestPointerLock,
  onToggleElevatorPanel,
  onSelectElevatorFloor,
  onToggleBabushkaModal,
  onToggleTaskModal,
  onToggleAiming,
  onCapturePhoto,
  onTriggerPoliceTest,
  onToggleLocker,
  leaderboard,
  onClearLeaderboard,
  hud,
}) => {
  const [copiedScoreCode, setCopiedScoreCode] = useState(false);
  const [parsedCodeNotice, setParsedCodeNotice] = useState<string | null>(null);
  const [selectedContactPhotoId, setSelectedContactPhotoId] = useState<string | null>(null);

  // Distance indicator styling & explicit Turkish semantic text
  const zoneMeta =
    hud.distanceZone === 'green'
      ? {
          label: 'YEŞİL · GRUBA YAKIN',
          subtext: 'Güvendesin, turist grubunun içindesin',
          bg: 'rgba(20, 46, 31, 0.92)',
          border: '#34d399',
          text: '#6ee7b7',
          barColor: '#10b981',
        }
      : hud.distanceZone === 'yellow'
        ? {
            label: 'SARI · GRUPTAN AÇILIYORSUN',
            subtext: 'Dikkat! Gruptan fazla uzaklaşma',
            bg: 'rgba(54, 41, 14, 0.92)',
            border: '#fbbf24',
            text: '#fde68a',
            barColor: '#f59e0b',
          }
        : {
            label: 'KIRMIZI · TEHLİKELİ MESAFE!',
            subtext: 'Derhal turist grubuna geri dön!',
            bg: 'rgba(64, 18, 18, 0.94)',
            border: '#f87171',
            text: '#fca5a5',
            barColor: '#ef4444',
          };

  const distPercent = Math.min(100, Math.round((hud.playerDistanceMeters / 28) * 100));
  const openTasks = hud.tasks.filter((t) => t.status === 'open');
  const completedCount = hud.tasks.filter((t) => t.status === 'completed').length;
  const suspicionNorm = Math.min(1, hud.suspicion / 100);

  const rankMeta = getJournalistRankMeta(hud.totalScore);
  const currentScoreCode = generateScoreCode({
    seed,
    difficulty,
    totalScore: hud.totalScore,
    completedTasks: completedCount,
    totalTasks: Math.max(1, hud.tasks.length || GAME_CONFIG.photoCamera.tasksPerTour),
    photosCount: hud.gallery.length,
  });

  const handleSeedOrScoreCodeInput = (rawVal: string) => {
    const upper = rawVal.toUpperCase();
    if (upper.startsWith('ST:') && upper.split(':').length === 7) {
      const parsed = parseScoreCode(upper);
      if (parsed.isScoreCode) {
        onSeedChange(parsed.seed);
        if (parsed.difficulty) {
          onDifficultyChange(parsed.difficulty);
        }
        setParsedCodeNotice(
          `Skor Kodu çözüldü: Tohum "${parsed.seed}" · Hedef Skor: ${parsed.claimedScore ?? 0} (${parsed.claimedRank ?? 'Amatör'})`,
        );
        return;
      }
    }
    setParsedCodeNotice(null);
    onSeedChange(upper);
  };

  const handleCopyScoreCode = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentScoreCode);
      } else {
        const tempInput = document.createElement('input');
        tempInput.value = currentScoreCode;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
      }
    } catch {
      // Fallback copy succeeded or clipboard restricted in iframe
    }
    setCopiedScoreCode(true);
    window.setTimeout(() => setCopiedScoreCode(false), 2600);
  };

  const selectedContactPhoto =
    hud.gallery.find((p) => p.id === selectedContactPhotoId) ||
    (hud.gallery.length > 0 ? hud.gallery[0] : null);

  return (
    <div className="fixed inset-0 pointer-events-none z-10 select-none overflow-hidden">
      {/* Subtle PS1 CRT Scanline & Dynamic Suspicion Screen-Edge Darkening Vignette */}
      <div
        className="fixed inset-0 pointer-events-none transition-all duration-150"
        style={{
          background:
            hud.policeState === 'chase' || hud.suspicion > 15
              ? `radial-gradient(circle at center, transparent ${Math.max(25, Math.round(58 - suspicionNorm * 30))}%, rgba(${Math.round(45 + suspicionNorm * 95)}, 6, 8, ${(0.72 + suspicionNorm * 0.24).toFixed(2)}) 100%)`
              : 'radial-gradient(circle at center, transparent 58%, rgba(5, 8, 6, 0.68) 100%)',
        }}
      />

      {/* Baton Impact Red Flash & 4-Second Stun Overlay */}
      {hud.damageFlashAlpha > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none z-40"
          style={{
            backgroundColor: `rgba(185, 24, 24, ${(hud.damageFlashAlpha * 0.65).toFixed(2)})`,
          }}
        />
      )}

      {gameState === 'playing' && hud.stunRemainingSec > 0 && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-40 px-5 py-2.5 bg-red-950/95 border-2 border-red-400 text-center shadow-xl pointer-events-none">
          <div className="text-sm font-display font-bold uppercase tracking-wider text-red-200">
            {hud.lastHitWasLockerKiss
              ? `POLİS DOLABA GİRİP SENİ ÖPTÜ! (MUAH! · CAN -1 · KALAN CAN: ${hud.lives}/3)`
              : `POLİS COPUYLA YAKALANDIN! (CAN -1 · KALAN CAN: ${hud.lives}/3)`}
          </div>
          <div className="text-xs font-mono-tabular text-amber-200 mt-0.5">
            Sersemledin: {hud.stunRemainingSec.toFixed(1)} sn · Polis 15 sn geri çekiliyor!
          </div>
        </div>
      )}

      {/* Camera Flash Burst Overlay */}
      {hud.screenFlashAlpha > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none z-40"
          style={{
            backgroundColor: `rgba(255, 248, 225, ${hud.screenFlashAlpha.toFixed(2)})`,
          }}
        />
      )}

      {/* First-Person Soviet Metal Locker Interior Frame & Louver Slit Overlay */}
      {gameState === 'playing' && hud.isInsideLocker && (
        <div className="fixed inset-0 pointer-events-none z-20 flex flex-col justify-between">
          {/* Top solid locker door header & upper louver slats */}
          <div className="w-full">
            <div
              className="w-full h-14 border-b-2 border-stone-700 flex items-center justify-center"
              style={{ backgroundColor: 'rgba(14, 18, 15, 0.94)' }}
            >
              <span className="text-xs font-mono-tabular uppercase tracking-widest text-emerald-300 font-bold">
                DOLAP İÇİNDE SAKLANIYORSUN · {hud.activeHidingSpotLabel} · POLİS SENİ GÖREMEZ
              </span>
            </div>
            <div className="w-full h-3 bg-black/75 border-b border-stone-800/80" />
            <div className="w-full h-5" />
            <div className="w-full h-2.5 bg-black/70 border-y border-stone-800/80" />
          </div>

          {/* Left & Right Steel Locker Door Jambs */}
          <div className="flex-1 flex justify-between items-stretch">
            <div
              className="w-16 md:w-28 border-r-2 border-stone-700/90"
              style={{ backgroundColor: 'rgba(12, 16, 13, 0.92)' }}
            />
            <div
              className="w-16 md:w-28 border-l-2 border-stone-700/90"
              style={{ backgroundColor: 'rgba(12, 16, 13, 0.92)' }}
            />
          </div>

          {/* Bottom solid locker door plate */}
          <div className="w-full">
            <div className="w-full h-2.5 bg-black/70 border-y border-stone-800/80" />
            <div className="w-full h-5" />
            <div
              className="w-full h-16 border-t-2 border-stone-700"
              style={{ backgroundColor: 'rgba(12, 16, 13, 0.94)' }}
            />
          </div>
        </div>
      )}

      {/* ==================== 1. TITLE SCREEN ('title') ==================== */}
      {gameState === 'title' && (
        <div
          className="fixed inset-0 flex flex-col justify-between p-6 md:p-12 pointer-events-auto overflow-y-auto"
          style={{
            background:
              'linear-gradient(90deg, rgba(10, 13, 11, 0.94) 0%, rgba(10, 13, 11, 0.78) 52%, rgba(10, 13, 11, 0.45) 100%)',
          }}
        >
          <div className="w-full max-w-6xl mx-auto my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left-Third Asymmetric Title Lockup & Controls */}
            <div className="lg:col-span-6 max-w-md w-full space-y-5">
              {/* Bespoke Inline SVG Constructivist Emblem & Title Lockup */}
              <div className="space-y-2.5">
                <svg
                  viewBox="0 0 360 92"
                  className="w-full max-w-[340px] h-auto drop-shadow"
                  aria-label="Son Tur Oyun Logosu"
                >
                  <polygon points="0,8 344,8 358,46 344,84 0,84" fill="#181e1a" stroke="#b8332a" strokeWidth="2.5" />
                  <polygon points="6,14 82,14 70,78 6,78" fill="#9e261f" />
                  <polygon
                    points="42,22 48,38 65,38 51,48 56,65 42,55 28,65 33,48 19,38 36,38"
                    fill="#e8d8b0"
                  />
                  <polyline points="42,20 39,43 49,51 44,68" fill="none" stroke="#181e1a" strokeWidth="2.5" />
                  <text
                    x="92"
                    y="53"
                    fill="#ece6d5"
                    fontFamily="Chakra Petch, sans-serif"
                    fontWeight="700"
                    fontSize="40"
                    letterSpacing="2.5"
                  >
                    SON TUR
                  </text>
                  <text
                    x="94"
                    y="72"
                    fill="#c79e61"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="600"
                    fontSize="9.5"
                    letterSpacing="1"
                  >
                    GİZLİ FOTO MUHABİRİ · KÜLTÜR SARAYI
                  </text>
                </svg>

                <p className="text-sm text-stone-300 leading-relaxed max-w-sm">
                  Terk edilmiş Sovyet Kültür Sarayı&apos;nda 5 kişilik turist kafilesine karıştın.
                  Gizli kamera vizörünle listedeki hedefleri doğru açı ve mesafeden fotoğrafla,
                  koridor sonundaki asansörle son kata çık.
                </p>
              </div>

              {/* Seed / Score Code & Difficulty Configuration Panel */}
              <div
                className="p-5 space-y-4 border"
                style={{
                  backgroundColor: 'rgba(18, 23, 20, 0.94)',
                  borderColor: 'rgba(184, 150, 76, 0.4)',
                }}
              >
                <div>
                  <label
                    htmlFor="seed-input"
                    className="block text-xs font-mono-tabular uppercase tracking-wider text-amber-300/90 mb-1.5"
                  >
                    Tur Tohum Kodu (Seed) veya Skor Kodu (ST:...)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="seed-input"
                      type="text"
                      value={seed}
                      onChange={(e) => handleSeedOrScoreCodeInput(e.target.value)}
                      placeholder="SOVYET-1984 veya ST:..."
                      className="flex-1 px-3 py-2 text-sm font-mono-tabular bg-stone-950 border border-stone-700 text-stone-100 focus:outline-none focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setParsedCodeNotice(null);
                        onSeedChange(`TUR-${Math.floor(1000 + Math.random() * 9000)}`);
                      }}
                      className="px-3 py-2 text-xs font-mono-tabular bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Rastgele
                    </button>
                  </div>
                  {parsedCodeNotice && (
                    <div className="mt-1.5 px-2.5 py-1 bg-emerald-950/90 border border-emerald-500/50 text-[11px] font-mono-tabular text-emerald-300">
                      {parsedCodeNotice}
                    </div>
                  )}
                </div>

                <div>
                  <span className="block text-xs font-mono-tabular uppercase tracking-wider text-amber-300/90 mb-1.5">
                    Zorluk Derecesi
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['easy', 'normal', 'hard'] as DifficultyLevel[]).map((lvl) => {
                      const active = difficulty === lvl;
                      const label =
                        lvl === 'easy' ? 'Kolay' : lvl === 'normal' ? 'Normal' : 'Zor';
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => onDifficultyChange(lvl)}
                          className={`py-2 px-3 text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-amber-700/90 border-amber-400 text-amber-50'
                              : 'bg-stone-900 border-stone-700 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <label
                      htmlFor="sens-range"
                      className="block text-xs text-stone-400 mb-1 font-mono-tabular"
                    >
                      Fare Hassasiyeti: {(mouseSensitivity * 1000).toFixed(1)}
                    </label>
                    <input
                      id="sens-range"
                      type="range"
                      min="0.0008"
                      max="0.005"
                      step="0.0002"
                      value={mouseSensitivity}
                      onChange={(e) => onSensitivityChange(parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={onToggleMute}
                      className="px-3 py-1.5 text-xs font-mono-tabular border border-stone-700 bg-stone-900 hover:bg-stone-800 text-stone-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {isMuted ? 'Ses: KAPALI [M]' : 'Ses: AÇIK [M]'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Primary Start Action Button */}
              <button
                type="button"
                data-start="true"
                onClick={onStartGame}
                className="w-full py-3.5 px-6 text-base font-display font-bold tracking-wider uppercase text-stone-100 border-2 border-red-500/80 transition-transform active:scale-[0.99] cursor-pointer shadow-lg"
                style={{ backgroundColor: '#9e261f' }}
              >
                TURA KATIL VE BAŞLA [ENTER]
              </button>
            </div>

            {/* Right Column: Local Leaderboard (Yerel Skor Tablosu — localStorage) */}
            <div className="lg:col-span-6 w-full">
              <div
                className="p-5 border space-y-3"
                style={{
                  backgroundColor: 'rgba(15, 19, 17, 0.92)',
                  borderColor: 'rgba(184, 150, 76, 0.35)',
                }}
              >
                <div className="flex items-center justify-between border-b border-stone-800 pb-2.5">
                  <div>
                    <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-amber-400">
                      YEREL BASIN ARŞİVİ (LOCALSTORAGE)
                    </div>
                    <h2 className="text-base font-display font-bold text-stone-100">
                      YEREL SKOR TABLOSU · EN İYİ MUHABİRLER
                    </h2>
                  </div>
                  {leaderboard.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearLeaderboard}
                      className="px-2.5 py-1 text-[11px] font-mono-tabular bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-700 cursor-pointer"
                    >
                      Tabloyu Sıfırla
                    </button>
                  )}
                </div>

                {leaderboard.length === 0 ? (
                  <div className="py-6 px-4 text-center border border-stone-800/80 bg-stone-950/70 space-y-1.5">
                    <div className="text-xs font-mono-tabular text-amber-300/90 font-semibold">
                      HENÜZ KAYITLI TUR RAPORU YOK
                    </div>
                    <p className="text-xs text-stone-400 max-w-sm mx-auto">
                      Turu tamamladığında veya oyun içinde <strong>[B]</strong> tuşuyla raporu
                      teslim ettiğinde puanın, rütben (<strong>Amatör / Muhabir / Usta</strong>) ve
                      skor kodun buraya kaydedilir.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                    {leaderboard.slice(0, 6).map((entry, idx) => (
                      <div
                        key={entry.id}
                        className="p-2.5 bg-stone-950/90 border border-stone-800 flex items-center justify-between gap-2 text-xs font-mono-tabular"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-bold">#{idx + 1}</span>
                            <span className="font-bold text-stone-100">{entry.totalScore} Puan</span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-bold border ${
                                entry.rank === 'Usta'
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-500/60'
                                  : entry.rank === 'Muhabir'
                                    ? 'bg-amber-950 text-amber-300 border-amber-500/60'
                                    : 'bg-stone-900 text-stone-300 border-stone-600'
                              }`}
                            >
                              {entry.rank.toUpperCase()}
                            </span>
                            <span className="text-[11px] text-stone-400 truncate">
                              Tohum: {entry.seed}
                            </span>
                          </div>
                          <div className="text-[10px] text-stone-400 mt-0.5 truncate">
                            Görev: {entry.completedTasks}/{entry.totalTasks} · Kare: {entry.photosCount} ·{' '}
                            {GAME_CONFIG.difficulties[entry.difficulty]?.label ?? entry.difficulty} ·{' '}
                            {entry.dateLabelTr}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onSeedChange(entry.seed);
                            onDifficultyChange(entry.difficulty);
                            setParsedCodeNotice(
                              `Tablodan yüklendi: Tohum "${entry.seed}" (${entry.rank} · ${entry.totalScore}p)`,
                            );
                          }}
                          className="px-2 py-1 text-[10px] bg-stone-800 hover:bg-amber-800 text-amber-200 border border-amber-600/50 shrink-0 cursor-pointer"
                        >
                          Bu Tohumu Seç
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-1 border-t border-stone-800/80 flex items-center justify-between text-[11px] font-mono-tabular text-stone-400">
                  <span>Rütbe Eşikleri:</span>
                  <span>
                    Amatör (&lt;300p) · Muhabir (300p+) · Usta (600p+)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Single Flat Control-Hint Line in Bottom Safe Margin */}
          <div className="text-xs font-mono-tabular text-stone-400 tracking-wide pt-4">
            WASD Hareket · Sağ Tık / V Vizör · Sol Tık / Q Fotoğraf Çek · R Flaş · Tab Görevler &amp; Galeri · E Dolap/Asansör · B Turu Bitir · F1 Debug
          </div>
        </div>
      )}


      {/* ==================== 2. PLAYING HUD ('playing') ==================== */}
      {gameState === 'playing' && (
        <>
          {/* ZENIT-E SLR OPTICAL VIEWFINDER OVERLAY (Sağ Tık veya V) */}
          {hud.isAiming && (
            <div className="fixed inset-0 pointer-events-none flex items-center justify-center">
              <div
                className="w-[540px] h-[360px] border-2 border-amber-200/80 relative"
                style={{ boxShadow: '0 0 0 9999px rgba(5, 7, 6, 0.72)' }}
              >
                {/* Rule-of-Thirds Framing Grid */}
                <div className="absolute inset-x-0 top-1/3 border-t border-amber-200/25" />
                <div className="absolute inset-x-0 top-2/3 border-t border-amber-200/25" />
                <div className="absolute inset-y-0 left-1/3 border-l border-amber-200/25" />
                <div className="absolute inset-y-0 left-2/3 border-l border-amber-200/25" />

                {/* Corner SLR Framing Brackets */}
                <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 border-amber-400" />
                <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 border-amber-400" />
                <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 border-amber-400" />
                <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 border-amber-400" />

                {/* Center Split-Prism Focusing Ring */}
                <div
                  className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border ${
                    hud.livePreview && hud.livePreview.estimatedQuality >= 60
                      ? 'border-emerald-400'
                      : 'border-amber-200/60'
                  } flex items-center justify-center`}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-300" />
                </div>

                {/* Top Viewfinder Status Strip */}
                <div className="absolute -top-7 inset-x-0 flex items-center justify-between text-xs font-mono-tabular text-amber-300 bg-stone-950/90 px-3 py-1 border border-amber-500/40">
                  <span>
                    ZENIT-E VİZÖR · ZOOM {Math.round((70 / hud.zoomFov) * 10) / 10}x [Tekerlek / Z-X]
                  </span>
                  <span>
                    FİLM: {hud.filmRemaining}/{GAME_CONFIG.photoCamera.maxFilmCount} · FLAŞ [R]:{' '}
                    {hud.flashCooldownSec > 0
                      ? `ŞARJ (${hud.flashCooldownSec.toFixed(1)}s)`
                      : hud.flashEnabled
                        ? 'HAZIR'
                        : 'KAPALI'}
                  </span>
                </div>

                {/* Live Target Telemetry Inside Viewfinder */}
                <div className="absolute -bottom-11 inset-x-0 px-3 py-1.5 bg-stone-950/95 border border-amber-500/50 text-xs font-mono-tabular flex items-center justify-between">
                  {hud.livePreview ? (
                    <>
                      <div className="truncate pr-2">
                        <span
                          className={
                            hud.livePreview.alreadyCompleted
                              ? 'text-sky-300 font-bold'
                              : 'text-amber-300 font-bold'
                          }
                        >
                          {hud.livePreview.alreadyCompleted ? '[ÇEKİLDİ] ' : '[HEDEF] '}
                          {hud.livePreview.targetTitle}
                        </span>
                        <span className="text-stone-400 ml-2">
                          ({hud.livePreview.distanceMeters}m / İdeal: {hud.livePreview.minDist}-
                          {hud.livePreview.maxDist}m)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hud.livePreview.obstructedBy !== 'none' ? (
                          <span className="px-1.5 py-0.5 bg-red-900/90 text-red-200 border border-red-400 font-bold">
                            ENGEL VAR!
                          </span>
                        ) : hud.livePreview.requiresFlash && !hud.livePreview.flashReady ? (
                          <span className="px-1.5 py-0.5 bg-amber-900/90 text-amber-200 border border-amber-400 font-bold">
                            FLAŞ [R] AÇ!
                          </span>
                        ) : (
                          <span
                            className={`px-1.5 py-0.5 border font-bold ${
                              hud.livePreview.estimatedQuality >= 60
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-400'
                                : 'bg-stone-900 text-amber-300 border-amber-500/50'
                            }`}
                          >
                            KALİTE: ~{hud.livePreview.estimatedQuality}/100
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-stone-400">
                      Kadrajda görev hedefi aranıyor... [Sol Tık] veya [Q] ile fotoğraf çek.
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Subtle Center Crosshair Dot when not aiming */}
          {!hud.isAiming && (
            <div
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none"
              style={{ backgroundColor: 'rgba(235, 228, 208, 0.65)' }}
            />
          )}

          {/* TOP-LEFT CLUSTER: Tour Timer, Current Room & Active Photo Tasks Summary */}
          <div className="fixed top-4 left-4 flex flex-col gap-2 max-w-sm pointer-events-none">
            <div
              className="px-4 py-2.5 border"
              style={{
                backgroundColor: 'rgba(14, 19, 16, 0.9)',
                borderColor: 'rgba(148, 163, 152, 0.3)',
              }}
            >
              <div className="flex items-baseline justify-between gap-6">
                <div>
                  <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-stone-400">
                    TUR BİTİŞİNE KALAN SÜRE
                  </div>
                  <div className="text-2xl font-display font-bold font-mono-tabular text-amber-300 hud-text-stroke">
                    {formatMMSS(hud.tourRemainingSec)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-stone-400">
                    DURAK {hud.currentStopIndex}/{hud.totalStops} · KAT {hud.currentFloor}
                  </div>
                  <div className="text-base font-mono-tabular font-semibold text-stone-200">
                    {hud.groupState === 'waiting_at_stop'
                      ? `${Math.ceil(hud.stopCountdownSec)} sn`
                      : 'Yolda'}
                  </div>
                </div>
              </div>

              <div className="mt-1.5 pt-1.5 border-t border-stone-800 text-xs text-stone-300 flex items-center justify-between gap-2">
                <span className="truncate font-medium">{hud.currentStopTitle}</span>
                <span className="text-[11px] font-mono-tabular text-amber-400/90 shrink-0">
                  {hud.groupState === 'waiting_at_stop'
                    ? `Sonraki durağa: ${Math.ceil(hud.stopCountdownSec)}s`
                    : 'Grup ilerliyor...'}
                </span>
              </div>
            </div>

            {/* Current Player Room Indicator */}
            <div
              className="px-3.5 py-2 border text-xs"
              style={{
                backgroundColor: 'rgba(14, 19, 16, 0.86)',
                borderColor: hud.roomIsDark ? '#d97706' : 'rgba(120, 130, 122, 0.28)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-stone-200">{hud.roomName}</span>
                {hud.roomIsDark && (
                  <span className="text-[11px] font-mono-tabular text-amber-400 font-semibold">
                    KARANLIK [F: Fener / R: Flaş]
                  </span>
                )}
              </div>
              <div className="text-[11px] text-stone-400 mt-0.5">{hud.roomHint}</div>
            </div>

            {/* Compact Open Photo Tasks Tracker */}
            <div
              className="px-3.5 py-2.5 border space-y-1.5"
              style={{
                backgroundColor: 'rgba(14, 19, 16, 0.9)',
                borderColor: 'rgba(217, 119, 6, 0.4)',
              }}
            >
              <div className="flex items-center justify-between text-[11px] font-mono-tabular border-b border-stone-800 pb-1">
                <span className="text-amber-300 font-bold uppercase tracking-wider">
                  AÇIK FOTOĞRAF GÖREVLERİ [TAB]
                </span>
                <span className="text-emerald-300 font-semibold">
                  {completedCount}/{hud.tasks.length} · {hud.totalScore} Puan
                </span>
              </div>
              {openTasks.length === 0 ? (
                <div className="text-[11px] text-stone-400 font-mono-tabular">
                  Tüm açık görevler tamamlandı!
                </div>
              ) : (
                <div className="space-y-1">
                  {openTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between text-xs gap-2"
                    >
                      <div className="truncate text-stone-200">
                        <span className="text-amber-400 font-mono-tabular mr-1">
                          #{task.orderIndex}
                        </span>
                        {task.target.title}
                        {task.target.requiresFlash && (
                          <span className="ml-1 text-[10px] font-mono-tabular text-amber-300">
                            [FLAŞ]
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-mono-tabular shrink-0 ${
                          task.remainingSec < 20 ? 'text-red-400 font-bold' : 'text-stone-400'
                        }`}
                      >
                        {Math.ceil(task.remainingSec)}s
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* TOP-RIGHT CLUSTER: Utility Buttons, Group Distance Indicator & Soviet Elevator Panel */}
          <div className="fixed top-4 right-4 flex flex-col items-end gap-2 pointer-events-none">
            {/* Utility Icon Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-1.5 pointer-events-auto">
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleTaskModal();
                }}
                aria-label="Görev Listesi ve Galeriyi Aç/Kapa"
                className={`px-2.5 py-1.5 text-xs font-mono-tabular border cursor-pointer whitespace-nowrap shrink-0 ${
                  hud.taskModalOpen
                    ? 'bg-amber-700 border-amber-300 text-stone-100 font-semibold'
                    : 'bg-stone-900/95 border-amber-600/60 text-amber-300 hover:bg-stone-800'
                }`}
              >
                Görev &amp; Galeri [Tab] ({hud.gallery.length})
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleAiming();
                }}
                aria-label="Vizör Aç/Kapa"
                className={`px-2.5 py-1.5 text-xs font-mono-tabular border cursor-pointer whitespace-nowrap shrink-0 ${
                  hud.isAiming
                    ? 'bg-emerald-800/95 border-emerald-400 text-emerald-100 font-semibold'
                    : 'bg-stone-900/95 border-stone-700 text-stone-200 hover:bg-stone-800'
                }`}
              >
                Vizör [V]
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCapturePhoto();
                }}
                aria-label="Fotoğraf Çek"
                className="px-2.5 py-1.5 text-xs font-mono-tabular bg-red-900/90 hover:bg-red-800 text-amber-100 border border-red-400 font-semibold cursor-pointer whitespace-nowrap shrink-0"
              >
                Çek [Q / Sol Tık]
              </button>
              {hud.nearElevator && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onToggleElevatorPanel();
                  }}
                  aria-label="Kat Asansörü Panelini Aç/Kapa"
                  className="px-2.5 py-1.5 text-xs font-mono-tabular border cursor-pointer whitespace-nowrap shrink-0 bg-amber-800/95 border-amber-400 text-amber-100 font-semibold"
                >
                  Asansör [E]
                </button>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleDebug();
                }}
                aria-label="Debug Modu Aç/Kapa"
                className={`px-2.5 py-1.5 text-xs font-mono-tabular border cursor-pointer whitespace-nowrap shrink-0 ${
                  hud.debugEnabled
                    ? 'bg-sky-900/90 border-sky-400 text-sky-200'
                    : 'bg-stone-900/95 border-stone-700 text-stone-300 hover:bg-stone-800'
                }`}
              >
                Debug [F1]
              </button>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleMute();
                }}
                aria-label="Sesi Aç/Kapa"
                className="px-2.5 py-1.5 text-xs font-mono-tabular bg-stone-900/95 hover:bg-stone-800 text-stone-300 border border-stone-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                {isMuted ? 'Sessiz [M]' : 'Ses [M]'}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="finish-tour-btn"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onFinishTourNow();
                }}
                aria-label="Turu Bitir ve Sonuç Ekranını Gör"
                className="px-2.5 py-1.5 text-xs font-mono-tabular bg-stone-900/95 hover:bg-amber-900/80 text-amber-200 border border-amber-500/60 cursor-pointer whitespace-nowrap shrink-0"
              >
                Turu Bitir [B]
              </button>
            </div>


            {/* Group Path Distance Indicator (Green / Yellow / Red) */}
            <div
              className="w-72 px-4 py-2.5 border-2 transition-colors"
              style={{
                backgroundColor: zoneMeta.bg,
                borderColor: zoneMeta.border,
              }}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className="text-xs font-mono-tabular font-bold tracking-wider"
                  style={{ color: zoneMeta.text }}
                >
                  {zoneMeta.label}
                </span>
                <span
                  className="text-xl font-display font-bold font-mono-tabular hud-text-stroke"
                  style={{ color: zoneMeta.text }}
                >
                  {Math.round(hud.playerDistanceMeters)} m
                </span>
              </div>
              <div className="w-full h-2 bg-black/60 mt-1.5 overflow-hidden">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${distPercent}%`,
                    backgroundColor: zoneMeta.barColor,
                  }}
                />
              </div>
              <div className="text-[11px] text-stone-200/90 mt-1">{zoneMeta.subtext}</div>
            </div>

            {/* STAGE 4: POLICE SUSPICION METER & 3-LIVES INDICATOR (Polis Şüphesi ve Can) */}
            <div
              className="w-72 px-4 py-2.5 border-2 transition-colors"
              style={{
                backgroundColor:
                  hud.policeState === 'chase'
                    ? 'rgba(78, 14, 16, 0.96)'
                    : hud.policeState === 'suspicion'
                      ? 'rgba(52, 28, 12, 0.94)'
                      : 'rgba(14, 19, 16, 0.92)',
                borderColor:
                  hud.policeState === 'chase'
                    ? '#ef4444'
                    : hud.policeState === 'suspicion'
                      ? '#f59e0b'
                      : 'rgba(148, 163, 152, 0.35)',
              }}
            >
              {/* Lives Row (3 Can) & Police State Badge */}
              <div className="flex items-center justify-between border-b border-stone-800/80 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono-tabular uppercase tracking-wider text-stone-300 font-bold">
                    CAN:
                  </span>
                  <div className="flex items-center gap-1" aria-label={`Kalan Can: ${hud.lives}/3`}>
                    {[1, 2, 3].map((idx) => {
                      const alive = idx <= hud.lives;
                      return (
                        <span
                          key={idx}
                          className={`text-sm font-bold ${
                            alive ? 'text-red-400' : 'text-stone-700'
                          }`}
                        >
                          ★
                        </span>
                      );
                    })}
                  </div>
                  <span className="text-xs font-mono-tabular font-bold text-stone-200">
                    {hud.lives}/3
                  </span>
                </div>

                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono-tabular font-bold border ${
                    hud.policeState === 'chase'
                      ? 'bg-red-900 text-red-100 border-red-300'
                      : hud.policeState === 'suspicion'
                        ? 'bg-amber-900/90 text-amber-200 border-amber-400'
                        : hud.policeState === 'cooldown'
                          ? 'bg-sky-950 text-sky-300 border-sky-500/60'
                          : 'bg-stone-900 text-stone-300 border-stone-700'
                  }`}
                >
                  {hud.policeState === 'chase'
                    ? 'KOVALAMA!'
                    : hud.policeState === 'suspicion'
                      ? 'ŞÜPHE'
                      : hud.policeState === 'cooldown'
                        ? `SOĞUMA (${Math.ceil(hud.policeCooldownSec)}s)`
                        : 'GÖZETLEME'}
                </span>
              </div>

              {/* Suspicion Progress Bar */}
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                  <span
                    className={
                      hud.policeState === 'chase'
                        ? 'text-red-300 font-bold'
                        : hud.suspicion > 20
                          ? 'text-amber-300 font-semibold'
                          : 'text-stone-400'
                    }
                  >
                    POLİS ŞÜPHE ÖLÇERİ
                  </span>
                  <span className="font-bold text-stone-200">%{hud.suspicion}</span>
                </div>
                <div className="w-full h-2 bg-black/60 mt-1 overflow-hidden">
                  <div
                    className="h-full transition-all duration-150"
                    style={{
                      width: `${hud.suspicion}%`,
                      backgroundColor:
                        hud.suspicion >= 80
                          ? '#ef4444'
                          : hud.suspicion >= 35
                            ? '#f59e0b'
                            : '#38bdf8',
                    }}
                  />
                </div>
              </div>

              {/* Active Detection / Hiding Spot Sub-status */}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono-tabular">
                {hud.isHidden ? (
                  <span className="text-emerald-300 font-semibold">
                    SAKLANIYOR: {hud.activeHidingSpotLabel}
                  </span>
                ) : hud.policeState === 'chase' ? (
                  <span className="text-red-200 font-semibold">
                    Turist grubuna yaklaşarak kovalamadan kurtul!
                  </span>
                ) : (
                  <span className="text-stone-400">
                    Polis Mesafesi: {Math.round(hud.policeDistanceMeters)}m
                  </span>
                )}
                <div className="flex gap-1">
                  {hud.policeInVisionCone && (
                    <span className="px-1 bg-red-900/90 text-red-200 border border-red-400">
                      GÖRÜŞTE
                    </span>
                  )}
                  {hud.policeSpottedFlashlight && (
                    <span className="px-1 bg-amber-900/90 text-amber-200 border border-amber-400">
                      FENER!
                    </span>
                  )}
                  {hud.policeHeardFootsteps && (
                    <span className="px-1 bg-orange-900/90 text-orange-200 border border-orange-400">
                      SES!
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* SOVIET ELEVATOR FLOOR CONTROL PANEL (Kat Seçim Paneli - Sadece Kabin İçindeyken Aktif) */}
            {hud.nearElevator && (
              <div
                className="w-72 p-3.5 border-2 space-y-2.5 pointer-events-auto"
                style={{
                  backgroundColor: 'rgba(18, 22, 19, 0.95)',
                  borderColor: '#b8964c',
                }}
              >
                <div className="flex items-center justify-between border-b border-stone-700 pb-1.5">
                  <div>
                    <div className="text-xs font-display font-bold text-amber-300 tracking-wide">
                      SOVYET KAT ASANSÖRÜ (KABİN İÇİ)
                    </div>
                    <div className="text-[10px] font-mono-tabular text-stone-400">
                      Yaşlı Kadın Sesli Kat Anons Sistemi
                    </div>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-mono-tabular font-bold bg-stone-900 border border-amber-500/60 text-amber-300">
                    KAT: {hud.currentFloor}
                  </span>
                </div>

                {hud.elevatorMovingToFloor !== null ? (
                  <div className="py-3 px-2 text-center bg-amber-950/50 border border-amber-600/50 text-xs font-mono-tabular text-amber-200">
                    Asansör {hud.elevatorMovingToFloor}. Kata İlerliyor...
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {GAME_CONFIG.elevator.floors.map((fl, idx) => {
                      const isCurrent = hud.currentFloor === fl.floorNumber;
                      return (
                        <button
                          key={fl.floorNumber}
                          type="button"
                          onClick={() => onSelectElevatorFloor(fl.floorNumber)}
                          className={`w-full px-3 py-2 text-left text-xs font-mono-tabular border flex items-center justify-between transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-amber-800/40 border-amber-400 text-amber-200 font-semibold'
                              : 'bg-stone-900 hover:bg-stone-800 border-stone-700 text-stone-200'
                          }`}
                        >
                          <span className="truncate pr-2">{fl.name}</span>
                          <span className="px-1.5 py-0.5 text-[10px] bg-stone-950 border border-stone-600 text-amber-300 shrink-0">
                            [{idx + 1}] {fl.code}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="text-[10px] font-mono-tabular text-stone-400 leading-tight">
                  Kabin içindeyken klavyeden <strong>1, 2, 3, 4</strong> tuşlarıyla veya butonlara
                  tıklayarak kat seçebilirsin.
                </div>
              </div>
            )}

            {/* Prompt when inside or near Top-Floor Babushka's Room */}
            {(hud.nearBabushka || hud.currentFloor === 3) && !hud.babushkaModalOpen && (
              <button
                type="button"
                onClick={onToggleBabushkaModal}
                className="w-72 py-2.5 px-4 border-2 text-xs font-display font-bold uppercase tracking-wider text-amber-100 cursor-pointer pointer-events-auto shadow-lg"
                style={{
                  backgroundColor: 'rgba(124, 35, 41, 0.95)',
                  borderColor: '#fbbf24',
                }}
              >
                Matruşka ve Üniformalı Fotoğrafları Gör [G]
              </button>
            )}
          </div>

          {/* MID-LEFT CLUSTER: F1 Debug Telemetry Overlay */}
          {hud.debugEnabled && (
            <div
              className="fixed left-4 top-64 p-3.5 border text-xs font-mono-tabular space-y-1 max-w-xs pointer-events-auto"
              style={{
                backgroundColor: 'rgba(10, 18, 28, 0.94)',
                borderColor: '#38bdf8',
                color: '#e0f2fe',
              }}
            >
              <div className="font-bold text-sky-300 border-b border-sky-800 pb-1 mb-1">
                DEBUG MODU (F1) AKTİF
              </div>
              <div>Tohum (Seed): {seed}</div>
              <div>FPS: {hud.fps} · Mevcut Kat: {hud.currentFloor}</div>
              <div>
                Oyuncu: X:{hud.playerCoords.x.toFixed(1)} Y:{hud.playerCoords.y.toFixed(1)} Z:
                {hud.playerCoords.z.toFixed(1)}
              </div>
              <div>Grup Yol Mesafesi: {hud.playerDistanceMeters.toFixed(1)} m</div>
              <div>
                Polis Durumu: <strong className="text-amber-300">{hud.policeStateLabelTr}</strong>
              </div>
              <div>
                Polis Mesafesi: {hud.policeDistanceMeters.toFixed(1)} m · Şüphe: %{hud.suspicion}
              </div>
              <div className="truncate">A* Rota: {hud.activePathStr || 'Aynı Nokta'}</div>
              <div className="pt-1.5">
                <button
                  type="button"
                  onClick={onTriggerPoliceTest}
                  className="w-full py-1.5 px-2 bg-red-900/90 hover:bg-red-800 text-amber-100 border border-red-400 text-[11px] font-bold cursor-pointer"
                >
                  Polis Kovalama Testi Başlat [K]
                </button>
              </div>
              <div className="pt-1 text-[11px] text-sky-300/90">
                3D Çizimler: Mavi=Waypoint, Sarı=Foto Bölgesi, Kırmızı=Polis Görüş Konisi, Yeşil=Grup Yolu
              </div>
            </div>
          )}

          {/* BOTTOM-LEFT CLUSTER: Film Counter, Flash Status, Stamina, Stealth Posture & Battery */}
          <div className="fixed bottom-4 left-4 flex items-end gap-3 pointer-events-none">
            <div
              className="px-4 py-2.5 border space-y-2 w-72"
              style={{
                backgroundColor: 'rgba(14, 19, 16, 0.92)',
                borderColor: 'rgba(148, 163, 152, 0.3)',
              }}
            >
              {/* Camera Film & Score Strip */}
              <div className="flex items-center justify-between pb-1.5 border-b border-stone-800 text-xs font-mono-tabular">
                <span className="text-amber-300 font-bold">
                  FİLM: {hud.filmRemaining}/{GAME_CONFIG.photoCamera.maxFilmCount}
                </span>
                <span className="text-emerald-300 font-bold">SKOR: {hud.totalScore}</span>
              </div>

              {/* Stamina Bar */}
              <div>
                <div className="flex justify-between text-[11px] font-mono-tabular text-stone-300 mb-1">
                  <span>KONDİSYON [SHIFT]</span>
                  <span>%{Math.round(hud.stamina)}</span>
                </div>
                <div className="w-full h-2 bg-stone-950 overflow-hidden">
                  <div
                    className="h-full transition-all duration-100"
                    style={{
                      width: `${Math.round(hud.stamina)}%`,
                      backgroundColor: hud.stamina < 25 ? '#ef4444' : '#d97706',
                    }}
                  />
                </div>
              </div>

              {/* Flashlight Battery Bar */}
              <div>
                <div className="flex justify-between text-[11px] font-mono-tabular text-stone-300 mb-1">
                  <span>EL FENERİ [F]: {hud.flashlightOn ? 'AÇIK' : 'KAPALI'}</span>
                  <span>%{Math.round(hud.battery)}</span>
                </div>
                <div className="w-full h-2 bg-stone-950 overflow-hidden">
                  <div
                    className="h-full transition-all duration-100"
                    style={{
                      width: `${Math.round(hud.battery)}%`,
                      backgroundColor: hud.flashlightOn ? '#facc15' : '#65a30d',
                    }}
                  />
                </div>
              </div>

              {/* Posture & Camera Flash Status */}
              <div className="flex items-center justify-between pt-1 border-t border-stone-800 text-[11px] font-mono-tabular">
                <span className={hud.isCrouching ? 'text-emerald-400 font-semibold' : 'text-stone-400'}>
                  DURUŞ [C]: {hud.isCrouching ? 'EĞİLME' : 'AYAKTA'}
                </span>
                <span className={hud.flashEnabled ? 'text-amber-300 font-semibold' : 'text-stone-400'}>
                  FLAŞ [R]:{' '}
                  {hud.flashCooldownSec > 0
                    ? `ŞARJ (${hud.flashCooldownSec.toFixed(1)}s)`
                    : hud.flashEnabled
                      ? 'AÇIK'
                      : 'KAPALI'}
                </span>
              </div>
            </div>
          </div>

          {/* BOTTOM-RIGHT CLUSTER: Newly Captured Sepia Photo Toast Notification */}
          {hud.lastCapturedPhoto && hud.lastCaptureBannerTimer > 0 && (
            <div
              className="fixed bottom-4 right-4 w-80 p-3 border-2 space-y-2 pointer-events-auto shadow-xl"
              style={{
                backgroundColor: 'rgba(18, 15, 12, 0.96)',
                borderColor: hud.lastCapturedPhoto.evaluation.isValid ? '#34d399' : '#f87171',
              }}
            >
              <div className="flex items-center justify-between border-b border-stone-800 pb-1">
                <span className="text-xs font-mono-tabular font-bold text-amber-300">
                  {hud.lastCapturedPhoto.timestampStr} · {hud.lastCapturedPhoto.roomName}
                </span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-mono-tabular font-bold ${
                    hud.lastCapturedPhoto.evaluation.isValid
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500'
                      : 'bg-red-950 text-red-300 border border-red-500'
                  }`}
                >
                  {hud.lastCapturedPhoto.evaluation.qualityScore}/100{' '}
                  {hud.lastCapturedPhoto.evaluation.isValid
                    ? `(+${hud.lastCapturedPhoto.evaluation.awardedPoints}P)`
                    : 'GEÇERSİZ'}
                </span>
              </div>

              <div className="flex gap-2.5 items-center">
                <img
                  src={hud.lastCapturedPhoto.dataUrl}
                  alt={hud.lastCapturedPhoto.targetTitle}
                  className="w-28 h-18 object-cover border border-amber-700/50 shrink-0"
                />
                <div className="text-[11px] font-mono-tabular space-y-0.5 text-stone-300">
                  <div className="font-semibold text-stone-100 truncate max-w-[165px]">
                    {hud.lastCapturedPhoto.targetTitle}
                  </div>
                  <div>
                    Kadraj:{hud.lastCapturedPhoto.evaluation.framingScore}/35 · Açı:
                    {hud.lastCapturedPhoto.evaluation.angleScore}/20
                  </div>
                  <div>
                    Mesafe:{hud.lastCapturedPhoto.evaluation.distanceScore}/20 · Flaş:
                    {hud.lastCapturedPhoto.evaluation.flashScore}/15
                  </div>
                  <div className="text-amber-300 leading-tight pt-0.5">
                    {hud.lastCapturedPhoto.evaluation.feedbackTr}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* BOTTOM-CENTER: Locker Interaction Prompt, Police Subtitles, Elevator Voice, Guide Olga & Tutorial */}
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-full max-w-xl px-4 pointer-events-none z-30">
            {(hud.isInsideLocker || hud.nearbyLockerLabel) && (
              <div
                className="px-5 py-2.5 border-2 flex items-center justify-between gap-4 shadow-xl pointer-events-auto"
                style={{
                  backgroundColor: hud.isInsideLocker
                    ? 'rgba(14, 42, 26, 0.96)'
                    : 'rgba(24, 32, 26, 0.95)',
                  borderColor: hud.isInsideLocker ? '#34d399' : '#fbbf24',
                }}
              >
                <div className="text-xs font-mono-tabular">
                  {hud.isInsideLocker ? (
                    <span className="text-emerald-200 font-bold">
                      DOLAP İÇİNDE GİZLENDİN ({hud.activeHidingSpotLabel}) — Havalandırma ızgarasından dışarıyı izliyorsun
                    </span>
                  ) : (
                    <span className="text-amber-200 font-semibold">
                      SAKLANDIĞIN NOKTA YAKIN: <strong>{hud.nearbyLockerLabel}</strong>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onToggleLocker}
                  className={`px-3 py-1.5 text-xs font-mono-tabular font-bold border cursor-pointer whitespace-nowrap shrink-0 ${
                    hud.isInsideLocker
                      ? 'bg-emerald-800 hover:bg-emerald-700 border-emerald-300 text-emerald-50'
                      : 'bg-amber-700 hover:bg-amber-600 border-amber-300 text-amber-50'
                  }`}
                >
                  {hud.isInsideLocker ? 'Dolaptan Çık [E]' : 'Dolaba Gir ve Saklan [E]'}
                </button>
              </div>
            )}

            {hud.policeActiveQuote && (
              <div
                className="w-full px-5 py-3 border-2 text-center shadow-xl"
                style={{
                  backgroundColor: 'rgba(64, 12, 16, 0.96)',
                  borderColor: '#f87171',
                }}
              >
                <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-red-300 mb-0.5 font-bold">
                  SARIŞIN POLİS MEMURU İGOR · {hud.policeStateLabelTr.toUpperCase()}
                </div>
                <p className="text-sm text-amber-50 font-semibold">{hud.policeActiveQuote}</p>
              </div>
            )}

            {hud.elevatorAnnouncement && (
              <div
                className="w-full px-5 py-3 border-2 text-center shadow-lg"
                style={{
                  backgroundColor: 'rgba(38, 18, 20, 0.95)',
                  borderColor: '#fbbf24',
                }}
              >
                <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-amber-300 mb-0.5">
                  ASANSÖR DAHİLİ HOPARLÖRÜ · YAŞLI KADININ SESİ
                </div>
                <p className="text-sm text-amber-50 font-semibold">{hud.elevatorAnnouncement}</p>
              </div>
            )}

            {hud.currentSubtitle && !hud.elevatorAnnouncement && !hud.policeActiveQuote && (
              <div
                className="w-full px-5 py-2.5 border text-center"
                style={{
                  backgroundColor: 'rgba(12, 16, 14, 0.92)',
                  borderColor: 'rgba(217, 119, 6, 0.5)',
                }}
              >
                <p className="text-sm text-amber-100 font-medium">{hud.currentSubtitle}</p>
              </div>
            )}

            {hud.tutorialRemainingSec > 0 && (
              <div
                className="px-4 py-2 border text-xs text-stone-200 text-center"
                style={{
                  backgroundColor: 'rgba(20, 28, 24, 0.92)',
                  borderColor: 'rgba(148, 163, 152, 0.35)',
                }}
              >
                <span className="font-mono-tabular text-amber-300 font-semibold mr-2">
                  ÖĞRETİCİ ({Math.ceil(hud.tutorialRemainingSec)}sn):
                </span>
                <strong>Sağ Tık / V</strong> vizör, <strong>Sol Tık / Q</strong> fotoğraf çek,{' '}
                <strong>R</strong> flaş, <strong>Tab</strong> görevler, <strong>C</strong> eğil/saklan,{' '}
                <strong>K</strong> polis testi.
              </div>
            )}
          </div>


          {/* ==================== STAGE 3: TASK LIST & SEPIA GALLERY MODAL (TAB) ==================== */}
          {hud.taskModalOpen && (
            <div
              className="fixed inset-0 flex items-center justify-center p-6 pointer-events-auto z-30"
              style={{ backgroundColor: 'rgba(8, 10, 9, 0.93)' }}
            >
              <div
                className="w-full max-w-5xl max-h-[86vh] flex flex-col p-6 border-2 space-y-4 overflow-hidden"
                style={{
                  backgroundColor: '#151916',
                  borderColor: '#c59b43',
                }}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between border-b border-stone-800 pb-3 shrink-0">
                  <div>
                    <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
                      GİZLİ BASIN DOSYASI · TOHUM: {seed}
                    </div>
                    <h2 className="text-2xl font-display font-bold text-stone-100">
                      Fotoğraf Görev Listesi ve Karanlık Oda Galerisi ({completedCount}/
                      {hud.tasks.length} Tamamlandı · Toplam: {hud.totalScore} Puan)
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleTaskModal}
                    className="px-3.5 py-1.5 text-xs font-mono-tabular bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 cursor-pointer"
                  >
                    Kapat [Tab / Esc]
                  </button>
                </div>

                {/* Two-Column Body: Left = Tasks with SVG Hint Sketches, Right = Sepia Photo Gallery */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 overflow-y-auto pr-1">
                  {/* LEFT COLUMN: 9 Photo Tasks */}
                  <div className="space-y-2.5">
                    <div className="text-xs font-mono-tabular font-bold uppercase tracking-wider text-amber-300">
                      1. Tur Görev Listesi (Aynı Anda En Fazla 3 Görev Açık)
                    </div>
                    <div className="space-y-2">
                      {hud.tasks.map((task) => {
                        const isOpen = task.status === 'open';
                        const isDone = task.status === 'completed';
                        const isFailed = task.status === 'failed';
                        return (
                          <div
                            key={task.id}
                            className={`p-3 border flex items-center gap-3 ${
                              isDone
                                ? 'bg-emerald-950/35 border-emerald-500/60'
                                : isOpen
                                  ? 'bg-stone-900/95 border-amber-500/70'
                                  : isFailed
                                    ? 'bg-red-950/30 border-red-700/50 opacity-75'
                                    : 'bg-stone-950/70 border-stone-800 opacity-65'
                            }`}
                          >
                            <TaskHintSketch targetId={task.target.id} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-display font-bold text-stone-100 truncate">
                                  #{task.orderIndex}. {task.target.title}
                                </span>
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] font-mono-tabular font-bold shrink-0 ${
                                    isDone
                                      ? 'bg-emerald-900 text-emerald-200'
                                      : isOpen
                                        ? 'bg-amber-900/80 text-amber-200'
                                        : isFailed
                                          ? 'bg-red-900 text-red-200'
                                          : 'bg-stone-800 text-stone-400'
                                  }`}
                                >
                                  {isDone
                                    ? `TAMAMLANDI (${task.bestScore}/100 · +${task.awardedPoints}P)`
                                    : isOpen
                                      ? `AÇIK · ${Math.ceil(task.remainingSec)} sn`
                                      : isFailed
                                        ? 'SÜRESİ DOLDU'
                                        : 'SIRADA (KİLİTLİ)'}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono-tabular text-amber-300/90 mt-0.5">
                                Oda: {task.target.roomName} · Mesafe: {task.target.minDist}-
                                {task.target.maxDist}m · Tolerans: ±{task.target.toleranceDeg}°{' '}
                                {task.target.requiresFlash ? '· [FLAŞ GEREKLİ]' : ''}
                              </div>
                              <p className="text-[11px] text-stone-400 mt-0.5 leading-snug">
                                {task.target.hintText}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Captured Grainy Sepia Photographs Gallery */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-mono-tabular font-bold uppercase tracking-wider text-amber-300">
                      <span>2. Çekilen Sepya Film Galerisi ({hud.gallery.length} Kare)</span>
                      <span className="text-stone-400">
                        Kalan Film: {hud.filmRemaining}/{GAME_CONFIG.photoCamera.maxFilmCount}
                      </span>
                    </div>

                    {hud.gallery.length === 0 ? (
                      <div className="p-8 border border-stone-800 bg-stone-950/80 text-center space-y-2">
                        <div className="text-sm font-display font-bold text-stone-300">
                          Henüz Fotoğraf Çekilmedi
                        </div>
                        <p className="text-xs text-stone-400 max-w-sm mx-auto">
                          Oyun sırasında <strong>Sağ Tık</strong> (veya <strong>V</strong>) ile
                          vizörü açıp hedefe odaklan, ardından <strong>Sol Tık</strong> (veya{' '}
                          <strong>Q</strong>) ile deklanşöre bas. 60 puan ve üzeri kareler görevi
                          tamamlar.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {hud.gallery.map((item) => (
                          <div
                            key={item.id}
                            className="p-2.5 bg-stone-950 border border-stone-800 space-y-2"
                          >
                            <img
                              src={item.dataUrl}
                              alt={item.targetTitle}
                              className="w-full h-32 object-cover border border-amber-800/40"
                            />
                            <div className="flex items-center justify-between text-xs font-mono-tabular">
                              <span className="font-bold text-amber-200 truncate pr-2">
                                {item.timestampStr}: {item.targetTitle}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                                  item.evaluation.isValid
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/60'
                                    : 'bg-red-950 text-red-300 border border-red-500/60'
                                }`}
                              >
                                {item.evaluation.qualityScore}/100
                              </span>
                            </div>
                            <div className="text-[10px] font-mono-tabular text-stone-400">
                              Kadraj:{item.evaluation.framingScore}/35 · Açı:
                              {item.evaluation.angleScore}/20 · Mesafe:
                              {item.evaluation.distanceScore}/20 · Flaş:
                              {item.evaluation.flashScore}/15
                            </div>
                            <div className="text-[11px] text-amber-300/90 leading-tight">
                              {item.evaluation.feedbackTr}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== BABUSHKA'S MATRYOSHKA & UNIFORM PHOTOS MODAL ==================== */}
          {hud.babushkaModalOpen && (
            <div
              className="fixed inset-0 flex items-center justify-center p-6 pointer-events-auto z-30"
              style={{ backgroundColor: 'rgba(8, 10, 9, 0.92)' }}
            >
              <div
                className="w-full max-w-3xl p-6 border-2 space-y-5"
                style={{
                  backgroundColor: '#181412',
                  borderColor: '#d4af37',
                }}
              >
                <div className="flex items-start justify-between border-b border-stone-800 pb-3">
                  <div>
                    <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
                      SON KAT (3. KAT) · ÇATI KULESİ ODASI
                    </div>
                    <h2 className="text-2xl font-display font-bold text-stone-100 mt-0.5">
                      Yaşlı Kadın (Babuşka Valentina): Matruşkalarım ve Eski Üniformalı Fotoğraflarım
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleBabushkaModal}
                    className="px-3 py-1.5 text-xs font-mono-tabular bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 cursor-pointer"
                  >
                    Kapat [G / Esc]
                  </button>
                </div>

                <p className="text-sm text-amber-100/90 italic bg-stone-900/90 p-3.5 border border-amber-700/40">
                  &ldquo;Asansörde sesimi duyup son kata kadar çıktın demek yavrum... Yıllardır bu
                  binanın santralini ve asansörünü ben beklerim. Gel, sana el boyaması 5&apos;li
                  matruşkalarımı ve gençliğimde üniformayla çekilmiş fotoğraflarımı göstereyim.&rdquo;
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Card 1: 5-Piece Nested Soviet Matryoshka Collection */}
                  <div className="p-4 bg-stone-950 border border-amber-600/40 space-y-3">
                    <div className="text-xs font-mono-tabular font-bold text-amber-300 uppercase tracking-wider">
                      1. El Boyaması 5&apos;li Sovyet Matruşka Seti
                    </div>
                    <svg
                      viewBox="0 0 320 150"
                      className="w-full h-36 bg-[#120e0c] border border-stone-800 p-2"
                      aria-label="Beşli Matruşka Bebekleri"
                    >
                      {[0, 1, 2, 3, 4].map((idx) => {
                        const s = 1 - idx * 0.16;
                        const cx = 48 + idx * 58;
                        const baseY = 135;
                        const w = 24 * s;
                        const h = 76 * s;
                        return (
                          <g key={idx}>
                            <ellipse
                              cx={cx}
                              cy={baseY - h * 0.42}
                              rx={w}
                              ry={h * 0.45}
                              fill="#9e261f"
                              stroke="#d4af37"
                              strokeWidth="2"
                            />
                            <ellipse
                              cx={cx}
                              cy={baseY - h * 0.38}
                              rx={w * 0.72}
                              ry={h * 0.28}
                              fill="#e5c158"
                            />
                            <circle cx={cx} cy={baseY - h * 0.38} r={4 * s} fill="#9e261f" />
                            <circle
                              cx={cx}
                              cy={baseY - h * 0.85}
                              r={w * 0.68}
                              fill="#b8332a"
                              stroke="#d4af37"
                              strokeWidth="1.5"
                            />
                            <circle cx={cx} cy={baseY - h * 0.85} r={w * 0.48} fill="#f3dec0" />
                            <circle cx={cx - 3 * s} cy={baseY - h * 0.87} r={1.4 * s} fill="#1f1a17" />
                            <circle cx={cx + 3 * s} cy={baseY - h * 0.87} r={1.4 * s} fill="#1f1a17" />
                          </g>
                        );
                      })}
                    </svg>
                    <p className="text-xs text-stone-300 leading-relaxed">
                      İç içe geçen 5 ahşap matruşka bebeği; binanın 5 katmanını ve sırlarını temsil
                      ediyor. En küçüğünün içinde 1958 yılına ait anahtar mührü saklı.
                    </p>
                  </div>

                  {/* Card 2: Old Photographs in Soviet Uniform */}
                  <div className="p-4 bg-stone-950 border border-amber-600/40 space-y-3">
                    <div className="text-xs font-mono-tabular font-bold text-amber-300 uppercase tracking-wider">
                      2. Eskiden Üniforma İle Olan Fotoğrafları (1958 &amp; 1964)
                    </div>
                    <svg
                      viewBox="0 0 320 150"
                      className="w-full h-36 bg-[#1a1510] border border-stone-800 p-2"
                      aria-label="Yaşlı Kadının Gençlik Üniformalı Fotoğrafları"
                    >
                      <g transform="translate(14, 8)">
                        <rect x="0" y="0" width="132" height="128" fill="#c8b48e" stroke="#8c734b" strokeWidth="3" />
                        <rect x="6" y="6" width="120" height="116" fill="#9c8663" />
                        <polygon points="22,122 36,74 96,74 110,122" fill="#2d382c" />
                        <rect x="30" y="72" width="22" height="7" fill="#d4af37" />
                        <rect x="80" y="72" width="22" height="7" fill="#d4af37" />
                        <rect x="44" y="86" width="7" height="9" fill="#9e261f" />
                        <circle cx="47.5" cy="99" r="4.5" fill="#e5c158" />
                        <rect x="56" y="86" width="7" height="9" fill="#9e261f" />
                        <circle cx="59.5" cy="99" r="4.5" fill="#e5c158" />
                        <circle cx="66" cy="52" r="16" fill="#e6d2b5" />
                        <polygon points="44,40 88,40 94,26 38,26" fill="#253024" />
                        <rect x="46" y="37" width="40" height="5" fill="#9e261f" />
                        <polygon points="66,29 68,34 73,34 69,37 70,41 66,38 62,41 63,37 59,34 64,34" fill="#e5c158" />
                        <text x="12" y="118" fill="#1f1812" fontSize="9" fontFamily="IBM Plex Mono, monospace" fontWeight="600">
                          TEĞMEN VALENTINA · 1958
                        </text>
                      </g>

                      <g transform="translate(168, 8)">
                        <rect x="0" y="0" width="136" height="128" fill="#c8b48e" stroke="#8c734b" strokeWidth="3" />
                        <rect x="6" y="6" width="124" height="116" fill="#8f7a58" />
                        <polygon points="102,32 106,44 118,44 108,52 112,64 102,56 92,64 96,52 86,44 98,44" fill="#6e221d" />
                        <polygon points="32,122 42,68 78,68 88,122" fill="#263025" />
                        <rect x="38" y="67" width="16" height="6" fill="#d4af37" />
                        <rect x="66" y="67" width="16" height="6" fill="#d4af37" />
                        <rect x="42" y="96" width="36" height="5" fill="#1a1715" />
                        <rect x="57" y="95" width="6" height="7" fill="#d4af37" />
                        <circle cx="60" cy="49" r="14" fill="#e6d2b5" />
                        <polygon points="42,38 78,38 82,26 38,26" fill="#253024" />
                        <text x="12" y="118" fill="#1f1812" fontSize="9" fontFamily="IBM Plex Mono, monospace" fontWeight="600">
                          KÜLTÜR SARAYI · 1964
                        </text>
                      </g>
                    </svg>
                    <p className="text-xs text-stone-300 leading-relaxed">
                      Sepya çerçevelerde Valentina&apos;nın gençliğinde resmi Sovyet subay
                      üniforması, altın apoletleri ve madalyalarıyla Kültür Sarayı açılışında
                      çekilmiş orijinal fotoğrafları yer alıyor.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== 3. PAUSE MODAL ('paused') ==================== */}
      {gameState === 'paused' && (
        <div
          className="fixed inset-0 flex items-center justify-center p-6 pointer-events-auto z-30"
          style={{ backgroundColor: 'rgba(8, 11, 9, 0.9)' }}
        >
          <div
            className="w-full max-w-md p-6 border-2 space-y-5"
            style={{
              backgroundColor: '#141a16',
              borderColor: '#b8964c',
            }}
          >
            <div className="border-b border-stone-800 pb-3">
              <h2 className="text-2xl font-display font-bold text-stone-100 tracking-wide">
                TUR DURAKLATILDI
              </h2>
              <p className="text-xs font-mono-tabular text-stone-400 mt-0.5">
                TOHUM KODU: {seed} · ZORLUK: {GAME_CONFIG.difficulties[difficulty].label}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 bg-stone-900 border border-stone-800">
                <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                  KALAN SÜRE
                </div>
                <div className="text-lg font-display font-bold font-mono-tabular text-amber-300 mt-0.5">
                  {formatMMSS(hud.tourRemainingSec)}
                </div>
              </div>
              <div className="p-2.5 bg-stone-900 border border-stone-800">
                <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                  GÖREVLER
                </div>
                <div className="text-lg font-display font-bold font-mono-tabular text-emerald-300 mt-0.5">
                  {completedCount}/{hud.tasks.length}
                </div>
              </div>
              <div className="p-2.5 bg-stone-900 border border-stone-800">
                <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                  TOPLAM PUAN
                </div>
                <div className="text-lg font-display font-bold font-mono-tabular text-amber-200 mt-0.5">
                  {hud.totalScore}
                </div>
              </div>
            </div>

            {/* In-Pause Settings (Fare Hassasiyeti & Ses) */}
            <div className="p-3.5 bg-stone-950/90 border border-stone-800 space-y-3">
              <div className="text-[11px] font-mono-tabular uppercase tracking-wider text-amber-300/90 font-semibold">
                OYUN İÇİ AYARLAR
              </div>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label
                    htmlFor="pause-sens-range"
                    className="block text-[11px] text-stone-400 mb-1 font-mono-tabular"
                  >
                    Fare Hassasiyeti: {(mouseSensitivity * 1000).toFixed(1)}
                  </label>
                  <input
                    id="pause-sens-range"
                    type="range"
                    min="0.0008"
                    max="0.005"
                    step="0.0002"
                    value={mouseSensitivity}
                    onChange={(e) => onSensitivityChange(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={onToggleMute}
                    className="px-3 py-1.5 text-xs font-mono-tabular border border-stone-700 bg-stone-900 hover:bg-stone-800 text-stone-200 cursor-pointer"
                  >
                    {isMuted ? 'Ses: KAPALI [M]' : 'Ses: AÇIK [M]'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={onResumeGame}
                className="w-full py-3 px-4 text-sm font-display font-bold uppercase tracking-wider bg-amber-700 hover:bg-amber-600 text-stone-100 border border-amber-400 cursor-pointer"
              >
                Tura Devam Et [ESC]
              </button>
              <button
                type="button"
                onClick={onFinishTourNow}
                className="w-full py-2.5 px-4 text-sm font-display font-bold uppercase tracking-wide bg-emerald-900/90 hover:bg-emerald-800 text-emerald-100 border border-emerald-400/70 cursor-pointer"
              >
                Turu Şimdi Bitir &amp; Sonuç Ekranı [B]
              </button>
              <button
                type="button"
                onClick={onRestartGame}
                className="w-full py-2.5 px-4 text-sm font-semibold bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 cursor-pointer"
              >
                Turu Baştan Başlat
              </button>
              <button
                type="button"
                onClick={onReturnToTitle}
                className="w-full py-2.5 px-4 text-sm font-semibold bg-stone-900 hover:bg-stone-800 text-stone-400 border border-stone-800 cursor-pointer"
              >
                Ana Menüye Dön
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. END-OF-TOUR 35MM CONTACT STRIP RESULTS SCREEN ('gameover') ==================== */}
      {gameState === 'gameover' && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 md:p-6 pointer-events-auto z-30 overflow-y-auto"
          style={{ backgroundColor: 'rgba(7, 10, 8, 0.94)' }}
        >
          <div
            className="w-full max-w-6xl p-5 md:p-7 border-2 space-y-5 my-auto max-h-[94vh] overflow-y-auto"
            style={{
              backgroundColor: '#121714',
              borderColor:
                hud.gameOverReason === 'caught_by_police' ? '#b8332a' : '#d4af37',
            }}
          >
            {/* 1. Top Press Dossier Header & Journalist Rank Stamp (Amatör / Muhabir / Usta) */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-stone-800 pb-4">
              <div className="space-y-1">
                <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
                  {hud.gameOverReason === 'caught_by_police'
                    ? '3 CAN BİTTİ · POLİS MEMURU İGOR KAMERANA EL KOYDU'
                    : 'TUR SONU BASIN RAPORU · 35MM KARANLIK ODA BASKISI'}
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-stone-100">
                  {hud.gameOverReason === 'caught_by_police'
                    ? 'POLİS MEMURU İGOR SENİ YAKALADI — TUR SONU RAPORU'
                    : 'TUR TAMAMLANDI — KONTAK ŞERİDİ & DEĞERLENDİRME'}
                </h2>
                <p className="text-xs text-stone-300 max-w-2xl">
                  {rankMeta.descriptionTr}
                </p>
              </div>

              {/* Journalist Rank Badge (Amatör / Muhabir / Usta) */}
              <div
                data-testid="journalist-rank-badge"
                className="px-5 py-3 border-2 shrink-0 text-right"
                style={{
                  backgroundColor:
                    rankMeta.rank === 'Usta'
                      ? 'rgba(6, 52, 36, 0.95)'
                      : rankMeta.rank === 'Muhabir'
                        ? 'rgba(62, 42, 10, 0.95)'
                        : 'rgba(30, 32, 30, 0.95)',
                  borderColor:
                    rankMeta.rank === 'Usta'
                      ? '#34d399'
                      : rankMeta.rank === 'Muhabir'
                        ? '#fbbf24'
                        : '#a8a29e',
                }}
              >
                <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-stone-300">
                  BASIN KARTI RÜTBESİ (AMATÖR / MUHABİR / USTA)
                </div>
                <div className="text-2xl font-display font-bold tracking-wider uppercase text-amber-200 mt-0.5">
                  RÜTBE: {rankMeta.rank.toUpperCase()}
                </div>
                <div className="text-[11px] font-mono-tabular text-stone-300">
                  {rankMeta.fullTitleTr}
                </div>
              </div>
            </div>

            {/* 2. Key Telemetry Strip + Score Code (Seed + Puan) & Action Buttons */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
              {/* 4 Telemetry Metrics */}
              <div className="lg:col-span-5 grid grid-cols-4 gap-2 text-center">
                <div className="p-3 bg-stone-950 border border-stone-800 flex flex-col justify-center">
                  <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                    TOPLAM PUAN
                  </div>
                  <div
                    data-testid="final-total-score"
                    className="text-2xl font-display font-bold font-mono-tabular text-amber-300 mt-0.5"
                  >
                    {hud.totalScore}
                  </div>
                </div>
                <div className="p-3 bg-stone-950 border border-stone-800 flex flex-col justify-center">
                  <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                    GÖREVLER
                  </div>
                  <div className="text-xl font-display font-bold font-mono-tabular text-emerald-300 mt-0.5">
                    {completedCount}/{hud.tasks.length}
                  </div>
                </div>
                <div className="p-3 bg-stone-950 border border-stone-800 flex flex-col justify-center">
                  <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                    KARELER
                  </div>
                  <div className="text-xl font-display font-bold font-mono-tabular text-stone-100 mt-0.5">
                    {hud.gallery.length}/{GAME_CONFIG.photoCamera.maxFilmCount}
                  </div>
                </div>
                <div className="p-3 bg-stone-950 border border-stone-800 flex flex-col justify-center">
                  <div className="text-[10px] font-mono-tabular text-stone-400 uppercase">
                    KALAN CAN
                  </div>
                  <div className="text-xl font-display font-bold font-mono-tabular text-red-300 mt-0.5">
                    {hud.lives}/3
                  </div>
                </div>
              </div>

              {/* Score Code (Seed + Score) Copy Box & Contact Strip Download */}
              <div className="lg:col-span-7 p-3.5 bg-stone-950 border border-amber-600/40 flex flex-col justify-between gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono-tabular uppercase tracking-wider text-amber-300 font-bold">
                    SKOR KODU (TOHUM + PUAN + RÜTBE DOĞRULAMA KODU)
                  </span>
                  <span className="text-[11px] font-mono-tabular text-stone-400">
                    Tohum: <strong className="text-stone-200">{seed}</strong> · Zorluk:{' '}
                    <strong className="text-stone-200">
                      {GAME_CONFIG.difficulties[difficulty].label}
                    </strong>
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <code
                    data-testid="score-code-display"
                    className="flex-1 px-3 py-1.5 bg-[#0b0e0c] border border-stone-700 text-xs font-mono-tabular text-amber-200 select-all"
                  >
                    {currentScoreCode}
                  </code>
                  <button
                    type="button"
                    data-testid="copy-score-code-btn"
                    onClick={handleCopyScoreCode}
                    className={`px-3.5 py-1.5 text-xs font-mono-tabular font-bold border cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      copiedScoreCode
                        ? 'bg-emerald-800 border-emerald-300 text-emerald-100'
                        : 'bg-amber-800/90 hover:bg-amber-700 border-amber-400 text-amber-50'
                    }`}
                  >
                    {copiedScoreCode ? 'SKOR KODU KOPYALANDI! ✓' : 'Skor Kodunu Kopyala'}
                  </button>
                  <button
                    type="button"
                    data-testid="download-contact-strip-btn"
                    onClick={() => {
                      void downloadContactStripSheetPng({
                        gallery: hud.gallery,
                        seed,
                        difficulty,
                        totalScore: hud.totalScore,
                        rank: rankMeta.rank,
                        completedCount,
                        totalTasks: hud.tasks.length,
                        scoreCode: currentScoreCode,
                      });
                    }}
                    className="px-3.5 py-1.5 text-xs font-mono-tabular font-bold bg-stone-800 hover:bg-stone-700 text-amber-200 border border-amber-500/60 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Kontak Şeridini İndir (.PNG)
                  </button>
                </div>
              </div>
            </div>

            {/* 3. Main Split View: 35mm Contact Strip (Left 8 cols) + Selected Frame / Leaderboard & Tasks (Right 4 cols) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* LEFT 8 COLS: 35MM DARKROOM CONTACT STRIP (KONTAK ŞERİDİ) */}
              <div className="lg:col-span-8 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-mono-tabular uppercase tracking-wider text-amber-300 font-bold">
                    35MM KONTAK ŞERİDİ (ÇEKİLEN TÜM FOTOĞRAFLAR VE PUANLARI · {hud.gallery.length} KARE)
                  </h3>
                  <span className="text-[11px] font-mono-tabular text-stone-400">
                    Kareye tıklayarak büyütebilir veya tek tek indirebilirsin
                  </span>
                </div>

                {/* Authentic 35mm Film Strip Container with Top & Bottom Sprocket Perforations */}
                <div
                  data-testid="contact-strip-container"
                  className="p-3 border-2"
                  style={{
                    backgroundColor: '#0c0a08',
                    borderColor: '#3f382c',
                  }}
                >
                  {/* Top 35mm Film Sprocket Holes */}
                  <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-stone-800/80 overflow-hidden">
                    {Array.from({ length: 22 }).map((_, idx) => (
                      <div
                        key={`top-perf-${idx}`}
                        className="w-3.5 h-2 bg-[#1c1916] border border-stone-700/50 shrink-0"
                      />
                    ))}
                  </div>

                  {hud.gallery.length === 0 ? (
                    <div className="py-10 px-4 text-center space-y-2 bg-[#14110e] border border-stone-800">
                      <div className="text-sm font-display font-bold text-amber-200">
                        BU TURDA HİÇ FOTOĞRAF ÇEKİLMEDİ (POZLANMAMIŞ 35MM NEGATİF ŞERİT)
                      </div>
                      <p className="text-xs text-stone-400 max-w-md mx-auto">
                        Oyun sırasında <strong>Sağ Tık</strong> (veya <strong>V</strong>) ile
                        vizörü açıp görev hedeflerini kadraja alarak <strong>Sol Tık</strong> (veya{' '}
                        <strong>Q</strong>) ile fotoğraf çektiğinde tüm kareler bu kontak şeridinde
                        sıralanır. Yine de üstteki butondan kontak şeridi raporunu (.PNG)
                        indirebilirsin.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[340px] overflow-y-auto p-1">
                      {hud.gallery.map((item) => {
                        const isSelected = selectedContactPhoto?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            onClick={() => setSelectedContactPhotoId(item.id)}
                            className={`p-2 bg-[#15120e] border transition-colors cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? 'border-amber-400 ring-1 ring-amber-400/60'
                                : 'border-stone-800 hover:border-amber-600/60'
                            }`}
                          >
                            <div>
                              {/* Film Negative Frame Code Header */}
                              <div className="flex items-center justify-between text-[10px] font-mono-tabular text-amber-500/90 mb-1">
                                <span>
                                  KARE #{String(item.frameNumber).padStart(2, '0')}A · 35MM
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 font-bold ${
                                    item.evaluation.isValid
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/60'
                                      : 'bg-red-950 text-red-300 border border-red-500/60'
                                  }`}
                                >
                                  {item.evaluation.qualityScore}/100
                                </span>
                              </div>


                              {/* Sepia Grainy Thumbnail */}
                              <img
                                src={item.dataUrl}
                                alt={item.targetTitle}
                                className="w-full h-24 object-cover border border-amber-900/40"
                              />

                              <div className="mt-1.5 text-xs font-semibold text-stone-100 truncate">
                                {item.targetTitle}
                              </div>
                              <div className="text-[10px] font-mono-tabular text-stone-400 flex items-center justify-between mt-0.5">
                                <span>
                                  {item.evaluation.isValid
                                    ? `+${item.evaluation.awardedPoints} Puan`
                                    : 'Geçersiz (<60)'}
                                </span>
                                <span>
                                  K:{item.evaluation.framingScore} A:{item.evaluation.angleScore} M:
                                  {item.evaluation.distanceScore}
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadSinglePhotoFrame(item, seed);
                              }}
                              className="mt-2 w-full py-1 px-2 text-[10px] font-mono-tabular bg-stone-900 hover:bg-amber-900/80 text-amber-200 border border-stone-700 cursor-pointer"
                            >
                              Kareyi İndir (.PNG)
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Bottom 35mm Film Sprocket Holes */}
                  <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-stone-800/80 overflow-hidden">
                    {Array.from({ length: 22 }).map((_, idx) => (
                      <div
                        key={`bot-perf-${idx}`}
                        className="w-3.5 h-2 bg-[#1c1916] border border-stone-700/50 shrink-0"
                      />
                    ))}
                  </div>
                </div>

                {/* Selected Frame Detailed Inspection Strip */}
                {selectedContactPhoto && (
                  <div className="p-3 bg-stone-950 border border-stone-800 flex flex-col sm:flex-row items-center gap-3.5">
                    <img
                      src={selectedContactPhoto.dataUrl}
                      alt={selectedContactPhoto.targetTitle}
                      className="w-40 h-28 object-cover border border-amber-500/50 shrink-0"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-display font-bold text-amber-200 truncate">
                          SEÇİLİ KARE #{String(selectedContactPhoto.frameNumber).padStart(2, '0')}A:{' '}
                          {selectedContactPhoto.targetTitle}
                        </span>
                        <span className="text-xs font-mono-tabular font-bold text-emerald-300 shrink-0">
                          Kalite: {selectedContactPhoto.evaluation.qualityScore}/100 (+
                          {selectedContactPhoto.evaluation.awardedPoints} Puan)
                        </span>
                      </div>
                      <div className="text-[11px] font-mono-tabular text-stone-300">
                        Kadraj Merkezleme: {selectedContactPhoto.evaluation.framingScore}/35 · Bakış
                        Açısı: {selectedContactPhoto.evaluation.angleScore}/20 · Mesafe:{' '}
                        {selectedContactPhoto.evaluation.distanceScore}/20 · Flaş:{' '}
                        {selectedContactPhoto.evaluation.flashScore}/15 · Zamanlama Bonusu: +
                        {selectedContactPhoto.evaluation.timingBonus}
                      </div>
                      <div className="text-xs text-amber-300/90">
                        {selectedContactPhoto.evaluation.feedbackTr}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT 4 COLS: LOCAL LEADERBOARD (YEREL SKOR TABLOSU) & TASK STATUS SUMMARY */}
              <div className="lg:col-span-4 space-y-4">
                {/* Local Leaderboard in Results Screen */}
                <div className="p-3.5 bg-stone-950 border border-stone-800 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-stone-800 pb-2">
                    <h3 className="text-xs font-mono-tabular uppercase tracking-wider text-amber-300 font-bold">
                      YEREL SKOR TABLOSU (LOCALSTORAGE)
                    </h3>
                    <span className="text-[10px] font-mono-tabular text-stone-400">
                      İlk { Math.min(6, leaderboard.length) } Kayıt
                    </span>
                  </div>

                  {leaderboard.length === 0 ? (
                    <div className="text-xs text-stone-400 py-3 text-center">
                      Skor tablosu yükleniyor...
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {leaderboard.slice(0, 6).map((entry, idx) => {
                        const isCurrentRun = entry.scoreCode === currentScoreCode;
                        return (
                          <div
                            key={entry.id}
                            className={`p-2 border text-xs font-mono-tabular flex items-center justify-between gap-2 ${
                              isCurrentRun
                                ? 'bg-amber-950/50 border-amber-400 text-amber-100'
                                : 'bg-stone-900/80 border-stone-800 text-stone-300'
                            }`}
                          >
                            <div className="truncate">
                              <span className="text-amber-400 font-bold mr-1.5">#{idx + 1}</span>
                              <span className="font-bold">{entry.totalScore}p</span>
                              <span className="mx-1.5 text-[10px] px-1 py-0.5 bg-stone-800 border border-stone-600">
                                {entry.rank}
                              </span>
                              <span className="text-[10px] text-stone-400">{entry.seed}</span>
                            </div>
                            <span className="text-[10px] text-emerald-300 shrink-0">
                              {entry.completedTasks}/{entry.totalTasks} Görev
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Tour Photo Tasks Final Checklist */}
                <div className="p-3.5 bg-stone-950 border border-stone-800 space-y-2">
                  <div className="text-xs font-mono-tabular uppercase tracking-wider text-stone-300 font-bold border-b border-stone-800 pb-1.5">
                    GÖREV LİSTESİ SONUÇ DÖKÜMÜ ({completedCount}/{hud.tasks.length})
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {hud.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between text-[11px] font-mono-tabular py-1 border-b border-stone-900"
                      >
                        <span className="truncate pr-2 text-stone-300">
                          #{task.orderIndex} {task.target.title}
                        </span>
                        <span
                          className={`shrink-0 font-bold ${
                            task.status === 'completed'
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {task.status === 'completed'
                            ? `✓ +${task.awardedPoints}p (${task.bestScore}/100)`
                            : '✗ BAŞARISIZ'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 4. Bottom Action Bar: Replay Same Seed or Return to Main Menu */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-stone-800">
              <div className="text-xs font-mono-tabular text-stone-400">
                Aynı tohum kodu (<strong>{seed}</strong>) ile tekrar oynayarak rotayı ezberleyip{' '}
                <strong>USTA (600+ Puan)</strong> rütbesine ulaşabilirsin.
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-start="true"
                  onClick={onRestartGame}
                  className="py-2.5 px-6 text-sm font-display font-bold uppercase tracking-wider bg-red-800 hover:bg-red-700 text-stone-100 border border-red-400 cursor-pointer"
                >
                  Aynı Tohumla Tekrar Oyna
                </button>
                <button
                  type="button"
                  onClick={onReturnToTitle}
                  className="py-2.5 px-5 text-sm font-semibold bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-600 cursor-pointer"
                >
                  Ana Menüye Dön
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


