// test/profile_service.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight, dependency-free test runner for the CV profile feature.
// Run with:  node test/profile_service.test.js
//
// Covers the scenarios required by the feature spec:
//   • save + load a custom profile (encrypted round-trip)
//   • persistence across "restarts" (fresh init over the same dir)
//   • fallback to candidate_profile.js when no profile exists
//   • updating the profile and seeing new prompt text
//   • clearing the profile and restoring the fallback
//   • missing / corrupted / undecryptable profile files
//   • encryption-unavailable and write-failure handling
//   • dynamic prompt building reflects the active profile
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { buildPrompts } = require('../classifier');
const fallbackText = require('../candidate_profile');

// ── Tiny assertion helpers ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('  ✗ FAIL: ' + name); }
}
function section(title) { console.log('\n── ' + title + ' ──'); }

// ── Fake Electron safeStorage ────────────────────────────────────────────────
// Reversible, non-plaintext transform (base64 of a tagged buffer) that stands in
// for OS encryption. `available` toggles the encryption-unavailable scenario.
function makeFakeSafeStorage(available = true) {
  return {
    _available: available,
    isEncryptionAvailable() { return this._available; },
    encryptString(str) {
      if (!this._available) throw new Error('not available');
      return Buffer.concat([Buffer.from('ENC:'), Buffer.from(str, 'utf8')]);
    },
    decryptString(buf) {
      const s = buf.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('cannot decrypt');
      return s.slice(4);
    },
  };
}

// Fresh require of the profile service so module state resets between cases,
// simulating an application restart.
function freshService() {
  delete require.cache[require.resolve('../profile_service')];
  return require('../profile_service');
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-test-'));
}

const SAMPLE = {
  fullName:       'Grace Hopper',
  currentRole:    'Principal Engineer at Navy Systems (2023 - Present)',
  previousRole:   'Researcher at Harvard (2018 - 2022)',
  degree:         'PhD Mathematics',
  university:     'Yale University',
  graduationYear: '1934',
  projects:       '- COBOL: pioneered English-like programming language.',
  skills:         'Languages: COBOL, FLOW-MATIC. Tools: compilers, linkers.',
  certifications: 'US Navy Rear Admiral',
};

// ─────────────────────────────────────────────────────────────────────────────
section('save + load custom profile (encrypted round-trip)');
{
  const dir = tmpDir();
  const svc = freshService();
  const ss  = makeFakeSafeStorage(true);
  svc.init({ userDataPath: dir, safeStorage: ss });

  const saveRes = svc.save(SAMPLE);
  assert(saveRes.ok === true, 'save returns ok');

  const file = path.join(dir, 'user_profile.json');
  assert(fs.existsSync(file), 'user_profile.json created');

  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(envelope.encrypted === true, 'envelope marked encrypted');
  assert(envelope.version === svc.PROFILE_FILE_VERSION, 'envelope has version');
  assert(!JSON.stringify(envelope).includes('Grace Hopper'), 'no plaintext PII on disk');

  assert(svc.hasCustomProfile() === true, 'hasCustomProfile true after save');
  const text = svc.getActiveProfileText();
  assert(text.includes('Grace Hopper'), 'active text includes name');
  assert(text.includes('COBOL'), 'active text includes projects');
  assert(text.includes('Graduated 1934'), 'education formatted with grad year');
}

// ─────────────────────────────────────────────────────────────────────────────
section('persistence across restart');
{
  const dir = tmpDir();
  let svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  svc.save(SAMPLE);

  // Simulate restart: brand new module instance, same dir + safeStorage.
  svc = freshService();
  const loadRes = svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  assert(loadRes.status === 'ok', 'load status ok on restart');
  assert(svc.hasCustomProfile() === true, 'profile persists across restart');
  assert(svc.getActiveProfileText().includes('Grace Hopper'), 'restarted text has profile');
}

// ─────────────────────────────────────────────────────────────────────────────
section('fallback when no profile exists');
{
  const dir = tmpDir();
  const svc = freshService();
  const loadRes = svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  assert(loadRes.status === 'none', 'load status none');
  assert(loadRes.usingFallback === true, 'usingFallback true');
  assert(svc.hasCustomProfile() === false, 'no custom profile');
  assert(svc.getActiveProfileText() === fallbackText.trim(), 'active text equals fallback');
}

// ─────────────────────────────────────────────────────────────────────────────
section('update profile reflects in active text');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  svc.save(SAMPLE);
  assert(svc.getActiveProfileText().includes('Grace Hopper'), 'has original name');

  svc.save({ ...SAMPLE, fullName: 'Ada Lovelace' });
  const text = svc.getActiveProfileText();
  assert(text.includes('Ada Lovelace'), 'updated name present');
  assert(!text.includes('Grace Hopper'), 'old name gone');
}

// ─────────────────────────────────────────────────────────────────────────────
section('clear restores fallback');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  svc.save(SAMPLE);
  assert(fs.existsSync(path.join(dir, 'user_profile.json')), 'file exists before clear');

  const clearRes = svc.clear();
  assert(clearRes.ok === true, 'clear returns ok');
  assert(!fs.existsSync(path.join(dir, 'user_profile.json')), 'file removed after clear');
  assert(svc.hasCustomProfile() === false, 'no custom profile after clear');
  assert(svc.getActiveProfileText() === fallbackText.trim(), 'fallback restored');
}

// ─────────────────────────────────────────────────────────────────────────────
section('missing field tolerated / partial profile');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  const res = svc.save({ fullName: 'Solo Field' });
  assert(res.ok === true, 'partial profile saves');
  assert(svc.getActiveProfileText().includes('Solo Field'), 'partial text present');
}

// ─────────────────────────────────────────────────────────────────────────────
section('empty profile rejected');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  const res = svc.save({});
  assert(res.ok === false, 'empty profile not saved');
  assert(svc.hasCustomProfile() === false, 'stays on fallback');
}

// ─────────────────────────────────────────────────────────────────────────────
section('corrupted file handled gracefully (not discarded)');
{
  const dir = tmpDir();
  const file = path.join(dir, 'user_profile.json');
  fs.writeFileSync(file, '{ this is not valid json', 'utf8');

  const svc = freshService();
  const loadRes = svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  assert(loadRes.status === 'corrupt', 'status corrupt');
  assert(loadRes.usingFallback === true, 'falls back for answering');
  assert(fs.existsSync(file), 'corrupt file NOT deleted');
  assert(svc.getActiveProfileText() === fallbackText.trim(), 'uses fallback text');
}

// ─────────────────────────────────────────────────────────────────────────────
section('undecryptable file handled gracefully');
{
  const dir = tmpDir();
  const file = path.join(dir, 'user_profile.json');
  // Encrypted envelope, but safeStorage will be unavailable at load time.
  const svc1 = freshService();
  svc1.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  svc1.save(SAMPLE);

  const svc2 = freshService();
  const loadRes = svc2.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(false) });
  assert(loadRes.status === 'undecryptable', 'status undecryptable');
  assert(loadRes.usingFallback === true, 'falls back');
  assert(fs.existsSync(file), 'undecryptable file preserved');
}

// ─────────────────────────────────────────────────────────────────────────────
section('encryption unavailable → no plaintext save');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(false) });
  const res = svc.save(SAMPLE);
  assert(res.ok === false, 'save fails when encryption unavailable');
  assert(res.error === 'ENCRYPTION_UNAVAILABLE', 'signals ENCRYPTION_UNAVAILABLE');
  assert(!fs.existsSync(path.join(dir, 'user_profile.json')), 'no file written in plaintext');
}

// ─────────────────────────────────────────────────────────────────────────────
section('write failure preserves previous profile');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });
  svc.save(SAMPLE);
  const before = svc.getActiveProfileText();

  // Break the directory so the temp write fails: replace dir path target by
  // pointing the file at a path whose parent is a file (invalid).
  const badFile = path.join(dir, 'user_profile.json');
  fs.rmSync(badFile, { force: true });
  // Make the profile path's parent un-writable by creating a file where the
  // ".tmp" rename target's directory would need to be a dir. Simplest reliable
  // cross-platform break: make the json path itself a directory.
  fs.mkdirSync(badFile);

  const res = svc.save({ ...SAMPLE, fullName: 'Should Not Persist' });
  assert(res.ok === false, 'save reports failure on write error');
  // Active profile should still be the previously saved one, untouched.
  assert(svc.getActiveProfileText() === before, 'previous profile preserved on failure');

  fs.rmSync(badFile, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
section('dynamic prompts reflect active profile');
{
  const dir = tmpDir();
  const svc = freshService();
  svc.init({ userDataPath: dir, safeStorage: makeFakeSafeStorage(true) });

  // Fallback prompts
  let prompts = buildPrompts(svc.getActiveProfileText());
  assert(prompts.behavioural.includes('CANDIDATE PROFILE'), 'prompt has profile section');
  assert(prompts.coding.includes('time and space complexity'), 'coding instructions preserved');

  // After save, prompts should contain the custom name
  svc.save(SAMPLE);
  prompts = buildPrompts(svc.getActiveProfileText());
  assert(prompts.behavioural.includes('Grace Hopper'), 'behavioural prompt uses custom profile');
  assert(prompts.screen.includes('Grace Hopper'), 'screen prompt uses custom profile');
  // No duplication: profile text appears exactly once in a prompt.
  const occurrences = prompts.general.split('CANDIDATE PROFILE:').length - 1;
  assert(occurrences === 1, 'profile not duplicated in prompt');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
if (failed > 0) {
  console.log('Failures:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('All profile-service tests passed.');
process.exit(0);
