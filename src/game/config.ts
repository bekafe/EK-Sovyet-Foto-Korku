/**
 * Centralized numerical configuration for "Son Tur" (The Last Tour).
 * All speeds, distances, timers, scores, capacities, and rendering parameters live here.
 */

export type DifficultyLevel = 'easy' | 'normal' | 'hard';

export interface DifficultyMultipliers {
  label: string;
  suspicionRateMultiplier: number;
  tourDurationSec: number;
  stopWaitSec: number;
  SafeDistanceMeters: number;
  WarningDistanceMeters: number;
}

export const GAME_CONFIG = {
  // Default seed and rendering settings (PS1 / Low-Poly aesthetic)
  defaultSeed: 'SOVYET-1984',
  ps1ResolutionScale: 0.45, // Low-resolution internal render scale for authentic PS1 look
  maxDeltaTime: 0.05, // Clamp dt to 50ms max

  // Atmosphere & Fog
  fogColor: 0x161b18,
  fogDensity: 0.042,
  ambientSkyColor: 0x38463e,
  ambientGroundColor: 0x181512,
  ambientIntensity: 0.65,
  keyLightColor: 0xd9c29c,
  keyLightIntensity: 0.85,

  // Player Movement & Mechanics
  player: {
    walkSpeed: 4.4, // m/s
    sprintSpeed: 7.4, // m/s
    crouchSpeed: 2.3, // m/s
    eyeHeightStanding: 1.68, // meters (Noticeably taller than the short blonde police officer)
    eyeHeightCrouching: 0.98, // meters
    crouchLerpSpeed: 10.0,
    collisionRadius: 0.42, // meters
    mouseSensitivityDefault: 0.0022,
    keyboardTurnSpeed: 1.9, // rad/s for keyboard arrow support
    headBobFrequency: 2.1,
    headBobAmplitude: 0.045,

    // Stamina
    maxStamina: 100,
    staminaDrainPerSec: 24,
    staminaRegenPerSec: 16,
    staminaRegenDelaySec: 1.2,
    minStaminaToSprint: 15,

    // Flashlight (El Feneri)
    maxBattery: 100,
    batteryDrainPerSec: 2.2,
    batteryRechargePerSec: 0.8, // Slow passive dynamo trickle when off
    flashlightIntensity: 6.5,
    flashlightDistance: 24,
    flashlightAngle: Math.PI / 4.8,
    flashlightPenumbra: 0.45,
    flashlightColor: 0xffe8b8,

    // Noise radius for Police detection
    walkNoiseRadius: 6.0,
    sprintNoiseRadius: 15.0,
    crouchNoiseRadius: 2.2,

    // Lives & Stun
    maxLives: 3,
    stunDurationSec: 4.0,
  },

  // Tour Group (5 NPCs: 1 Guide + 4 Tourists)
  tourGroup: {
    npcCount: 5,
    moveSpeed: 2.65, // m/s between stops
    npcSpacing: 1.35, // meters between tourists in formation
    npcCollisionRadius: 0.48, // NPCs act as physical & line-of-sight obstacles
    totalTourDurationSec: 540, // 9 minutes (between 8-10 minutes as specified)
    defaultStopWaitSec: 28, // Wait time at each stop for guide commentary
    guideMumbleIntervalMs: 190, // Synthesized voice syllable interval

    // Distance Indicator Thresholds (Path distance in meters)
    distanceGreenMax: 11.0, // <= 11m: Green (Güvende / Gruba Yakın)
    distanceYellowMax: 21.0, // 11m - 21m: Yellow (Uyarı / Gruptan Açılıyorsun)
    // > 21m: Red (Tehlike / Polis Şüphesi Artıyor!)
  },

  // Police Officer (Short Blonde Officer with Baton)
  police: {
    heightMeters: 1.28, // Distinctly shorter than the player (1.68m)
    stalkSpeed: 2.8,
    suspicionApproachSpeed: 3.9,
    chaseSpeed: 6.2,
    cooldownDurationSec: 15.0,
    minStalkDistance: 20.0,
    maxStalkDistance: 30.0,
    visionConeAngleRad: Math.PI * 0.42, // ~75 degrees
    visionDistanceNormal: 18.0,
    visionDistanceFlashlight: 29.0, // Notices flashlight from much farther away
    attackRangeMeters: 1.65,
    groupSafeBubbleRadius: 8.5, // Never attacks when player is near the tourist group

    // Suspicion Meter (0 - 100)
    maxSuspicion: 100,
    suspicionThresholdToApproach: 20, // Enters 'suspicion' state above 20%
    suspicionFillRatePerSec: 12.5, // Base fill rate when in Red distance from group
    suspicionYellowFillRatePerSec: 3.8, // Slow creep when in Yellow distance if spotted/noisy
    suspicionVisionConeBonusRate: 14.0, // Extra fill when inside police vision cone
    suspicionFlashlightBonusRate: 9.0, // Extra fill when flashlight is on in police sight/range
    suspicionSprintNoiseBonusRate: 8.5, // Extra fill when sprinting within sprintNoiseRadius
    suspicionDecayRatePerSec: 11.0, // Decay rate when back in Green distance with group or hidden

    // Funny-Threatening Turkish Lines (Komik-Tehditkâr Türkçe Replikler)
    suspicionQuotes: [
      'Polis Memuru İgor: "Şşt! Oradaki uzun boylu turist, gruptan niye ayrıldın bakayım?!"',
      'Polis Memuru İgor: "Karanlıkta fener mi yakıyorsun? Yanına geliyorum tatlım!"',
      'Polis Memuru İgor: "Ayak seslerini duydum... Sarı perçemlerim diken diken oldu!"',
    ],
    chaseQuotes: [
      'Polis Memuru İgor: "Seni öpmek istiyorum! Kaçma benden küçük foto muhabiri!"',
      'Polis Memuru İgor: "Gel buraya, sana Sovyet misafirperverliği ve kauçuk copumu göstereceğim!"',
      'Polis Memuru İgor: "Fotoğraf makineni ver, seni şefkatle kucaklayıp nezarethaneye götüreceğim!"',
      'Polis Memuru İgor: "Turist grubundan ayrılan kuzuyu kurt değil, sarışın polis memuru öper!"',
      'Polis Memuru İgor: "Dur bakalım! O deklanşör sesi kalbimi kırdı, gel barış öpücüğü verelim!"',
    ],
    cooldownQuotes: [
      'Polis Memuru İgor: "Bu ufak bir öpücüktü! 15 saniye sarı saçlarımı taramaya gidiyorum, uslu dur!"',
      'Polis Memuru İgor: "Copumun tadına baktın! Şimdi 15 saniye çay molası veriyorum, bir daha yakalanma!"',
    ],
    groupSafeAbortQuotes: [
      'Polis Memuru İgor: "Hıh, turist grubunun arasına saklandın demek... Rehber Olga varken sana dokunamam!"',
      'Polis Memuru İgor: "Şimdilik kalabalıkta kurtuldun uzun bacaklı, ama köşeden seni izliyorum!"',
    ],
    lockerSeenQuotes: [
      'Polis Memuru İgor: "Seni gidi yaramaz! O daracık dolaba girdiğini gördüm, yanına gelip seni dolapta öpeceğim!"',
      'Polis Memuru İgor: "Haha! Dolaba saklandığını gözlerimle gördüm, bekle beni, iki kişilik yer var orada!"',
    ],
    lockerKissQuotes: [
      'Polis Memuru İgor: "MUAH! Daracık dolapta baş başa kaldık, sonunda seni öptüm küçük muhabir! 15 saniye utanıp kaçıyorum!"',
      'Polis Memuru İgor: "MUAH! Dolap içi sıcak Sovyet öpücüğü! Kalbim pır pır etti, 15 saniye mola veriyorum!"',
    ],
    lockerEscapedRadarQuotes: [
      'Polis Memuru İgor: "Allah Allah, nereye buharlaştı bu turist?! Az önce buradaydı, radarımdan tamamen çıktı!"',
      'Polis Memuru İgor: "Hay aksi, izini tamamen kaybettim! Herhalde halüsinasyon gördüm..."',
    ],
  },


  // Photo Camera & Tasks (Prepared for Stage 3, used by Debug Mode in Stage 1)
  photoCamera: {
    maxFilmCount: 24,
    normalFov: 70,
    zoomFovMin: 28,
    zoomFovMax: 52,
    zoomSpeed: 8.0,
    flashRechargeSec: 3.5,
    flashRangeMeters: 14.0,
    minPassingScore: 60,
    tasksPerTour: 9,
    maxConcurrentTasks: 3,
    taskWindowMinSec: 65,
    taskWindowMaxSec: 115,
  },

  // Tutorial duration
  tutorialDurationSec: 30.0,

  // Elevator System & Top-Floor Old Woman (Babushka) Room
  elevator: {
    cabinPosition: { x: 0.0, y: 0, z: -31.15 },
    cabinBounds: {
      minX: -1.35,
      maxX: 1.35,
      minZ: -31.95,
      maxZ: -29.2,
    },
    approachHintRadius: 4.5,
    interactionRadius: 4.2,
    travelDurationSec: 1.8,
    babushkaPosition: { x: 26.8, y: 0, z: 3.2 },
    babushkaInteractRadius: 5.5,
    floors: [
      {
        floorNumber: 0,
        code: 'B1',
        name: 'Bodrum Katı — Karanlık Kazan Dairesi',
        targetRoomId: 'kazan_dairesi',
        spawnPos: { x: 12.0, y: 0, z: -25.0 },
        spawnYaw: 0,
        announcement:
          'Yaşlı Kadın (Asansör Hoparlörü): "Bodrum Katı... Karanlık Kazan Dairesi. Buhar borularına ve polise dikkat et yavrum."',
      },
      {
        floorNumber: 1,
        code: 'K1',
        name: '1. Kat — Ana Koridor, Fuaye ve Tiyatro',
        targetRoomId: 'uzun_koridor',
        spawnPos: { x: 0.0, y: 0, z: -25.6 },
        spawnYaw: 0,
        announcement:
          'Yaşlı Kadın (Asansör Hoparlörü): "Birinci Kat... Ana Koridor Sonu, Kültür Fuayesi ve Kızıl Yıldız Tiyatrosu."',
      },
      {
        floorNumber: 2,
        code: 'K2',
        name: '2. Kat — Gizli Telsiz ve Arşiv Katı',
        targetRoomId: 'cati_kati',
        spawnPos: { x: 23.5, y: 0, z: -14.0 },
        spawnYaw: -Math.PI / 2,
        announcement:
          'Yaşlı Kadın (Asansör Hoparlörü): "İkinci Kat... Eski Dinleme ve Gizli Arşiv Odası. Sessiz adımlarla ilerle."',
      },
      {
        floorNumber: 3,
        code: 'K3',
        name: '3. Kat (Son Kat) — Yaşlı Kadının Çatı Odası',
        targetRoomId: 'babushka_odasi',
        spawnPos: { x: 23.6, y: 0, z: 2.9 },
        spawnYaw: -Math.PI / 2,
        announcement:
          'Yaşlı Kadın (Asansör Hoparlörü): "Üçüncü ve Son Kat... Çatı Kulesi. Sağdaki kapı benim odam, gel sana matruşkalarımı ve eski üniformalı fotoğraflarımı göstereyim..."',
      },
    ],
  },

  // Difficulty presets
  difficulties: {
    easy: {
      label: 'Kolay (Turist)',
      suspicionRateMultiplier: 0.75,
      tourDurationSec: 570,
      stopWaitSec: 32,
      SafeDistanceMeters: 13.0,
      WarningDistanceMeters: 24.0,
    },
    normal: {
      label: 'Normal (Muhabir)',
      suspicionRateMultiplier: 1.0,
      tourDurationSec: 540,
      stopWaitSec: 26,
      SafeDistanceMeters: 11.0,
      WarningDistanceMeters: 21.0,
    },
    hard: {
      label: 'Zor (Casus)',
      suspicionRateMultiplier: 1.35,
      tourDurationSec: 480,
      stopWaitSec: 21,
      SafeDistanceMeters: 9.0,
      WarningDistanceMeters: 17.5,
    },
  } as Record<DifficultyLevel, DifficultyMultipliers>,

  // Scoring, Journalist Ranks & Local Leaderboard (Stage 5)
  scoring: {
    leaderboardStorageKey: 'son_tur_leaderboard_v1',
    maxLeaderboardEntries: 15,
    muhabirMinScore: 300,
    ustaMinScore: 600,
  },
} as const;


/**
 * Pure helper: returns true only when the player is physically inside the walk-in elevator cabin
 * at the North end of the Long Corridor.
 */
export function isPositionInsideElevator(x: number, z: number): boolean {
  const b = GAME_CONFIG.elevator.cabinBounds;
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

