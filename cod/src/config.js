// Global tunables. Query-string overrides let the screenshot harness pin things down.
const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);

export const CONFIG = {
  seed: num('seed', 20260728),
  fov: num('fov', 80),
  adsFov: num('adsfov', 55),
  pixelRatioCap: num('dpr', 2),
  shadowMapSize: num('shadow', 2048),
  // deterministic capture mode: no pointer lock, camera driven by a named pose
  shot: q.get('shot'),          // pose name, e.g. "street"
  shotFrames: num('frames', 60), // fixed-step frames simulated before the capture is taken
  quality: q.get('q') || 'ultra',
  debug: q.has('debug'),
};
