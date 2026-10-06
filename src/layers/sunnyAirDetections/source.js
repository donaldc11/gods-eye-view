import { normalizeDetectionFeature } from './model.js';

export function detectionsUrl(base = import.meta.env?.BASE_URL || '/') {
  const root = base || '/';
  return `${root.endsWith('/') ? root : `${root}/`}detections.geojson`;
}
const DEFAULT_URL = detectionsUrl();

export function createSunnyAirDetectionsSource({
  url = DEFAULT_URL,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(url, { signal });
      if (!response.ok) {
        throw new Error(`Detections HTTP ${response.status}`);
      }
      const data = await response.json();
      signal?.throwIfAborted();
      if (
        !data ||
        data.type !== 'FeatureCollection' ||
        !Array.isArray(data.features)
      ) {
        throw new Error('Invalid GeoJSON FeatureCollection response');
      }
      const records = [];
      for (const feature of data.features) {
        const normalized = normalizeDetectionFeature(feature);
        if (normalized) {
          records.push(normalized);
        }
      }
      return records;
    },
  };
}
