/**
 * Photo Camera, Task Queue, Viewfinder Preview & Sepia Gallery System ("Son Tur" — Stage 3).
 * Handles:
 * - 9 seeded photo tasks per tour (2-3 open concurrently, 65-115s time windows)
 * - Viewfinder zoom (Right Click / V), Flash toggle (R) & 3D flash PointLight burst
 * - 0-100 photo quality scoring via raycast obstruction, framing, angle, distance, motion blur, flash & timing
 * - Grainy sepia film capture from the WebGL canvas into the player's gallery
 */

import * as THREE from 'three';
import { GAME_CONFIG } from './config';
import { SeededRNG } from './prng';
import { SoundSynthesizer } from './audio';
import type { AABBBox, PhotoZoneTarget } from './level';
import type { PlayerObstacleCylinder } from './player';
import {
  checkRayObstruction,
  evaluatePhotoShot,
  PhotoEvaluationResult,
} from './scoring';

export type PhotoTaskStatus = 'locked' | 'open' | 'completed' | 'failed';

export interface PhotoTaskInstance {
  id: string;
  orderIndex: number;
  target: PhotoZoneTarget;
  status: PhotoTaskStatus;
  timeWindowSec: number;
  remainingSec: number;
  bestScore: number;
  awardedPoints: number;
  capturedPhotoId: string | null;
}

export interface CapturedPhotoRecord {
  id: string;
  frameNumber: number;
  dataUrl: string;
  targetId: string | null;
  targetTitle: string;
  roomName: string;
  isTaskTarget: boolean;
  evaluation: PhotoEvaluationResult;
  timestampStr: string;
}

export interface LiveViewfinderPreview {
  targetTitle: string;
  roomName: string;
  isOpenTask: boolean;
  alreadyCompleted: boolean;
  distanceMeters: number;
  minDist: number;
  maxDist: number;
  distanceOk: boolean;
  angleOk: boolean;
  requiresFlash: boolean;
  flashReady: boolean;
  obstructedBy: 'none' | 'wall' | 'npc';
  estimatedQuality: number;
}

export class PhotoCameraSystem {
  public isAiming = false;
  public flashEnabled = false;
  public flashCooldownSec = 0;
  public screenFlashAlpha = 0;

  public currentFov: number = GAME_CONFIG.photoCamera.normalFov;
  public targetZoomFov: number = 42;
  public filmRemaining: number = GAME_CONFIG.photoCamera.maxFilmCount;

  public tasks: PhotoTaskInstance[] = [];
  public gallery: CapturedPhotoRecord[] = [];
  public totalScore = 0;

  public livePreview: LiveViewfinderPreview | null = null;
  public lastCapturedPhoto: CapturedPhotoRecord | null = null;
  public lastCaptureBannerTimer = 0;

  public readonly flashBurstLight: THREE.PointLight;
  private flashLightTimer = 0;

  // Scratch vectors to avoid GC
  private readonly _projVec = new THREE.Vector3();
  private readonly _camToTarget = new THREE.Vector3();
  private readonly _camForward = new THREE.Vector3();
  private offscreenCanvas: HTMLCanvasElement | null = null;

  constructor(scene?: THREE.Scene) {
    this.flashBurstLight = new THREE.PointLight(
      0xfff6e0,
      0,
      GAME_CONFIG.photoCamera.flashRangeMeters,
      1.3,
    );
    if (scene) {
      scene.add(this.flashBurstLight);
    }
  }

  public initTasks(photoTargets: PhotoZoneTarget[], seed: string): void {
    const rng = new SeededRNG(seed + '-photo-tasks');
    // Keep Entrance Hall (photo_star) and Corridor (photo_poster_corridor / photo_stair_mural) first
    // so the player can immediately photograph targets on Floor 1, and keep Babushka's room last.
    const firstTargets = photoTargets.filter(
      (t) => t.id === 'photo_star' || t.id === 'photo_poster_corridor',
    );
    const finalTarget = photoTargets.filter((t) => t.id === 'photo_matryoshka_uniform');
    const middleTargets = photoTargets.filter(
      (t) =>
        t.id !== 'photo_star' &&
        t.id !== 'photo_poster_corridor' &&
        t.id !== 'photo_matryoshka_uniform',
    );
    if (rng.next() > 0.5) {
      middleTargets.reverse();
    }

    const ordered = [...firstTargets, ...middleTargets, ...finalTarget].slice(
      0,
      GAME_CONFIG.photoCamera.tasksPerTour,
    );

    this.tasks = ordered.map((target, idx) => {
      // Generous seeded time window (85-120s) so tasks stay open smoothly while exploring
      const winSec = rng.int(85, GAME_CONFIG.photoCamera.taskWindowMaxSec);
      return {
        id: `task_${target.id}`,
        orderIndex: idx + 1,
        target,
        status: idx < GAME_CONFIG.photoCamera.maxConcurrentTasks ? 'open' : 'locked',
        timeWindowSec: winSec,
        remainingSec: winSec,
        bestScore: 0,
        awardedPoints: 0,
        capturedPhotoId: null,
      };
    });
  }

  public reset(photoTargets?: PhotoZoneTarget[], seed = 'SOVYET-1984'): void {
    this.isAiming = false;
    this.flashEnabled = false;
    this.flashCooldownSec = 0;
    this.screenFlashAlpha = 0;
    this.flashLightTimer = 0;
    this.flashBurstLight.intensity = 0;
    this.currentFov = GAME_CONFIG.photoCamera.normalFov;
    this.targetZoomFov = 42;
    this.filmRemaining = GAME_CONFIG.photoCamera.maxFilmCount;
    this.gallery = [];
    this.totalScore = 0;
    this.livePreview = null;
    this.lastCapturedPhoto = null;
    this.lastCaptureBannerTimer = 0;

    if (photoTargets && photoTargets.length > 0) {
      this.initTasks(photoTargets, seed);
    }
  }

  public toggleFlash(audio: SoundSynthesizer): void {
    this.flashEnabled = !this.flashEnabled;
    audio.playSwitchClick(this.flashEnabled);
  }

  public setAiming(aiming: boolean): void {
    this.isAiming = aiming;
  }

  public toggleAiming(audio: SoundSynthesizer): void {
    this.isAiming = !this.isAiming;
    audio.playSwitchClick(this.isAiming);
  }

  public adjustZoom(wheelDeltaY: number): void {
    if (!this.isAiming) return;
    this.targetZoomFov = THREE.MathUtils.clamp(
      this.targetZoomFov + (wheelDeltaY > 0 ? 4 : -4),
      GAME_CONFIG.photoCamera.zoomFovMin,
      GAME_CONFIG.photoCamera.zoomFovMax,
    );
  }

  public getZoomMagnification(): number {
    return Number((GAME_CONFIG.photoCamera.normalFov / this.currentFov).toFixed(1));
  }

  private ensureOpenTaskSlots(): void {
    const openCount = this.tasks.filter((t) => t.status === 'open').length;
    const needed = GAME_CONFIG.photoCamera.maxConcurrentTasks - openCount;
    if (needed <= 0) return;

    let unlocked = 0;
    for (const task of this.tasks) {
      if (task.status === 'locked') {
        task.status = 'open';
        unlocked++;
        if (unlocked >= needed) break;
      }
    }
  }

  /**
   * Marks any remaining open or locked tasks as failed when the tour ends.
   */
  public finalizeRemainingTasksOnTourEnd(): void {
    for (const task of this.tasks) {
      if (task.status === 'open' || task.status === 'locked') {
        task.status = 'failed';
      }
    }
  }

  public update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    colliders?: AABBBox[],
    npcObstacles?: PlayerObstacleCylinder[],
    playerSpeed = 0,
  ): void {
    // 1. Smoothly interpolate camera FOV for viewfinder zoom
    const desiredFov = this.isAiming ? this.targetZoomFov : GAME_CONFIG.photoCamera.normalFov;
    if (Math.abs(this.currentFov - desiredFov) > 0.05) {
      this.currentFov = THREE.MathUtils.damp(
        this.currentFov,
        desiredFov,
        GAME_CONFIG.photoCamera.zoomSpeed,
        dt,
      );
      camera.fov = this.currentFov;
      camera.updateProjectionMatrix();
    }

    // 2. Update flash recharge, 3D flash light burst, and HUD banners
    if (this.flashCooldownSec > 0) {
      this.flashCooldownSec = Math.max(0, this.flashCooldownSec - dt);
    }
    if (this.screenFlashAlpha > 0) {
      this.screenFlashAlpha = Math.max(0, this.screenFlashAlpha - dt * 2.8);
    }
    if (this.flashLightTimer > 0) {
      this.flashLightTimer = Math.max(0, this.flashLightTimer - dt);
      this.flashBurstLight.position.copy(camera.position);
      this.flashBurstLight.intensity = (this.flashLightTimer / 0.24) * 18.0;
    } else {
      this.flashBurstLight.intensity = 0;
    }
    if (this.lastCaptureBannerTimer > 0) {
      this.lastCaptureBannerTimer = Math.max(0, this.lastCaptureBannerTimer - dt);
    }

    // 3. Tick open photo task timers & unlock next tasks sequentially
    let slotFreed = false;
    for (const task of this.tasks) {
      if (task.status === 'open') {
        task.remainingSec = Math.max(0, task.remainingSec - dt);
        if (task.remainingSec <= 0) {
          task.status = 'failed';
          slotFreed = true;
        }
      }
    }
    if (slotFreed) {
      this.ensureOpenTaskSlots();
    }

    // 4. Compute live viewfinder target preview when aiming (or looking at a target)
    if (colliders && npcObstacles) {
      this.livePreview = this.computeBestFramedPreview(camera, colliders, npcObstacles, playerSpeed);
    }
  }

  private evaluateSingleTaskForCamera(
    task: PhotoTaskInstance,
    camera: THREE.PerspectiveCamera,
    colliders: AABBBox[],
    npcObstacles: PlayerObstacleCylinder[],
    playerSpeed: number,
    flashUsed: boolean,
  ): {
    evalResult: PhotoEvaluationResult;
    ndcX: number;
    ndcY: number;
    inFront: boolean;
    distanceMeters: number;
    angleDiffDeg: number;
    obstructedBy: 'none' | 'wall' | 'npc';
  } {
    const targetPos = task.target.position;
    this._projVec.copy(targetPos).project(camera);

    this._camToTarget.subVectors(targetPos, camera.position);
    const distanceMeters = this._camToTarget.length();
    this._camToTarget.normalize();

    camera.getWorldDirection(this._camForward);
    const inFront = this._camForward.dot(this._camToTarget) > 0.15;

    // View angle alignment with idealViewDir
    const dotIdeal = THREE.MathUtils.clamp(
      this._camToTarget.dot(task.target.idealViewDir),
      -1,
      1,
    );
    const angleDiffDeg = THREE.MathUtils.radToDeg(Math.acos(dotIdeal));

    const los =
      inFront && distanceMeters <= task.target.maxDist + 8
        ? checkRayObstruction(camera.position, targetPos, colliders, npcObstacles)
        : { obstructed: false, blockerType: 'none' as const };

    const evalResult = evaluatePhotoShot({
      ndcX: this._projVec.x,
      ndcY: this._projVec.y,
      inFrontOfCamera: inFront,
      viewAngleDiffDeg: angleDiffDeg,
      toleranceDeg: task.target.toleranceDeg,
      distanceMeters,
      minDist: task.target.minDist,
      maxDist: task.target.maxDist,
      obstructedBy: los.blockerType,
      playerSpeed,
      requiresFlash: task.target.requiresFlash,
      flashUsed,
      remainingTimeRatio: task.timeWindowSec > 0 ? task.remainingSec / task.timeWindowSec : 0.5,
      basePoints: task.target.basePoints,
    });

    return {
      evalResult,
      ndcX: this._projVec.x,
      ndcY: this._projVec.y,
      inFront,
      distanceMeters,
      angleDiffDeg,
      obstructedBy: los.blockerType,
    };
  }

  private computeBestFramedPreview(
    camera: THREE.PerspectiveCamera,
    colliders: AABBBox[],
    npcObstacles: PlayerObstacleCylinder[],
    playerSpeed: number,
  ): LiveViewfinderPreview | null {
    const flashReady = this.flashEnabled && this.flashCooldownSec <= 0;
    let bestTask: PhotoTaskInstance | null = null;
    let bestData: ReturnType<typeof this.evaluateSingleTaskForCamera> | null = null;
    let bestMetric = -999;

    for (const task of this.tasks) {
      const data = this.evaluateSingleTaskForCamera(
        task,
        camera,
        colliders,
        npcObstacles,
        playerSpeed,
        flashReady,
      );
      if (!data.inFront || Math.abs(data.ndcX) > 0.92 || Math.abs(data.ndcY) > 0.92) continue;
      if (data.distanceMeters > task.target.maxDist + 6.5) continue;

      // Prioritize open tasks that are well-centered and unobstructed
      const openBonus = task.status === 'open' ? 50 : task.status === 'locked' ? 20 : 0;
      const metric = data.evalResult.qualityScore + openBonus - Math.hypot(data.ndcX, data.ndcY) * 20;
      if (metric > bestMetric) {
        bestMetric = metric;
        bestTask = task;
        bestData = data;
      }
    }

    if (!bestTask || !bestData) return null;

    return {
      targetTitle: bestTask.target.title,
      roomName: bestTask.target.roomName,
      isOpenTask: bestTask.status === 'open' || bestTask.status === 'locked',
      alreadyCompleted: bestTask.status === 'completed',
      distanceMeters: Number(bestData.distanceMeters.toFixed(1)),
      minDist: bestTask.target.minDist,
      maxDist: bestTask.target.maxDist,
      distanceOk:
        bestData.distanceMeters >= bestTask.target.minDist &&
        bestData.distanceMeters <= bestTask.target.maxDist,
      angleOk: bestData.angleDiffDeg <= bestTask.target.toleranceDeg * 1.4,
      requiresFlash: bestTask.target.requiresFlash,
      flashReady,
      obstructedBy: bestData.obstructedBy,
      estimatedQuality: bestData.evalResult.qualityScore,
    };
  }

  /**
   * Captures a photograph from the current WebGL canvas, applies a grainy Soviet sepia filter,
   * evaluates photo quality (0–100), updates task completion if >= 60, and saves to the gallery.
   */
  public capturePhoto(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    colliders: AABBBox[],
    npcObstacles: PlayerObstacleCylinder[],
    playerSpeed: number,
    currentRoomName: string,
    audio: SoundSynthesizer,
  ): CapturedPhotoRecord | null {
    if (this.filmRemaining <= 0) {
      audio.playSwitchClick(false);
      return null;
    }

    this.filmRemaining = Math.max(0, this.filmRemaining - 1);
    const frameNumber = GAME_CONFIG.photoCamera.maxFilmCount - this.filmRemaining;

    // 1. Trigger camera flash if enabled and recharged
    const flashFired = this.flashEnabled && this.flashCooldownSec <= 0;
    if (flashFired) {
      this.flashCooldownSec = GAME_CONFIG.photoCamera.flashRechargeSec;
      this.screenFlashAlpha = 0.85;
      this.flashLightTimer = 0.24;
      this.flashBurstLight.position.copy(camera.position);
      this.flashBurstLight.intensity = 18.0;
    }

    audio.playShutterClick(flashFired);

    // Render scene immediately so flash illumination is captured on the WebGL canvas
    renderer.render(scene, camera);

    // 2. Find best candidate task in frame (open or locked tasks can be completed when photographed!)
    let bestTask: PhotoTaskInstance | null = null;
    let bestEval: PhotoEvaluationResult | null = null;
    let bestRankScore = -1;

    for (const task of this.tasks) {
      const data = this.evaluateSingleTaskForCamera(
        task,
        camera,
        colliders,
        npcObstacles,
        playerSpeed,
        flashFired,
      );
      if (!data.inFront || Math.abs(data.ndcX) > 1.02 || Math.abs(data.ndcY) > 1.02) continue;
      if (data.distanceMeters > task.target.maxDist + 8.0) continue;

      const statusWeight =
        task.status === 'open' ? 200 : task.status === 'locked' ? 120 : 10;
      const rankScore = statusWeight + data.evalResult.qualityScore;
      if (rankScore > bestRankScore) {
        bestRankScore = rankScore;
        bestTask = task;
        bestEval = data.evalResult;
      }
    }

    if (!bestEval) {
      bestEval = {
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
        feedbackTr: 'Geçersiz: Kadrajda herhangi bir görev hedefi yok!',
      };
    }

    // 3. Create grainy sepia film strip image from the WebGL canvas
    const targetTitle = bestTask ? bestTask.target.title : 'Serbest Kare (Hedef Yok)';
    const roomName = bestTask ? bestTask.target.roomName : currentRoomName;
    const dataUrl = this.createSepiaGrainDataUrl(
      renderer.domElement,
      frameNumber,
      targetTitle,
      bestEval.qualityScore,
      bestEval.isValid,
    );

    const record: CapturedPhotoRecord = {
      id: `photo_${frameNumber}_${Date.now()}`,
      frameNumber,
      dataUrl,
      targetId: bestTask ? bestTask.target.id : null,
      targetTitle,
      roomName,
      isTaskTarget: Boolean(bestTask),
      evaluation: bestEval,
      timestampStr: `KARE #${String(frameNumber).padStart(2, '0')}`,
    };

    this.gallery.unshift(record);
    this.lastCapturedPhoto = record;
    this.lastCaptureBannerTimer = 4.5;

    // 4. Update task status & total score if valid (>= 60)
    if (bestTask && bestEval.isValid) {
      if (bestTask.status === 'open' || bestTask.status === 'locked') {
        bestTask.status = 'completed';
        bestTask.bestScore = bestEval.qualityScore;
        bestTask.awardedPoints = bestEval.awardedPoints;
        bestTask.capturedPhotoId = record.id;
        this.totalScore += bestEval.awardedPoints;
        this.ensureOpenTaskSlots();
        audio.playTaskCompleteChime(true);
      } else if (bestTask.status === 'completed' && bestEval.qualityScore > bestTask.bestScore) {
        const diff = bestEval.awardedPoints - bestTask.awardedPoints;
        bestTask.bestScore = bestEval.qualityScore;
        bestTask.awardedPoints = bestEval.awardedPoints;
        bestTask.capturedPhotoId = record.id;
        this.totalScore += Math.max(0, diff);
        audio.playTaskCompleteChime(true);
      }
    } else {
      audio.playTaskCompleteChime(false);
    }

    return record;
  }

  /**
   * Renders the current WebGL canvas onto an offscreen 2D canvas and applies
   * a vintage Soviet sepia tone, film grain, vignette, sprocket border, and stamp.
   */
  private createSepiaGrainDataUrl(
    sourceCanvas: HTMLCanvasElement,
    frameNumber: number,
    title: string,
    qualityScore: number,
    isValid: boolean,
  ): string {
    const width = 320;
    const height = 200;
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = width;
      this.offscreenCanvas.height = height;
    }
    const ctx = this.offscreenCanvas.getContext('2d');
    if (!ctx) return '';

    // Draw WebGL frame
    ctx.drawImage(sourceCanvas, 0, 0, width, height);

    // Apply vintage Soviet sepia + contrast + analog film grain pixel-by-pixel
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Grain noise
        const grain = ((i * 1103515245 + frameNumber * 12345) & 0x1f) - 15;
        const c = Math.max(0, Math.min(255, (lum - 115) * 1.18 + 122 + grain));
        data[i] = Math.min(255, c * 1.08 + 18); // Warm sepia red
        data[i + 1] = Math.min(255, c * 0.94 + 8); // Sepia ochre green
        data[i + 2] = Math.max(0, c * 0.72 - 6); // Muted blue
      }
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Fallback tint if getImageData is restricted
      ctx.fillStyle = 'rgba(110, 82, 45, 0.32)';
      ctx.fillRect(0, 0, width, height);
    }

    // Film border & sprocket holes
    ctx.strokeStyle = '#181410';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(218, 185, 125, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(6, 6, width - 12, height - 12);

    // Bottom film metadata strip
    ctx.fillStyle = 'rgba(16, 13, 10, 0.82)';
    ctx.fillRect(6, height - 30, width - 12, 24);
    ctx.fillStyle = '#e8d4a2';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(
      `#${String(frameNumber).padStart(2, '0')} · ${title.slice(0, 26)}`,
      12,
      height - 14,
    );

    // Quality score stamp in bottom right
    ctx.fillStyle = isValid ? '#5cd67d' : '#e85d56';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(
      `${qualityScore}/100 ${isValid ? '[GEÇERLİ]' : '[GEÇERSİZ]'}`,
      width - 12,
      height - 14,
    );
    ctx.textAlign = 'left';

    return this.offscreenCanvas.toDataURL('image/jpeg', 0.85);
  }
}
