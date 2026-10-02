# Traffic Safety Watch build and deployment

This is a packaging plan, not a completed deployment.

## API adapter

Keep VSS_URL, VSS_USERNAME, VSS_PASSWORD in a Kubernetes Secret. Authenticate server-side at `/api/v1/auth/login`; cache the JWT, re-authenticate on 401. Never send the password or raw JWT to the globe. Expose same-origin media proxy routes using opaque event IDs.

1. Inspect `/metadata/schema`, `/metadata/values?field=camera_id`, `/videos/explore`, and `/dashboard/stats`. Select available highway videos, not guessed corpus content.
2. On explicit user query, call `/search` with top_k 15, min_similarity 0.3, time_filter all; optionally call `/agent/search-and-answer` for evidence-backed assessment.
3. Inspect hit metadata and `/videos/detections?source=...` to verify actual field names. Keep detector confidence separate from semantic similarity. Do not call a near miss confirmed from proximity alone.
4. Convert verified hits into GeoJSON. Stable ID from source + detection/frame ID. Point coordinates `[lon,lat]` must be verified camera coordinates or clearly marked approximate site coordinates. Omit unlocated hits from map, but keep them in evidence list. `ts_utc` stays null unless the capture timestamp is known. `t_video` is relative to the media served: parent timing for parent media, segment-relative timing for a segment.
5. GeoJSON properties: id, class, confidence (nullable), similarity_score, t_video (nullable), ts_utc (nullable), lat, lon, camera_id, location, approximate, original_video, source, summary, video_url (same-origin proxy), frame_url (optional verified frame).
6. Serve last query snapshot from `/detections.geojson`; its 2-second frontend polling reads cached JSON only, never triggers model calls. Default is empty. A failed query shows an error, never stock fire footage.

## Packaging

The organizer deployment recipe uses the team's existing host with Ingress `/app` rewritten to `/`. Work only in the assigned namespace. Do not redeploy DataEngine.

This repository requires Node >=24.14.0 <25 or >=26 <27. Verify the exact public image version in the lab; do not use Node 22. The repository and Cesium assets do not fit a ~1 MiB ConfigMap. Put only bootstrap/adapter code and small configuration there.

Candidate route (requires testing in the lab): public compatible Node image, initContainer clones a pinned approved public commit into an emptyDir and runs npm ci + npm run build -- --base=/app/. Skip Puppeteer downloads if not using browser tests. Serve built assets plus adapter using a production HTTP server, not Vite dev server. Use a separate public image for adapter if needed, or one compatible Node adapter. No Docker build/push needed. Verify outbound GitHub/npm access and pod resource limits before committing to this route. If unavailable, ask organizers for an approved PVC/static asset upload route.

Assets must load from `/app/`; same-origin fetches including detections and media use the same base. Verify Cesium Workers/Assets/Widgets paths in actual browser network requests, since plugin paths may need adjustment. Many other globe layers use absolute APIs; disable unrelated layers in this focused demo rather than proxying the entire world-feed stack.

## Submission draft (not submitted)

# TEAM NUMBER TO VERIFY FROM VM

## Project
Traffic Safety Watch lets operators search indexed highway footage in plain language, inspect camera-site events on a globe, and review timestamped video evidence with a safety assessment.

**Stack:** God's Eye View, Cesium, VAST VSS/DataEngine/VastDB, Cosmos Reason/Embed, YOLO; add W&B only if actually used.
**Code:** TO CONFIRM
**Live app:** TO VERIFY
**Supplementary:** none

## Feedback
TO COLLECT FROM TEAM

Confirm final description against implemented behavior. Prepare SUBMISSION.md with the organizer workflow and ask staff for the actual submission destination. Nothing here claims live deployment or submitted entry.
