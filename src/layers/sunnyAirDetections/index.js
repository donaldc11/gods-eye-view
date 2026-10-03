import * as Cesium from 'cesium';
import { createSunnyAirDetectionsSource } from './source.js';
import { getClassColor, findNewestDetection } from './model.js';
import { loadEvidenceVideo } from './video.js';
import { registerPickOwner, unregisterPickOwner } from '../../data/pickRegistry.js';

export { createSunnyAirDetectionsSource } from './source.js';
export * from './model.js';

export const LAYER_ID = 'sunny-air-detections';

export function createSunnyAirDetectionsLayer({
  source = createSunnyAirDetectionsSource(),
  pollIntervalMs = 2000,
  onVideoSeek = null,
} = {}) {
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _intervalId = null;
  let _request = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _records = [];
  let _selectedRecord = null;
  let _newestId = null;
  let _postRenderRemove = null;
  let _clickHandler = null;
  let _cardElement = null;

  function ensureCardElement() {
    if (_cardElement) return _cardElement;
    if (typeof globalThis.document === 'undefined') return null;
    _cardElement = document.createElement('div');
    _cardElement.id = 'sunny-air-detection-card';
    _cardElement.className = 'sunny-air-card';
    _cardElement.style.cssText = `
      position: absolute;
      top: 80px;
      right: 20px;
      z-index: 150;
      width: 280px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      padding: 12px;
      color: #f8fafc;
      font-family: monospace, sans-serif;
      font-size: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      display: none;
    `;
    document.body.appendChild(_cardElement);
    return _cardElement;
  }

  function hideCard() {
    if (_cardElement) {
      _cardElement.style.display = 'none';
    }
  }

  function showCard(record) {
    const card = ensureCardElement();
    if (!card) return;
    const colorInfo = getClassColor(record.class);
    const confidencePct = record.confidence === null ? 'unknown' : `${Math.round(record.confidence * 100)}%`;
    const escape = (value) => String(value ?? 'unknown').replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

    let frameHtml = '';
    if (record.frame_url) {
      frameHtml = `<div style="margin-top: 8px;"><img src="${escape(record.frame_url)}" alt="Frame" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15);" /></div>`;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">
        <span style="font-weight: bold; text-transform: uppercase; color: ${colorInfo.css};">${escape(record.class)}</span>
        <button id="sunny-air-card-close" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; line-height: 1;">&times;</button>
      </div>
      <div style="margin-bottom: 4px; color: #cbd5e1; font-size: 11px;">${escape(record.summary)}${record.approximate ? " (approximate site location)" : ""}</div>
      <div style="display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; margin-top: 6px;">
        <span>Confidence: <strong style="color: #f1f5f9;">${confidencePct}</strong></span>
        <span>t_video: <strong style="color: #f1f5f9;">${record.t_video === null ? 'unknown' : `${record.t_video}s`}</strong></span>
      </div>
      <div style="font-size: 10px; color: #64748b; margin-top: 4px;">TS: ${escape(record.ts_utc)}</div>
      ${frameHtml}
    `;
    card.style.display = 'block';

    const closeBtn = card.querySelector('#sunny-air-card-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        hideCard();
      };
    }
  }

  function handleEntityClick(record) {
    if (!record) return;
    _selectedRecord = record;

    // 1. Fly camera to entity
    if (_viewer && _viewer.camera) {
      const position = Cesium.Cartesian3.fromDegrees(
        record.lon,
        record.lat,
        Math.max(record.alt_m || 0, 0) + 200,
      );
      _viewer.camera.flyTo({
        destination: position,
        duration: 1.5,
      });
    }

    // 2. Show click card with summary, confidence, frame_url
    showCard(record);

    // Seek side-panel HTML video to properties.t_video & invoke callback
    if (typeof record.t_video === 'number') {
      if (typeof globalThis.document !== 'undefined') {
        const videoElements = document.querySelectorAll('video');
        videoElements.forEach((video) => {
          try {
            video.currentTime = record.t_video;
          } catch (_) {}
        });
      }
      if (typeof onVideoSeek === 'function') {
        try {
          onVideoSeek(record.t_video, record);
        } catch (_) {}
      }
    } else if (typeof onVideoSeek === 'function') {
      onVideoSeek(record.t_video, record);
    }

    if (record.video_url && typeof globalThis.document !== 'undefined') {
      let video = document.getElementById('sunny-air-evidence-video');
      if (!video) {
        video = document.createElement('video');
        video.id = 'sunny-air-evidence-video';
        video.controls = true;
        video.style.cssText = 'width:100%;margin-top:8px;max-height:180px';
        ensureCardElement()?.appendChild(video);
      }
      loadEvidenceVideo(video, record);
    }
  }

  function installClickHandler(viewer) {
    if (_clickHandler || !viewer?.scene?.canvas) return;
    if (typeof globalThis.document === 'undefined') return;
    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled || !_dataSource) return;
      const picked = viewer.scene.pick(click.position);
      if (!picked || !picked.id) return;

      const entity = picked.id;
      if (typeof entity.id === 'string' && entity.id.startsWith('sunny-air:')) {
        const detId = entity.id.replace('sunny-air:', '');
        const record = _records.find((r) => String(r.id) === detId);
        if (record) {
          handleEntityClick(record);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  async function fetchAndUpdate() {
    if (!_enabled || !_dataSource) return;
    _request?.abort();
    const request = new AbortController();
    _request = request;

    try {
      const records = await source.getSnapshot({ signal: request.signal });
      if (request.signal.aborted || _request !== request || !_enabled) return;

      _records = records;
      _count = records.length;
      _lastUpdate = Date.now();
      _lastError = null;

      const newest = findNewestDetection(records);
      _newestId = newest ? newest.id : null;

      _dataSource.entities.removeAll();

      for (const rec of records) {
        const colorInfo = getClassColor(rec.class);
        const cesiumColor = new Cesium.Color(colorInfo.r, colorInfo.g, colorInfo.b, 1.0);
        const position = Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat, rec.alt_m || 0);

        const isNewest = String(rec.id) === String(_newestId);

        const entityOptions = {
          id: `sunny-air:${rec.id}`,
          position,
          point: {
            pixelSize: isNewest ? 14 : 10,
            color: cesiumColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          label: {
            text: `${rec.class.toUpperCase()}\n${rec.ts_utc || 'capture time unknown'}${rec.approximate ? '\napproximate site' : ''}`,
            font: '11px monospace',
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            showBackground: true,
            backgroundColor: new Cesium.Color(0.1, 0.1, 0.1, 0.7),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -12),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
          properties: { ...rec },
        };

        _dataSource.entities.add(new Cesium.Entity(entityOptions));
      }
    } catch (err) {
      if (request.signal.aborted || _request !== request || !_enabled) return;
      _lastError = err?.message || 'Failed to fetch detections';
      _records = [];
      _count = 0;
      _newestId = null;
      _dataSource?.entities.removeAll();
      hideCard();
    } finally {
      if (_request === request) _request = null;
    }
  }

  const layer = {
    id: LAYER_ID,
    name: 'Sunny Air Detections',
    icon: '🚁',
    source: 'Sunny Air / Detections',
    updateInterval: pollIntervalMs,

    init(viewer) {
      if (_viewer) throw new Error('Sunny Air Detections layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('sunny-air-detections');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);

      installClickHandler(viewer);

      // Pulsing animation for newest detection
      _postRenderRemove = viewer.scene.postRender?.addEventListener(() => {
        if (!_enabled || !_dataSource || !_newestId) return;
        const entity = _dataSource.entities.getById(`sunny-air:${_newestId}`);
        if (!entity || !entity.point) return;

        const time = Date.now() / 1000;
        const pulse = 0.5 + 0.5 * Math.sin(time * 6); // Oscillation between 0 and 1
        const colorInfo = getClassColor(entity.properties?.class?.getValue?.() || 'unknown');
        entity.point.color = new Cesium.Color(
          colorInfo.r,
          colorInfo.g,
          colorInfo.b,
          0.4 + 0.6 * pulse,
        );
        entity.point.pixelSize = 12 + Math.floor(6 * pulse);
      });
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      registerPickOwner(LAYER_ID, (id) => typeof id === 'string' && id.startsWith('sunny-air:'));

      fetchAndUpdate();
      if (_intervalId) clearInterval(_intervalId);
      _intervalId = setInterval(fetchAndUpdate, pollIntervalMs);
    },

    disable() {
      _enabled = false;
      if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
      }
      _request?.abort();
      _request = null;
      if (_dataSource) _dataSource.show = false;
      unregisterPickOwner(LAYER_ID);
      hideCard();
    },

    update() {
      return fetchAndUpdate();
    },

    destroy(viewer = _viewer) {
      this.disable();
      if (_postRenderRemove) {
        _postRenderRemove();
        _postRenderRemove = null;
      }
      if (_clickHandler) {
        _clickHandler.destroy();
        _clickHandler = null;
      }
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      if (_cardElement && _cardElement.parentNode) {
        _cardElement.parentNode.removeChild(_cardElement);
        _cardElement = null;
      }
      _viewer = null;
      _records = [];
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _count,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };

  return layer;
}
