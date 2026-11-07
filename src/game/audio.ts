/**
 * WebAudio Procedural Sound Synthesizer ("Son Tur").
 * Zero external audio assets: synthesizes footsteps (normal/crouch/sprint),
 * guide gibberish mumble at stops, flashlight click, shutter click, ambient drone, and heartbeat.
 */

export class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private masterVolume = 0.7;
  private ambientOsc: OscillatorNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private ambientGain: GainNode | null = null;
  private lastDoorFrictionAt = 0;
  private lastRoomAccentAt = 0;
  private lastLampBuzzAt = 0;

  private ensureContext(): AudioContext | null {
    if (this.isMuted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    if (this.ambientGain && this.ctx) {
      this.ambientGain.gain.setTargetAtTime(
        muted ? 0 : 0.045 * this.masterVolume,
        this.ctx.currentTime,
        0.08,
      );
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.ambientGain && this.ctx && !this.isMuted) {
      this.ambientGain.gain.setTargetAtTime(0.045 * this.masterVolume, this.ctx.currentTime, 0.08);
    }
  }

  public getVolume(): number {
    return this.masterVolume;
  }

  /**
   * Starts subtle Soviet building transformer hum & ventilation drone
   */
  public startAmbientHum(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.ambientOsc) return;
    try {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.value = 52; // 50Hz Soviet electrical hum
      filter.type = 'lowpass';
      filter.frequency.value = 130;

      gain.gain.value = this.isMuted ? 0 : 0.04 * this.masterVolume;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();

      this.ambientOsc = osc;
      this.ambientFilter = filter;
      this.ambientGain = gain;
    } catch {
      // Ignore audio autoplay restriction until user gesture
    }
  }

  /**
   * Stage 6 Atmosphere Polish: Adapts the room ambient drone & triggers subtle room-specific
   * environmental acoustic textures (boiler steam hiss, attic radio Morse chirp, Babushka's mantel clock).
   */
  public updateRoomAmbience(roomId: string, suspicionNorm: number): void {
    if (this.isMuted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.ambientOsc && this.ambientFilter && this.ambientGain) {
      const targetFreq =
        roomId === 'kazan_dairesi'
          ? 38
          : roomId === 'cati_kati'
            ? 62
            : roomId === 'babushka_odasi'
              ? 48
              : 52;
      const targetCutoff =
        (roomId === 'kazan_dairesi' ? 165 : 125) + suspicionNorm * 110;
      const targetVol = (0.038 + suspicionNorm * 0.025) * this.masterVolume;

      this.ambientOsc.frequency.setTargetAtTime(targetFreq, now, 0.25);
      this.ambientFilter.frequency.setTargetAtTime(targetCutoff, now, 0.25);
      this.ambientGain.gain.setTargetAtTime(targetVol, now, 0.25);
    }

    // Periodic room-specific acoustic details
    if (roomId === 'kazan_dairesi' && now - this.lastRoomAccentAt > 4.6) {
      this.lastRoomAccentAt = now;
      this.playBoilerSteamHiss();
    } else if (roomId === 'cati_kati' && now - this.lastRoomAccentAt > 4.2) {
      this.lastRoomAccentAt = now;
      this.playRadioMorseChirp();
    } else if (roomId === 'babushka_odasi' && now - this.lastRoomAccentAt > 1.25) {
      this.lastRoomAccentAt = now;
      this.playGrandmotherClockTick();
    }
  }

  private playBoilerSteamHiss(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dur = 0.42;
    const frameCount = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frameCount, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + dur);
    filter.Q.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045 * this.masterVolume, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
    src.stop(now + dur + 0.01);
  }

  private playRadioMorseChirp(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pattern = [0, 0.11, 0.24];
    for (let i = 0; i < pattern.length; i++) {
      const t = now + pattern[i];
      const dur = i === 1 ? 0.08 : 0.045;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.032 * this.masterVolume, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.005);
    }
  }

  private playGrandmotherClockTick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.025);
    gain.gain.setValueAtTime(0.028 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
  }


  /**
   * Plays a synthesized footstep thud with pitch variation and crouch dampening
   */
  public playFootstep(mode: 'walk' | 'sprint' | 'crouch'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const pitchVar = 0.92 + Math.random() * 0.16;
    const baseFreq = mode === 'crouch' ? 75 : mode === 'sprint' ? 115 : 92;
    const vol = (mode === 'crouch' ? 0.05 : mode === 'sprint' ? 0.19 : 0.12) * this.masterVolume;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * pitchVar, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.09);

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.1);
  }

  /**
   * Plays mechanical toggle click for flashlight (F) or flash (R)
   */
  public playSwitchClick(highPitch = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(highPitch ? 1200 : 820, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

    gain.gain.setValueAtTime(0.12 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  }

  /**
   * Plays a short syllable of gibberish Russian-accented tour guide mumble
   */
  public playGuideMumbleSyllable(seedOffset = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const basePitch = 195 + ((seedOffset * 37) % 85);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(basePitch, now);
    osc.frequency.linearRampToValueAtTime(basePitch * (0.85 + Math.random() * 0.3), now + 0.08);

    filter.type = 'bandpass';
    filter.frequency.value = 650 + ((seedOffset * 113) % 500);
    filter.Q.value = 3.2;

    gain.gain.setValueAtTime(0.06 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.095);
  }

  /**
   * Plays vintage mechanical SLR camera shutter sound + optional high-voltage flash pop & capacitor whine
   */
  public playShutterClick(withFlash = false): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. First curtain mechanical clack
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(1650, now);
    osc1.frequency.exponentialRampToValueAtTime(180, now + 0.045);
    gain1.gain.setValueAtTime(0.24 * this.masterVolume, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.055);

    // 2. Second curtain & mirror return thud
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(920, now + 0.055);
    osc2.frequency.exponentialRampToValueAtTime(140, now + 0.11);
    gain2.gain.setValueAtTime(0.18 * this.masterVolume, now + 0.055);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.115);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.055);
    osc2.stop(now + 0.12);

    // 3. Mechanical 35mm Zenit-E Film-Advance Lever Ratchet (Two crisp gear clicks)
    for (let r = 0; r < 2; r++) {
      const rt = now + 0.14 + r * 0.055;
      const rOsc = ctx.createOscillator();
      const rGain = ctx.createGain();
      rOsc.type = 'square';
      rOsc.frequency.setValueAtTime(1120 + r * 240, rt);
      rOsc.frequency.exponentialRampToValueAtTime(340, rt + 0.03);
      rGain.gain.setValueAtTime(0.085 * this.masterVolume, rt);
      rGain.gain.exponentialRampToValueAtTime(0.001, rt + 0.035);
      rOsc.connect(rGain);
      rGain.connect(ctx.destination);
      rOsc.start(rt);
      rOsc.stop(rt + 0.04);
    }

    // 4. Optional flash bulb pop & rising capacitor recharge whine
    if (withFlash) {
      const fOsc = ctx.createOscillator();
      const fGain = ctx.createGain();
      fOsc.type = 'sine';
      fOsc.frequency.setValueAtTime(2200, now + 0.12);
      fOsc.frequency.exponentialRampToValueAtTime(5800, now + 1.1);
      fGain.gain.setValueAtTime(0.05 * this.masterVolume, now + 0.12);
      fGain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
      fOsc.connect(fGain);
      fGain.connect(ctx.destination);
      fOsc.start(now + 0.12);
      fOsc.stop(now + 1.2);
    }
  }


  /**
   * Plays a subtle warm confirmation chime when a photo task passes quality threshold (>= 60)
   */
  public playTaskCompleteChime(isSuccess = true): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    if (isSuccess) {
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.09); // E5
    } else {
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.linearRampToValueAtTime(175, now + 0.18);
    }
    gain.gain.setValueAtTime(0.14 * this.masterVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * Plays Soviet cage elevator bell chime + heavy mechanical cable rumble
   */
  public playElevatorChimeAndRumble(durationSec = 3.8): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Vintage brass bell ding
    const bellOsc = ctx.createOscillator();
    const bellGain = ctx.createGain();
    bellOsc.type = 'sine';
    bellOsc.frequency.setValueAtTime(1046.5, now); // C6
    bellGain.gain.setValueAtTime(0.18 * this.masterVolume, now);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    bellOsc.connect(bellGain);
    bellGain.connect(ctx.destination);
    bellOsc.start(now);
    bellOsc.stop(now + 0.95);

    // 2. Low elevator motor & cable rumble
    const rumbleOsc = ctx.createOscillator();
    const rumbleFilter = ctx.createBiquadFilter();
    const rumbleGain = ctx.createGain();
    rumbleOsc.type = 'sawtooth';
    rumbleOsc.frequency.setValueAtTime(44, now + 0.2);
    rumbleOsc.frequency.linearRampToValueAtTime(58, now + durationSec * 0.5);
    rumbleOsc.frequency.linearRampToValueAtTime(38, now + durationSec);

    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 110;

    rumbleGain.gain.setValueAtTime(0.001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.14 * this.masterVolume, now + 0.35);
    rumbleGain.gain.setValueAtTime(0.14 * this.masterVolume, now + durationSec - 0.4);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    rumbleOsc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumbleOsc.start(now);
    rumbleOsc.stop(now + durationSec + 0.05);
  }

  /**
   * Plays subtle metallic creak (metalik gıcırtı), roller rail friction (sürtünme sesi),
   * and final bumper latch clunk when the double elevator doors slide closed or open.
   */
  public playElevatorDoorSlide(mode: 'closing' | 'opening'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const dur = 0.56;

    // 1. Metallic Creak (Resonant FM-modulated sawtooth/triangle sweep)
    const creakOsc = ctx.createOscillator();
    const creakLfo = ctx.createOscillator();
    const creakLfoGain = ctx.createGain();
    const creakFilter = ctx.createBiquadFilter();
    const creakGain = ctx.createGain();

    creakOsc.type = 'sawtooth';
    if (mode === 'closing') {
      creakOsc.frequency.setValueAtTime(590, now);
      creakOsc.frequency.linearRampToValueAtTime(385, now + dur * 0.6);
      creakOsc.frequency.linearRampToValueAtTime(470, now + dur);
    } else {
      creakOsc.frequency.setValueAtTime(410, now);
      creakOsc.frequency.linearRampToValueAtTime(645, now + dur * 0.55);
      creakOsc.frequency.linearRampToValueAtTime(520, now + dur);
    }

    creakLfo.type = 'sine';
    creakLfo.frequency.value = 15.5; // Metallic stick-slip vibration warble
    creakLfoGain.gain.value = 28;
    creakLfo.connect(creakLfoGain);
    creakLfoGain.connect(creakOsc.frequency);

    creakFilter.type = 'bandpass';
    creakFilter.frequency.setValueAtTime(mode === 'closing' ? 1180 : 960, now);
    creakFilter.frequency.linearRampToValueAtTime(mode === 'closing' ? 840 : 1320, now + dur);
    creakFilter.Q.value = 7.5;

    creakGain.gain.setValueAtTime(0.001, now);
    creakGain.gain.linearRampToValueAtTime(0.068 * this.masterVolume, now + 0.06);
    creakGain.gain.setValueAtTime(0.055 * this.masterVolume, now + dur * 0.72);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    creakOsc.connect(creakFilter);
    creakFilter.connect(creakGain);
    creakGain.connect(ctx.destination);

    creakLfo.start(now);
    creakOsc.start(now);
    creakLfo.stop(now + dur + 0.02);
    creakOsc.stop(now + dur + 0.02);

    // 2. Steel Door Rail & Roller Friction (Bandpass-filtered noise buffer)
    const sampleRate = ctx.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * dur));
    const noiseBuffer = ctx.createBuffer(1, frameCount, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (0.65 + 0.35 * Math.sin(i * 0.015));
    }

    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const frictionFilter = ctx.createBiquadFilter();
    frictionFilter.type = 'bandpass';
    frictionFilter.frequency.setValueAtTime(mode === 'closing' ? 980 : 820, now);
    frictionFilter.frequency.linearRampToValueAtTime(mode === 'closing' ? 680 : 1120, now + dur);
    frictionFilter.Q.value = 3.4;

    const frictionGain = ctx.createGain();
    frictionGain.gain.setValueAtTime(0.001, now);
    frictionGain.gain.linearRampToValueAtTime(0.075 * this.masterVolume, now + 0.05);
    frictionGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noiseSrc.connect(frictionFilter);
    frictionFilter.connect(frictionGain);
    frictionGain.connect(ctx.destination);
    noiseSrc.start(now);
    noiseSrc.stop(now + dur + 0.01);

    // 3. Soft Metallic Bumper / Latch Clunk at End of Slide
    const clunkTime = now + dur - 0.04;
    const clunkOsc = ctx.createOscillator();
    const clunkGain = ctx.createGain();
    clunkOsc.type = 'triangle';
    clunkOsc.frequency.setValueAtTime(mode === 'closing' ? 142 : 168, clunkTime);
    clunkOsc.frequency.exponentialRampToValueAtTime(42, clunkTime + 0.09);
    clunkGain.gain.setValueAtTime(0.09 * this.masterVolume, clunkTime);
    clunkGain.gain.exponentialRampToValueAtTime(0.001, clunkTime + 0.095);
    clunkOsc.connect(clunkGain);
    clunkGain.connect(ctx.destination);
    clunkOsc.start(clunkTime);
    clunkOsc.stop(clunkTime + 0.1);
  }

  /**
   * Velocity-coupled continuous micro-creak and rail friction grain triggered directly
   * from the elevatorDoorLeft / elevatorDoorRight damp animation in src/App.tsx.
   */
  public updateElevatorDoorMovement(doorSpeed: number, isClosing: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (now - this.lastDoorFrictionAt < 0.085) return;
    const clampedSpeed = Math.min(1, Math.max(0, doorSpeed / 2.8));
    if (clampedSpeed < 0.03) return;
    this.lastDoorFrictionAt = now;

    const grainDur = 0.08;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const baseFreq = (isClosing ? 480 : 540) + clampedSpeed * 190 + (Math.random() * 45 - 22);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * (isClosing ? 0.91 : 1.08), now + grainDur);

    filter.type = 'bandpass';
    filter.frequency.value = 1050 + clampedSpeed * 320;
    filter.Q.value = 6.2;

    const vol = (0.018 + clampedSpeed * 0.042) * this.masterVolume;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + grainDur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + grainDur + 0.005);
  }

  /**
   * Synthesizes the trembling elderly woman's voice over the crackling elevator PA speaker
   * (plus triggers Web Speech API in Turkish when available in the browser).
   */
  public playOldWomanVoice(announcementText: string, syllableCount = 14): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Optional Web Speech API with elderly feminine pitch/rate
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && !this.isMuted) {
      try {
        window.speechSynthesis.cancel();
        const cleanSpeech = announcementText.replace(/^[^:]+:\s*"/, '').replace(/"$/, '');
        const utter = new SpeechSynthesisUtterance(cleanSpeech);
        utter.lang = 'tr-TR';
        utter.rate = 0.82; // Slow, frail elderly cadence
        utter.pitch = 1.25;
        utter.volume = Math.min(1, this.masterVolume * 0.9);
        window.speechSynthesis.speak(utter);
      } catch {
        // Fallback purely to WebAudio formant synthesis
      }
    }

    // WebAudio trembling old woman formant synthesis through an intercom bandpass filter
    const now = ctx.currentTime;
    for (let i = 0; i < syllableCount; i++) {
      const start = now + 0.35 + i * 0.19;
      const dur = 0.14;

      const osc = ctx.createOscillator();
      const vibrato = ctx.createOscillator();
      const vibratoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      // Trembling elderly voice pitch (~245-290Hz with 6.5Hz tremor)
      const baseFreq = 250 + ((i * 29) % 55) - (i % 3 === 0 ? 20 : 0);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, start);
      osc.frequency.linearRampToValueAtTime(baseFreq * 0.93, start + dur);

      vibrato.type = 'sine';
      vibrato.frequency.value = 6.8; // Characteristic elderly vocal tremor
      vibratoGain.gain.value = 9.0;
      vibrato.connect(osc.frequency);

      filter.type = 'bandpass';
      filter.frequency.value = 920 + ((i * 83) % 420);
      filter.Q.value = 2.8;

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.095 * this.masterVolume, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      vibrato.start(start);
      osc.start(start);
      vibrato.stop(start + dur + 0.01);
      osc.stop(start + dur + 0.01);
    }
  }

  /**
   * Plays a double-thump ("lub-dub") heartbeat sound scaled by suspicion intensity (0..1)
   */
  public playHeartbeat(intensity = 0.6): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.15, Math.min(1, intensity));
    const vol = (0.08 + clamped * 0.22) * this.masterVolume;

    // First thump ("lub")
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(62 + clamped * 12, now);
    osc1.frequency.exponentialRampToValueAtTime(28, now + 0.11);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.linearRampToValueAtTime(vol, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.13);

    // Second thump ("dub")
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(54 + clamped * 10, now + 0.16);
    osc2.frequency.exponentialRampToValueAtTime(24, now + 0.28);
    gain2.gain.setValueAtTime(0.001, now + 0.16);
    gain2.gain.linearRampToValueAtTime(vol * 0.8, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.29);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.16);
    osc2.stop(now + 0.3);
  }

  /**
   * Plays short police whistle trill + absurd-threatening voice synthesis (+ optional Turkish Web Speech API)
   */
  public playPoliceVoiceLine(lineText: string, includeWhistle = true): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Short shrill militia whistle trill on chase start
    if (includeWhistle) {
      const wOsc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const wGain = ctx.createGain();

      wOsc.type = 'triangle';
      wOsc.frequency.setValueAtTime(2680, now);
      wOsc.frequency.linearRampToValueAtTime(2920, now + 0.24);

      lfo.type = 'square';
      lfo.frequency.value = 28; // Pea-whistle modulation
      lfoGain.gain.value = 140;
      lfo.connect(wOsc.frequency);

      wGain.gain.setValueAtTime(0.001, now);
      wGain.gain.linearRampToValueAtTime(0.14 * this.masterVolume, now + 0.02);
      wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      wOsc.connect(wGain);
      wGain.connect(ctx.destination);
      lfo.start(now);
      wOsc.start(now);
      lfo.stop(now + 0.29);
      wOsc.stop(now + 0.29);
    }

    // 2. Optional Web Speech API in Turkish with eccentric pitch
    if (typeof window !== 'undefined' && 'speechSynthesis' in window && !this.isMuted) {
      try {
        window.speechSynthesis.cancel();
        const cleanSpeech = lineText.replace(/^[^:]+:\s*"/, '').replace(/"$/, '');
        const utter = new SpeechSynthesisUtterance(cleanSpeech);
        utter.lang = 'tr-TR';
        utter.rate = 1.12;
        utter.pitch = 1.35; // Slightly high, absurdly eager officer tone
        utter.volume = Math.min(1, this.masterVolume * 0.95);
        window.speechSynthesis.speak(utter);
      } catch {
        // Fallback to WebAudio formant synthesis
      }
    }

    // 3. WebAudio formant synthesis for the short blonde officer's voice
    const syllables = 9;
    const baseDelay = includeWhistle ? 0.3 : 0.02;
    for (let i = 0; i < syllables; i++) {
      const start = now + baseDelay + i * 0.11;
      const dur = 0.09;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      const pitch = 210 + ((i * 53) % 95);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(pitch, start);
      osc.frequency.linearRampToValueAtTime(pitch * 1.12, start + dur);

      filter.type = 'bandpass';
      filter.frequency.value = 880 + ((i * 97) % 450);
      filter.Q.value = 3.0;

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.085 * this.masterVolume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.01);
    }
  }

  /**
   * Plays heavy rubber baton impact thud + 4-second stun ear-ringing chime when caught by police
   */
  public playBatonHitAndStun(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Low rubber baton impact thud
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(165, now);
    thudOsc.frequency.exponentialRampToValueAtTime(32, now + 0.22);
    thudGain.gain.setValueAtTime(0.34 * this.masterVolume, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(now);
    thudOsc.stop(now + 0.26);

    // 2. Dazed ear-ringing sine tone fading over 2.2s
    const ringOsc = ctx.createOscillator();
    const ringGain = ctx.createGain();
    ringOsc.type = 'sine';
    ringOsc.frequency.setValueAtTime(2480, now + 0.05);
    ringOsc.frequency.linearRampToValueAtTime(2420, now + 2.1);
    ringGain.gain.setValueAtTime(0.001, now);
    ringGain.gain.linearRampToValueAtTime(0.07 * this.masterVolume, now + 0.08);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
    ringOsc.connect(ringGain);
    ringGain.connect(ctx.destination);
    ringOsc.start(now + 0.05);
    ringOsc.stop(now + 2.25);
  }

  /**
   * Plays Soviet sheet-metal locker door hinge squeak + hollow metal latch clank when entering/exiting a locker
   */
  public playLockerDoorSound(entering: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Rusty hinge squeak
    const sqOsc = ctx.createOscillator();
    const sqFilter = ctx.createBiquadFilter();
    const sqGain = ctx.createGain();
    sqOsc.type = 'sawtooth';
    if (entering) {
      sqOsc.frequency.setValueAtTime(640, now);
      sqOsc.frequency.linearRampToValueAtTime(420, now + 0.24);
    } else {
      sqOsc.frequency.setValueAtTime(440, now);
      sqOsc.frequency.linearRampToValueAtTime(690, now + 0.24);
    }
    sqFilter.type = 'bandpass';
    sqFilter.frequency.value = 1150;
    sqFilter.Q.value = 6.5;

    sqGain.gain.setValueAtTime(0.001, now);
    sqGain.gain.linearRampToValueAtTime(0.11 * this.masterVolume, now + 0.03);
    sqGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    sqOsc.connect(sqFilter);
    sqFilter.connect(sqGain);
    sqGain.connect(ctx.destination);
    sqOsc.start(now);
    sqOsc.stop(now + 0.27);

    // 2. Hollow sheet-metal door clank
    const clankTime = now + 0.22;
    const clankOsc = ctx.createOscillator();
    const clankGain = ctx.createGain();
    clankOsc.type = 'triangle';
    clankOsc.frequency.setValueAtTime(entering ? 185 : 225, clankTime);
    clankOsc.frequency.exponentialRampToValueAtTime(48, clankTime + 0.14);
    clankGain.gain.setValueAtTime(0.18 * this.masterVolume, clankTime);
    clankGain.gain.exponentialRampToValueAtTime(0.001, clankTime + 0.15);
    clankOsc.connect(clankGain);
    clankGain.connect(ctx.destination);
    clankOsc.start(clankTime);
    clankOsc.stop(clankTime + 0.16);
  }

  /**
   * Plays locker door flying open + comical "MUAH!" kiss smack + stun ring when Officer Igor
   * follows the player into the locker and kisses them!
   */
  public playPoliceLockerKiss(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    // 1. Metal locker door yanked open
    this.playLockerDoorSound(false);

    const now = ctx.currentTime;

    // 2. Comical resonant "MUAH!" kiss smack at +0.18s
    const kissStart = now + 0.18;
    const kissOsc = ctx.createOscillator();
    const kissFilter = ctx.createBiquadFilter();
    const kissGain = ctx.createGain();

    kissOsc.type = 'sine';
    kissOsc.frequency.setValueAtTime(340, kissStart);
    kissOsc.frequency.exponentialRampToValueAtTime(980, kissStart + 0.09);
    kissOsc.frequency.exponentialRampToValueAtTime(220, kissStart + 0.24);

    kissFilter.type = 'bandpass';
    kissFilter.frequency.setValueAtTime(850, kissStart);
    kissFilter.frequency.linearRampToValueAtTime(1650, kissStart + 0.12);
    kissFilter.Q.value = 4.2;

    kissGain.gain.setValueAtTime(0.001, kissStart);
    kissGain.gain.linearRampToValueAtTime(0.28 * this.masterVolume, kissStart + 0.04);
    kissGain.gain.exponentialRampToValueAtTime(0.001, kissStart + 0.26);

    kissOsc.connect(kissFilter);
    kissFilter.connect(kissGain);
    kissGain.connect(ctx.destination);
    kissOsc.start(kissStart);
    kissOsc.stop(kissStart + 0.27);

    // 3. Stun impact & ear-ringing chime
    this.playBatonHitAndStun();
  }

  /**
   * Plays a brief 100Hz fluorescent ballast buzz when a broken ceiling lamp flickers near the player
   */
  public playLampFlickerBuzz(distanceMeters: number): void {
    if (distanceMeters > 9.0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (now - this.lastLampBuzzAt < 0.75) return;
    this.lastLampBuzzAt = now;

    const prox = Math.max(0.1, 1 - distanceMeters / 9.0);
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.linearRampToValueAtTime(92, now + 0.08);

    filter.type = 'bandpass';
    filter.frequency.value = 1450;
    filter.Q.value = 4.5;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.032 * prox * this.masterVolume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  /**
   * Plays an end-of-tour darkroom / press fanfare chord when transitioning to the results screen
   */
  public playTourEndFanfare(
    reason: 'tour_finished' | 'caught_by_police',
    rank: 'Amatör' | 'Muhabir' | 'Usta',
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes =
      reason === 'caught_by_police'
        ? [293.66, 277.18, 220.0] // Descending minor detention sting
        : rank === 'Usta'
          ? [261.63, 329.63, 392.0, 523.25] // Triumphant C major press chord
          : rank === 'Muhabir'
            ? [261.63, 329.63, 392.0]
            : [220.0, 261.63, 329.63];

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.09;
      const dur = 0.55;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = reason === 'caught_by_police' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.11 * this.masterVolume, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }
}




