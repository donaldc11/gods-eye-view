import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as Cesium from 'cesium';
import {
  getClassColor,
  normalizeDetectionFeature,
  findNewestDetection,
} from './model.js';
import { createSunnyAirDetectionsSource, detectionsUrl } from './source.js';
import { createSunnyAirDetectionsLayer, LAYER_ID } from './index.js';
import {
  _resetRenderGovernorForTest,
  getRenderGovernorDiagnostics,
} from '../../renderGovernor.js';

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
    properties: {
      class: '  Vehicle ',
      confidence: 4,
      t_video: -3,
      ts_utc: 'not-a-date',
    },
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

function overlayHost(entries, calls) {
  return {
    setEntries(_id, next) {
      entries.splice(0, entries.length, ...next);
      calls.push('setEntries');
    },
    setVisible() {
      calls.push('setVisible');
    },
    clearSource() {
      calls.push('clearSource');
    },
  };
}

function mockViewer(flyTo) {
  return {
    dataSources: {
      add() {},
      remove() {},
    },
    scene: {
      canvas: {},
      postRender: {
        addEventListener() {
          return () => {};
        },
      },
    },
    camera: { flyTo },
    flyTo,
  };
}

describe('Sunny Air layer runtime', { concurrency: false }, () => {
  test('lifecycle publishes overlay labels and pulses the newest detection', async () => {
    _resetRenderGovernorForTest();
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
    const viewer = {
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
      camera: { flyTo() {} },
    };

    let seekTime = null;
    const entries = [];
    const layer = createSunnyAirDetectionsLayer({
      source,
      pollIntervalMs: 10000,
      overlayHost: overlayHost(entries, []),
      onVideoSeek(t) {
        seekTime = t;
      },
    });

    layer.init(viewer);
    assert.equal(addedDataSources.length, 1);

    layer.enable();
    assert.equal(await layer.update(), true);

    const stats = layer.getStats();
    assert.equal(stats.count, 1);
    assert.equal(stats.error, null);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'FLAME');
    assert.equal(entries[0].variant, 'label');
    assert.equal(entries[0].details[0], '2026-09-23T14:35:10Z');
    assert.equal(seekTime, null);
    const point = addedDataSources[0].entities.values[0].point;
    assert.notEqual(
      point.heightReference?.getValue?.(),
      Cesium.HeightReference.CLAMP_TO_GROUND,
    );
    assert.equal(
      point.disableDepthTestDistance.getValue(),
      Number.POSITIVE_INFINITY,
    );
    assert.equal(addedDataSources[0].entities.values[0].label, undefined);
    assert.deepEqual(getRenderGovernorDiagnostics().holds, [LAYER_ID]);

    layer.disable();
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    layer.destroy();
    assert.equal(removedDataSources.length, 1);
    _resetRenderGovernorForTest();
  });

  test('failed refresh keeps markers, empty snapshot clears them, duplicate ids collapse', async () => {
    _resetRenderGovernorForTest();
    let mode = 'ok';
    let fetches = 0;
    const source = createSunnyAirDetectionsSource({
      fetchImpl: async () => {
        fetches += 1;
        if (mode === 'fail') {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        if (mode === 'bad-json') {
          return {
            ok: true,
            json: async () => {
              throw new SyntaxError('Unexpected token');
            },
          };
        }
        if (mode === 'empty') {
          return {
            ok: true,
            json: async () => ({ type: 'FeatureCollection', features: [] }),
          };
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
                  properties: {
                    id: 'same',
                    class: 'smoke',
                    lat: 34.67,
                    lon: -118.44,
                    ts_utc: '2026-09-23T14:00:00Z',
                  },
                },
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [400, 10] },
                  properties: { id: 'bad', class: 'flame' },
                },
                {
                  type: 'Feature',
                  geometry: { type: 'Point', coordinates: [-118.45, 34.68] },
                  properties: {
                    id: 'same',
                    class: 'flame',
                    lat: 34.68,
                    lon: -118.45,
                    ts_utc: '2026-09-23T15:00:00Z',
                    summary: 'later',
                    approximate: true,
                  },
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
    const entries = [];
    const calls = [];
    const layer = createSunnyAirDetectionsLayer({
      source,
      pollIntervalMs: 1000,
      overlayHost: overlayHost(entries, calls),
      onVideoSeek() {},
    });
    layer.init({
      ...mockViewer(() => {}),
      dataSources: {
        add(ds) {
          added.push(ds);
        },
        remove() {},
      },
    });

    layer.enable();
    assert.equal(fetches, 0, 'enable must not start its own fetch');
    assert.equal(await layer.update(), true);
    assert.equal(fetches, 1);
    assert.equal(added[0].entities.values.length, 1);
    const point = added[0].entities.values[0].point;
    assert.equal(
      point.disableDepthTestDistance.getValue(),
      Number.POSITIVE_INFINITY,
    );
    assert.notEqual(
      point.heightReference?.getValue?.(),
      Cesium.HeightReference.CLAMP_TO_GROUND,
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'FLAME');
    assert.deepEqual(getRenderGovernorDiagnostics().holds, [LAYER_ID]);

    const keptEntries = entries.slice();
    mode = 'fail';
    assert.equal(await layer.update(), false);
    assert.equal(added[0].entities.values.length, 1);
    assert.match(layer.getStats().error, /503/);
    assert.equal(layer.getStats().count, 1);
    assert.deepEqual(entries, keptEntries);
    assert.deepEqual(getRenderGovernorDiagnostics().holds, [LAYER_ID]);

    mode = 'bad-json';
    assert.equal(await layer.update(), false);
    assert.equal(added[0].entities.values.length, 1);
    assert.match(layer.getStats().error, /Unexpected token/);
    assert.equal(layer.getStats().count, 1);
    assert.deepEqual(entries, keptEntries);

    mode = 'empty';
    assert.equal(await layer.update(), true);
    assert.equal(added[0].entities.values.length, 0);
    assert.equal(layer.getStats().count, 0);
    assert.equal(layer.getStats().error, null);
    assert.deepEqual(entries, []);
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);

    mode = 'dupes';
    assert.equal(await layer.update(), true);
    assert.equal(added[0].entities.values.length, 1);
    assert.equal(added[0].entities.values[0].id, 'sunny-air:same');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'FLAME · approximate site');
    assert.equal(added[0].entities.values[0].label, undefined);
    layer.destroy();
    assert.ok(calls.includes('clearSource'));
    assert.deepEqual(getRenderGovernorDiagnostics().holds, []);
    _resetRenderGovernorForTest();
  });

  test('click frames the detection above terrain and pauses video when the card hides', async () => {
    _resetRenderGovernorForTest();
    const source = createSunnyAirDetectionsSource({
      fetchImpl: async () => ({
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
                alt_m: 50,
                ts_utc: '2026-09-23T14:00:00Z',
                summary: 'Flame',
                video_url: 'https://example.com/evidence.mp4',
                t_video: 3,
              },
            },
          ],
        }),
      }),
    });
    const flights = [];
    const paused = [];
    const videos = [];
    const otherVideos = [{ currentTime: 0 }];
    let clickAction = null;
    const originalSetInputAction =
      Cesium.ScreenSpaceEventHandler.prototype.setInputAction;
    Cesium.ScreenSpaceEventHandler.prototype.setInputAction = function (
      action,
      type,
    ) {
      if (type === Cesium.ScreenSpaceEventType.LEFT_CLICK) clickAction = action;
      return originalSetInputAction.call(this, action, type);
    };
    const previousDocument = globalThis.document;
    const card = {
      id: '',
      className: '',
      style: { display: 'none', cssText: '' },
      innerHTML: '',
      parentNode: { removeChild() {} },
      querySelector(selector) {
        if (selector === 'video') return videos[0] || null;
        if (selector === '#sunny-air-card-close') return { onclick: null };
        return null;
      },
      appendChild(node) {
        videos.push(node);
      },
    };
    globalThis.document = {
      createElement(tag) {
        if (tag === 'video') {
          const video = {
            id: '',
            controls: false,
            style: {},
            pause() {
              paused.push(video);
            },
            addEventListener() {},
            removeEventListener() {},
            getAttribute() {
              return null;
            },
            set src(_value) {},
            load() {},
            readyState: 0,
          };
          return video;
        }
        return card;
      },
      getElementById(id) {
        if (id === 'sunny-air-evidence-video') return videos[0] || null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'video') return otherVideos;
        return [];
      },
      body: { appendChild() {} },
    };
    try {
      const viewer = {
        dataSources: { add() {}, remove() {} },
        scene: {
          canvas: {
            disableRootEvents: true,
            addEventListener() {},
            removeEventListener() {},
          },
          pick() {
            return { id: { id: 'sunny-air:det-1' } };
          },
          postRender: {
            addEventListener() {
              return () => {};
            },
          },
        },
        camera: {
          flyTo(options) {
            flights.push(options);
          },
        },
      };
      const seeks = [];
      const layer = createSunnyAirDetectionsLayer({
        source,
        onVideoSeek(time) {
          seeks.push(time);
        },
      });
      layer.init(viewer);
      layer.enable();
      assert.equal(await layer.update(), true);
      assert.equal(typeof clickAction, 'function');
      clickAction({ position: { x: 1, y: 1 } });
      assert.equal(flights.length, 1);
      const cartographic = Cesium.Cartographic.fromCartesian(
        flights[0].destination,
      );
      assert.ok(Math.abs(cartographic.height - 4050) < 1);
      const framed = [];
      viewer.flyTo = (entity, options) => {
        framed.push({ id: entity?.id, range: options?.offset?.range });
        return Promise.resolve(true);
      };
      clickAction({ position: { x: 2, y: 2 } });
      assert.equal(framed.length, 1);
      assert.equal(framed[0].id, 'sunny-air:det-1');
      assert.equal(framed[0].range, 4000);
      assert.deepEqual(seeks, [3, 3]);
      assert.equal(otherVideos[0].currentTime, 0);
      assert.equal(videos.length, 1);
      layer.disable();
      assert.equal(paused.length, 1);
      assert.equal(card.style.display, 'none');
      layer.destroy();
    } finally {
      Cesium.ScreenSpaceEventHandler.prototype.setInputAction =
        originalSetInputAction;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      _resetRenderGovernorForTest();
    }
  });
});
