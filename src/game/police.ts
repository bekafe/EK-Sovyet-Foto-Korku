/**
 * Police Officer AI & 4-State Machine Module ("Son Tur" — Stage 4).
 * Implements:
 * - Short (1.28m), blonde, uniformed Soviet militia officer holding a rubber baton
 * - 4 States:
 *   1. GÖZETLEME ('stalking'): Watches player from 20–30m away around corners/doorways
 *   2. ŞÜPHE ('suspicion'): Suspicion meter fills when far from group, spotted in vision cone,
 *      using flashlight, or sprinting loudly; officer approaches via A* pathfinding
 *   3. KOVALAMA ('chase'): Sprints at player shouting funny-threatening Turkish lines
 *      ("Seni öpmek istiyorum!"), swings baton within attack range; aborts immediately if player
 *      returns to the tourist group!
 *   4. SOĞUMA ('cooldown'): Retreats for 15 seconds after landing a baton hit (-1 life, 4s stun)
 */

import * as THREE from 'three';
import { DifficultyLevel, GAME_CONFIG } from './config';
import {
  DistanceZone,
  distance3D,
  findNearestWaypointId,
  findShortestWaypointPath,
  SeededRNG,
  WaypointNode,
} from './prng';
import { AABBBox, HidingSpot } from './level';
import { checkRayObstruction } from './scoring';
import { SoundSynthesizer } from './audio';

export type PoliceState = 'stalking' | 'suspicion' | 'chase' | 'cooldown';

export interface PoliceDetectionInput {
  policeX: number;
  policeZ: number;
  policeYaw: number;
  playerX: number;
  playerZ: number;
  playerFlashlightOn: boolean;
  playerNoiseRadius: number;
  playerIsHidden: boolean;
  lineOfSightClear: boolean;
}

export interface PoliceDetectionResult {
  distanceToPlayer: number;
  inVisionCone: boolean;
  spottedByFlashlight: boolean;
  heardFootsteps: boolean;
}

export interface PoliceStepInput {
  currentState: PoliceState;
  currentSuspicion: number;
  cooldownRemainingSec: number;
  dt: number;
  distanceZone: DistanceZone;
  playerDistToGroupMeters: number;
  detection: PoliceDetectionResult;
  playerIsHidden: boolean;
  lockerEntrySeenByPolice?: boolean;
  difficultyMultiplier: number;
}

export interface PoliceStepOutput {
  nextState: PoliceState;
  nextSuspicion: number;
  nextCooldownSec: number;
  triggeredChaseStart: boolean;
  triggeredGroupSafeAbort: boolean;
  triggeredAttackHit: boolean;
  triggeredSuspicionBark: boolean;
  triggeredLockerKissHit?: boolean;
  triggeredLockerEscapedRadar?: boolean;
}

export interface PoliceTelemetry {
  state: PoliceState;
  stateLabelTr: string;
  suspicion: number; // 0..100
  cooldownRemainingSec: number;
  distanceToPlayerMeters: number;
  inVisionCone: boolean;
  spottedByFlashlight: boolean;
  heardFootsteps: boolean;
  activeQuote: string | null;
}

/**
 * Pure function: Evaluates whether the police officer sees the player in his vision cone,
 * notices the player's flashlight from afar, or hears the player's footsteps.
 */
export function evaluatePoliceDetection(input: PoliceDetectionInput): PoliceDetectionResult {
  const dx = input.playerX - input.policeX;
  const dz = input.playerZ - input.policeZ;
  const distanceToPlayer = Math.hypot(dx, dz);

  // Police forward vector from yaw: (-sin(yaw), -cos(yaw))
  const fwdX = -Math.sin(input.policeYaw);
  const fwdZ = -Math.cos(input.policeYaw);

  let angleFromForward = Math.PI;
  if (distanceToPlayer > 0.001) {
    const ux = dx / distanceToPlayer;
    const uz = dz / distanceToPlayer;
    const dot = Math.max(-1, Math.min(1, fwdX * ux + fwdZ * uz));
    angleFromForward = Math.acos(dot);
  }

  const halfCone = GAME_CONFIG.police.visionConeAngleRad * 0.5;

  const inVisionCone =
    !input.playerIsHidden &&
    input.lineOfSightClear &&
    distanceToPlayer <= GAME_CONFIG.police.visionDistanceNormal &&
    angleFromForward <= halfCone;

  // Police notices flashlight from much farther away (even slightly wider than normal cone)
  const spottedByFlashlight =
    input.playerFlashlightOn &&
    !input.playerIsHidden &&
    input.lineOfSightClear &&
    distanceToPlayer <= GAME_CONFIG.police.visionDistanceFlashlight &&
    angleFromForward <= halfCone * 1.35;

  // Footstep / running sound detection (works around corners within noise radius)
  const heardFootsteps =
    input.playerNoiseRadius > 0 && distanceToPlayer <= input.playerNoiseRadius;

  return {
    distanceToPlayer,
    inVisionCone,
    spottedByFlashlight,
    heardFootsteps,
  };
}

/**
 * Pure function: Steps the 4-state Police AI machine ('stalking', 'suspicion', 'chase', 'cooldown').
 * Enforces the core rule that the police officer NEVER attacks near the tourist group and
 * immediately aborts a chase when the player returns to the group.
 */
export function stepPoliceStateMachine(input: PoliceStepInput): PoliceStepOutput {
  const {
    currentState,
    currentSuspicion,
    cooldownRemainingSec,
    dt,
    distanceZone,
    playerDistToGroupMeters,
    detection,
    playerIsHidden,
    lockerEntrySeenByPolice = false,
    difficultyMultiplier,
  } = input;

  let nextState: PoliceState = currentState;
  let nextSuspicion = currentSuspicion;
  let nextCooldownSec = cooldownRemainingSec;
  let triggeredChaseStart = false;
  let triggeredGroupSafeAbort = false;
  let triggeredAttackHit = false;
  let triggeredSuspicionBark = false;
  let triggeredLockerKissHit = false;
  let triggeredLockerEscapedRadar = false;

  const isSafeWithGroup =
    distanceZone === 'green' ||
    playerDistToGroupMeters <= GAME_CONFIG.police.groupSafeBubbleRadius;

  // 1. COOLDOWN STATE (15s retreat after baton attack)
  if (currentState === 'cooldown') {
    nextCooldownSec = Math.max(0, cooldownRemainingSec - dt);
    nextSuspicion = Math.max(
      0,
      currentSuspicion - GAME_CONFIG.police.suspicionDecayRatePerSec * 2.0 * dt,
    );
    if (nextCooldownSec <= 0) {
      nextState = 'stalking';
    }
    return {
      nextState,
      nextSuspicion,
      nextCooldownSec,
      triggeredChaseStart,
      triggeredGroupSafeAbort,
      triggeredAttackHit,
      triggeredSuspicionBark,
      triggeredLockerKissHit,
      triggeredLockerEscapedRadar,
    };
  }

  // Handle Locker Hiding Rule:
  // - If Police SAW the player enter the locker (lockerEntrySeenByPolice = true), he chases straight
  //   to the locker, enters the locker with the player, and kisses them!
  // - If Police did NOT see the player enter the locker, the player immediately escapes his radar!
  if (playerIsHidden) {
    if (lockerEntrySeenByPolice) {
      if (detection.distanceToPlayer <= GAME_CONFIG.police.attackRangeMeters + 0.55) {
        triggeredAttackHit = true;
        triggeredLockerKissHit = true;
        nextState = 'cooldown';
        nextCooldownSec = GAME_CONFIG.police.cooldownDurationSec;
        nextSuspicion = 0;
        return {
          nextState,
          nextSuspicion,
          nextCooldownSec,
          triggeredChaseStart,
          triggeredGroupSafeAbort,
          triggeredAttackHit,
          triggeredSuspicionBark,
          triggeredLockerKissHit,
          triggeredLockerEscapedRadar,
        };
      }
      return {
        nextState: 'chase',
        nextSuspicion: 100,
        nextCooldownSec: 0,
        triggeredChaseStart: currentState !== 'chase',
        triggeredGroupSafeAbort: false,
        triggeredAttackHit: false,
        triggeredSuspicionBark: false,
        triggeredLockerKissHit: false,
        triggeredLockerEscapedRadar: false,
      };
    } else {
      // Unseen locker entry -> completely escaped police radar!
      const wasAlerted =
        currentState === 'chase' || currentState === 'suspicion' || currentSuspicion > 5;
      return {
        nextState: 'stalking',
        nextSuspicion: 0,
        nextCooldownSec: 0,
        triggeredChaseStart: false,
        triggeredGroupSafeAbort: false,
        triggeredAttackHit: false,
        triggeredSuspicionBark: false,
        triggeredLockerKissHit: false,
        triggeredLockerEscapedRadar: wasAlerted,
      };
    }
  }

  // 2. CHASE STATE
  if (currentState === 'chase') {
    // Rule: Police never attacks near the tourist group; returning to group ends the chase!
    if (isSafeWithGroup) {
      nextState = 'stalking';
      nextSuspicion = Math.min(currentSuspicion, 32);
      triggeredGroupSafeAbort = true;
      return {
        nextState,
        nextSuspicion,
        nextCooldownSec: 0,
        triggeredChaseStart,
        triggeredGroupSafeAbort,
        triggeredAttackHit,
        triggeredSuspicionBark,
        triggeredLockerKissHit,
        triggeredLockerEscapedRadar,
      };
    }

    // Check baton attack range
    if (detection.distanceToPlayer <= GAME_CONFIG.police.attackRangeMeters) {
      triggeredAttackHit = true;
      nextState = 'cooldown';
      nextCooldownSec = GAME_CONFIG.police.cooldownDurationSec;
      nextSuspicion = 0;
      return {
        nextState,
        nextSuspicion,
        nextCooldownSec,
        triggeredChaseStart,
        triggeredGroupSafeAbort,
        triggeredAttackHit,
        triggeredSuspicionBark,
        triggeredLockerKissHit,
        triggeredLockerEscapedRadar,
      };
    }

    return {
      nextState: 'chase',
      nextSuspicion: 100,
      nextCooldownSec: 0,
      triggeredChaseStart,
      triggeredGroupSafeAbort,
      triggeredAttackHit,
      triggeredSuspicionBark,
      triggeredLockerKissHit,
      triggeredLockerEscapedRadar,
    };
  }

  // 3. STALKING & SUSPICION STATES
  let fillRate = 0;
  if (distanceZone === 'red') {
    fillRate += GAME_CONFIG.police.suspicionFillRatePerSec;
  } else if (
    distanceZone === 'yellow' &&
    (detection.inVisionCone || detection.spottedByFlashlight || detection.heardFootsteps)
  ) {
    fillRate += GAME_CONFIG.police.suspicionYellowFillRatePerSec;
  }

  if (!isSafeWithGroup && !playerIsHidden) {
    if (detection.inVisionCone) {
      fillRate += GAME_CONFIG.police.suspicionVisionConeBonusRate;
    }
    if (detection.spottedByFlashlight) {
      fillRate += GAME_CONFIG.police.suspicionFlashlightBonusRate;
    }
    if (detection.heardFootsteps) {
      fillRate += GAME_CONFIG.police.suspicionSprintNoiseBonusRate;
    }
  }

  fillRate *= difficultyMultiplier;

  if (fillRate > 0 && !isSafeWithGroup) {
    nextSuspicion = Math.min(
      GAME_CONFIG.police.maxSuspicion,
      currentSuspicion + fillRate * dt,
    );
  } else if (isSafeWithGroup || playerIsHidden) {
    nextSuspicion = Math.max(
      0,
      currentSuspicion - GAME_CONFIG.police.suspicionDecayRatePerSec * dt,
    );
  } else {
    nextSuspicion = Math.max(
      0,
      currentSuspicion - GAME_CONFIG.police.suspicionDecayRatePerSec * 0.45 * dt,
    );
  }

  if (nextSuspicion >= GAME_CONFIG.police.maxSuspicion && !isSafeWithGroup) {
    nextState = 'chase';
    nextSuspicion = 100;
    triggeredChaseStart = true;
  } else if (nextSuspicion >= GAME_CONFIG.police.suspicionThresholdToApproach) {
    nextState = 'suspicion';
    if (currentState === 'stalking') {
      triggeredSuspicionBark = true;
    }
  } else {
    nextState = 'stalking';
  }

  return {
    nextState,
    nextSuspicion,
    nextCooldownSec: 0,
    triggeredChaseStart,
    triggeredGroupSafeAbort,
    triggeredAttackHit,
    triggeredSuspicionBark,
    triggeredLockerKissHit,
    triggeredLockerEscapedRadar,
  };
}

export class PoliceOfficerManager {
  public readonly meshGroup: THREE.Group;
  public readonly position = new THREE.Vector3(12, 0, -22);
  public yaw = 0;

  public state: PoliceState = 'stalking';
  public suspicion = 0; // 0..100
  public cooldownRemainingSec = 0;
  public activeQuote: string | null = null;
  public lockerEntrySeenByPolice = false;
  public targetLockerSpot: HidingSpot | null = null;
  public lastDetection: PoliceDetectionResult = {
    distanceToPlayer: 28,
    inVisionCone: false,
    spottedByFlashlight: false,
    heardFootsteps: false,
  };

  private waypoints: Map<string, WaypointNode>;
  private rng: SeededRNG;
  private patrolOrder: string[] = [];
  private currentPatrolIdx = 0;
  private routeQueue: WaypointNode[] = [];
  private walkPhase = 0;
  private pathRepathTimer = 0;
  private stalkPauseTimer = 0;
  private quoteTimer = 0;
  private chaseBarkCooldown = 0;
  private heartbeatTimer = 0;
  private batonSwingTimer = 0;

  private leftLeg!: THREE.Mesh;
  private rightLeg!: THREE.Mesh;
  private leftArm!: THREE.Mesh;
  private rightArmBaton!: THREE.Mesh;
  private headGroup!: THREE.Group;

  constructor(scene: THREE.Scene, waypoints: Map<string, WaypointNode>, seed: string) {
    this.waypoints = waypoints;
    this.rng = new SeededRNG(seed + '-police-ai');
    this.meshGroup = this.buildShortBlondePoliceMesh();
    scene.add(this.meshGroup);
    this.reset(seed);
  }

  /**
   * Builds the distinctly short (1.28m tall), blonde, uniformed Soviet militia officer holding a rubber baton.
   */
  private buildShortBlondePoliceMesh(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'PoliceOfficer';

    const uniformMat = new THREE.MeshStandardMaterial({
      color: 0x22303c,
      roughness: 0.72,
      metalness: 0.12,
    });
    const trimRedMat = new THREE.MeshStandardMaterial({
      color: 0xb8251e,
      roughness: 0.48,
      metalness: 0.2,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xe8c8ae,
      roughness: 0.68,
      metalness: 0.05,
    });
    const blondeHairMat = new THREE.MeshStandardMaterial({
      color: 0xf5d547,
      roughness: 0.45,
      metalness: 0.12,
      emissive: 0x3a2e05,
      emissiveIntensity: 0.25,
    });
    const batonMat = new THREE.MeshStandardMaterial({
      color: 0x111315,
      roughness: 0.32,
      metalness: 0.45,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.28,
      metalness: 0.82,
    });

    // Contact shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.44, 10),
      new THREE.MeshBasicMaterial({
        color: 0x050706,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    group.add(shadow);

    // Short stocky legs (Total height ~1.28m vs player 1.68m)
    const legGeo = new THREE.BoxGeometry(0.18, 0.44, 0.2);
    this.leftLeg = new THREE.Mesh(legGeo, uniformMat);
    this.leftLeg.position.set(-0.11, 0.22, 0);
    this.rightLeg = new THREE.Mesh(legGeo, uniformMat);
    this.rightLeg.position.set(0.11, 0.22, 0);
    group.add(this.leftLeg, this.rightLeg);

    // Stocky uniformed torso with red shoulder boards & brass buttons
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.46, 0.3), uniformMat);
    torso.position.set(0, 0.67, 0);
    const epLeft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.24), trimRedMat);
    epLeft.position.set(-0.2, 0.91, 0);
    const epRight = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.045, 0.24), trimRedMat);
    epRight.position.set(0.2, 0.91, 0);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.075, 0.32), batonMat);
    belt.position.set(0, 0.49, 0);
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.085, 0.34), brassMat);
    buckle.position.set(0, 0.49, 0);
    group.add(torso, epLeft, epRight, belt, buckle);

    // Arms & Rubber Baton (Cop)
    const armGeo = new THREE.BoxGeometry(0.14, 0.4, 0.16);
    this.leftArm = new THREE.Mesh(armGeo, uniformMat);
    this.leftArm.position.set(-0.31, 0.68, 0);
    this.rightArmBaton = new THREE.Mesh(armGeo, uniformMat);
    this.rightArmBaton.position.set(0.31, 0.68, 0);

    const baton = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.56, 7), batonMat);
    baton.rotation.x = Math.PI / 2.5;
    baton.position.set(0, -0.15, -0.24);
    this.rightArmBaton.add(baton);
    group.add(this.leftArm, this.rightArmBaton);

    // Head + Prominent Blonde Hair + Officer Visor Cap
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 1.05, 0);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.25, 0.28), skinMat);
    // Expressive bushy blonde eyebrows & mustache
    const blondeMustache = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.04), blondeHairMat);
    blondeMustache.position.set(0, -0.04, -0.145);

    const blondeFringe = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.13, 0.31), blondeHairMat);
    blondeFringe.position.set(0, 0.08, 0.01);

    const capBase = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 8), trimRedMat);
    capBase.position.set(0, 0.16, 0);
    const capCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.19, 0.08, 8), uniformMat);
    capCrown.position.set(0, 0.22, 0);
    const cockade = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 6), brassMat);
    cockade.position.set(0, 0.2, -0.21);

    this.headGroup.add(head, blondeMustache, blondeFringe, capBase, capCrown, cockade);
    group.add(this.headGroup);

    return group;
  }

  public reset(seed: string): void {
    this.rng = new SeededRNG(seed + '-police-patrol');
    const candidateNodes = [
      'wp_koridor_north',
      'wp_sinif_north',
      'wp_tiyatro_west',
      'wp_merdiven_north',
      'wp_kazan_center',
      'wp_cati_center',
    ];
    this.patrolOrder = this.rng.shuffle(candidateNodes);
    this.currentPatrolIdx = 0;
    this.routeQueue = [];
    this.state = 'stalking';
    this.suspicion = 0;
    this.cooldownRemainingSec = 0;
    this.activeQuote = null;
    this.lockerEntrySeenByPolice = false;
    this.targetLockerSpot = null;
    this.quoteTimer = 0;
    this.chaseBarkCooldown = 0;
    this.heartbeatTimer = 0;
    this.batonSwingTimer = 0;
    this.pathRepathTimer = 0;
    this.stalkPauseTimer = 0;

    // Start in the northern corridor / side room (~24m from spawn) so he stalks from a distance
    const startWp = this.waypoints.get('wp_koridor_north') ?? this.waypoints.get(this.patrolOrder[0])!;
    this.position.set(startWp.x, 0, startWp.z);
    this.yaw = Math.PI; // Facing South down the corridor toward the foyer
    this.meshGroup.position.copy(this.position);
    this.meshGroup.rotation.y = this.yaw;
  }

  /**
   * Checks whether Officer Igor currently sees the player right at the moment they step into a locker.
   */
  public didWitnessPlayerEnterLocker(
    playerPos: THREE.Vector3,
    playerFlashlightOn: boolean,
    colliders: AABBBox[],
  ): boolean {
    if (this.state === 'cooldown') return false;
    const rayCheck = checkRayObstruction(
      { x: this.position.x, y: 1.12, z: this.position.z },
      { x: playerPos.x, y: 1.35, z: playerPos.z },
      colliders,
      [],
    );
    if (rayCheck.obstructed) return false;

    const det = evaluatePoliceDetection({
      policeX: this.position.x,
      policeZ: this.position.z,
      policeYaw: this.yaw,
      playerX: playerPos.x,
      playerZ: playerPos.z,
      playerFlashlightOn,
      playerNoiseRadius: 0,
      playerIsHidden: false,
      lineOfSightClear: true,
    });

    return (
      det.inVisionCone ||
      det.spottedByFlashlight ||
      (this.state === 'chase' && det.distanceToPlayer <= GAME_CONFIG.police.visionDistanceNormal)
    );
  }

  /**
   * Called when the player enters a locker:
   * - If Officer Igor saw the player enter (sawPlayerEnter = true), he charges to the locker to enter and kiss them!
   * - If Officer Igor did NOT see the player enter, the player immediately escapes his radar!
   */
  public onPlayerEnteredLocker(
    sawPlayerEnter: boolean,
    lockerSpot: HidingSpot,
    audio: SoundSynthesizer,
  ): void {
    if (sawPlayerEnter) {
      this.lockerEntrySeenByPolice = true;
      this.targetLockerSpot = lockerSpot;
      this.state = 'chase';
      this.suspicion = 100;
      this.cooldownRemainingSec = 0;
      this.routeQueue = [];
      const q =
        GAME_CONFIG.police.lockerSeenQuotes[
          this.rng.int(0, GAME_CONFIG.police.lockerSeenQuotes.length - 1)
        ];
      this.speakQuote(q, audio, true);
      this.chaseBarkCooldown = 5.5;
    } else {
      this.lockerEntrySeenByPolice = false;
      this.targetLockerSpot = null;
      const wasAlerted =
        this.state === 'chase' || this.state === 'suspicion' || this.suspicion > 5;
      this.state = 'stalking';
      this.suspicion = 0;
      if (wasAlerted) {
        const q =
          GAME_CONFIG.police.lockerEscapedRadarQuotes[
            this.rng.int(0, GAME_CONFIG.police.lockerEscapedRadarQuotes.length - 1)
          ];
        this.speakQuote(q, audio, false);
      }
      const stalkWp = this.pickStalkingWaypoint(lockerSpot.position);
      this.buildRouteToTargetWaypoint(stalkWp);
    }
  }

  public onPlayerExitedLocker(): void {
    this.lockerEntrySeenByPolice = false;
    this.targetLockerSpot = null;
  }

  /**
   * Triggers an immediate chase or suspicion state near the player for easy testing (KeyK or Debug button).
   */
  public triggerDebugChaseNearPlayer(
    playerPos: THREE.Vector3,
    playerYaw: number,
    audio: SoundSynthesizer,
  ): void {
    // Place officer ~3.8m directly in front of the player so he is clearly visible and closes in quickly
    const fwdX = -Math.sin(playerYaw);
    const fwdZ = -Math.cos(playerYaw);
    const targetX = playerPos.x + fwdX * 3.8;
    const targetZ = playerPos.z + fwdZ * 3.8;
    this.position.set(targetX, 0, targetZ);

    const dx = playerPos.x - this.position.x;
    const dz = playerPos.z - this.position.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.meshGroup.position.copy(this.position);
    this.meshGroup.rotation.y = this.yaw;

    this.state = 'chase';
    this.suspicion = 100;
    this.cooldownRemainingSec = 0;
    this.chaseBarkCooldown = 6.5;
    this.routeQueue = [];
    this.speakQuote(GAME_CONFIG.police.chaseQuotes[0], audio, true);
  }

  private speakQuote(quote: string, audio: SoundSynthesizer, withWhistle = false): void {
    this.activeQuote = quote;
    this.quoteTimer = 5.5;
    audio.playPoliceVoiceLine(quote, withWhistle);
  }

  /**
   * Picks a stalking vantage waypoint 20–30m from the player so the officer watches from corners/doorways.
   */
  private pickStalkingWaypoint(playerPos: THREE.Vector3): WaypointNode {
    const candidates: WaypointNode[] = [];
    for (const node of this.waypoints.values()) {
      const d = Math.hypot(node.x - playerPos.x, node.z - playerPos.z);
      if (
        d >= GAME_CONFIG.police.minStalkDistance &&
        d <= GAME_CONFIG.police.maxStalkDistance + 4
      ) {
        candidates.push(node);
      }
    }
    if (candidates.length > 0) {
      const idx = this.rng.int(0, candidates.length - 1);
      return candidates[idx];
    }
    const nextId = this.patrolOrder[this.currentPatrolIdx % this.patrolOrder.length];
    this.currentPatrolIdx = (this.currentPatrolIdx + 1) % this.patrolOrder.length;
    return this.waypoints.get(nextId)!;
  }

  /**
   * Picks a distant retreat waypoint (>= 22m from player) for the 15-second cooldown state.
   */
  private pickRetreatWaypoint(playerPos: THREE.Vector3): WaypointNode {
    let bestNode: WaypointNode | null = null;
    let bestDist = -1;
    for (const node of this.waypoints.values()) {
      const d = Math.hypot(node.x - playerPos.x, node.z - playerPos.z);
      if (d > bestDist) {
        bestDist = d;
        bestNode = node;
      }
    }
    return bestNode ?? this.waypoints.values().next().value!;
  }

  private buildRouteToTargetWaypoint(targetWp: WaypointNode): void {
    const startWpId = findNearestWaypointId(this.waypoints, this.position.x, 0, this.position.z);
    const startWp = this.waypoints.get(startWpId);
    if (!startWp) return;
    const { path } = findShortestWaypointPath(this.waypoints, startWp.id, targetWp.id);
    this.routeQueue = path
      .slice(1)
      .map((id) => this.waypoints.get(id)!)
      .filter(Boolean);
    if (this.routeQueue.length === 0 && startWp.id !== targetWp.id) {
      this.routeQueue = [targetWp];
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerFlashlightOn: boolean,
    playerNoiseRadius: number,
    playerIsHidden: boolean,
    distanceZone: DistanceZone,
    playerDistToGroupMeters: number,
    guidePos: { x: number; y: number; z: number },
    colliders: AABBBox[],
    difficulty: DifficultyLevel,
    audio: SoundSynthesizer,
    onPlayerBatonHit: (isLockerKiss: boolean) => void,
  ): void {
    if (this.quoteTimer > 0) {
      this.quoteTimer = Math.max(0, this.quoteTimer - dt);
      if (this.quoteTimer <= 0) {
        this.activeQuote = null;
      }
    }
    if (this.chaseBarkCooldown > 0) {
      this.chaseBarkCooldown = Math.max(0, this.chaseBarkCooldown - dt);
    }
    if (this.batonSwingTimer > 0) {
      this.batonSwingTimer = Math.max(0, this.batonSwingTimer - dt);
    }

    if (!playerIsHidden && this.lockerEntrySeenByPolice) {
      this.lockerEntrySeenByPolice = false;
      this.targetLockerSpot = null;
    }

    // 1. Line-of-sight raycast check between police officer eyes (1.12m) and player
    const rayCheck = checkRayObstruction(
      { x: this.position.x, y: 1.12, z: this.position.z },
      { x: playerPos.x, y: Math.max(1.0, playerPos.y - 0.15), z: playerPos.z },
      colliders,
      [],
    );
    const lineOfSightClear = !rayCheck.obstructed;

    // 2. Evaluate Vision Cone, Flashlight & Footstep Noise Detection
    const detection = evaluatePoliceDetection({
      policeX: this.position.x,
      policeZ: this.position.z,
      policeYaw: this.yaw,
      playerX: playerPos.x,
      playerZ: playerPos.z,
      playerFlashlightOn,
      playerNoiseRadius,
      playerIsHidden,
      lineOfSightClear,
    });
    this.lastDetection = detection;

    // Also check direct Euclidean distance to Guide Olga for group safe bubble
    const distToGuide = Math.hypot(playerPos.x - guidePos.x, playerPos.z - guidePos.z);
    const effectiveGroupDist = Math.min(playerDistToGroupMeters, distToGuide);

    // 3. Step the 4-State Machine
    const diffMult = GAME_CONFIG.difficulties[difficulty].suspicionRateMultiplier;
    const stepOut = stepPoliceStateMachine({
      currentState: this.state,
      currentSuspicion: this.suspicion,
      cooldownRemainingSec: this.cooldownRemainingSec,
      dt,
      distanceZone,
      playerDistToGroupMeters: effectiveGroupDist,
      detection,
      playerIsHidden,
      lockerEntrySeenByPolice: this.lockerEntrySeenByPolice,
      difficultyMultiplier: diffMult,
    });

    const prevState = this.state;
    this.state = stepOut.nextState;
    this.suspicion = stepOut.nextSuspicion;
    this.cooldownRemainingSec = stepOut.nextCooldownSec;

    // 4. Handle State Transition Events, Quotes, Radar Escape & Baton/Locker Kiss Attack
    if (stepOut.triggeredSuspicionBark && this.quoteTimer <= 0) {
      const q =
        GAME_CONFIG.police.suspicionQuotes[
          this.rng.int(0, GAME_CONFIG.police.suspicionQuotes.length - 1)
        ];
      this.speakQuote(q, audio, false);
      this.routeQueue = [];
    }

    if (stepOut.triggeredChaseStart) {
      const q =
        GAME_CONFIG.police.chaseQuotes[
          this.rng.int(0, GAME_CONFIG.police.chaseQuotes.length - 1)
        ];
      this.speakQuote(q, audio, true);
      this.chaseBarkCooldown = 6.2;
      this.routeQueue = [];
    }

    if (stepOut.triggeredGroupSafeAbort) {
      const q =
        GAME_CONFIG.police.groupSafeAbortQuotes[
          this.rng.int(0, GAME_CONFIG.police.groupSafeAbortQuotes.length - 1)
        ];
      this.speakQuote(q, audio, false);
      const stalkWp = this.pickStalkingWaypoint(playerPos);
      this.buildRouteToTargetWaypoint(stalkWp);
    }

    if (stepOut.triggeredLockerEscapedRadar) {
      const q =
        GAME_CONFIG.police.lockerEscapedRadarQuotes[
          this.rng.int(0, GAME_CONFIG.police.lockerEscapedRadarQuotes.length - 1)
        ];
      this.speakQuote(q, audio, false);
      const stalkWp = this.pickStalkingWaypoint(playerPos);
      this.buildRouteToTargetWaypoint(stalkWp);
    }

    if (stepOut.triggeredAttackHit) {
      this.batonSwingTimer = 0.65;
      const isLockerKiss = Boolean(stepOut.triggeredLockerKissHit || this.lockerEntrySeenByPolice);
      if (isLockerKiss && this.targetLockerSpot) {
        // Officer Igor flings the locker door open and steps right inside the locker to kiss the player!
        this.targetLockerSpot.currentDoorAngle = 1.35;
        this.targetLockerSpot.targetDoorAngle = 0.95;
        this.position.set(
          this.targetLockerSpot.insidePosition.x,
          0,
          this.targetLockerSpot.insidePosition.z,
        );
        this.yaw = this.targetLockerSpot.facingYaw;
        this.meshGroup.position.copy(this.position);
        this.meshGroup.rotation.y = this.yaw;

        const q =
          GAME_CONFIG.police.lockerKissQuotes[
            this.rng.int(0, GAME_CONFIG.police.lockerKissQuotes.length - 1)
          ];
        this.speakQuote(q, audio, false);
      } else {
        const q =
          GAME_CONFIG.police.cooldownQuotes[
            this.rng.int(0, GAME_CONFIG.police.cooldownQuotes.length - 1)
          ];
        this.speakQuote(q, audio, false);
      }

      this.lockerEntrySeenByPolice = false;
      this.targetLockerSpot = null;
      const retreatWp = this.pickRetreatWaypoint(playerPos);
      this.buildRouteToTargetWaypoint(retreatWp);
      onPlayerBatonHit(isLockerKiss);
    }

    // Periodic funny-threatening Turkish barks while chasing
    if (this.state === 'chase' && this.chaseBarkCooldown <= 0) {
      const q =
        GAME_CONFIG.police.chaseQuotes[
          this.rng.int(0, GAME_CONFIG.police.chaseQuotes.length - 1)
        ];
      this.speakQuote(q, audio, false);
      this.chaseBarkCooldown = 6.8;
    }

    // 5. Heartbeat Audio Pulse when Suspicion >= 22% or in Chase
    if (this.suspicion >= 22 || this.state === 'chase') {
      const suspNorm = this.state === 'chase' ? 1.0 : this.suspicion / 100;
      const beatInterval = 1.05 - suspNorm * 0.58; // 1.05s down to 0.47s at max chase
      this.heartbeatTimer += dt;
      if (this.heartbeatTimer >= beatInterval) {
        this.heartbeatTimer = 0;
        audio.playHeartbeat(suspNorm);
      }
    } else {
      this.heartbeatTimer = 0;
    }

    // 6. Movement & Pathfinding per State
    this.pathRepathTimer -= dt;

    if (this.state === 'stalking') {
      // If officer gets too close to the tourist group, step back to a stalking node
      const policeDistToGroup = Math.hypot(
        this.position.x - guidePos.x,
        this.position.z - guidePos.z,
      );
      if (this.routeQueue.length === 0) {
        if (this.stalkPauseTimer > 0 && policeDistToGroup > 10) {
          this.stalkPauseTimer -= dt;
          // Face toward player from the corner/doorway so silhouette is ominous
          const dx = playerPos.x - this.position.x;
          const dz = playerPos.z - this.position.z;
          const lookYaw = Math.atan2(-dx, -dz);
          this.smoothTurnTo(lookYaw, dt, 5);
        } else {
          const targetWp = this.pickStalkingWaypoint(playerPos);
          this.buildRouteToTargetWaypoint(targetWp);
          this.stalkPauseTimer = 2.8;
        }
      }
      this.followRouteQueue(dt, GAME_CONFIG.police.stalkSpeed);
    } else if (this.state === 'suspicion') {
      // Approach player along A* waypoint graph
      if (this.pathRepathTimer <= 0 || this.routeQueue.length === 0 || prevState !== 'suspicion') {
        this.pathRepathTimer = 1.1;
        const playerWpId = findNearestWaypointId(this.waypoints, playerPos.x, 0, playerPos.z);
        const playerWp = this.waypoints.get(playerWpId);
        if (playerWp) {
          this.buildRouteToTargetWaypoint(playerWp);
        }
      }
      this.followRouteQueue(dt, GAME_CONFIG.police.suspicionApproachSpeed);
    } else if (this.state === 'chase') {
      // Direct sprint when in line-of-sight and reasonably close; otherwise follow A* waypoints
      if (lineOfSightClear && detection.distanceToPlayer < 13.5) {
        this.routeQueue = [];
        this.moveTowardsPoint(playerPos.x, playerPos.z, GAME_CONFIG.police.chaseSpeed, dt);
      } else {
        if (this.pathRepathTimer <= 0 || this.routeQueue.length === 0 || prevState !== 'chase') {
          this.pathRepathTimer = 0.5;
          const playerWpId = findNearestWaypointId(this.waypoints, playerPos.x, 0, playerPos.z);
          const playerWp = this.waypoints.get(playerWpId);
          if (playerWp) {
            this.buildRouteToTargetWaypoint(playerWp);
          }
        }
        if (this.routeQueue.length > 0) {
          this.followRouteQueue(dt, GAME_CONFIG.police.chaseSpeed);
        } else {
          this.moveTowardsPoint(playerPos.x, playerPos.z, GAME_CONFIG.police.chaseSpeed, dt);
        }
      }
    } else if (this.state === 'cooldown') {
      if (this.routeQueue.length === 0 && detection.distanceToPlayer < 18) {
        const retreatWp = this.pickRetreatWaypoint(playerPos);
        this.buildRouteToTargetWaypoint(retreatWp);
      }
      this.followRouteQueue(dt, GAME_CONFIG.police.suspicionApproachSpeed);
    }

    // 7. Limb & Baton Animation
    if (this.batonSwingTimer > 0) {
      this.rightArmBaton.rotation.x = -1.6 + Math.sin(this.batonSwingTimer * 18) * 1.1;
    } else if (this.state === 'chase') {
      // Raised threatening baton wave while running!
      this.rightArmBaton.rotation.x = -1.25 + Math.sin(this.walkPhase * 1.4) * 0.45;
    }

    this.meshGroup.position.copy(this.position);
    this.meshGroup.rotation.y = this.yaw;
  }

  private followRouteQueue(dt: number, speed: number): void {
    if (this.routeQueue.length === 0) {
      // Idle breathing pose
      this.leftLeg.rotation.x = THREE.MathUtils.damp(this.leftLeg.rotation.x, 0, 8, dt);
      this.rightLeg.rotation.x = THREE.MathUtils.damp(this.rightLeg.rotation.x, 0, 8, dt);
      if (this.batonSwingTimer <= 0 && this.state !== 'chase') {
        this.rightArmBaton.rotation.x = THREE.MathUtils.damp(
          this.rightArmBaton.rotation.x,
          -0.25,
          8,
          dt,
        );
      }
      return;
    }

    const target = this.routeQueue[0];
    const reached = this.moveTowardsPoint(target.x, target.z, speed, dt);
    if (reached) {
      this.routeQueue.shift();
    }
  }

  private moveTowardsPoint(targetX: number, targetZ: number, speed: number, dt: number): boolean {
    const dx = targetX - this.position.x;
    const dz = targetZ - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= speed * dt + 0.15) {
      this.position.set(targetX, 0, targetZ);
      return true;
    }

    const ux = dx / dist;
    const uz = dz / dist;
    this.position.x += ux * speed * dt;
    this.position.z += uz * speed * dt;

    const targetYaw = Math.atan2(-ux, -uz);
    this.smoothTurnTo(targetYaw, dt, 9);

    this.walkPhase += speed * 4.5 * dt;
    const swing = Math.sin(this.walkPhase) * (this.state === 'chase' ? 0.72 : 0.48);
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing * 0.7;
    if (this.batonSwingTimer <= 0 && this.state !== 'chase') {
      this.rightArmBaton.rotation.x = -0.3 + Math.cos(this.walkPhase) * 0.25;
    }
    return false;
  }

  private smoothTurnTo(targetYaw: number, dt: number, turnRate: number): void {
    let diff = targetYaw - this.yaw;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.yaw += diff * (1 - Math.exp(-turnRate * dt));
  }

  public getDistanceToPlayer(playerPos: THREE.Vector3): number {
    return distance3D(
      this.position.x,
      this.position.y,
      this.position.z,
      playerPos.x,
      0,
      playerPos.z,
    );
  }

  public getStateLabelTr(): string {
    switch (this.state) {
      case 'stalking':
        return 'GÖZETLEME (Uzaktan İzliyor)';
      case 'suspicion':
        return 'ŞÜPHE (Yaklaşıyor!)';
      case 'chase':
        return 'KOVALAMA (Peşinde!)';
      case 'cooldown':
        return `SOĞUMA (${Math.ceil(this.cooldownRemainingSec)}sn Geri Çekildi)`;
    }
  }

  public getTelemetry(playerPos: THREE.Vector3): PoliceTelemetry {
    return {
      state: this.state,
      stateLabelTr: this.getStateLabelTr(),
      suspicion: Math.round(this.suspicion),
      cooldownRemainingSec: this.cooldownRemainingSec,
      distanceToPlayerMeters: Math.round(this.getDistanceToPlayer(playerPos) * 10) / 10,
      inVisionCone: this.lastDetection.inVisionCone,
      spottedByFlashlight: this.lastDetection.spottedByFlashlight,
      heardFootsteps: this.lastDetection.heardFootsteps,
      activeQuote: this.activeQuote,
    };
  }
}
