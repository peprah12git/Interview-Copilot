// profile_service.js
// ─────────────────────────────────────────────────────────────────────────────
// Central profile service for Interview Copilot.
//
// Responsibilities:
//   • Hold the single source of truth for the "active" candidate profile.
//   • Persist a user-supplied CV profile to an encrypted JSON file in the
//     per-user application data directory (app.getPath('userData')).
//   • Encrypt profile data with Electron safeStorage (same mechanism the app
//     already uses for the API key), never writing plaintext PII when
//     encryption is available.
//   • Fall back to the bundled candidate_profile.js when no user profile exists.
//   • Format the profile into the exact text block that the system prompt
//     builder injects, so the settings preview matches reality.
//
// All filesystem + encryption work happens in the main process. The renderer
// never touches these functions directly — it goes through IPC (see index.js).
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');

// Bundled fallback profile (string). Used when the user has not configured one.
const fallbackProfileText = require('./candidate_profile');

// Versioned on-disk format. Bump when the stored shape changes so we can migrate.
const PROFILE_FILE_VERSION = 1;
const PROFILE_FILE_NAME = 'user_profile.json';

// The set of fields a user profile may contain. Keeping this explicit lets us
// validate IPC input and avoid persisting anything unexpected from the renderer.
const PROFILE_FIELDS = [
  'fullName',
  'currentRole',
  'previousRole',
  'degree',
  'university',
  'graduationYear',
  'projects',
  'skills',
  'certifications',
];

// Module-scoped state. These are set up by init() and kept in sync on save/clear
// so the settings UI and the system prompt builder read from the same place.
let userDataDir  = null;   // where user_profile.json lives
let profilePath  = null;   // full path to user_profile.json
let safeStorage  = null;   // Electron safeStorage (injected by init)
let activeProfile = null;  // the structured user profile object, or null = fallback

// ─────────────────────────────────────────────────────────────────────────────
// Validation / normalisation
// ─────────────────────────────────────────────────────────────────────────────

// Normalise arbitrary renderer input into a clean profile object. Only known
// fields are kept; everything is coerced to a trimmed string. No field is
// required — users may fill in as much or as little as they like.
function normaliseProfile(input) {
  const out = {};
  if (input && typeof input === 'object') {
    for (const key of PROFILE_FIELDS) {
      const val = input[key];
      out[key] = typeof val === 'string' ? val.trim() : '';
    }
  } else {
    for (const key of PROFILE_FIELDS) out[key] = '';
  }
  return out;
}

// A profile is "meaningful" (worth saving / treating as configured) only if at
// least one field has content. This prevents an empty save from being treated
// as a real custom profile.
function hasAnyContent(profile) {
  return PROFILE_FIELDS.some((k) => profile[k] && profile[k].length > 0);
}

// Structural validation of a decrypted profile object loaded from disk.
function isValidStoredProfile(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // Must be an object we can read fields from. Missing fields are tolerated
  // (treated as empty) for forward/backward compatibility.
  return PROFILE_FIELDS.some((k) => typeof obj[k] === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt formatting
// ─────────────────────────────────────────────────────────────────────────────

// Turn a structured user profile into the CANDIDATE PROFILE text block that is
// injected into the system prompt. The shape intentionally mirrors the bundled
// candidate_profile.js so the model sees a consistent format either way.
function formatProfileForPrompt(profile) {
  const lines = [];
  lines.push('CANDIDATE PROFILE:');

  if (profile.fullName)       lines.push(`Name: ${profile.fullName}`);
  if (profile.currentRole)    lines.push(`Role: ${profile.currentRole}`);
  if (profile.previousRole)   lines.push(`Previous Role: ${profile.previousRole}`);

  // Education: degree, university, graduation year — combined on one line.
  const eduParts = [];
  if (profile.degree)         eduParts.push(profile.degree);
  if (profile.university)     eduParts.push(profile.university);
  if (profile.graduationYear) eduParts.push(`Graduated ${profile.graduationYear}`);
  if (eduParts.length)        lines.push(`Education: ${eduParts.join(' - ')}`);

  if (profile.projects) {
    lines.push('');
    lines.push('KEY PROJECTS:');
    lines.push(profile.projects.trim());
  }

  if (profile.skills) {
    lines.push('');
    lines.push('TECHNICAL SKILLS:');
    lines.push(profile.skills.trim());
  }

  if (profile.certifications) {
    lines.push('');
    lines.push('CERTIFICATIONS:');
    lines.push(profile.certifications.trim());
  }

  return lines.join('\n');
}

// Returns the candidate-profile text block that should be injected into the
// system prompt right now — the formatted user profile when configured, else
// the bundled fallback string. This is the single function both the prompt
// builder and the settings preview rely on.
function getActiveProfileText() {
  if (activeProfile && hasAnyContent(activeProfile)) {
    return formatProfileForPrompt(activeProfile);
  }
  return fallbackProfileText.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Encryption helpers (Electron safeStorage)
// ─────────────────────────────────────────────────────────────────────────────

function encryptionAvailable() {
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

// Read + decrypt the on-disk profile. Returns:
//   { status: 'ok',       profile }   — loaded a valid user profile
//   { status: 'none' }                — no file; use fallback
//   { status: 'corrupt',  error }     — file unreadable / bad JSON / bad shape
//   { status: 'undecryptable', error }— present but could not be decrypted
// Importantly, this NEVER deletes or overwrites the file on a read failure.
function readProfileFromDisk() {
  if (!profilePath || !fs.existsSync(profilePath)) {
    return { status: 'none' };
  }

  let raw;
  try {
    raw = fs.readFileSync(profilePath, 'utf8');
  } catch (e) {
    return { status: 'corrupt', error: 'Could not read profile file.' };
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (e) {
    return { status: 'corrupt', error: 'Profile file is not valid JSON.' };
  }

  if (!envelope || typeof envelope !== 'object') {
    return { status: 'corrupt', error: 'Profile file has an unexpected format.' };
  }

  let profileJson = null;

  if (envelope.encrypted && typeof envelope.data === 'string') {
    // Encrypted envelope — needs safeStorage to read.
    if (!encryptionAvailable()) {
      return {
        status: 'undecryptable',
        error: 'Encrypted profile found but OS encryption is unavailable on this machine.',
      };
    }
    try {
      profileJson = safeStorage.decryptString(Buffer.from(envelope.data, 'base64'));
    } catch (e) {
      return {
        status: 'undecryptable',
        error: 'Profile could not be decrypted (it may belong to a different OS user or install).',
      };
    }
  } else if (envelope.encrypted === false && typeof envelope.data === 'string') {
    // Explicit plaintext envelope (only written when encryption was unavailable).
    profileJson = envelope.data;
  } else {
    return { status: 'corrupt', error: 'Profile file is missing expected fields.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(profileJson);
  } catch (e) {
    return { status: 'corrupt', error: 'Decrypted profile is not valid JSON.' };
  }

  if (!isValidStoredProfile(parsed)) {
    return { status: 'corrupt', error: 'Decrypted profile has an invalid structure.' };
  }

  return { status: 'ok', profile: normaliseProfile(parsed) };
}

// Write + encrypt the profile atomically-ish (write temp, then rename) so a
// crash mid-write can't leave a half-written file in place of a good one.
// Returns { ok: true } or { ok: false, error }.
function writeProfileToDisk(profile) {
  if (!profilePath) {
    return { ok: false, error: 'Profile storage path is not initialised.' };
  }

  const profileJson = JSON.stringify(profile);

  let envelope;
  if (encryptionAvailable()) {
    let encrypted;
    try {
      encrypted = safeStorage.encryptString(profileJson).toString('base64');
    } catch (e) {
      return { ok: false, error: 'Encryption failed; profile was not saved.' };
    }
    envelope = {
      version:   PROFILE_FILE_VERSION,
      encrypted: true,
      scheme:    'electron-safeStorage',
      data:      encrypted,
      savedAt:   new Date().toISOString(),
    };
  } else {
    // Encryption unavailable: we DO NOT silently store plaintext PII. The caller
    // decides whether to proceed. We signal this clearly.
    return {
      ok: false,
      error: 'ENCRYPTION_UNAVAILABLE',
    };
  }

  const tmpPath = profilePath + '.tmp';
  try {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), 'utf8');
    fs.renameSync(tmpPath, profilePath);
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { ok: false, error: 'Could not write the profile file to disk.' };
  }

  // Verify the write succeeded and round-trips before reporting success.
  const verify = readProfileFromDisk();
  if (verify.status !== 'ok') {
    return { ok: false, error: 'Profile write could not be verified after saving.' };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

// Initialise the service. Must be called once after app is ready.
//   deps.userDataPath — app.getPath('userData')
//   deps.safeStorage  — Electron's safeStorage module
// Returns a load result describing what happened (for optional UI messaging).
function init(deps) {
  userDataDir = deps.userDataPath;
  safeStorage = deps.safeStorage;
  profilePath = path.join(userDataDir, PROFILE_FILE_NAME);
  return load();
}

// Load the profile from disk into active state (or leave as fallback). Returns:
//   { status, usingFallback, error? }
function load() {
  const result = readProfileFromDisk();

  switch (result.status) {
    case 'ok':
      activeProfile = result.profile;
      return { status: 'ok', usingFallback: false };

    case 'none':
      activeProfile = null;  // fallback
      return { status: 'none', usingFallback: true };

    case 'corrupt':
    case 'undecryptable':
      // Do NOT discard the file. Keep using the fallback for answering, but
      // surface the problem so the user can decide (re-save or clear).
      activeProfile = null;
      return { status: result.status, usingFallback: true, error: result.error };

    default:
      activeProfile = null;
      return { status: 'none', usingFallback: true };
  }
}

// Save a user profile (object from the renderer). Validates, encrypts, writes,
// verifies, and updates active state only after a confirmed write.
// Returns { ok, error? }.
function save(input) {
  const profile = normaliseProfile(input);

  if (!hasAnyContent(profile)) {
    return { ok: false, error: 'Please fill in at least one field before saving.' };
  }

  const result = writeProfileToDisk(profile);
  if (!result.ok) {
    // Active state is left untouched on failure — previously saved profile
    // (if any) is preserved.
    return result;
  }

  activeProfile = profile;
  return { ok: true };
}

// Clear the custom profile: delete the file and revert to the fallback.
// Does NOT touch settings.json, the API key, or any other files.
// Returns { ok, error? }.
function clear() {
  try {
    if (profilePath && fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
    }
  } catch (e) {
    return { ok: false, error: 'Could not remove the saved profile file.' };
  }
  activeProfile = null;  // back to fallback
  return { ok: true };
}

// Does a custom (user-configured) profile currently exist in active state?
function hasCustomProfile() {
  return !!(activeProfile && hasAnyContent(activeProfile));
}

// Return the structured active profile object for the settings form. When no
// custom profile is configured, returns an all-empty object so the form loads
// cleanly. Never returns the fallback text here — that is for the preview only.
function getProfileForForm() {
  if (hasCustomProfile()) return { ...activeProfile };
  return normaliseProfile(null);
}

// A safe status snapshot for the renderer. No secrets, no raw file contents.
function getStatus() {
  return {
    hasCustomProfile:     hasCustomProfile(),
    encryptionAvailable:  encryptionAvailable(),
    storagePath:          profilePath,
  };
}

module.exports = {
  init,
  load,
  save,
  clear,
  hasCustomProfile,
  getProfileForForm,
  getActiveProfileText,
  formatProfileForPrompt,
  normaliseProfile,
  getStatus,
  PROFILE_FIELDS,
  PROFILE_FILE_VERSION,
};
