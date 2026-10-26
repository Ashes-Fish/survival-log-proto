// Audio (M8): plays sounds decoded from the original FMOD banks
// (tools/assets/export-audio.py + encode-audio.mjs). FMOD event graphs (layering,
// parameters, randomisation) are not reproduced: an event path plays the subsound with
// the same name as its last segment (INFERRED mapping, see audio-manifest.json).
export function createAudio({base = '../world/'} = {}) {
  let manifest = null;
  let ctx = null;
  let musicEl = null;
  let musicName = null;
  const buffers = new Map();
  let volume = {music: 0.35, sfx: 0.8};
  const ready = fetch(base + 'assets/audio/audio-manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => { manifest = m; }).catch(() => {});
  const played = [];

  // Browsers block audio until a user gesture; resume on the first one.
  const unlock = () => { ctx ??= new AudioContext(); ctx.resume?.(); if (musicEl && musicEl.paused) musicEl.play().catch(() => {}); };
  addEventListener('pointerdown', unlock, {once: false});
  addEventListener('keydown', unlock, {once: false});

  const resolve = (path) => {
    if (!manifest || !path) return null;
    const name = String(path).split('/').pop();
    return manifest.sounds[name] ?? manifest.music[name] ?? null;
  };

  async function play(path, {gain = 1} = {}) {
    await ready;
    const rel = resolve(path);
    played.push({path, resolved: Boolean(rel)});
    if (played.length > 100) played.shift();
    if (!rel) return false;
    try {
      ctx ??= new AudioContext();
      if (!buffers.has(rel)) buffers.set(rel, fetch(base + rel.replace(/^\.\//, '')).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)));
      const buffer = await buffers.get(rel);
      const node = ctx.createBufferSource();
      const g = ctx.createGain();
      g.gain.value = volume.sfx * gain;
      node.buffer = buffer; node.connect(g).connect(ctx.destination); node.start();
      return true;
    } catch { return false; }
  }

  async function music(path) {
    await ready;
    const name = path ? String(path).split('/').pop() : null;
    if (name === musicName) return;
    musicName = name;
    musicEl?.pause();
    const rel = resolve(path);
    if (!rel) { musicEl = null; return; }
    musicEl = new Audio(base + rel.replace(/^\.\//, ''));
    musicEl.loop = true;
    musicEl.volume = volume.music;
    musicEl.play().catch(() => {});
  }

  return {
    ready,
    play,
    music,
    // Scene music: chapter BgFmod for home; Config_MapPoint has no music field, so
    // exploration maps use the chapter's exploration BGM (Chapter 1000+ BgFmod).
    playScene(desc, session) {
      const chapterBgm = desc.id >= 1000 ? 'event:/BGM/SurvivalLog_AfterDisaster' : 'event:/BGM/SurvivalLog_AfterDisaster_B';
      music(chapterBgm);
    },
    playFunction(funcId, T) {
      const func = T.func.get(funcId);
      const action = T.action.get(func?.ActionIds?.[0]);
      if (action?.FmodPath) play(action.FmodPath);
    },
    playAction(actionId, T) { const a = T.action.get(actionId); if (a?.FmodPath) play(a.FmodPath); },
    // Config_Player.DeadFmod of the current role (e.g. .../Death/HumanDeathYoung).
    playDeath(path = 'event:/Battle/Model/Human/Death/HumanDeathYoung') { play(path); music(null); },
    setVolume(next) { volume = {...volume, ...next}; if (musicEl) musicEl.volume = volume.music; },
    stats: () => ({loaded: Boolean(manifest), sounds: manifest ? Object.keys(manifest.sounds).length : 0, music: manifest ? Object.keys(manifest.music).length : 0, current: musicName, recent: played.slice(-10)}),
  };
}
