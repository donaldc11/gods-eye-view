export function getClassColor(className) {
  const normalized = String(className || '').toLowerCase().trim();
  switch (normalized) {
    case 'flame':
      return { r: 1.0, g: 0.15, b: 0.15, css: '#ff2626' }; // flame red
    case 'smoke':
      return { r: 0.65, g: 0.65, b: 0.65, css: '#a6a6a6' }; // smoke gray
    case 'person':
      return { r: 1.0, g: 0.85, b: 0.1, css: '#ffd91a' }; // person yellow
    case 'vehicle':
      return { r: 0.2, g: 0.5, b: 1.0, css: '#3380ff' }; // vehicle blue
    default:
      return { r: 0.8, g: 0.8, b: 0.8, css: '#cccccc' };
  }
}

export function normalizeDetectionFeature(feature) {
  if (!feature || feature.type !== 'Feature') return null;
  const props = feature.properties || {};
  const geom = feature.geometry;

  let lon = Number(props.lon);
  let lat = Number(props.lat);
  if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
    lon = Number(geom.coordinates[0]);
    lat = Number(geom.coordinates[1]);
  }
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const id = String(props.id || `det-${Math.random().toString(36).substring(2, 9)}`);
  const cls = String(props.class || 'smoke').toLowerCase().trim();
  const confidence = Number.isFinite(Number(props.confidence)) ? Number(props.confidence) : 0.5;
  const tVideo = Number.isFinite(Number(props.t_video)) ? Number(props.t_video) : 0;
  const tsUtc = String(props.ts_utc || new Date().toISOString());
  const altM = Number.isFinite(Number(props.alt_m)) ? Number(props.alt_m) : 0;
  const headingDeg = Number.isFinite(Number(props.heading_deg)) ? Number(props.heading_deg) : 0;
  const source = String(props.source || 'Sunny Air Detections');
  const frameUrl = props.frame_url ? String(props.frame_url) : null;
  const summary = String(props.summary || `${cls} detected`);

  return {
    id,
    class: cls,
    confidence,
    t_video: tVideo,
    ts_utc: tsUtc,
    lat,
    lon,
    alt_m: altM,
    heading_deg: headingDeg,
    source,
    frame_url: frameUrl,
    summary,
  };
}

export function findNewestDetection(detections) {
  if (!Array.isArray(detections) || detections.length === 0) return null;
  let newest = null;
  let maxTime = -Infinity;
  for (const det of detections) {
    const time = new Date(det.ts_utc).getTime();
    const validTime = Number.isFinite(time) ? time : 0;
    if (validTime > maxTime) {
      maxTime = validTime;
      newest = det;
    }
  }
  return newest;
}
