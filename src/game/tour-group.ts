/**
 * Tourist Group Manager ("Son Tur" - Stage 2).
 * Manages 5 composite 3D NPCs (1 Tour Guide "Rehber Olga" + 4 Tourists).
 * Follows the seeded stop-by-stop route, waits at each stop with gibberish speech
 * and Turkish subtitles, provides physical obstacle collision cylinders, and calculates
 * continuous path distance (Green / Yellow / Red) between the player and the group.
 */

import * as THREE from 'three';
import { DifficultyLevel, GAME_CONFIG } from './config';
import {
  calculatePlayerToGroupPathDistance,
  classifyGroupDistance,
  DistanceZone,
  findShortestWaypointPath,
  SeededRNG,
  WaypointNode,
} from './prng';
import { PlayerObstacleCylinder } from './player';
import { SoundSynthesizer } from './audio';

export interface TouristNPC {
  id: string;
  name: string;
  isGuide: boolean;
  group: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  position: THREE.Vector3;
  yaw: number;
  formationOffset: THREE.Vector3;
  walkPhase: number;
}

export interface TourGroupTelemetry {
  currentStopIndex: number;
  totalStops: number;
  currentStopTitle: string;
  groupState: 'waiting_at_stop' | 'moving_to_next';
  stopCountdownSec: number;
  tourRemainingSec: number;
  currentSubtitle: string | null;
  playerDistanceMeters: number;
  distanceZone: DistanceZone;
  activePathToPlayer: string[];
  guidePosition: { x: number; y: number; z: number };
}

/**
 * Builds a composite 9-part low-poly NPC model with grounded bottom-center pivot (y = 0)
 * and a soft contact shadow disc underneath.
 */
function createCompositeNPCMesh(isGuide: boolean, coatHex: number, hatHex: number): {
  group: THREE.Group;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
} {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: 0xdcc0a8, roughness: 0.75, metalness: 0.05 });
  const coatMat = new THREE.MeshStandardMaterial({ color: coatHex, roughness: 0.82, metalness: 0.08 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.88, metalness: 0.04 });
  const hatMat = new THREE.MeshStandardMaterial({ color: hatHex, roughness: 0.55, metalness: 0.15 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.5 });

  // 1. Contact shadow disc on floor (y = 0.015)
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x050706,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.45, 10), shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  group.add(shadowDisc);

  // 2 & 3. Left & Right Legs
  const legGeo = new THREE.BoxGeometry(0.18, 0.72, 0.2);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.position.set(-0.12, 0.36, 0);
  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.position.set(0.12, 0.36, 0);
  group.add(leftLeg, rightLeg);

  // 4. Torso Overcoat
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.68, 0.28), coatMat);
  torso.position.set(0, 1.04, 0);
  group.add(torso);

  // 5 & 6. Left & Right Arms
  const armGeo = new THREE.BoxGeometry(0.14, 0.58, 0.16);
  const leftArm = new THREE.Mesh(armGeo, coatMat);
  leftArm.position.set(-0.32, 1.02, 0);
  const rightArm = new THREE.Mesh(armGeo, coatMat);
  rightArm.position.set(0.32, 1.02, 0);
  group.add(leftArm, rightArm);

  // 7. Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), skinMat);
  head.position.set(0, 1.55, 0);
  group.add(head);

  // 8. Hat / Ushanka / Guide Red Beret
  const hat = new THREE.Mesh(
    isGuide
      ? new THREE.CylinderGeometry(0.21, 0.18, 0.1, 8)
      : new THREE.BoxGeometry(0.32, 0.16, 0.32),
    hatMat,
  );
  hat.position.set(0, 1.73, 0);
  group.add(hat);

  // 9. Distinct Prop: Guide holds a raised Red Soviet Tour Flag; Tourists have a backpack + vintage camera
  if (isGuide) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.95, 6), strapMat);
    pole.position.set(0, 0.35, 0.12);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.28, 0.42),
      new THREE.MeshStandardMaterial({
        color: 0xc92a22,
        emissive: 0x550d0a,
        roughness: 0.5,
      }),
    );
    flag.position.set(0, 0.72, 0.32);
    rightArm.add(pole, flag);
    rightArm.rotation.x = -0.65;
  } else {
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.18), hatMat);
    backpack.position.set(0, 1.06, 0.22);
    const camBox = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.12), strapMat);
    camBox.position.set(0, 1.05, -0.18);
    group.add(backpack, camBox);
  }

  return { group, leftLeg, rightLeg, leftArm, rightArm };
}

export class TourGroupManager {
  public readonly groupRoot = new THREE.Group();
  public readonly npcs: TouristNPC[] = [];

  private waypoints: Map<string, WaypointNode>;
  private orderedStopIds: string[] = [];
  private currentStopIdx = 0;
  private groupState: 'waiting_at_stop' | 'moving_to_next' = 'waiting_at_stop';

  private stopTimerSec = 26;
  private stopDurationSec = 26;
  private tourRemainingSec = 540;

  private activeRouteQueue: WaypointNode[] = [];
  private guidePos = new THREE.Vector3(0, 0, 4.5);
  private guideYaw = 0;

  private mumbleAccumMs = 0;
  private mumbleStep = 0;

  // Distance thresholds configured per difficulty
  private greenMax = 11.0;
  private yellowMax = 21.0;

  private lastPlayerDistance = 2.0;
  private lastDistanceZone: DistanceZone = 'green';
  private lastPathToPlayer: string[] = [];

  constructor(
    scene: THREE.Scene,
    waypoints: Map<string, WaypointNode>,
    baseStopOrder: string[],
    seed: string,
    difficulty: DifficultyLevel,
  ) {
    this.waypoints = waypoints;
    this.groupRoot.name = 'TourGroupNPCs';
    scene.add(this.groupRoot);

    this.buildNPCModels();
    this.reset(seed, difficulty, baseStopOrder);
  }

  private buildNPCModels(): void {
    const configs = [
      { id: 'npc_guide', name: 'Rehber Olga', isGuide: true, coat: 0x8f2822, hat: 0xc92a22, offset: new THREE.Vector3(0, 0, 0) },
      { id: 'npc_t1', name: 'Turist Anton', isGuide: false, coat: 0x3b5249, hat: 0x242926, offset: new THREE.Vector3(-1.1, 0, 1.35) },
      { id: 'npc_t2', name: 'Turist Elena', isGuide: false, coat: 0x6b5b3e, hat: 0x3d3322, offset: new THREE.Vector3(1.1, 0, 1.35) },
      { id: 'npc_t3', name: 'Turist Boris', isGuide: false, coat: 0x3e4a59, hat: 0x222830, offset: new THREE.Vector3(-0.75, 0, 2.55) },
      { id: 'npc_t4', name: 'Turist Vera', isGuide: false, coat: 0x5c4354, hat: 0x33242e, offset: new THREE.Vector3(0.75, 0, 2.55) },
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const built = createCompositeNPCMesh(cfg.isGuide, cfg.coat, cfg.hat);
      this.groupRoot.add(built.group);
      this.npcs.push({
        id: cfg.id,
        name: cfg.name,
        isGuide: cfg.isGuide,
        group: built.group,
        leftLeg: built.leftLeg,
        rightLeg: built.rightLeg,
        leftArm: built.leftArm,
        rightArm: built.rightArm,
        position: new THREE.Vector3(),
        yaw: 0,
        formationOffset: cfg.offset,
        walkPhase: i * 1.3,
      });
    }
  }

  public reset(seed: string, difficulty: DifficultyLevel, baseStopOrder: string[]): void {
    const diffCfg = GAME_CONFIG.difficulties[difficulty];
    this.stopDurationSec = diffCfg.stopWaitSec;
    this.stopTimerSec = this.stopDurationSec;
    this.tourRemainingSec = diffCfg.tourDurationSec;
    this.greenMax = diffCfg.SafeDistanceMeters;
    this.yellowMax = diffCfg.WarningDistanceMeters;

    // Seeded route variation: always starts at Entrance Hall (wp_hol_south)
    // and ends at the Top Floor Old Woman's Room (wp_babushka_oda)
    const rng = new SeededRNG(seed + '-route');
    const firstStop = baseStopOrder[0];
    const finalStop = baseStopOrder[baseStopOrder.length - 1];
    const middleStops = baseStopOrder.slice(1, baseStopOrder.length - 1);
    if (rng.next() > 0.5) {
      middleStops.reverse();
    }
    this.orderedStopIds = [firstStop, ...middleStops, finalStop];
    this.currentStopIdx = 0;
    this.groupState = 'waiting_at_stop';
    this.activeRouteQueue = [];

    const startNode = this.waypoints.get(firstStop)!;
    this.guidePos.set(startNode.x, 0, startNode.z);
    this.guideYaw = 0;

    // Place all 5 NPCs in formation around the guide
    for (const npc of this.npcs) {
      npc.position.set(
        this.guidePos.x + npc.formationOffset.x,
        0,
        this.guidePos.z + npc.formationOffset.z,
      );
      npc.yaw = 0;
      npc.group.position.copy(npc.position);
      npc.group.rotation.y = npc.yaw;
    }
  }

  /**
   * Moves the tour group along with the player when transitioning between floors via the Soviet Elevator.
   */
  public moveGroupToFloorStop(floorNumber: number): void {
    const floorStopMap: Record<number, string> = {
      0: 'wp_kazan_center',
      1: 'wp_koridor_north',
      2: 'wp_cati_center',
      3: 'wp_babushka_oda',
    };
    const targetStopId = floorStopMap[floorNumber] ?? 'wp_koridor_north';
    const idx = this.orderedStopIds.indexOf(targetStopId);
    if (idx !== -1) {
      this.currentStopIdx = idx;
    }
    const targetNode = this.waypoints.get(targetStopId);
    if (!targetNode) return;

    this.groupState = 'waiting_at_stop';
    this.stopTimerSec = this.stopDurationSec;
    this.activeRouteQueue = [];
    this.guidePos.set(targetNode.x, 0, targetNode.z);

    for (const npc of this.npcs) {
      npc.position.set(
        this.guidePos.x + npc.formationOffset.x * 0.65,
        0,
        this.guidePos.z + npc.formationOffset.z * 0.65,
      );
      npc.group.position.copy(npc.position);
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    audio: SoundSynthesizer,
  ): { tourFinished: boolean } {
    // Advance overall tour countdown
    this.tourRemainingSec = Math.max(0, this.tourRemainingSec - dt);
    if (this.tourRemainingSec <= 0) {
      return { tourFinished: true };
    }

    const currentStopId = this.orderedStopIds[this.currentStopIdx];
    const currentStopNode = this.waypoints.get(currentStopId)!;

    if (this.groupState === 'waiting_at_stop') {
      this.stopTimerSec = Math.max(0, this.stopTimerSec - dt);

      // Face guide toward stop's lookTarget
      if (currentStopNode.lookTarget) {
        const dx = currentStopNode.lookTarget.x - this.guidePos.x;
        const dz = currentStopNode.lookTarget.z - this.guidePos.z;
        const targetYaw = Math.atan2(-dx, -dz);
        this.guideYaw = this.dampAngle(this.guideYaw, targetYaw, 5, dt);
      }

      // Guide speaks gibberish mumble for first 70% of the stop wait time
      const speechRatio = 1 - this.stopTimerSec / this.stopDurationSec;
      if (speechRatio < 0.78 && this.lastPlayerDistance < 22) {
        this.mumbleAccumMs += dt * 1000;
        if (this.mumbleAccumMs >= GAME_CONFIG.tourGroup.guideMumbleIntervalMs) {
          this.mumbleAccumMs = 0;
          this.mumbleStep++;
          audio.playGuideMumbleSyllable(this.mumbleStep);
        }
      }

      // Transition to next stop when stop timer expires
      if (this.stopTimerSec <= 0) {
        const nextIdx = (this.currentStopIdx + 1) % this.orderedStopIds.length;
        const nextStopId = this.orderedStopIds[nextIdx];
        const { path } = findShortestWaypointPath(this.waypoints, currentStopId, nextStopId);
        this.activeRouteQueue = path
          .slice(1)
          .map((id) => this.waypoints.get(id)!)
          .filter(Boolean);
        this.currentStopIdx = nextIdx;
        this.groupState = 'moving_to_next';
      }
    } else {
      // Moving along A* waypoint queue to next stop
      if (this.activeRouteQueue.length === 0) {
        this.groupState = 'waiting_at_stop';
        this.stopTimerSec = this.stopDurationSec;
      } else {
        const targetWp = this.activeRouteQueue[0];
        const dx = targetWp.x - this.guidePos.x;
        const dz = targetWp.z - this.guidePos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const speed = GAME_CONFIG.tourGroup.moveSpeed;

        if (dist <= speed * dt + 0.15) {
          this.guidePos.set(targetWp.x, 0, targetWp.z);
          this.activeRouteQueue.shift();
          if (this.activeRouteQueue.length === 0) {
            this.groupState = 'waiting_at_stop';
            this.stopTimerSec = this.stopDurationSec;
          }
        } else {
          const ux = dx / dist;
          const uz = dz / dist;
          this.guidePos.x += ux * speed * dt;
          this.guidePos.z += uz * speed * dt;
          const moveYaw = Math.atan2(-ux, -uz);
          this.guideYaw = this.dampAngle(this.guideYaw, moveYaw, 8, dt);
        }
      }
    }

    // Update all 5 NPCs to follow the guide smoothly in formation
    const cosY = Math.cos(this.guideYaw);
    const sinY = Math.sin(this.guideYaw);

    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i];
      if (npc.isGuide) {
        const moveDelta = npc.position.distanceTo(this.guidePos);
        npc.position.copy(this.guidePos);
        npc.yaw = this.guideYaw;
        this.animateNPCLimbs(npc, moveDelta / Math.max(0.001, dt), dt);
      } else {
        // Rotate formation offset by guideYaw, tightening width slightly when walking through doorways
        const widthFactor = this.groupState === 'moving_to_next' ? 0.58 : 1.0;
        const ox = npc.formationOffset.x * widthFactor;
        const oz = npc.formationOffset.z;
        const worldOffX = ox * cosY + oz * sinY;
        const worldOffZ = -ox * sinY + oz * cosY;

        const targetX = this.guidePos.x + worldOffX;
        const targetZ = this.guidePos.z + worldOffZ;

        const prevX = npc.position.x;
        const prevZ = npc.position.z;

        npc.position.x = THREE.MathUtils.damp(npc.position.x, targetX, 4.2, dt);
        npc.position.z = THREE.MathUtils.damp(npc.position.z, targetZ, 4.2, dt);

        const stepDist = Math.hypot(npc.position.x - prevX, npc.position.z - prevZ);
        const speedNow = stepDist / Math.max(0.001, dt);

        if (speedNow > 0.25) {
          const moveYaw = Math.atan2(-(npc.position.x - prevX), -(npc.position.z - prevZ));
          npc.yaw = this.dampAngle(npc.yaw, moveYaw, 7, dt);
        } else {
          npc.yaw = this.dampAngle(npc.yaw, this.guideYaw, 4, dt);
        }

        this.animateNPCLimbs(npc, speedNow, dt);
      }

      npc.group.position.copy(npc.position);
      npc.group.rotation.y = npc.yaw;
    }

    // Compute navigable path distance between player and guide
    const pathResult = calculatePlayerToGroupPathDistance(
      this.waypoints,
      { x: playerPos.x, y: 0, z: playerPos.z },
      { x: this.guidePos.x, y: 0, z: this.guidePos.z },
    );
    this.lastPlayerDistance = pathResult.distanceMeters;
    this.lastPathToPlayer = pathResult.pathNodeIds;
    this.lastDistanceZone = classifyGroupDistance(
      this.lastPlayerDistance,
      this.greenMax,
      this.yellowMax,
    );

    return { tourFinished: false };
  }

  private animateNPCLimbs(npc: TouristNPC, speed: number, dt: number): void {
    if (speed > 0.15) {
      npc.walkPhase += speed * 3.2 * dt;
      const swing = Math.sin(npc.walkPhase) * 0.45;
      npc.leftLeg.rotation.x = swing;
      npc.rightLeg.rotation.x = -swing;
      npc.leftArm.rotation.x = -swing * 0.7;
      if (!npc.isGuide) {
        npc.rightArm.rotation.x = swing * 0.7;
      }
    } else {
      npc.leftLeg.rotation.x = THREE.MathUtils.damp(npc.leftLeg.rotation.x, 0, 8, dt);
      npc.rightLeg.rotation.x = THREE.MathUtils.damp(npc.rightLeg.rotation.x, 0, 8, dt);
      npc.leftArm.rotation.x = THREE.MathUtils.damp(npc.leftArm.rotation.x, 0, 8, dt);
      if (!npc.isGuide) {
        npc.rightArm.rotation.x = THREE.MathUtils.damp(npc.rightArm.rotation.x, 0, 8, dt);
      }
    }
  }

  private dampAngle(current: number, target: number, lambda: number, dt: number): number {
    let diff = target - current;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return current + diff * (1 - Math.exp(-lambda * dt));
  }

  public getObstacleCylinders(): PlayerObstacleCylinder[] {
    return this.npcs.map((npc) => ({
      x: npc.position.x,
      z: npc.position.z,
      radius: GAME_CONFIG.tourGroup.npcCollisionRadius,
    }));
  }

  public getTelemetry(): TourGroupTelemetry {
    const stopId = this.orderedStopIds[this.currentStopIdx];
    const stopNode = this.waypoints.get(stopId)!;

    let subtitle: string | null = null;
    if (this.groupState === 'waiting_at_stop' && stopNode.guideSpeech && stopNode.guideSpeech.length > 0) {
      const elapsedRatio = 1 - this.stopTimerSec / Math.max(1, this.stopDurationSec);
      if (elapsedRatio < 0.85 && this.lastPlayerDistance <= 24) {
        const lineIdx = Math.min(
          stopNode.guideSpeech.length - 1,
          Math.floor((elapsedRatio / 0.85) * stopNode.guideSpeech.length),
        );
        subtitle = stopNode.guideSpeech[lineIdx];
      }
    } else if (this.groupState === 'moving_to_next' && this.lastPlayerDistance <= 24) {
      subtitle = `Rehber Olga: "Lütfen sırayı bozmayın, ${stopNode.stopTitle ?? 'sonraki durağa'} ilerliyoruz..."`;
    }

    return {
      currentStopIndex: this.currentStopIdx + 1,
      totalStops: this.orderedStopIds.length,
      currentStopTitle: stopNode.stopTitle ?? stopId,
      groupState: this.groupState,
      stopCountdownSec: this.stopTimerSec,
      tourRemainingSec: this.tourRemainingSec,
      currentSubtitle: subtitle,
      playerDistanceMeters: this.lastPlayerDistance,
      distanceZone: this.lastDistanceZone,
      activePathToPlayer: this.lastPathToPlayer,
      guidePosition: { x: this.guidePos.x, y: this.guidePos.y, z: this.guidePos.z },
    };
  }
}
