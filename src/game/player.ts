/**
 * First-Person Player Controller ("Son Tur").
 * Handles WASD movement, Shift sprinting (stamina), C crouching (stealth/quieter),
 * F flashlight toggle (SpotLight + battery), PointerLock mouse look + keyboard arrow look,
 * AABB wall sliding collision, and NPC obstacle collision.
 */

import * as THREE from 'three';
import { GAME_CONFIG } from './config';
import { AABBBox, HidingSpot } from './level';
import { SoundSynthesizer } from './audio';

export interface PlayerObstacleCylinder {
  x: number;
  z: number;
  radius: number;
}

export class PlayerController {
  public readonly position = new THREE.Vector3(2.35, GAME_CONFIG.player.eyeHeightStanding, 6.4);
  public yaw = 0.34; // Framed looking at Guide Olga, the Tourist Group, and the Broken Star Monument
  public pitch = -0.03;

  public lives: number = GAME_CONFIG.player.maxLives;
  public stunRemainingSec = 0;
  public damageFlashAlpha = 0;
  public lastHitWasLockerKiss = false;
  public isHidden = false;
  public isInsideLocker = false;
  public activeLockerSpot: HidingSpot | null = null;
  public nearbyLockerSpot: HidingSpot | null = null;
  public activeHidingSpotLabel: string | null = null;

  public stamina: number = GAME_CONFIG.player.maxStamina;
  public battery: number = GAME_CONFIG.player.maxBattery;
  public isCrouching = false;
  public isSprinting = false;
  public flashlightOn = false;
  public currentSpeed = 0;

  public readonly flashlight: THREE.SpotLight;
  public readonly flashlightTarget: THREE.Object3D;

  private currentEyeHeight: number = GAME_CONFIG.player.eyeHeightStanding;
  private staminaRegenCooldown = 0;
  private walkDistanceAccum = 0;
  private lastStepDist = 0;
  private headBobOffset = 0;
  private stunClock = 0;

  // Reusable scratch vectors (Zero GC in loop)
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _moveVec = new THREE.Vector3();
  private readonly _euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(scene: THREE.Scene) {
    this.flashlight = new THREE.SpotLight(
      GAME_CONFIG.player.flashlightColor,
      0,
      GAME_CONFIG.player.flashlightDistance,
      GAME_CONFIG.player.flashlightAngle,
      GAME_CONFIG.player.flashlightPenumbra,
      1.6,
    );
    this.flashlightTarget = new THREE.Object3D();
    scene.add(this.flashlight);
    scene.add(this.flashlightTarget);
    this.flashlight.target = this.flashlightTarget;
  }

  public reset(): void {
    this.position.set(2.35, GAME_CONFIG.player.eyeHeightStanding, 6.4);
    this.yaw = 0.34;
    this.pitch = -0.03;
    this.lives = GAME_CONFIG.player.maxLives;
    this.stunRemainingSec = 0;
    this.damageFlashAlpha = 0;
    this.lastHitWasLockerKiss = false;
    this.isHidden = false;
    this.isInsideLocker = false;
    this.activeLockerSpot = null;
    this.nearbyLockerSpot = null;
    this.activeHidingSpotLabel = null;
    this.stamina = GAME_CONFIG.player.maxStamina;
    this.battery = GAME_CONFIG.player.maxBattery;
    this.isCrouching = false;
    this.isSprinting = false;
    this.flashlightOn = false;
    this.currentSpeed = 0;
    this.currentEyeHeight = GAME_CONFIG.player.eyeHeightStanding;
    this.walkDistanceAccum = 0;
    this.lastStepDist = 0;
    this.stunClock = 0;
    this.flashlight.intensity = 0;
  }

  /**
   * Called when the short blonde police officer catches the player with his rubber baton
   * or follows them into a locker to kiss them:
   * -1 life, 4 seconds of stun + camera shake, and audio impact.
   */
  public applyPoliceBatonHit(
    audio: SoundSynthesizer,
    isLockerKiss = false,
  ): { livesRemaining: number; gameOver: boolean } {
    this.lives = Math.max(0, this.lives - 1);
    this.stunRemainingSec = GAME_CONFIG.player.stunDurationSec;
    this.damageFlashAlpha = 0.85;
    this.lastHitWasLockerKiss = isLockerKiss;
    this.isSprinting = false;

    if (this.isInsideLocker && this.activeLockerSpot) {
      const spot = this.activeLockerSpot;
      spot.currentDoorAngle = 1.35;
      spot.targetDoorAngle = 0.85;
      this.position.set(
        spot.outsidePosition.x,
        GAME_CONFIG.player.eyeHeightStanding,
        spot.outsidePosition.z,
      );
      // Turn player to face Officer Igor standing inside the locker
      this.yaw = spot.facingYaw + Math.PI;
      this.isInsideLocker = false;
      this.activeLockerSpot = null;
      this.isHidden = false;
      this.activeHidingSpotLabel = null;
    }

    if (isLockerKiss) {
      audio.playPoliceLockerKiss();
    } else {
      audio.playBatonHitAndStun();
    }

    return {
      livesRemaining: this.lives,
      gameOver: this.lives <= 0,
    };
  }

  public getNoiseRadius(): number {
    if (this.currentSpeed < 0.25) return 0;
    if (this.isCrouching) return GAME_CONFIG.player.crouchNoiseRadius;
    if (this.isSprinting) return GAME_CONFIG.player.sprintNoiseRadius;
    return GAME_CONFIG.player.walkNoiseRadius;
  }

  public applyMouseDelta(movementX: number, movementY: number, sensitivity: number): void {
    const stunDamp = this.stunRemainingSec > 0 ? 0.45 : 1.0;
    this.yaw -= movementX * sensitivity * stunDamp;
    this.pitch -= movementY * sensitivity * stunDamp;
    const maxPitch = Math.PI * 0.46;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }

  public toggleFlashlight(audio: SoundSynthesizer): void {
    if (!this.flashlightOn && this.battery <= 1) {
      audio.playSwitchClick(false);
      return;
    }
    this.flashlightOn = !this.flashlightOn;
    audio.playSwitchClick(this.flashlightOn);
  }

  public toggleCrouch(): void {
    if (this.isInsideLocker) return;
    this.isCrouching = !this.isCrouching;
  }

  /**
   * Enters the nearest Soviet metal locker (if within 2.65m) or exits the currently occupied locker.
   */
  public toggleLockerInteraction(hidingSpots: HidingSpot[], audio: SoundSynthesizer): boolean {
    if (this.isInsideLocker && this.activeLockerSpot) {
      const spot = this.activeLockerSpot;
      spot.currentDoorAngle = 1.15;
      spot.targetDoorAngle = 0.62;
      this.position.set(
        spot.outsidePosition.x,
        GAME_CONFIG.player.eyeHeightStanding,
        spot.outsidePosition.z,
      );
      this.yaw = spot.facingYaw;
      this.pitch = -0.02;
      this.isInsideLocker = false;
      this.activeLockerSpot = null;
      this.isHidden = false;
      this.activeHidingSpotLabel = null;
      audio.playLockerDoorSound(false);
      return true;
    }

    let closest: HidingSpot | null = null;
    let bestDist = 2.65;
    for (let i = 0; i < hidingSpots.length; i++) {
      const s = hidingSpots[i];
      const d = Math.hypot(this.position.x - s.position.x, this.position.z - s.position.z);
      if (d <= bestDist) {
        bestDist = d;
        closest = s;
      }
    }

    if (!closest) return false;

    this.isInsideLocker = true;
    this.activeLockerSpot = closest;
    this.isHidden = true;
    this.activeHidingSpotLabel = closest.label;
    this.isSprinting = false;
    this.isCrouching = false;
    this.currentSpeed = 0;
    if (this.flashlightOn) {
      this.flashlightOn = false;
      this.flashlight.intensity = 0;
    }
    this.position.set(closest.insidePosition.x, 1.56, closest.insidePosition.z);
    this.yaw = closest.facingYaw;
    this.pitch = -0.02;
    closest.currentDoorAngle = 1.1;
    closest.targetDoorAngle = 0.0;
    audio.playLockerDoorSound(true);
    return true;
  }

  public update(
    dt: number,
    keysHeld: Set<string>,
    colliders: AABBBox[],
    npcObstacles: PlayerObstacleCylinder[],
    camera: THREE.PerspectiveCamera,
    audio: SoundSynthesizer,
    hidingSpots: HidingSpot[] = [],
  ): void {
    if (this.stunRemainingSec > 0) {
      this.stunRemainingSec = Math.max(0, this.stunRemainingSec - dt);
      this.stunClock += dt;
    }
    if (this.damageFlashAlpha > 0) {
      this.damageFlashAlpha = Math.max(0, this.damageFlashAlpha - dt * 1.15);
    }

    // Optional keyboard arrow look fallback for accessibility & automated testing
    const turnSpeed = GAME_CONFIG.player.keyboardTurnSpeed;
    if (keysHeld.has('ArrowLeft')) this.yaw += turnSpeed * dt;
    if (keysHeld.has('ArrowRight')) this.yaw -= turnSpeed * dt;
    if (keysHeld.has('ArrowUp')) {
      this.pitch = Math.min(Math.PI * 0.46, this.pitch + turnSpeed * 0.7 * dt);
    }
    if (keysHeld.has('ArrowDown')) {
      this.pitch = Math.max(-Math.PI * 0.46, this.pitch - turnSpeed * 0.7 * dt);
    }

    // Forward & Right vectors on XZ plane
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();

    let moveZ = 0;
    let moveX = 0;
    if (keysHeld.has('KeyW')) moveZ += 1;
    if (keysHeld.has('KeyS')) moveZ -= 1;
    if (keysHeld.has('KeyD')) moveX += 1;
    if (keysHeld.has('KeyA')) moveX -= 1;

    const wantsMove = moveX !== 0 || moveZ !== 0;
    const isStunned = this.stunRemainingSec > 0;
    const wantsSprint =
      (keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight')) &&
      wantsMove &&
      !this.isCrouching &&
      !isStunned;

    if (wantsSprint && this.stamina > 0) {
      if (this.isSprinting || this.stamina >= GAME_CONFIG.player.minStaminaToSprint) {
        this.isSprinting = true;
      } else {
        this.isSprinting = false;
      }
    } else {
      this.isSprinting = false;
    }

    // Stamina drain / regeneration
    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - GAME_CONFIG.player.staminaDrainPerSec * dt);
      this.staminaRegenCooldown = GAME_CONFIG.player.staminaRegenDelaySec;
      if (this.stamina <= 0) {
        this.isSprinting = false;
      }
    } else {
      if (this.staminaRegenCooldown > 0) {
        this.staminaRegenCooldown = Math.max(0, this.staminaRegenCooldown - dt);
      } else {
        this.stamina = Math.min(
          GAME_CONFIG.player.maxStamina,
          this.stamina + GAME_CONFIG.player.staminaRegenPerSec * dt,
        );
      }
    }

    // Determine target speed (heavily staggered during 4-second stun)
    let targetSpeed = 0;
    if (wantsMove) {
      if (isStunned) {
        targetSpeed = GAME_CONFIG.player.crouchSpeed * 0.45;
      } else if (this.isCrouching) {
        targetSpeed = GAME_CONFIG.player.crouchSpeed;
      } else if (this.isSprinting) {
        targetSpeed = GAME_CONFIG.player.sprintSpeed;
      } else {
        targetSpeed = GAME_CONFIG.player.walkSpeed;
      }
    }

    this._moveVec
      .set(0, 0, 0)
      .addScaledVector(this._forward, moveZ)
      .addScaledVector(this._right, moveX);
    if (this._moveVec.lengthSq() > 0.0001) {
      this._moveVec.normalize();
    }

    // Animate all locker doors smoothly and find nearest interactable locker
    let nearestSpot: HidingSpot | null = null;
    let nearestDist = 2.65;
    for (let i = 0; i < hidingSpots.length; i++) {
      const spot = hidingSpots[i];
      spot.currentDoorAngle = THREE.MathUtils.damp(
        spot.currentDoorAngle,
        spot.targetDoorAngle,
        9.0,
        dt,
      );
      spot.doorPivot.rotation.y = -spot.currentDoorAngle;

      const d = Math.hypot(this.position.x - spot.position.x, this.position.z - spot.position.z);
      if (d <= nearestDist) {
        nearestDist = d;
        nearestSpot = spot;
      }
    }
    this.nearbyLockerSpot = nearestSpot;

    if (this.isInsideLocker && this.activeLockerSpot) {
      // Anchor player inside the hollow locker looking out through the ventilation louver slits
      const spot = this.activeLockerSpot;
      spot.targetDoorAngle = 0.0;
      this.position.x = THREE.MathUtils.damp(this.position.x, spot.insidePosition.x, 14, dt);
      this.position.z = THREE.MathUtils.damp(this.position.z, spot.insidePosition.z, 14, dt);
      this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, 1.56, 12, dt);
      this.position.y = this.currentEyeHeight;
      this.currentSpeed = 0;
      this.isSprinting = false;
      this.isHidden = true;
      this.activeHidingSpotLabel = spot.label;

      // Clamp yaw to +/- 35 degrees around the locker's outward-facing direction
      let deltaYaw = this.yaw - spot.facingYaw;
      while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
      while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
      const maxPeek = 0.62;
      if (deltaYaw > maxPeek) this.yaw = spot.facingYaw + maxPeek;
      if (deltaYaw < -maxPeek) this.yaw = spot.facingYaw - maxPeek;
    } else {
      const prevX = this.position.x;
      const prevZ = this.position.z;

      // Move & resolve collisions separately on X and Z for smooth wall sliding
      const stepX = this._moveVec.x * targetSpeed * dt;
      const stepZ = this._moveVec.z * targetSpeed * dt;
      const radius = GAME_CONFIG.player.collisionRadius;

      const nextX = this.position.x + stepX;
      if (!this.checkCollision(nextX, this.position.z, radius, colliders, npcObstacles)) {
        this.position.x = nextX;
      }

      const nextZ = this.position.z + stepZ;
      if (!this.checkCollision(this.position.x, nextZ, radius, colliders, npcObstacles)) {
        this.position.z = nextZ;
      }

      const actualDx = this.position.x - prevX;
      const actualDz = this.position.z - prevZ;
      const distMoved = Math.sqrt(actualDx * actualDx + actualDz * actualDz);
      this.currentSpeed = dt > 0.0001 ? distMoved / dt : 0;

      // Also allow crouching right next to a locker to count as hidden
      let crouchSpot: HidingSpot | null = null;
      if (this.isCrouching) {
        for (let i = 0; i < hidingSpots.length; i++) {
          const spot = hidingSpots[i];
          const d = Math.hypot(
            this.position.x - spot.position.x,
            this.position.z - spot.position.z,
          );
          if (d <= 2.1) {
            crouchSpot = spot;
            break;
          }
        }
      }
      this.isHidden = crouchSpot !== null;
      this.activeHidingSpotLabel = crouchSpot ? crouchSpot.label : null;

      // Head bob & footsteps synced to actual distance traveled
      if (distMoved > 0.0001) {
        this.walkDistanceAccum += distMoved;
        const stepStride = this.isSprinting ? 2.1 : this.isCrouching ? 1.25 : 1.65;
        if (this.walkDistanceAccum - this.lastStepDist >= stepStride) {
          this.lastStepDist = this.walkDistanceAccum;
          audio.playFootstep(this.isCrouching ? 'crouch' : this.isSprinting ? 'sprint' : 'walk');
        }
        this.headBobOffset =
          Math.sin(this.walkDistanceAccum * GAME_CONFIG.player.headBobFrequency * 2.2) *
          GAME_CONFIG.player.headBobAmplitude *
          (this.isCrouching ? 0.5 : this.isSprinting ? 1.35 : 1.0);
      } else {
        this.headBobOffset = THREE.MathUtils.damp(this.headBobOffset, 0, 10, dt);
      }

      // Smooth eye height damping for crouch (or stunned knees-buckled dip)
      const desiredEye =
        this.isCrouching || isStunned
          ? GAME_CONFIG.player.eyeHeightCrouching
          : GAME_CONFIG.player.eyeHeightStanding;
      this.currentEyeHeight = THREE.MathUtils.damp(
        this.currentEyeHeight,
        desiredEye,
        GAME_CONFIG.player.crouchLerpSpeed,
        dt,
      );
      this.position.y = this.currentEyeHeight + this.headBobOffset;
    }

    // Flashlight battery & spotlight transform
    if (this.flashlightOn) {
      this.battery = Math.max(0, this.battery - GAME_CONFIG.player.batteryDrainPerSec * dt);
      if (this.battery <= 0) {
        this.flashlightOn = false;
        this.flashlight.intensity = 0;
      } else {
        // Subtle flicker when battery is below 15%
        const lowBatFlicker =
          this.battery < 15 ? 0.6 + 0.4 * Math.sin(performance.now() * 0.03) : 1.0;
        this.flashlight.intensity = GAME_CONFIG.player.flashlightIntensity * lowBatFlicker;
      }
    } else {
      this.flashlight.intensity = 0;
      this.battery = Math.min(
        GAME_CONFIG.player.maxBattery,
        this.battery + GAME_CONFIG.player.batteryRechargePerSec * dt,
      );
    }

    // Sync Three.js camera transform (+ 4-second stun shake & disorienting roll when caught by police)
    camera.position.copy(this.position);
    let shakePitch = 0;
    let shakeYaw = 0;
    let shakeRoll = 0;
    if (this.stunRemainingSec > 0) {
      const stunRatio = Math.min(1, this.stunRemainingSec / GAME_CONFIG.player.stunDurationSec);
      const t = this.stunClock;
      camera.position.x += Math.sin(t * 36) * 0.095 * stunRatio;
      camera.position.y += Math.cos(t * 29) * 0.08 * stunRatio;
      shakePitch = Math.sin(t * 15) * 0.065 * stunRatio;
      shakeYaw = Math.cos(t * 12) * 0.055 * stunRatio;
      shakeRoll = Math.sin(t * 10) * 0.16 * stunRatio;
    }

    this._euler.set(this.pitch + shakePitch, this.yaw + shakeYaw, shakeRoll, 'YXZ');
    camera.quaternion.setFromEuler(this._euler);

    // Position flashlight slightly to right-hand side of camera
    this.flashlight.position.copy(this.position);
    this.flashlight.position.y -= 0.15;
    const lookDir = this._forward
      .set(0, 0, -1)
      .applyQuaternion(camera.quaternion)
      .normalize();
    this.flashlightTarget.position.copy(this.position).addScaledVector(lookDir, 10);
  }


  private checkCollision(
    x: number,
    z: number,
    radius: number,
    colliders: AABBBox[],
    npcObstacles: PlayerObstacleCylinder[],
  ): boolean {
    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i];
      if (
        x + radius > box.minX &&
        x - radius < box.maxX &&
        z + radius > box.minZ &&
        z - radius < box.maxZ
      ) {
        return true;
      }
    }
    for (let i = 0; i < npcObstacles.length; i++) {
      const npc = npcObstacles[i];
      const dx = x - npc.x;
      const dz = z - npc.z;
      const minD = radius + npc.radius;
      if (dx * dx + dz * dz < minD * minD) {
        return true;
      }
    }
    return false;
  }
}
