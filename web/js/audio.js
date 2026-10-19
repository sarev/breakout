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
   */
  play(name, pan = 0.5, volume = 1) {
    const buffer = this.buffers[name];
    if (!buffer || this.ctx.state !== 'running') return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * 2 - 1));
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(panner).connect(gain).connect(this.ctx.destination);
    source.start();
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
    this.current = null;            // [name, tempo] of the track that is (or was last) playing
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
   * Start a track looping. Does nothing if music is off, the track is missing, or it's already playing.
   *
   * @param {string} name
   * @param {number} tempo Speed (and pitch) multiplier.
   */
  play(name, tempo = 1) {
    if (!this.enabled || !this.buffers[name]) return;
    if (this.current && this.current[0] === name && this.current[1] === tempo && this.playing()) return;
    this.stop(false);
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers[name];
    source.loop = true;
    source.playbackRate.value = tempo;
    source.connect(this.gain);
    source.start();
    this.source = source;
    this.current = [name, tempo];
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }

  /**
   * Stop the music, with a short fade by default.
   *
   * @param {boolean} fade
   */
  stop(fade = true) {
    const source = this.source;
    if (!source) return;
    this.source = null;
    if (fade) {
      const now = this.ctx.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS);
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
      this.stop(false);
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
