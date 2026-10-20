// Sound effects and music through the Web Audio API.
//
// Effects are one-shot buffer sources with a stereo panner and a gain, which gives the same "panned by x, volume
// by speed" behaviour as the Python game's channel.set_volume(left, right). Music is a looping buffer source
// with its own gain; tempo changes are just playbackRate, which raises the pitch along with the speed exactly as
// the Python version's resampling does, without any resampling at all.

import { MUSIC_FADE_SECONDS, MUSIC_LEVEL_PLAN, MUSIC_VOLUME } from './config.js';

export class Sfx {
  /**
   * @param {AudioContext} ctx
   * @param {Object<string, AudioBuffer|null>} buffers Decoded effects by name.
   */
  constructor(ctx, buffers) {
    this.ctx = ctx;
    this.buffers = buffers;
  }

  /**
   * Play an effect.
   *
   * @param {string} name
   * @param {number} pan 0 (left) .. 1 (right); 0.5 is centred.
   * @param {number} volume 0 .. 1.
   * @param {number} rate Playback rate, which shifts the pitch too: 1 as recorded.
   * @param {number} delay Seconds from now to start it, so one effect can follow another exactly.
   */
  play(name, pan = 0.5, volume = 1, rate = 1, delay = 0) {
    const buffer = this.buffers[name];
    if (!buffer || this.ctx.state !== 'running') return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * 2 - 1));
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(panner).connect(gain).connect(this.ctx.destination);
    source.start(this.ctx.currentTime + delay);
  }

  /** How long an effect lasts at its recorded rate, in seconds (0 if it didn't load). */
  duration(name) {
    const buffer = this.buffers[name];
    return buffer ? buffer.duration : 0;
  }
}

export class Music {
  /**
   * @param {AudioContext} ctx
   * @param {Object<string, AudioBuffer|null>} buffers Decoded tracks by name (intro, stage1, stage2, boss).
   * @param {boolean} enabled Start with music on.
   * @param {number|null} volume 0..1, or null for the default.
   */
  constructor(ctx, buffers, enabled = true, volume = null) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.enabled = enabled;
    this.volume = volume === null ? MUSIC_VOLUME : Math.max(0, Math.min(1, volume));
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(ctx.destination);
    this.source = null;             // The looping source, while something is playing
    this.fader = null;              // Its own gain, between it and the volume, for fading it in or out
    this.current = null;            // [name, tempo] of the track the scene wants, playing or (music off) not
  }

  /**
   * What a level plays: the music of its stage, so a level going back over a stage carries on with its tune.
   *
   * @param {number} stage The level's stage, 1-based.
   * @returns {[string, number]} [track name, tempo], cycling past the end of the plan.
   */
  static levelTrack(stage) {
    return MUSIC_LEVEL_PLAN[(stage - 1) % MUSIC_LEVEL_PLAN.length];
  }

  /** Whether the current track is still sounding. */
  playing() {
    return this.source !== null;
  }

  /**
   * Start a track looping. Does nothing if the track is missing or already playing. With the music off it
   * just remembers the track, so switching the music on plays it straight away rather than waiting for the next
   * scene to ask for one (which, with the music off from the start, meant the intro stayed silent).
   *
   * Each track has its own fader, so with a fade-in the track it replaces fades out underneath rather than
   * being cut off. Scheduled on the audio clock, so a fade asked for before the context is unlocked (the intro,
   * from the gate) or while it's suspended (paused) waits and plays out in full once it runs.
   *
   * @param {string} name
   * @param {number} tempo Speed (and pitch) multiplier.
   * @param {number} fadeIn Seconds to fade in over: 0 starts at full volume, cutting off whatever was playing.
   */
  play(name, tempo = 1, fadeIn = 0) {
    if (!this.enabled) {
      this.current = [name, tempo];
      return;
    }
    if (!this.buffers[name]) return;
    if (this.current && this.current[0] === name && this.current[1] === tempo && this.playing()) return;
    this.stop(fadeIn > 0);
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers[name];
    source.loop = true;
    source.playbackRate.value = tempo;
    const fader = this.ctx.createGain();
    if (fadeIn > 0) {
      fader.gain.setValueAtTime(0, now);
      fader.gain.linearRampToValueAtTime(1, now + fadeIn);
    }
    source.connect(fader).connect(this.gain);
    source.start(now);
    this.source = source;
    this.fader = fader;
    this.current = [name, tempo];
  }

  /**
   * Stop the music, with a short fade by default. Nothing is wanted after this, so switching the music on (the
   * certificate stops it) stays silent until the next scene asks for a track.
   *
   * @param {boolean} fade
   */
  stop(fade = true) {
    this.current = null;
    const source = this.source;
    const fader = this.fader;
    if (!source) return;
    this.source = null;
    this.fader = null;
    if (fade) {
      // From wherever it is now, which may be part way through its own fade-in. `value` only catches up with a
      // ramp once the audio thread has rendered it, so where the browser can hold the ramp's true level (not
      // Firefox) that's used instead
      const now = this.ctx.currentTime;
      if (fader.gain.cancelAndHoldAtTime) {
        fader.gain.cancelAndHoldAtTime(now);
      } else {
        fader.gain.cancelScheduledValues(now);
        fader.gain.setValueAtTime(fader.gain.value, now);
      }
      fader.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS);
      source.stop(now + MUSIC_FADE_SECONDS);
    } else {
      source.stop();
    }
  }

  /**
   * Switch the music off or on. Switching on restarts whichever track was last asked for.
   *
   * @returns {boolean} The new enabled state.
   */
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      if (this.current) {
        const [name, tempo] = this.current;
        this.current = null;    // Force play() to restart it
        this.play(name, tempo);
      }
    } else {
      const wanted = this.current;
      this.stop(false);
      this.current = wanted;    // Still what the scene wants, for when the music comes back on
    }
    return this.enabled;
  }
}

export class AudioSystem {
  /**
   * Owns the AudioContext. The context is created suspended (browsers require a user gesture before sound) and
   * `unlock()` resumes it from the first click or key press. Pausing the game suspends the whole context, which
   * pauses music and effects together.
   */
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.sfx = null;
    this.music = null;
    this.pausedByGame = false;
  }

  /** Resume the context from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx.state === 'suspended' && !this.pausedByGame) {
      this.ctx.resume();
    }
  }

  /** Pause everything (game pause). */
  pause() {
    this.pausedByGame = true;
    if (this.ctx.state === 'running') this.ctx.suspend();
  }

  /** Resume after a game pause. */
  resume() {
    this.pausedByGame = false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
}
