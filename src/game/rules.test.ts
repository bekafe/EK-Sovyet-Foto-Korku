import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePlayerToGroupPathDistance,
  classifyGroupDistance,
  findShortestWaypointPath,
  SeededRNG,
  WaypointNode,
} from './prng';
import { GAME_CONFIG, isPositionInsideElevator } from './config';
import {
  checkRayObstruction,
  evaluateJournalistRank,
  evaluatePhotoShot,
  generateScoreCode,
  insertLeaderboardEntry,
  parseScoreCode,
} from './scoring';
import { evaluatePoliceDetection, stepPoliceStateMachine } from './police';


test('SeededRNG produces deterministic sequences for identical seeds', () => {
  const rngA = new SeededRNG('SOVYET-1984');
  const rngB = new SeededRNG('SOVYET-1984');
  const rngC = new SeededRNG('FARKLI-TOHUM');

  const seqA = [rngA.next(), rngA.int(1, 100), rngA.next()];
  const seqB = [rngB.next(), rngB.int(1, 100), rngB.next()];
  const seqC = [rngC.next(), rngC.int(1, 100), rngC.next()];

  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
});

test('A* findShortestWaypointPath finds valid shortest route across connected rooms', () => {
  const nodes = new Map<string, WaypointNode>([
    ['a', { id: 'a', x: 0, y: 0, z: 0, roomId: 'r1', neighbors: ['b'] }],
    ['b', { id: 'b', x: 0, y: 0, z: -10, roomId: 'r1', neighbors: ['a', 'c', 'd'] }],
    ['c', { id: 'c', x: -10, y: 0, z: -10, roomId: 'r2', neighbors: ['b', 'e'] }],
    ['d', { id: 'd', x: 10, y: 0, z: -10, roomId: 'r3', neighbors: ['b'] }],
    ['e', { id: 'e', x: -10, y: 0, z: -20, roomId: 'r2', neighbors: ['c'] }],
  ]);

  const res = findShortestWaypointPath(nodes, 'a', 'e');
  assert.deepEqual(res.path, ['a', 'b', 'c', 'e']);
  assert.equal(Math.round(res.distance), 30);
});

test('calculatePlayerToGroupPathDistance and classifyGroupDistance classify Green, Yellow, Red properly', () => {
  const nodes = new Map<string, WaypointNode>([
    ['w1', { id: 'w1', x: 0, y: 0, z: 0, roomId: 'r1', neighbors: ['w2'] }],
    ['w2', { id: 'w2', x: 0, y: 0, z: -12, roomId: 'r2', neighbors: ['w1', 'w3'] }],
    ['w3', { id: 'w3', x: 0, y: 0, z: -28, roomId: 'r3', neighbors: ['w2'] }],
  ]);

  const near = calculatePlayerToGroupPathDistance(
    nodes,
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: 0 },
  );
  assert.equal(classifyGroupDistance(near.distanceMeters, 11, 21), 'green');

  const medium = calculatePlayerToGroupPathDistance(
    nodes,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -15 },
  );
  assert.equal(classifyGroupDistance(medium.distanceMeters, 11, 21), 'yellow');

  const far = calculatePlayerToGroupPathDistance(
    nodes,
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 0, z: -28 },
  );
  assert.equal(classifyGroupDistance(far.distanceMeters, 11, 21), 'red');
});

test('GAME_CONFIG.elevator defines 4 floors with old woman voice announcements and top-floor Babushka room', () => {
  assert.equal(GAME_CONFIG.elevator.floors.length, 4);
  const topFloor = GAME_CONFIG.elevator.floors.find((f) => f.floorNumber === 3);
  assert.ok(topFloor);
  assert.equal(topFloor.targetRoomId, 'babushka_odasi');
  assert.ok(topFloor.announcement.toLowerCase().includes('son kat'));
  assert.ok(topFloor.announcement.includes('matruşka'));
});

test('evaluatePhotoShot scores centered, unobstructed, properly-lit shots >= 60 and penalizes missing flash or obstructions', () => {
  const perfect = evaluatePhotoShot({
    inFrontOfCamera: true,
    ndcX: 0.04,
    ndcY: -0.02,
    viewAngleDiffDeg: 8,
    toleranceDeg: 32,
    distanceMeters: 5.2,
    minDist: 2.5,
    maxDist: 8.5,
    obstructedBy: 'none',
    playerSpeed: 0.1,
    requiresFlash: true,
    flashUsed: true,
    remainingTimeRatio: 0.85,
    basePoints: 100,
  });

  assert.ok(perfect.isValid);
  assert.ok(perfect.qualityScore >= 85);

  const darkNoFlash = evaluatePhotoShot({
    inFrontOfCamera: true,
    ndcX: 0.35,
    ndcY: 0.25,
    viewAngleDiffDeg: 28,
    toleranceDeg: 30,
    distanceMeters: 5.0,
    minDist: 2.5,
    maxDist: 8.5,
    obstructedBy: 'none',
    playerSpeed: 0.0,
    requiresFlash: true,
    flashUsed: false,
    remainingTimeRatio: 0.4,
    basePoints: 100,
  });

  assert.equal(darkNoFlash.isValid, false);
  assert.ok(darkNoFlash.qualityScore < 60);
  assert.ok(darkNoFlash.feedbackTr.toLowerCase().includes('flaş'));

  const wallBlocked = evaluatePhotoShot({
    inFrontOfCamera: true,
    ndcX: 0,
    ndcY: 0,
    viewAngleDiffDeg: 4,
    toleranceDeg: 32,
    distanceMeters: 5.0,
    minDist: 2.5,
    maxDist: 8.5,
    obstructedBy: 'wall',
    playerSpeed: 0,
    requiresFlash: false,
    flashUsed: false,
    remainingTimeRatio: 0.9,
    basePoints: 100,
  });

  assert.equal(wallBlocked.isValid, false);
  assert.ok(wallBlocked.qualityScore < 60);
});

test('checkRayObstruction detects wall AABB and tourist NPC cylinder blocking camera line of sight', () => {
  const origin = { x: 0, y: 1.68, z: 6 };
  const target = { x: 0, y: 1.4, z: 0 };

  const clear = checkRayObstruction(origin, target, [], []);
  assert.equal(clear.obstructed, false);
  assert.equal(clear.blockerType, 'none');

  const wallBetween = checkRayObstruction(
    origin,
    target,
    [{ minX: -2, maxX: 2, minY: 0, maxY: 3, minZ: 2.5, maxZ: 3.5 }],
    [],
  );
  assert.equal(wallBetween.obstructed, true);
  assert.equal(wallBetween.blockerType, 'wall');

  const npcBetween = checkRayObstruction(
    origin,
    target,
    [],
    [{ x: 0.05, z: 3.0, radius: 0.42 }],
  );
  assert.equal(npcBetween.obstructed, true);
  assert.equal(npcBetween.blockerType, 'npc');
});

test('evaluatePoliceDetection detects vision cone, distant flashlight beam, and sprinting footsteps', () => {
  // Officer at (0, 0) facing North (yaw = 0 -> forward is (0, -1))
  const seenInCone = evaluatePoliceDetection({
    policeX: 0,
    policeZ: 0,
    policeYaw: 0,
    playerX: 0,
    playerZ: -12,
    playerFlashlightOn: false,
    playerNoiseRadius: 0,
    playerIsHidden: false,
    lineOfSightClear: true,
  });
  assert.equal(seenInCone.inVisionCone, true);
  assert.equal(seenInCone.spottedByFlashlight, false);

  // Player at 25m (outside normal 18m vision, but inside 29m flashlight detection)
  const seenByFlashlight = evaluatePoliceDetection({
    policeX: 0,
    policeZ: 0,
    policeYaw: 0,
    playerX: 1,
    playerZ: -25,
    playerFlashlightOn: true,
    playerNoiseRadius: 0,
    playerIsHidden: false,
    lineOfSightClear: true,
  });
  assert.equal(seenByFlashlight.inVisionCone, false);
  assert.equal(seenByFlashlight.spottedByFlashlight, true);

  // Player sprinting behind the police officer at 10m (heard via 15m sprint noise radius)
  const heardBehind = evaluatePoliceDetection({
    policeX: 0,
    policeZ: 0,
    policeYaw: 0,
    playerX: 0,
    playerZ: 10,
    playerFlashlightOn: false,
    playerNoiseRadius: GAME_CONFIG.player.sprintNoiseRadius,
    playerIsHidden: false,
    lineOfSightClear: false,
  });
  assert.equal(heardBehind.inVisionCone, false);
  assert.equal(heardBehind.heardFootsteps, true);
});

test('stepPoliceStateMachine transitions through Stalking -> Suspicion -> Chase -> Cooldown and aborts chase near Tourist Group', () => {
  // 1. Stalking -> Suspicion -> Chase when far from group (Red zone)
  const toSuspicion = stepPoliceStateMachine({
    currentState: 'stalking',
    currentSuspicion: 18,
    cooldownRemainingSec: 0,
    dt: 1.0,
    distanceZone: 'red',
    playerDistToGroupMeters: 26,
    detection: {
      distanceToPlayer: 14,
      inVisionCone: true,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: false,
    difficultyMultiplier: 1.0,
  });
  assert.equal(toSuspicion.nextState, 'suspicion');
  assert.equal(toSuspicion.triggeredSuspicionBark, true);
  assert.ok(toSuspicion.nextSuspicion > 20);

  // 2. Reaching 100 suspicion triggers Chase
  const toChase = stepPoliceStateMachine({
    currentState: 'suspicion',
    currentSuspicion: 92,
    cooldownRemainingSec: 0,
    dt: 1.0,
    distanceZone: 'red',
    playerDistToGroupMeters: 26,
    detection: {
      distanceToPlayer: 10,
      inVisionCone: true,
      spottedByFlashlight: true,
      heardFootsteps: true,
    },
    playerIsHidden: false,
    difficultyMultiplier: 1.0,
  });
  assert.equal(toChase.nextState, 'chase');
  assert.equal(toChase.triggeredChaseStart, true);

  // 3. Returning to the tourist group (Green zone) immediately aborts the chase!
  const abortNearGroup = stepPoliceStateMachine({
    currentState: 'chase',
    currentSuspicion: 100,
    cooldownRemainingSec: 0,
    dt: 0.2,
    distanceZone: 'green',
    playerDistToGroupMeters: 5.0,
    detection: {
      distanceToPlayer: 3.5,
      inVisionCone: true,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: false,
    difficultyMultiplier: 1.0,
  });
  assert.equal(abortNearGroup.nextState, 'stalking');
  assert.equal(abortNearGroup.triggeredGroupSafeAbort, true);
  assert.equal(abortNearGroup.triggeredAttackHit, false);

  // 4. Baton attack within attackRangeMeters transitions to 15s Cooldown
  const batonHit = stepPoliceStateMachine({
    currentState: 'chase',
    currentSuspicion: 100,
    cooldownRemainingSec: 0,
    dt: 0.1,
    distanceZone: 'red',
    playerDistToGroupMeters: 25,
    detection: {
      distanceToPlayer: 1.2,
      inVisionCone: true,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: false,
    difficultyMultiplier: 1.0,
  });
  assert.equal(batonHit.triggeredAttackHit, true);
  assert.equal(batonHit.nextState, 'cooldown');
  assert.equal(batonHit.nextCooldownSec, GAME_CONFIG.police.cooldownDurationSec);
});

test('isPositionInsideElevator allows elevator usage only when physically inside the cabin', () => {
  // Outside in Entrance Hall or middle of Corridor -> false
  assert.equal(isPositionInsideElevator(2.35, 6.4), false);
  assert.equal(isPositionInsideElevator(0, -18.0), false);
  assert.equal(isPositionInsideElevator(0, -28.0), false);

  // Physically inside the elevator cabin at the North end of the corridor -> true
  assert.equal(isPositionInsideElevator(0, -30.8), true);
  assert.equal(isPositionInsideElevator(0.5, -31.15), true);
});

test('stepPoliceStateMachine handles locker hiding: unseen entry escapes radar immediately, seen entry triggers locker kiss inside', () => {
  // 1. Unseen locker entry while chased -> escapes police radar immediately!
  const escapedRadar = stepPoliceStateMachine({
    currentState: 'chase',
    currentSuspicion: 100,
    cooldownRemainingSec: 0,
    dt: 0.1,
    distanceZone: 'red',
    playerDistToGroupMeters: 28,
    detection: {
      distanceToPlayer: 9.0,
      inVisionCone: false,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: true,
    lockerEntrySeenByPolice: false,
    difficultyMultiplier: 1.0,
  });
  assert.equal(escapedRadar.nextState, 'stalking');
  assert.equal(escapedRadar.nextSuspicion, 0);
  assert.equal(escapedRadar.triggeredLockerEscapedRadar, true);
  assert.equal(escapedRadar.triggeredAttackHit, false);

  // 2. Seen locker entry -> police continues chase and enters the locker to kiss the player when in range
  const seenStillChasing = stepPoliceStateMachine({
    currentState: 'suspicion',
    currentSuspicion: 55,
    cooldownRemainingSec: 0,
    dt: 0.2,
    distanceZone: 'red',
    playerDistToGroupMeters: 26,
    detection: {
      distanceToPlayer: 6.5,
      inVisionCone: false,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: true,
    lockerEntrySeenByPolice: true,
    difficultyMultiplier: 1.0,
  });
  assert.equal(seenStillChasing.nextState, 'chase');
  assert.equal(seenStillChasing.nextSuspicion, 100);
  assert.equal(seenStillChasing.triggeredLockerKissHit, false);

  const lockerKissHit = stepPoliceStateMachine({
    currentState: 'chase',
    currentSuspicion: 100,
    cooldownRemainingSec: 0,
    dt: 0.1,
    distanceZone: 'red',
    playerDistToGroupMeters: 26,
    detection: {
      distanceToPlayer: 1.8,
      inVisionCone: false,
      spottedByFlashlight: false,
      heardFootsteps: false,
    },
    playerIsHidden: true,
    lockerEntrySeenByPolice: true,
    difficultyMultiplier: 1.0,
  });
  assert.equal(lockerKissHit.triggeredAttackHit, true);
  assert.equal(lockerKissHit.triggeredLockerKissHit, true);
  assert.equal(lockerKissHit.nextState, 'cooldown');
});

test('evaluateJournalistRank, generateScoreCode, parseScoreCode, and insertLeaderboardEntry work deterministically', () => {
  // 1. Ranks: Amatör (<300), Muhabir (300-599), Usta (600+)
  assert.equal(evaluateJournalistRank(120), 'Amatör');
  assert.equal(evaluateJournalistRank(380), 'Muhabir');
  assert.equal(evaluateJournalistRank(640), 'Usta');

  // 2. Score Code round-trip (Seed + Difficulty + Score + Rank + Checksum)
  const code = generateScoreCode({
    seed: 'SOVYET-1984',
    difficulty: 'hard',
    totalScore: 640,
    completedTasks: 8,
    totalTasks: 9,
    photosCount: 10,
  });
  assert.ok(code.startsWith('ST:SOVYET-1984:Z:0640:USTA:8/9:'));

  const parsed = parseScoreCode(code);
  assert.equal(parsed.isScoreCode, true);
  assert.equal(parsed.validChecksum, true);
  assert.equal(parsed.seed, 'SOVYET-1984');
  assert.equal(parsed.difficulty, 'hard');
  assert.equal(parsed.claimedScore, 640);
  assert.equal(parsed.claimedRank, 'Usta');
  assert.equal(parsed.completedTasks, 8);
  assert.equal(parsed.totalTasks, 9);

  // 3. Leaderboard sorting by score descending, then completedTasks descending
  const board = insertLeaderboardEntry(
    [
      {
        id: 'r1',
        seed: 'TUR-1000',
        difficulty: 'normal',
        totalScore: 320,
        rank: 'Muhabir',
        completedTasks: 4,
        totalTasks: 9,
        photosCount: 5,
        livesRemaining: 2,
        outcome: 'tour_finished',
        scoreCode: 'ST:TUR-1000:N:0320:MUHABIR:4/9:00',
        createdAtIso: '2026-11-06T10:00:00Z',
        dateLabelTr: '10:00',
      },
    ],
    {
      id: 'r2',
      seed: 'SOVYET-1984',
      difficulty: 'hard',
      totalScore: 640,
      rank: 'Usta',
      completedTasks: 8,
      totalTasks: 9,
      photosCount: 10,
      livesRemaining: 3,
      outcome: 'tour_finished',
      scoreCode: code,
      createdAtIso: '2026-11-06T11:00:00Z',
      dateLabelTr: '11:00',
    },
  );
  assert.equal(board.length, 2);
  assert.equal(board[0].id, 'r2');
  assert.equal(board[0].rank, 'Usta');
  assert.equal(board[1].id, 'r1');
});


