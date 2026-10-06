export function loadEvidenceVideo(video, record) {
  if (!record.video_url) return;
  if (video._evidenceLoaded)
    video.removeEventListener('loadedmetadata', video._evidenceLoaded);
  const seek = () => {
    if (record.t_video !== null && Number.isFinite(record.t_video)) {
      video.currentTime = Math.min(
        record.t_video,
        Number.isFinite(video.duration) ? video.duration : record.t_video,
      );
    }
  };
  video._evidenceLoaded = seek;
  if (video.getAttribute('src') === record.video_url && video.readyState >= 1)
    seek();
  else {
    video.addEventListener('loadedmetadata', seek, { once: true });
    video.src = record.video_url;
    video.load();
  }
}
