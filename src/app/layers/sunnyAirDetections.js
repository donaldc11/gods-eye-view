import {
  createSunnyAirDetectionsLayer,
  createSunnyAirDetectionsSource,
} from '../../layers/sunnyAirDetections/index.js';
import { overlayHost } from './overlayHost.js';

export function createApplicationSunnyAirDetections(options = {}) {
  const source = options.source || createSunnyAirDetectionsSource(options);
  return createSunnyAirDetectionsLayer({ ...options, source, overlayHost });
}
