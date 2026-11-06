/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DifficultyLevel, GAME_CONFIG, isPositionInsideElevator } from './game/config';
import { buildSovietLevel, findRoomAtPosition } from './game/level';
import { PlayerController } from './game/player';
import { TourGroupManager } from './game/tour-group';
import { PoliceOfficerManager } from './game/police';
import { PhotoCameraSystem } from './game/photo-camera';
import { DebugVisualizer } from './game/debug';
import { SoundSynthesizer } from './game/audio';
import { GameLifecycleState, GameUI, HudSnapshot } from './game/ui';
import {
  clearLeaderboardStorage,
  evaluateJournalistRank,
  generateScoreCode,
  LeaderboardEntry,
  loadLeaderboardFromStorage,
  saveLeaderboardEntryToStorage,
} from './game/scoring';

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const initialAutoStart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [gameState, setGameState] = useState<GameLifecycleState>(
    initialAutoStart ? 'playing' : 'title',
  );
  const [seed, setSeed] = useState<string>(GAME_CONFIG.defaultSeed);
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('normal');
  const [mouseSensitivity, setMouseSensitivity] = useState<number>(
    GAME_CONFIG.player.mouseSensitivityDefault,
  );
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() =>
    loadLeaderboardFromStorage(),
  );

  const [hud, setHud] = useState<HudSnapshot>({
    roomName: '1. Giriş Holü (Kültür Sarayı Fuayesi)',
    roomIsDark: false,
    roomHint: 'Soğuk mermer zemin ve kırık Sovyet yıldızı anıtı.',
    tourRemainingSec: GAME_CONFIG.difficulties.normal.tourDurationSec,
    currentStopIndex: 1,
    totalStops: 8,
    currentStopTitle: 'Durak 1: Kültür Sarayı Giriş Fuayesi',
    groupState: 'waiting_at_stop',
    stopCountdownSec: GAME_CONFIG.difficulties.normal.stopWaitSec,
    currentSubtitle:
      'Rehber Olga: "Yoldaş turistler, 1962 yapımı Kültür Sarayı fuayesine hoş geldiniz!"',
    playerDistanceMeters: 3.0,
    distanceZone: 'green',
    stamina: 100,
    battery: 100,
    isCrouching: false,
    isSprinting: false,
    flashlightOn: false,
    lives: GAME_CONFIG.player.maxLives,
    stunRemainingSec: 0,
    damageFlashAlpha: 0,
    lastHitWasLockerKiss: false,
    isHidden: false,
    isInsideLocker: false,
    nearbyLockerLabel: null,
    activeHidingSpotLabel: null,
    policeState: 'stalking',
    policeStateLabelTr: 'GÖZETLEME (Uzaktan İzliyor)',
    suspicion: 0,
    policeCooldownSec: 0,
    policeActiveQuote: null,
    policeInVisionCone: false,
    policeSpottedFlashlight: false,
    policeHeardFootsteps: false,
    gameOverReason: 'tour_finished',
    flashEnabled: false,
    flashCooldownSec: 0,
    screenFlashAlpha: 0,
    isAiming: false,
    zoomFov: 70,
    filmRemaining: 24,
    totalScore: 0,
    tasks: [],
    gallery: [],
    livePreview: null,
    lastCapturedPhoto: null,
    lastCaptureBannerTimer: 0,
    taskModalOpen: false,
    pointerLocked: false,
    tutorialRemainingSec: GAME_CONFIG.tutorialDurationSec,
    debugEnabled: false,
    playerCoords: { x: 2.35, y: 1.68, z: 6.4 },
    policeDistanceMeters: 28.0,
    activePathStr: 'wp_hol_south',
    fps: 60,
    currentFloor: 1,
    nearElevator: false,
    elevatorPanelOpen: false,
    elevatorMovingToFloor: null,
    elevatorAnnouncement: null,
    nearBabushka: false,
    babushkaModalOpen: false,
  });

  // Mutable refs for 60Hz loop decoupling
  const gameStateRef = useRef<GameLifecycleState>(gameState);
  const seedRef = useRef<string>(seed);
  const difficultyRef = useRef<DifficultyLevel>(difficulty);
  const sensitivityRef = useRef<number>(mouseSensitivity);
  const debugEnabledRef = useRef<boolean>(false);
  const tutorialTimerRef = useRef<number>(GAME_CONFIG.tutorialDurationSec);
  const gameOverReasonRef = useRef<'tour_finished' | 'caught_by_police'>('tour_finished');

  // Elevator, Top-Floor Babushka & Task Modal mutable refs
  const currentFloorRef = useRef<number>(1);
  const elevatorPanelOpenRef = useRef<boolean>(false);
  const elevatorMovingToRef = useRef<number | null>(null);
  const elevatorTravelTimerRef = useRef<number>(0);
  const elevatorAnnouncementRef = useRef<string | null>(null);
  const elevatorAnnouncementTimerRef = useRef<number>(0);
  const babushkaModalOpenRef = useRef<boolean>(false);
  const taskModalOpenRef = useRef<boolean>(false);

  const actionsRef = useRef<{
    startNewRun: () => void;
    resumeRun: () => void;
    pauseRun: () => void;
    returnTitle: () => void;
    finishTourNow: () => void;
    toggleDebug: () => void;
    toggleMute: () => void;
    requestLock: () => void;
    toggleElevatorPanel: () => void;
    selectElevatorFloor: (floorNum: number) => void;
    toggleBabushkaModal: () => void;
    toggleTaskModal: () => void;
    toggleAiming: () => void;
    capturePhotoNow: () => void;
    triggerPoliceTest: () => void;
    toggleLocker: () => void;
  }>({
    startNewRun: () => {},
    resumeRun: () => {},
    pauseRun: () => {},
    returnTitle: () => {},
    finishTourNow: () => {},
    toggleDebug: () => {},
    toggleMute: () => {},
    requestLock: () => {},
    toggleElevatorPanel: () => {},
    selectElevatorFloor: () => {},
    toggleBabushkaModal: () => {},
    toggleTaskModal: () => {},
    toggleAiming: () => {},
    capturePhotoNow: () => {},
    triggerPoliceTest: () => {},
    toggleLocker: () => {},
  });



  useEffect(() => {
    gameStateRef.current = gameState;
    document.body.dataset.state = gameState;
  }, [gameState]);

  useEffect(() => {
    seedRef.current = seed;
  }, [seed]);

  useEffect(() => {
    difficultyRef.current = difficulty;
  }, [difficulty]);

  useEffect(() => {
    sensitivityRef.current = mouseSensitivity;
  }, [mouseSensitivity]);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    // 1. Software WebGL Detection (Three.js skill mandatory standard)
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer Setup (Low-res PS1 aesthetic with nearest scaling)
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const updateRenderSize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = isSoftwareGl ? 0.42 : GAME_CONFIG.ps1ResolutionScale;
      renderer.setPixelRatio(1);
      renderer.setSize(
        Math.max(320, Math.floor(w * scale)),
        Math.max(200, Math.floor(h * scale)),
        false,
      );
    };
    updateRenderSize();
    mountEl.innerHTML = '';
    mountEl.appendChild(renderer.domElement);

    // 3. Scene, Environment, Fog & Lighting
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(GAME_CONFIG.fogColor);
    scene.fog = new THREE.FogExp2(GAME_CONFIG.fogColor, GAME_CONFIG.fogDensity);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(
      GAME_CONFIG.ambientSkyColor,
      GAME_CONFIG.ambientGroundColor,
      GAME_CONFIG.ambientIntensity,
    );
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(
      GAME_CONFIG.keyLightColor,
      GAME_CONFIG.keyLightIntensity,
    );
    dirLight.position.set(8, 18, 10);
    if (!isSoftwareGl) {
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 65;
      const d = 28;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
    }
    scene.add(dirLight);

    // 4. Camera Setup
    const camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.photoCamera.normalFov,
      window.innerWidth / window.innerHeight,
      0.1,
      85,
    );

    // 5. Build Procedural Soviet Building Level & Subsystems
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const levelData = buildSovietLevel(maxAniso);
    scene.add(levelData.levelGroup);

    const audio = new SoundSynthesizer();
    const player = new PlayerController(scene);
    const tourGroup = new TourGroupManager(
      scene,
      levelData.waypoints,
      levelData.tourStopOrder,
      seedRef.current,
      difficultyRef.current,
    );
    const police = new PoliceOfficerManager(scene, levelData.waypoints, seedRef.current);
    const photoCamera = new PhotoCameraSystem(scene);
    photoCamera.reset(levelData.photoTargets, seedRef.current);
    const debugVis = new DebugVisualizer(scene, levelData.waypoints, levelData.photoTargets);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 6. Input Handling & Elevator / Babushka / Camera Actions
    const keysHeld = new Set<string>();

    const requestPointerLockSafe = () => {
      if (
        gameStateRef.current === 'playing' &&
        !babushkaModalOpenRef.current &&
        !taskModalOpenRef.current
      ) {
        try {
          renderer.domElement.requestPointerLock?.();
        } catch {
          // Ignore pointer lock rejection in headless browser
        }
      }
    };

    const startNewRun = () => {
      const cleanSeed = seedRef.current.trim() || GAME_CONFIG.defaultSeed;
      player.reset();
      tourGroup.reset(cleanSeed, difficultyRef.current, levelData.tourStopOrder);
      police.reset(cleanSeed);
      photoCamera.reset(levelData.photoTargets, cleanSeed);
      tutorialTimerRef.current = GAME_CONFIG.tutorialDurationSec;
      gameOverReasonRef.current = 'tour_finished';
      currentFloorRef.current = 1;
      elevatorPanelOpenRef.current = false;
      elevatorMovingToRef.current = null;
      elevatorTravelTimerRef.current = 0;
      elevatorAnnouncementRef.current = null;
      elevatorAnnouncementTimerRef.current = 0;
      babushkaModalOpenRef.current = false;
      taskModalOpenRef.current = false;
      keysHeld.clear();

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      audio.startAmbientHum();
      gameStateRef.current = 'playing';
      document.body.dataset.state = 'playing';
      setGameState('playing');
    };

    const resumeRun = () => {
      keysHeld.clear();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      gameStateRef.current = 'playing';
      document.body.dataset.state = 'playing';
      setGameState('playing');
    };

    const pauseRun = () => {
      keysHeld.clear();
      photoCamera.setAiming(false);
      document.exitPointerLock?.();
      gameStateRef.current = 'paused';
      document.body.dataset.state = 'paused';
      setGameState('paused');
    };

    const returnTitle = () => {
      keysHeld.clear();
      photoCamera.setAiming(false);
      document.exitPointerLock?.();
      gameStateRef.current = 'title';
      document.body.dataset.state = 'title';
      setGameState('title');
    };

    const toggleDebug = () => {
      debugEnabledRef.current = !debugEnabledRef.current;
      debugVis.setEnabled(debugEnabledRef.current);
    };

    const toggleMute = () => {
      const next = !audio.getMuted();
      audio.setMuted(next);
      setIsMuted(next);
    };

    const toggleElevatorPanel = () => {
      if (!isPositionInsideElevator(player.position.x, player.position.z)) {
        elevatorPanelOpenRef.current = false;
        return;
      }
      elevatorPanelOpenRef.current = !elevatorPanelOpenRef.current;
      audio.playSwitchClick(elevatorPanelOpenRef.current);
    };

    const toggleBabushkaModal = () => {
      if (!babushkaModalOpenRef.current) {
        const room = findRoomAtPosition(levelData.rooms, player.position.x, player.position.z);
        const distToBabushka = Math.hypot(player.position.x - 26.8, player.position.z - 3.2);
        const canInteract =
          room.id === 'babushka_odasi' ||
          distToBabushka <= GAME_CONFIG.elevator.babushkaInteractRadius;
        if (!canInteract) return;
      }
      babushkaModalOpenRef.current = !babushkaModalOpenRef.current;
      if (babushkaModalOpenRef.current) {
        taskModalOpenRef.current = false;
        photoCamera.setAiming(false);
        document.exitPointerLock?.();
        audio.playOldWomanVoice(
          'Yaşlı Kadın (Babuşka Valentina): "İşte benim beşli matruşkalarım ve gençliğimdeki üniformalı fotoğraflarım yavrum..."',
          12,
        );
      }
    };

    const toggleTaskModal = () => {
      taskModalOpenRef.current = !taskModalOpenRef.current;
      audio.playSwitchClick(taskModalOpenRef.current);
      if (taskModalOpenRef.current) {
        babushkaModalOpenRef.current = false;
        photoCamera.setAiming(false);
        document.exitPointerLock?.();
      }
    };

    const toggleAiming = () => {
      photoCamera.toggleAiming(audio);
    };

    const capturePhotoNow = () => {
      if (gameStateRef.current !== 'playing') return;
      const room = findRoomAtPosition(levelData.rooms, player.position.x, player.position.z);
      const obstacles = tourGroup.getObstacleCylinders();
      photoCamera.capturePhoto(
        renderer,
        scene,
        camera,
        levelData.colliders,
        obstacles,
        player.currentSpeed,
        room.name,
        audio,
      );
      // Force immediate HUD sync so the captured sepia photo toast appears right away
      hudSyncAccum = 1.0;
    };

    const triggerPoliceTest = () => {
      if (gameStateRef.current !== 'playing') return;
      // If player is currently inside the tourist group safe bubble, step them into the Long Corridor
      // right next to the Corridor Locker (-1.6, 1.68, -20.0) so both chasing and locker entry can be tested!
      const tourTel = tourGroup.getTelemetry();
      if (
        tourTel.distanceZone === 'green' ||
        tourTel.playerDistanceMeters <= GAME_CONFIG.police.groupSafeBubbleRadius + 2
      ) {
        player.position.set(-1.6, GAME_CONFIG.player.eyeHeightStanding, -20.0);
        player.yaw = 0; // Facing North down the Long Corridor
        player.pitch = -0.05;
        tourGroup.update(0.01, player.position, audio);
      }
      police.triggerDebugChaseNearPlayer(player.position, player.yaw, audio);
      hudSyncAccum = 1.0;
    };

    const selectElevatorFloor = (floorNum: number) => {
      if (elevatorMovingToRef.current !== null) return;
      // Strictly require player to be physically inside the elevator cabin
      if (!isPositionInsideElevator(player.position.x, player.position.z)) return;
      const floorCfg = GAME_CONFIG.elevator.floors.find((f) => f.floorNumber === floorNum);
      if (!floorCfg) return;

      // Move player inside the Soviet Elevator cabin at the end of the corridor while riding
      player.position.set(
        GAME_CONFIG.elevator.cabinPosition.x,
        GAME_CONFIG.player.eyeHeightStanding,
        GAME_CONFIG.elevator.cabinPosition.z,
      );
      player.yaw = Math.PI; // Facing South (+Z) toward the corridor and double sliding elevator doors
      player.pitch = 0;

      elevatorMovingToRef.current = floorNum;
      elevatorTravelTimerRef.current = GAME_CONFIG.elevator.travelDurationSec;
      elevatorAnnouncementRef.current = floorCfg.announcement;
      elevatorAnnouncementTimerRef.current = GAME_CONFIG.elevator.travelDurationSec + 3.5;

      // Trigger metallic door closing creak/friction, elevator brass bell, cable rumble, and the Old Woman's voice!
      audio.playElevatorDoorSlide('closing');
      audio.playElevatorChimeAndRumble(GAME_CONFIG.elevator.travelDurationSec);
      audio.playOldWomanVoice(floorCfg.announcement, 15);
    };

    const finishTourWithReason = (reason: 'tour_finished' | 'caught_by_police') => {
      if (gameStateRef.current === 'gameover') return;
      gameOverReasonRef.current = reason;
      photoCamera.finalizeRemainingTasksOnTourEnd();
      taskModalOpenRef.current = false;
      babushkaModalOpenRef.current = false;
      elevatorPanelOpenRef.current = false;
      document.exitPointerLock?.();

      const completedTasks = photoCamera.tasks.filter((t) => t.status === 'completed').length;
      const totalTasks = Math.max(1, photoCamera.tasks.length || GAME_CONFIG.photoCamera.tasksPerTour);
      const totalScore = photoCamera.totalScore;
      const rank = evaluateJournalistRank(totalScore);
      const scoreCode = generateScoreCode({
        seed: seedRef.current,
        difficulty: difficultyRef.current,
        totalScore,
        completedTasks,
        totalTasks,
        photosCount: photoCamera.gallery.length,
      });

      const now = new Date();
      const dateLabelTr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const entry: LeaderboardEntry = {
        id: `run_${now.getTime()}_${seedRef.current}`,
        seed: seedRef.current,
        difficulty: difficultyRef.current,
        totalScore,
        rank,
        completedTasks,
        totalTasks,
        photosCount: photoCamera.gallery.length,
        livesRemaining: player.lives,
        outcome: reason,
        scoreCode,
        createdAtIso: now.toISOString(),
        dateLabelTr,
      };
      const updatedBoard = saveLeaderboardEntryToStorage(entry);
      setLeaderboard(updatedBoard);

      setHud((prev) => ({
        ...prev,
        gameOverReason: reason,
        lives: player.lives,
        totalScore: photoCamera.totalScore,
        tasks: [...photoCamera.tasks],
        gallery: [...photoCamera.gallery],
        taskModalOpen: false,
        babushkaModalOpen: false,
      }));

      gameStateRef.current = 'gameover';
      document.body.dataset.state = 'gameover';
      setGameState('gameover');
      hudSyncAccum = 1.0;
    };

    const toggleLocker = () => {
      if (gameStateRef.current !== 'playing') return;
      const wasInside = player.isInsideLocker;
      const sawEnter =
        !wasInside &&
        police.didWitnessPlayerEnterLocker(
          player.position,
          player.flashlightOn,
          levelData.colliders,
        );
      if (player.toggleLockerInteraction(levelData.hidingSpots, audio)) {
        if (!wasInside && player.isInsideLocker && player.activeLockerSpot) {
          police.onPlayerEnteredLocker(sawEnter, player.activeLockerSpot, audio);
        } else if (wasInside && !player.isInsideLocker) {
          police.onPlayerExitedLocker();
        }
        hudSyncAccum = 1.0;
      }
    };

    actionsRef.current = {
      startNewRun,
      resumeRun,
      pauseRun,
      returnTitle,
      finishTourNow: () => finishTourWithReason('tour_finished'),
      toggleDebug,
      toggleMute,
      requestLock: requestPointerLockSafe,
      toggleElevatorPanel,
      selectElevatorFloor,
      toggleBabushkaModal,
      toggleTaskModal,
      toggleAiming,
      capturePhotoNow,
      triggerPoliceTest,
      toggleLocker,
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        document.activeElement.tagName === 'INPUT' &&
        (document.activeElement as HTMLInputElement).type === 'text'
      ) {
        if (e.code === 'Enter') {
          e.preventDefault();
          startNewRun();
        }
        return;
      }

      if (e.code === 'F1') {
        e.preventDefault();
        toggleDebug();
        return;
      }

      if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
        return;
      }

      if (gameStateRef.current === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          startNewRun();
        }
        return;
      }

      if (e.code === 'Tab') {
        e.preventDefault();
        if (gameStateRef.current === 'playing') {
          toggleTaskModal();
          hudSyncAccum = 1.0;
        }
        return;
      }

      if (e.code === 'KeyB') {
        if (gameStateRef.current === 'playing' || gameStateRef.current === 'paused') {
          e.preventDefault();
          finishTourWithReason('tour_finished');
          return;
        }
      }

      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (taskModalOpenRef.current) {
          taskModalOpenRef.current = false;
          hudSyncAccum = 1.0;
          return;
        }
        if (babushkaModalOpenRef.current) {
          babushkaModalOpenRef.current = false;
          hudSyncAccum = 1.0;
          return;
        }
        if (gameStateRef.current === 'playing') {
          pauseRun();
        } else if (gameStateRef.current === 'paused') {
          resumeRun();
        }
        return;
      }

      if (gameStateRef.current !== 'playing') return;

      if (!keysHeld.has(e.code)) {
        if (e.code === 'KeyF') {
          player.toggleFlashlight(audio);
        } else if (e.code === 'KeyC') {
          player.toggleCrouch();
        } else if (e.code === 'KeyR') {
          photoCamera.toggleFlash(audio);
          hudSyncAccum = 1.0;
        } else if (e.code === 'KeyV') {
          toggleAiming();
          hudSyncAccum = 1.0;
        } else if (e.code === 'KeyQ') {
          capturePhotoNow();
        } else if (e.code === 'KeyK') {
          triggerPoliceTest();
        } else if (e.code === 'KeyZ') {
          photoCamera.adjustZoom(-1);
        } else if (e.code === 'KeyX') {
          photoCamera.adjustZoom(1);
        } else if (e.code === 'KeyE') {
          if (isPositionInsideElevator(player.position.x, player.position.z)) {
            toggleElevatorPanel();
            hudSyncAccum = 1.0;
          } else {
            toggleLocker();
          }
        } else if (e.code === 'KeyG') {
          toggleBabushkaModal();
          hudSyncAccum = 1.0;
        } else if (e.code === 'Digit1') {
          selectElevatorFloor(0);
        } else if (e.code === 'Digit2') {
          selectElevatorFloor(1);
        } else if (e.code === 'Digit3') {
          selectElevatorFloor(2);
        } else if (e.code === 'Digit4') {
          selectElevatorFloor(3);
        }
      }
      keysHeld.add(e.code);
    };


    const onKeyUp = (e: KeyboardEvent) => {
      keysHeld.delete(e.code);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (
        gameStateRef.current !== 'playing' ||
        babushkaModalOpenRef.current ||
        taskModalOpenRef.current
      ) {
        return;
      }
      if (document.pointerLockElement === renderer.domElement || e.buttons === 1) {
        player.applyMouseDelta(e.movementX, e.movementY, sensitivityRef.current);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      if (
        gameStateRef.current !== 'playing' ||
        babushkaModalOpenRef.current ||
        taskModalOpenRef.current
      ) {
        return;
      }
      if (e.button === 2) {
        photoCamera.setAiming(true);
        hudSyncAccum = 1.0;
      } else if (e.button === 0) {
        audio.startAmbientHum();
        if (photoCamera.isAiming) {
          capturePhotoNow();
        } else if (document.pointerLockElement !== renderer.domElement) {
          requestPointerLockSafe();
        } else {
          // When pointer-locked, left click also captures a photo immediately
          capturePhotoNow();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        photoCamera.setAiming(false);
        hudSyncAccum = 1.0;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (gameStateRef.current === 'playing') {
        photoCamera.adjustZoom(e.deltaY);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const onBlur = () => {
      keysHeld.clear();
    };

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      updateRenderSize();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onResize);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('contextmenu', onContextMenu);

    // 7. Main Simulation & Render Loop (with Software-WebGL afterDraw Pacing)
    let frameId = 0;
    let lastTime = performance.now();
    let hudSyncAccum = 0;
    let elapsedTotal = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function updateFlickeringLamps(t: number) {
      for (let i = 0; i < levelData.flickeringLamps.length; i++) {
        const lamp = levelData.flickeringLamps[i];
        const wave =
          Math.sin(t * lamp.flickerSpeed + lamp.phase) *
          Math.cos(t * (lamp.flickerSpeed * 1.7) + lamp.phase);
        let factor = 0.88 + 0.12 * wave;
        if (lamp.isBrokenSpark && wave < -0.55) {
          factor = 0.18;
        }
        lamp.light.intensity = lamp.baseIntensity * factor;
        lamp.bulbMat.emissiveIntensity = factor;
      }
    }

    function tick() {
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, GAME_CONFIG.maxDeltaTime);
      const wallDt = Math.min(rawDt, 0.35);
      elapsedTotal += dt;

      updateFlickeringLamps(elapsedTotal);

      // Gentle welcoming animation for Babushka Valentina on the top floor
      levelData.babushkaNpcGroup.rotation.y =
        -Math.PI / 2 + Math.sin(elapsedTotal * 1.4) * 0.14;

      if (gameStateRef.current === 'title') {
        const orbitAngle = elapsedTotal * 0.24;
        camera.position.set(
          Math.sin(orbitAngle) * 5.2,
          2.6 + Math.sin(elapsedTotal * 0.5) * 0.25,
          3.8 + Math.cos(orbitAngle) * 2.2,
        );
        camera.lookAt(0, 1.85, -0.5);
        camera.fov = GAME_CONFIG.photoCamera.normalFov;
      } else if (gameStateRef.current === 'playing') {
        tutorialTimerRef.current = Math.max(0, tutorialTimerRef.current - wallDt);

        if (elevatorAnnouncementTimerRef.current > 0) {
          elevatorAnnouncementTimerRef.current = Math.max(
            0,
            elevatorAnnouncementTimerRef.current - wallDt,
          );
          if (elevatorAnnouncementTimerRef.current <= 0) {
            elevatorAnnouncementRef.current = null;
          }
        }

        const obstacles = tourGroup.getObstacleCylinders();

        // Handle Soviet Elevator Travel & Animated Double Sliding Doors (along X-axis)
        const prevDoorLeftX = levelData.elevatorDoorLeft.position.x;
        if (elevatorMovingToRef.current !== null) {
          elevatorTravelTimerRef.current = Math.max(0, elevatorTravelTimerRef.current - wallDt);
          // Slide double elevator doors closed toward X = 0 while moving
          levelData.elevatorDoorLeft.position.x = THREE.MathUtils.damp(
            levelData.elevatorDoorLeft.position.x,
            -0.59,
            8,
            wallDt,
          );
          levelData.elevatorDoorRight.position.x = THREE.MathUtils.damp(
            levelData.elevatorDoorRight.position.x,
            0.59,
            8,
            wallDt,
          );
          const doorClosingDelta = Math.abs(levelData.elevatorDoorLeft.position.x - prevDoorLeftX);
          if (doorClosingDelta > 0.0012) {
            audio.updateElevatorDoorMovement(doorClosingDelta / Math.max(0.001, wallDt), true);
          }

          // Subtle elevator mechanical vibration on camera
          player.update(
            dt,
            new Set(),
            levelData.colliders,
            [],
            camera,
            audio,
            levelData.hidingSpots,
          );
          camera.position.y += Math.sin(elapsedTotal * 28) * 0.025;

          if (elevatorTravelTimerRef.current <= 0) {
            const targetFloorNum = elevatorMovingToRef.current;
            elevatorMovingToRef.current = null;
            currentFloorRef.current = targetFloorNum;

            // Play metallic creak & rail friction as the doors slide back open at the destination floor
            audio.playElevatorDoorSlide('opening');

            const floorCfg = GAME_CONFIG.elevator.floors.find(
              (f) => f.floorNumber === targetFloorNum,
            );
            if (floorCfg) {
              player.position.set(
                floorCfg.spawnPos.x,
                GAME_CONFIG.player.eyeHeightStanding,
                floorCfg.spawnPos.z,
              );
              player.yaw = floorCfg.spawnYaw;
              player.pitch = 0;
              player.update(
                dt,
                new Set(),
                levelData.colliders,
                [],
                camera,
                audio,
                levelData.hidingSpots,
              );
              tourGroup.moveGroupToFloorStop(targetFloorNum);
            }
          }
        } else {
          // Slide double elevator doors open along X-axis when stationary
          levelData.elevatorDoorLeft.position.x = THREE.MathUtils.damp(
            levelData.elevatorDoorLeft.position.x,
            -1.14,
            6,
            dt,
          );
          levelData.elevatorDoorRight.position.x = THREE.MathUtils.damp(
            levelData.elevatorDoorRight.position.x,
            1.14,
            6,
            dt,
          );
          const doorOpeningDelta = Math.abs(levelData.elevatorDoorLeft.position.x - prevDoorLeftX);
          if (doorOpeningDelta > 0.0012) {
            audio.updateElevatorDoorMovement(doorOpeningDelta / Math.max(0.001, dt), false);
          }

          player.update(
            dt,
            keysHeld,
            levelData.colliders,
            obstacles,
            camera,
            audio,
            levelData.hidingSpots,
          );
        }

        photoCamera.update(
          dt,
          camera,
          levelData.colliders,
          obstacles,
          player.currentSpeed,
        );

        const { tourFinished } = tourGroup.update(dt, player.position, audio);
        const tourTel = tourGroup.getTelemetry();

        let caughtGameOver = false;
        police.update(
          dt,
          player.position,
          player.flashlightOn,
          player.getNoiseRadius(),
          player.isHidden,
          tourTel.distanceZone,
          tourTel.playerDistanceMeters,
          tourTel.guidePosition,
          levelData.colliders,
          difficultyRef.current,
          audio,
          (isLockerKiss) => {
            const hitRes = player.applyPoliceBatonHit(audio, isLockerKiss);
            hudSyncAccum = 1.0;
            if (hitRes.gameOver) {
              caughtGameOver = true;
            }
          },
        );

        debugVis.update(
          police.position,
          police.yaw,
          player.position,
          tourTel.guidePosition,
          tourTel.activePathToPlayer,
        );

        if (caughtGameOver) {
          finishTourWithReason('caught_by_police');
        } else if (tourFinished) {
          finishTourWithReason('tour_finished');
        }

        // Sync HUD at ~10Hz
        hudSyncAccum += dt;
        if (hudSyncAccum >= 0.1) {
          const currentFps = Math.min(60, Math.max(1, Math.round(1 / Math.max(0.001, rawDt))));
          hudSyncAccum = 0;
          const room = findRoomAtPosition(levelData.rooms, player.position.x, player.position.z);

          // Update floor index automatically if player walked into a floor zone
          if (room.id === 'kazan_dairesi') currentFloorRef.current = 0;
          else if (room.id === 'cati_kati') currentFloorRef.current = 2;
          else if (room.id === 'babushka_odasi') currentFloorRef.current = 3;
          else if (elevatorMovingToRef.current === null) currentFloorRef.current = 1;

          const nearElevator =
            elevatorMovingToRef.current !== null ||
            isPositionInsideElevator(player.position.x, player.position.z);
          if (!nearElevator && elevatorPanelOpenRef.current) {
            elevatorPanelOpenRef.current = false;
          }

          const distToBabushka = Math.hypot(
            player.position.x - 26.8,
            player.position.z - 3.2,
          );
          const nearBabushka =
            room.id === 'babushka_odasi' ||
            distToBabushka <= GAME_CONFIG.elevator.babushkaInteractRadius;

          const policeTel = police.getTelemetry(player.position);

          setHud({
            roomName: room.name,
            roomIsDark: room.isDark,
            roomHint: room.ambientHint,
            tourRemainingSec: tourTel.tourRemainingSec,
            currentStopIndex: tourTel.currentStopIndex,
            totalStops: tourTel.totalStops,
            currentStopTitle: tourTel.currentStopTitle,
            groupState: tourTel.groupState,
            stopCountdownSec: tourTel.stopCountdownSec,
            currentSubtitle: tourTel.currentSubtitle,
            playerDistanceMeters: tourTel.playerDistanceMeters,
            distanceZone: tourTel.distanceZone,
            stamina: player.stamina,
            battery: player.battery,
            isCrouching: player.isCrouching,
            isSprinting: player.isSprinting,
            flashlightOn: player.flashlightOn,
            lives: player.lives,
            stunRemainingSec: player.stunRemainingSec,
            damageFlashAlpha: player.damageFlashAlpha,
            lastHitWasLockerKiss: player.lastHitWasLockerKiss,
            isHidden: player.isHidden,
            isInsideLocker: player.isInsideLocker,
            nearbyLockerLabel: player.nearbyLockerSpot ? player.nearbyLockerSpot.label : null,
            activeHidingSpotLabel: player.activeHidingSpotLabel,
            policeState: policeTel.state,
            policeStateLabelTr: policeTel.stateLabelTr,
            suspicion: policeTel.suspicion,
            policeCooldownSec: policeTel.cooldownRemainingSec,
            policeActiveQuote: policeTel.activeQuote,
            policeInVisionCone: policeTel.inVisionCone,
            policeSpottedFlashlight: policeTel.spottedByFlashlight,
            policeHeardFootsteps: policeTel.heardFootsteps,
            gameOverReason: gameOverReasonRef.current,
            flashEnabled: photoCamera.flashEnabled,
            flashCooldownSec: photoCamera.flashCooldownSec,
            screenFlashAlpha: photoCamera.screenFlashAlpha,
            isAiming: photoCamera.isAiming,
            zoomFov: photoCamera.currentFov,
            filmRemaining: photoCamera.filmRemaining,
            totalScore: photoCamera.totalScore,
            tasks: [...photoCamera.tasks],
            gallery: [...photoCamera.gallery],
            livePreview: photoCamera.livePreview,
            lastCapturedPhoto: photoCamera.lastCapturedPhoto,
            lastCaptureBannerTimer: photoCamera.lastCaptureBannerTimer,
            taskModalOpen: taskModalOpenRef.current,
            pointerLocked: document.pointerLockElement === renderer.domElement,
            tutorialRemainingSec: tutorialTimerRef.current,
            debugEnabled: debugEnabledRef.current,
            playerCoords: {
              x: player.position.x,
              y: player.position.y,
              z: player.position.z,
            },
            policeDistanceMeters: policeTel.distanceToPlayerMeters,
            activePathStr: tourTel.activePathToPlayer.slice(0, 4).join(' → '),
            fps: currentFps,
            currentFloor: currentFloorRef.current,
            nearElevator,
            elevatorPanelOpen: elevatorPanelOpenRef.current,
            elevatorMovingToFloor: elevatorMovingToRef.current,
            elevatorAnnouncement: elevatorAnnouncementRef.current,
            nearBabushka,
            babushkaModalOpen: babushkaModalOpenRef.current,
          });
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
      renderer.dispose();
    };
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#0d100e]">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        data-testid="webgl-canvas-container"
        className="ps1-canvas-container fixed inset-0 z-0"
      />

      {/* World-Matched Turkish HUD & Game Shell */}
      <GameUI
        gameState={gameState}
        seed={seed}
        onSeedChange={setSeed}
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        mouseSensitivity={mouseSensitivity}
        onSensitivityChange={setMouseSensitivity}
        isMuted={isMuted}
        onToggleMute={() => actionsRef.current.toggleMute()}
        onStartGame={() => actionsRef.current.startNewRun()}
        onResumeGame={() => actionsRef.current.resumeRun()}
        onRestartGame={() => actionsRef.current.startNewRun()}
        onReturnToTitle={() => actionsRef.current.returnTitle()}
        onFinishTourNow={() => actionsRef.current.finishTourNow()}
        onToggleDebug={() => actionsRef.current.toggleDebug()}
        onRequestPointerLock={() => actionsRef.current.requestLock()}
        onToggleElevatorPanel={() => actionsRef.current.toggleElevatorPanel()}
        onSelectElevatorFloor={(fl) => actionsRef.current.selectElevatorFloor(fl)}
        onToggleBabushkaModal={() => actionsRef.current.toggleBabushkaModal()}
        onToggleTaskModal={() => actionsRef.current.toggleTaskModal()}
        onToggleAiming={() => actionsRef.current.toggleAiming()}
        onCapturePhoto={() => actionsRef.current.capturePhotoNow()}
        onTriggerPoliceTest={() => actionsRef.current.triggerPoliceTest()}
        onToggleLocker={() => actionsRef.current.toggleLocker()}
        leaderboard={leaderboard}
        onClearLeaderboard={() => {
          clearLeaderboardStorage();
          setLeaderboard([]);
        }}
        hud={hud}
      />
    </main>
  );
}


