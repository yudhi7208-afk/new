import test from 'node:test';
import assert from 'node:assert/strict';
import { createPosiSound, SPOKEN_GREETING } from './sound.mjs';

function fixture({ voice = false, blocked = false } = {}) {
  const calls = []; let time = 10000, hidden = false;
  class Audio {
    constructor() { calls.push('create'); this.state = blocked ? 'suspended' : 'running'; this.currentTime = 0; }
    resume() { calls.push('resume'); return blocked ? Promise.reject(Error('blocked')) : Promise.resolve(); }
    createOscillator() { return { frequency: {}, connect() {}, start() { calls.push('tone'); }, stop() { calls.push('stop'); }, disconnect() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime(v) { assert.ok(v <= .05); }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    close() { calls.push('close'); return Promise.resolve(); }
  }
  const scope = { AudioContext: Audio, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: {
    getVoices: () => voice ? [{ lang: 'id-ID', localService: true }] : [],
    speak(value) { calls.push({ spoken: value.text, lang: value.lang }); }, cancel() { calls.push('cancel'); },
  } };
  const sound = createPosiSound({ scope, now: () => time, isVisible: () => !hidden });
  return { sound, calls, advance: () => { time += 2001; }, hide: () => { hidden = true; } };
}
test('no audio context or sound is created before a user gesture primes it', () => {
  const { sound, calls } = fixture(); assert.equal(sound.greet(), false); assert.equal(sound.notify(), false); assert.deepEqual(calls, []); sound.destroy();
});
test('original gentle chime is brief, throttled, and mute stops it', () => {
  const { sound, calls, advance } = fixture(); sound.prime(); assert.equal(sound.greet(), true);
  assert.equal(calls.filter(c => c === 'tone').length, 3); assert.equal(sound.notify(), false);
  advance(); sound.setEnabled(false); assert.equal(sound.notify(), false); assert.ok(calls.includes('stop')); sound.destroy(); assert.ok(calls.includes('close'));
});
test('only a fixed greeting is spoken with an Indonesian local voice', () => {
  const { sound, calls } = fixture({ voice: true }); sound.prime(); assert.equal(sound.greet(), true);
  assert.ok(calls.some(c => c?.spoken === SPOKEN_GREETING && c.lang === 'id-ID')); assert.equal(calls.includes('tone'), false); sound.destroy();
});
test('hidden tab, unavailable APIs, blocked audio and destroyed sound fail without throwing', async () => {
  const f = fixture(); f.sound.prime(); f.hide(); assert.equal(f.sound.greet(), false); f.sound.destroy();
  const missing = createPosiSound({ scope: {} }); missing.prime(); assert.equal(missing.available, false); assert.equal(missing.greet(), false); missing.destroy();
  const blocked = fixture({ blocked: true }); blocked.sound.prime(); await Promise.resolve(); assert.equal(blocked.sound.greet(), false); blocked.sound.destroy();
  assert.equal(blocked.sound.greet(), false);
});
