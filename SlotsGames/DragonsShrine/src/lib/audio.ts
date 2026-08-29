'use client';

/**
 * STUB -- owned by the audio workstream, which replaces this file wholesale.
 *
 * It exists so that everything calling into sound compiles and runs before the
 * synthesiser lands. The signatures here are the contract; the implementation
 * is not.
 */

import type { SoundName } from '@/lib/store/contract';

export interface SoundOptions {
  /** Seconds from now. A spin is a short score, not a single cue. */
  delay?: number;
  /** 0..1, scaling this voice only. */
  gain?: number;
  /** Semitone offset, for sounds that step up as something builds. */
  pitch?: number;
}

export function playSound(_name: SoundName, _opts: SoundOptions = {}): void {}
export function unlockAudio(): void {}
export function setSoundEnabled(_on: boolean): void {}
export function setMusicEnabled(_on: boolean): void {}
export function startMusic(_track: 'base' | 'free' | 'hold'): void {}
export function stopMusic(): void {}
export function stopLoop(_name: SoundName): void {}
