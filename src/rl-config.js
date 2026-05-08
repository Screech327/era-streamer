// Auto-config for Rocket League's native StatsAPI export. Same approach as
// BARL: edit DefaultStatsAPI.ini in the install dir if writable, otherwise
// drop a user-dir override that Unreal merges over the install defaults at
// game launch. PacketSendRate=100 matches BARL's smoothness target.

const fs = require('fs');
const path = require('path');
const os = require('os');

const TARGET_RATE = 100;
const TARGET_PORT = 49123;

const STEAM_LIBRARY_VDF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/config/libraryfolders.vdf',
  'C:/Program Files/Steam/config/libraryfolders.vdf',
];
const FALLBACK_INSTALL_INIS = [
  'C:/Program Files (x86)/Steam/steamapps/common/rocketleague/TAGame/Config/DefaultStatsAPI.ini',
  'C:/Program Files/Steam/steamapps/common/rocketleague/TAGame/Config/DefaultStatsAPI.ini',
  'C:/Program Files/Epic Games/rocketleague/TAGame/Config/DefaultStatsAPI.ini',
  'D:/Program Files (x86)/Steam/steamapps/common/rocketleague/TAGame/Config/DefaultStatsAPI.ini',
  'D:/Program Files/Epic Games/rocketleague/TAGame/Config/DefaultStatsAPI.ini',
];
const USER_CONFIG_DIR = path.join(os.homedir(), 'Documents', 'My Games', 'Rocket League', 'TAGame', 'Config');
const USER_CONFIG_INI = path.join(USER_CONFIG_DIR, 'StatsAPI.ini');

function steamLibraryRLIniPaths() {
  const found = [];
  for (const vdf of STEAM_LIBRARY_VDF_CANDIDATES) {
    if (!fs.existsSync(vdf)) continue;
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      const re = /"path"\s*"([^"]+)"/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const lib = m[1].replace(/\\\\/g, '/');
        found.push(lib + '/steamapps/common/rocketleague/TAGame/Config/DefaultStatsAPI.ini');
      }
    } catch (_) {}
  }
  return found;
}

function findInstallIni() {
  for (const p of [...steamLibraryRLIniPaths(), ...FALLBACK_INSTALL_INIS]) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

function readPacketSendRate(content) {
  const m = content.match(/^\s*PacketSendRate\s*=\s*([0-9.]+)/im);
  return m ? parseFloat(m[1]) : null;
}

function ensureKey(content, key, value) {
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'im');
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  if (/\[TAGame\.MatchStatsExporter_TA\]/i.test(content)) {
    return content.replace(/(\[TAGame\.MatchStatsExporter_TA\])/i, `$1\n${key}=${value}`);
  }
  return (content.endsWith('\n') ? content : content + '\n') + `[TAGame.MatchStatsExporter_TA]\n${key}=${value}\n`;
}

function tryWriteUserConfig() {
  try {
    fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    let existing = '';
    if (fs.existsSync(USER_CONFIG_INI)) {
      try { existing = fs.readFileSync(USER_CONFIG_INI, 'utf8'); } catch (_) {}
    }
    let content = ensureKey(existing, 'PacketSendRate', TARGET_RATE);
    content = ensureKey(content, 'Port', TARGET_PORT);
    fs.writeFileSync(USER_CONFIG_INI, content, 'utf8');
    return { ok: true, path: USER_CONFIG_INI, scope: 'user' };
  } catch (e) {
    return { ok: false, error: e.code || e.message };
  }
}

function autoConfigure() {
  const installIni = findInstallIni();
  if (!installIni) return tryWriteUserConfig();

  let content;
  try { content = fs.readFileSync(installIni, 'utf8'); }
  catch { return tryWriteUserConfig(); }

  const rate = readPacketSendRate(content);
  if (rate != null && rate >= TARGET_RATE) {
    return { ok: true, path: installIni, scope: 'install', skipped: true };
  }

  let next = ensureKey(content, 'PacketSendRate', TARGET_RATE);
  next = ensureKey(next, 'Port', TARGET_PORT);
  try {
    fs.writeFileSync(installIni, next, 'utf8');
    return { ok: true, path: installIni, scope: 'install' };
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      return tryWriteUserConfig();
    }
    return { ok: false, error: e.code || e.message };
  }
}

module.exports = { autoConfigure };
