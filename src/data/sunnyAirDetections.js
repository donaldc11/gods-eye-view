import {
  createSunnyAirDetectionsSource,
  createSunnyAirDetectionsLayer,
} from '../layers/sunnyAirDetections/index.js';
export * from '../layers/sunnyAirDetections/index.js';

export function createSunnyAirDetections(options = {}) {
  const source = options.source || createSunnyAirDetectionsSource(options);
  return createSunnyAirDetectionsLayer({ source, ...options });
}

export default createSunnyAirDetections();
