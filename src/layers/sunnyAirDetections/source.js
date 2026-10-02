import { normalizeDetectionFeature } from './model.js';

const DEFAULT_URL = '/detections.geojson';

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
      if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
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
