import assert from 'node:assert/strict';
import test from 'node:test';
import { getClassColor, normalizeDetectionFeature, findNewestDetection } from './model.js';
import { createSunnyAirDetectionsSource, detectionsUrl } from './source.js';
import { createSunnyAirDetectionsLayer } from './index.js';

test('getClassColor maps classes to expected color representations', () => {
  assert.equal(getClassColor('flame').css, '#ff2626');
  assert.equal(getClassColor('smoke').css, '#a6a6a6');
  assert.equal(getClassColor('person').css, '#ffd91a');
  assert.equal(getClassColor('vehicle').css, '#3380ff');
  assert.equal(getClassColor('unknown').css, '#cccccc');
});

test('normalizeDetectionFeature normalizes GeoJSON feature properties', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-118.4451, 34.6782, 1120.0] },
    properties: {
      id: 'test-1',
      class: 'flame',
      confidence: 0.95,
      t_video: 42.5,
      ts_utc: '2026-09-23T14:35:10Z',
      lat: 34.6782,
      lon: -118.4451,
      alt_m: 1120.0,
      source: 'Test Drone',
      frame_url: 'https://example.com/frame.jpg',
      summary: 'Flame front detected',
    },
  };
  const norm = normalizeDetectionFeature(feature);
  assert.equal(norm.id, 'test-1');
  assert.equal(norm.class, 'flame');
  assert.equal(norm.confidence, 0.95);
  assert.equal(norm.t_video, 42.5);
  assert.equal(norm.ts_utc, '2026-09-23T14:35:10Z');
  assert.equal(norm.lat, 34.6782);
  assert.equal(norm.lon, -118.4451);
  assert.equal(norm.alt_m, 1120.0);
  assert.equal(norm.summary, 'Flame front detected');
});

test('normalizeDetectionFeature drops impossible coordinates and out-of-range confidence', () => {
  assert.equal(
    normalizeDetectionFeature({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [400, 34] },
      properties: { class: 'flame' },
    }),
    null,
  );
  const loose = normalizeDetectionFeature({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-118.4, 34.6] },
    properties: { class: '  Vehicle ', confidence: 4, t_video: -3, ts_utc: 'not-a-date' },
  });
  assert.equal(loose.class, 'vehicle');
  assert.equal(loose.confidence, null);
  assert.equal(loose.t_video, null);
  assert.equal(loose.ts_utc, null);
});

test('detectionsUrl joins a base path with or without a trailing slash', () => {
  assert.equal(detectionsUrl('/'), '/detections.geojson');
  assert.equal(detectionsUrl('/gev'), '/gev/detections.geojson');
  assert.equal(detectionsUrl('/gev/'), '/gev/detections.geojson');
  assert.equal(detectionsUrl(''), '/detections.geojson');
});

test('findNewestDetection identifies feature with highest ts_utc', () => {
  const detections = [
    { id: '1', ts_utc: '2026-09-23T14:25:30Z' },
    { id: '2', ts_utc: '2026-09-23T14:35:10Z' },
    { id: '3', ts_utc: '2026-09-23T14:30:00Z' },
  ];
  const newest = findNewestDetection(detections);
  assert.equal(newest.id, '2');
});

test('createSunnyAirDetectionsSource fetches and normalizes GeoJSON snapshot', async () => {
  const mockGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-118.44, 34.67] },
        properties: {
          id: 'det-1',
          class: 'smoke',
          confidence: 0.85,
          t_video: 10,
          ts_utc: '2026-09-23T14:00:00Z',
          lat: 34.67,
          lon: -118.44,
          source: 'Mock Air',
          summary: 'Smoke plume',
        },
      },
    ],
  };

  const source = createSunnyAirDetectionsSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => mockGeoJson,
    }),
  });

  const records = await source.getSnapshot();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'det-1');
  assert.equal(records[0].class, 'smoke');
});

test('SunnyAirDetections layer lifecycle, polling, and entity creation', async () => {
  const mockGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-118.4451, 34.6782] },
        properties: {
          id: 'det-1',
          class: 'flame',
          confidence: 0.9,
          t_video: 25.5,
          ts_utc: '2026-09-23T14:35:10Z',
          lat: 34.6782,
          lon: -118.4451,
          source: 'Recon AI',
          summary: 'Flame front',
        },
      },
    ],
  };

  const source = createSunnyAirDetectionsSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => mockGeoJson,
    }),
  });

  const addedDataSources = [];
  const removedDataSources = [];

  const mockViewer = {
    dataSources: {
      add(ds) {
        addedDataSources.push(ds);
      },
      remove(ds) {
        removedDataSources.push(ds);
      },
    },
    scene: {
      canvas: {},
      postRender: {
        addEventListener() {
          return () => {};
        },
      },
    },
    camera: {
      flyTo() {},
    },
  };

  let seekTime = null;
  const layer = createSunnyAirDetectionsLayer({
    source,
    pollIntervalMs: 10000,
    onVideoSeek(t) {
      seekTime = t;
    },
  });

  layer.init(mockViewer);
  assert.equal(addedDataSources.length, 1);

  layer.enable();
  await layer.update();

  const stats = layer.getStats();
  assert.equal(stats.count, 1);
  assert.equal(stats.error, null);

  layer.disable();
  layer.destroy();
  assert.equal(removedDataSources.length, 1);
});

test('failed refresh keeps markers, empty snapshot clears them, duplicate ids collapse', async () => {
  let mode = 'ok';
  let fetches = 0;
  const source = createSunnyAirDetectionsSource({
    fetchImpl: async () => {
      fetches += 1;
      if (mode === 'fail') {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      if (mode === 'empty') {
        return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) };
      }
      if (mode === 'dupes') {
        return {
          ok: true,
          json: async () => ({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-118.44, 34.67] },
                properties: { id: 'same', class: 'smoke', lat: 34.67, lon: -118.44, ts_utc: '2026-09-23T14:00:00Z' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [400, 10] },
                properties: { id: 'bad', class: 'flame' },
              },
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-118.45, 34.68] },
                properties: { id: 'same', class: 'flame', lat: 34.68, lon: -118.45, ts_utc: '2026-09-23T15:00:00Z', summary: 'later' },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [-118.44, 34.67] },
              properties: {
                id: 'det-1',
                class: 'flame',
                lat: 34.67,
                lon: -118.44,
                ts_utc: '2026-09-23T14:00:00Z',
                summary: 'Flame',
              },
            },
          ],
        }),
      };
    },
  });

  const added = [];
  const layer = createSunnyAirDetectionsLayer({
    source,
    pollIntervalMs: 1000,
    onVideoSeek() {},
  });
  layer.init({
    dataSources: {
      add(ds) { added.push(ds); },
      remove() {},
    },
    scene: { canvas: {}, postRender: { addEventListener() { return () => {}; } } },
    camera: { flyTo() {} },
  });

  layer.enable();
  assert.equal(fetches, 0, 'enable must not start its own fetch');
  assert.equal(await layer.update(), true);
  assert.equal(fetches, 1);
  assert.equal(added[0].entities.values.length, 1);
  const point = added[0].entities.values[0].point;
  assert.equal(point.disableDepthTestDistance.getValue(), Number.POSITIVE_INFINITY);

  mode = 'fail';
  assert.equal(await layer.update(), false);
  assert.equal(added[0].entities.values.length, 1);
  assert.match(layer.getStats().error, /503/);
  assert.equal(layer.getStats().count, 1);

  mode = 'empty';
  assert.equal(await layer.update(), true);
  assert.equal(added[0].entities.values.length, 0);
  assert.equal(layer.getStats().count, 0);
  assert.equal(layer.getStats().error, null);

  mode = 'dupes';
  assert.equal(await layer.update(), true);
  assert.equal(added[0].entities.values.length, 1);
  assert.equal(added[0].entities.values[0].id, 'sunny-air:same');
  layer.destroy();
});
