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

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeDetectionFeature(feature) {
  if (!feature || feature.type !== 'Feature') return null;
  const props = feature.properties || {};
  const coords = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : [];
  const lon = optionalNumber(props.lon) ?? optionalNumber(coords?.[0]);
  const lat = optionalNumber(props.lat) ?? optionalNumber(coords?.[1]);
  if (lon === null || lat === null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const tVideo = optionalNumber(props.t_video);
  // Derived identity is repeatable across snapshots; never invent random events.
  const identity = [props.source, props.original_video, props.camera_id, tVideo, props.class, lon, lat];
  const id = String(props.id || `det:${JSON.stringify(identity)}`);
  const confidence = optionalNumber(props.confidence);
  const rawTimestamp = props.ts_utc;
  const tsUtc = rawTimestamp && Number.isFinite(Date.parse(rawTimestamp)) ? String(rawTimestamp) : null;
  return {
    ...props,
    id,
    class: String(props.class || 'unknown').toLowerCase().trim(),
    confidence: confidence !== null && confidence >= 0 && confidence <= 1 ? confidence : null,
    t_video: tVideo !== null && tVideo >= 0 ? tVideo : null,
    ts_utc: tsUtc,
    lat, lon,
    alt_m: optionalNumber(props.alt_m) ?? 0,
    heading_deg: optionalNumber(props.heading_deg),
    source: String(props.source || 'Video archive'),
    frame_url: props.frame_url ? String(props.frame_url) : null,
    video_url: props.video_url ? String(props.video_url) : null,
    camera_id: props.camera_id ?? null,
    location: props.location ?? null,
    approximate: props.approximate === true,
    summary: String(props.summary || 'Video evidence'),
  };
}

export function findNewestDetection(detections) {
  if (!Array.isArray(detections) || detections.length === 0) return null;
  let newest = null;
  let maxTime = -Infinity;
  for (const det of detections) {
    if (!det.ts_utc) continue;
    const time = new Date(det.ts_utc).getTime();
    if (!Number.isFinite(time)) continue;
    const validTime = time;
    if (validTime > maxTime) {
      maxTime = validTime;
      newest = det;
    }
  }
  return newest;
}
