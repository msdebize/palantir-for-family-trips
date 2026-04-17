import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as turf from '@turf/turf'
import { ChevronDown, ChevronUp, Cloud, CloudRain, Layers3, Sun } from 'lucide-react'
import { isLiveExternalDataEnabled } from './publishConfig'
import { DAYS, TIME_SLOTS } from './tripData'
import { getRouteDurationSlotSpan, parseEntityKey } from './tripModel'
import { fetchWikimediaPhotos } from './wikimediaPhotos'

// ---------------------------------------------------------------------------
// MapLibre + OpenFreeMap + OSRM + Turf stack (replaces Google Maps entirely).
// OpenFreeMap styles: liberty | positron | bright | fiord. Using "liberty"
// for a dark-friendly canvas that harmonises with the Palantir theme.
// ---------------------------------------------------------------------------
const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving'

// Short-lived OSRM response cache and throttle to respect the demo server policy.
const osrmCache = new Map()
let osrmLastRequestAt = 0
const OSRM_MIN_GAP_MS = 1100 // <= 1 req/s

// ---------------------------------------------------------------------------
// Nominatim (OpenStreetMap) — free, key-less geocoder replacing Google Places.
// Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   * Max 1 request/second (we enforce 1.1 s gap as a safety margin).
//   * Descriptive User-Agent required (browsers attach their own UA, so the
//     header is informative only here; it is still declared for proxies).
//   * No bulk geocoding — we only run interactive hydration at mount time.
//   * Aggressive caching (7-day TTL in-memory + persisted in localStorage).
// ---------------------------------------------------------------------------
// Default is our same-origin Traefik proxy at /_proxy/nominatim — sidesteps
// CORS and lets us inject a proper User-Agent on the server side.
const NOMINATIM_BASE = import.meta.env.VITE_NOMINATIM_BASE || '/_proxy/nominatim'
const NOMINATIM_USER_AGENT = 'palantir-trip-command/1.0 (self-hosted pLim deployment)'
const NOMINATIM_MIN_GAP_MS = 1100 // respect 1 req/s policy with a 100 ms margin
const NOMINATIM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const NOMINATIM_CACHE_STORAGE_KEY = 'palantir-trip:nominatim-cache:v1'

const nominatimCache = new Map() // query -> { data, ts }
let nominatimLastRequestAt = 0

// Best-effort rehydrate the cache from localStorage so reloads don't re-hit
// the public endpoint. Silently ignore storage errors (SSR, private mode).
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const raw = window.localStorage.getItem(NOMINATIM_CACHE_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => {
          if (value && typeof value.ts === 'number' && Date.now() - value.ts < NOMINATIM_CACHE_TTL_MS) {
            nominatimCache.set(key, value)
          }
        })
      }
    }
  }
} catch {
  /* ignore cache hydrate errors */
}

function persistNominatimCache() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const snapshot = {}
    nominatimCache.forEach((value, key) => {
      snapshot[key] = value
    })
    window.localStorage.setItem(NOMINATIM_CACHE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* ignore cache persist errors */
  }
}

async function fetchNominatim(query) {
  if (!query || typeof query !== 'string') return null
  const key = query.trim().toLowerCase()
  if (!key) return null

  const cached = nominatimCache.get(key)
  if (cached && Date.now() - cached.ts < NOMINATIM_CACHE_TTL_MS) return cached.data

  const gap = Date.now() - nominatimLastRequestAt
  if (gap < NOMINATIM_MIN_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_GAP_MS - gap))
  }
  nominatimLastRequestAt = Date.now()

  try {
    const url = `${NOMINATIM_BASE}/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      // Browsers block setting User-Agent, but we declare intent anyway so a
      // self-hosted proxy or a Node-based test runner can honour it.
      headers: { Accept: 'application/json', 'X-App-User-Agent': NOMINATIM_USER_AGENT },
    })
    if (!response.ok) throw new Error(`nominatim ${response.status}`)
    const arr = await response.json()
    const data = Array.isArray(arr) && arr.length ? arr[0] : null
    nominatimCache.set(key, { data, ts: Date.now() })
    persistNominatimCache()
    return data
  } catch (error) {
    console.warn('[TripCommand] Nominatim lookup failed:', error?.message || error)
    return null
  }
}

const TONE_COLORS = {
  info: '#58A6FF',
  warning: '#D29922',
  success: '#3FB950',
  critical: '#F85149',
  violet: '#A371F7',
  muted: '#8B949E',
}

const SPEED_REDUCTION_FACTOR = 0.75
const MIN_ROUTE_LOOP_SECONDS = 16
const MAX_ROUTE_LOOP_SECONDS = 34
const LIVE_EXTERNAL_DATA = isLiveExternalDataEnabled()
const SKIP_DEPRECATED_OSRM_IN_DEV = import.meta.env.VITE_DISABLE_LEGACY_GOOGLE_ROUTING === 'true'
const WEATHER_ICONS = {
  sun: Sun,
  partly: Cloud,
  cloud: Cloud,
  rain: CloudRain,
  storm: CloudRain,
  fog: Cloud,
  wind: Cloud,
  snow: Cloud,
}

// Shorthand: {lat, lng} object  ->  [lng, lat] array for turf / MapLibre.
const ll = (p) => (Array.isArray(p) ? p : [p.lng, p.lat])
const toLngLat = (p) => (Array.isArray(p) ? { lng: p[0], lat: p[1] } : p)

function formatDurationText(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return ''

  const totalMinutes = Math.round(totalSeconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${totalMinutes} min`
  if (!minutes) return `${hours} hr${hours === 1 ? '' : 's'}`
  return `${hours} hr ${minutes} min`
}

function formatDistanceText(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return ''

  const miles = distanceMeters / 1609.344
  const decimals = miles >= 10 ? 0 : 1
  return `${miles.toFixed(decimals)} mi`
}

// Turf-backed geometry helpers (replaces google.maps.geometry.spherical.*).
function computePathLengthMeters(path) {
  if (!path || path.length < 2) return 0
  try {
    return turf.length(turf.lineString(path.map(ll)), { units: 'meters' })
  } catch {
    return 0
  }
}

function computeDistanceBetweenMeters(a, b) {
  if (!a || !b) return 0
  try {
    return turf.distance(ll(a), ll(b), { units: 'meters' })
  } catch {
    return 0
  }
}

function computeBearingDegrees(a, b) {
  if (!a || !b) return 0
  try {
    return turf.bearing(ll(a), ll(b)) || 0
  } catch {
    return 0
  }
}

function interpolatePoint(a, b, ratio) {
  try {
    const line = turf.lineString([ll(a), ll(b)])
    const totalMeters = turf.length(line, { units: 'meters' })
    const target = totalMeters * Math.min(Math.max(ratio, 0), 1)
    const point = turf.along(line, target, { units: 'meters' })
    const [lng, lat] = point.geometry.coordinates
    return { lat, lng }
  } catch {
    return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio }
  }
}

function buildAnimatedPath(path) {
  if (!path?.length || path.length < 4) return path

  const totalLength = computePathLengthMeters(path)
  const spacingMeters = Math.min(Math.max(totalLength / 18, 900), 4200)
  const reduced = [path[0]]
  let carriedDistance = 0

  for (let index = 1; index < path.length - 1; index += 1) {
    carriedDistance += computeDistanceBetweenMeters(path[index - 1], path[index])
    if (carriedDistance >= spacingMeters) {
      reduced.push(path[index])
      carriedDistance = 0
    }
  }

  reduced.push(path[path.length - 1])

  if (reduced.length < 4) return path

  return reduced.map((point, index) => {
    if (index === 0 || index === reduced.length - 1) return point

    const previous = reduced[index - 1]
    const next = reduced[index + 1]

    return {
      lat: (previous.lat + point.lat + next.lat) / 3,
      lng: (previous.lng + point.lng + next.lng) / 3,
    }
  })
}

function pathToGeoJSON(path) {
  const coordinates = (path || []).filter(Boolean).map(ll)
  if (coordinates.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {},
  }
}

function pointToGeoJSON(point) {
  if (!point) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: ll(point) },
    properties: {},
  }
}

function matchesDay(dayId, focusDayId) {
  return focusDayId === 'all' || dayId === 'all' || dayId === focusDayId
}

function isFacility(location) {
  return location.category === 'logistics' || location.category === 'park'
}

function colorForCategory(location) {
  if (location.category === 'meal') return '#D29922'
  if (location.category === 'park') return '#3FB950'
  if (location.category === 'logistics') return '#8B949E'
  return '#58A6FF'
}

function getPlaybackCueTone(route, location) {
  if (location) return colorForCategory(location)
  return getVehicleColor(route)
}

function getPlaybackCueSlotBucket(slot) {
  return Number.isFinite(slot) ? Math.floor(slot * 10) : 'na'
}

function buildPlaybackCueKey({ kind, route = null, location = null, entity = null, slot = null }) {
  const dayId = entity?.dayId || route?.dayId || 'all'
  const anchorId = entity?.id || location?.id || route?.destinationLocationId || route?.id || 'unknown'
  return `${kind}:${dayId}:${anchorId}:${getPlaybackCueSlotBucket(slot)}`
}

function getPlaybackCueSignature(cue) {
  const familyIds = [...(cue.families || [])]
    .map((family) => family.id)
    .sort()
    .join('|')
  return [
    cue.kind,
    cue.title,
    cue.subtitle,
    cue.caption,
    cue.locationId || '',
    cue.entityId || '',
    familyIds,
  ].join(':')
}

function buildPlaybackCue({ cueKey, families, route, kind, location, anchor, entity = null, subtitleOverride = null, captionOverride = null }) {
  const tone = getPlaybackCueTone(route, location)
  const familyTitles = families.map((family) => family.title)
  const caravan = families.length > 1
  const caravanLabel = caravan ? `${families.length}-car caravan` : familyTitles[0]
  if (kind === 'departure') {
    return {
      key: cueKey || `departure:${route.destinationLocationId || route.id}:${familyTitles.join('|')}`,
      kind,
      title: caravan ? caravanLabel : familyTitles[0],
      subtitle: subtitleOverride || 'Departure',
      caption: captionOverride || location?.title || familyTitles.join(' + '),
      tone,
      familyId: families[0]?.id || null,
      locationId: location?.id || null,
      entityType: entity?.type || null,
      entityId: entity?.id || null,
      families,
      anchor,
      clickable: true,
    }
  }

  return {
    key: cueKey || `${kind}:${location?.id || route.destinationLocationId || route.id}:${familyTitles.join('|')}`,
    kind,
    title: location?.title || (kind === 'arrival' ? 'Arrival' : 'Road stop'),
    subtitle: subtitleOverride || (caravan ? caravanLabel : kind === 'arrival' ? 'Arrival' : kind === 'stop' ? 'Road stop' : 'On site'),
    caption: captionOverride || (caravan ? familyTitles.join(' + ') : familyTitles[0]),
    tone,
    familyId: families[0]?.id || null,
    locationId: location?.id || null,
    entityType: entity?.type || null,
    entityId: entity?.id || null,
    families,
    anchor,
    clickable: true,
  }
}

function averagePoint(points) {
  if (!points.length) return null
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
}

function getCueEntityPriority(entity) {
  if (!entity) return 0
  if (entity.type === 'meal') return 4
  if (entity.type === 'itineraryItem' && entity.rowId === 'activities') return 3
  if (entity.type === 'activity') return 2
  if (entity.type === 'itineraryItem') return 1
  return 0
}

function collapseOnsiteCueEntities(entities) {
  if (!entities.length) return []

  const sorted = [...entities].sort((left, right) => {
    if (left.dayId !== right.dayId) return `${left.dayId}`.localeCompare(`${right.dayId}`)
    if (left.locationId !== right.locationId) return `${left.locationId}`.localeCompare(`${right.locationId}`)
    if (left.startSlot !== right.startSlot) return left.startSlot - right.startSlot
    return getCueEntityPriority(right) - getCueEntityPriority(left)
  })

  const groups = []
  sorted.forEach((entity) => {
    const previous = groups[groups.length - 1]
    if (
      previous &&
      previous.dayId === entity.dayId &&
      previous.locationId === entity.locationId &&
      Math.abs(previous.startSlot - entity.startSlot) <= 0.22
    ) {
      previous.entities.push(entity)
      previous.startSlot = Math.min(previous.startSlot, entity.startSlot)
      return
    }

    groups.push({
      dayId: entity.dayId,
      locationId: entity.locationId,
      startSlot: entity.startSlot,
      entities: [entity],
    })
  })

  return groups.map((group) => {
    const primary = [...group.entities].sort((left, right) => {
      const priorityDelta = getCueEntityPriority(right) - getCueEntityPriority(left)
      if (priorityDelta !== 0) return priorityDelta
      return left.startSlot - right.startSlot
    })[0]

    return {
      primary,
      entities: group.entities,
    }
  })
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatCategoryLabel(location) {
  if (location.stopType) return location.stopType
  if (!location.category) return 'Location'
  return location.category.replaceAll('-', ' ')
}

function getLocationPhoto(location) {
  // livePhotos arrive from Wikimedia Commons ({ thumbUrl, url, title, sourceUrl })
  // while the seeded photos use the legacy { imageUrl } shape. Normalise both
  // into { imageUrl, sourceUrl?, title? } for the popup renderer.
  const live = (location.livePhotos || [])
    .map((media) => {
      if (!media) return null
      if (media.imageUrl) return media
      const imageUrl = media.thumbUrl || media.url
      if (!imageUrl) return null
      return { imageUrl, sourceUrl: media.sourceUrl || null, title: media.title || '' }
    })
    .filter(Boolean)
  const seeded = (location.photos || []).filter((media) => media?.imageUrl)
  return live[0] || seeded[0] || null
}

function getHoursPreview(location) {
  return Array.isArray(location.openingHours) && location.openingHours.length ? location.openingHours[0] : ''
}

function getRatingSummary(location) {
  if (typeof location.rating !== 'number') return ''
  const reviewText = location.userRatingsTotal ? ` · ${location.userRatingsTotal} reviews` : ''
  return `${location.rating.toFixed(1)} rating${reviewText}`
}

function buildLocationBriefingContent(location) {
  const accent = colorForCategory(location)
  const photo = getLocationPhoto(location)
  const categoryLabel = formatCategoryLabel(location)
  const ratingSummary = getRatingSummary(location)
  const hoursPreview = getHoursPreview(location)
  const website = location.websiteUrl || location.externalUrl || ''
  const phone = location.phoneNumber || ''
  const address = location.address || 'Address pending'
  const summary = location.summary || location.reservationNote || location.note || 'Location intel syncing from trip plan.'
  // Wikimedia Commons / seeded photos surface here. Prefer the <img> element
  // with native lazy-loading + async decoding over a CSS background so the
  // browser can defer work when the popup is off-screen. The attribution link
  // is only attached when the asset came from Wikimedia (sourceUrl present).
  const photoMarkup = photo
    ? `<div class="trip-briefing__photo trip-briefing__photo--image">
         <img
           src="${escapeHtml(photo.imageUrl)}"
           alt="${escapeHtml(photo.title || location.title || '')}"
           loading="lazy"
           decoding="async"
           referrerpolicy="no-referrer"
         />
         ${photo.sourceUrl
           ? `<a class="trip-briefing__photo-credit" href="${escapeHtml(photo.sourceUrl)}" target="_blank" rel="noreferrer" title="Source: Wikimedia Commons">CC / Wikimedia</a>`
           : ''}
       </div>`
    : `<div class="trip-briefing__photo trip-briefing__photo--fallback">
         <div class="trip-briefing__photo-icon" style="color:${accent}">◆</div>
         <div class="trip-briefing__photo-label">${escapeHtml(categoryLabel)}</div>
       </div>`

  const metaRows = [
    { label: 'Address', value: address },
    { label: 'Hours', value: hoursPreview },
    { label: 'Rating', value: ratingSummary },
    { label: 'Phone', value: phone },
  ].filter((row) => row.value)

  const actions = [
    website
      ? `<a class="trip-briefing__action" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Open intel</a>`
      : '',
  ]
    .filter(Boolean)
    .join('')

  return `
    <div class="trip-briefing">
      ${photoMarkup}
      <div class="trip-briefing__body">
        <div class="trip-briefing__header">
          <div class="trip-briefing__eyebrow">Location Briefing</div>
          <div class="trip-briefing__badge" style="color:${accent};border-color:${accent}55;background:${accent}1A">${escapeHtml(categoryLabel)}</div>
        </div>
        <div class="trip-briefing__title">${escapeHtml(location.title || 'Unknown location')}</div>
        <div class="trip-briefing__summary">${escapeHtml(summary)}</div>
        <div class="trip-briefing__meta">
          ${metaRows
            .map(
              (row) => `
                <div class="trip-briefing__meta-row">
                  <div class="trip-briefing__meta-label">${escapeHtml(row.label)}</div>
                  <div class="trip-briefing__meta-value">${escapeHtml(row.value)}</div>
                </div>`,
            )
            .join('')}
        </div>
        ${actions ? `<div class="trip-briefing__actions">${actions}</div>` : ''}
      </div>
    </div>
  `
}

function ensureLocationBriefingStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('trip-location-briefing-styles')) return

  const style = document.createElement('style')
  style.id = 'trip-location-briefing-styles'
  style.textContent = `
    .maplibregl-popup-content {
      padding: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42) !important;
    }
    .maplibregl-popup-close-button {
      color: #e6edf3;
      font-size: 18px;
      padding: 4px 10px;
      opacity: 0.84;
    }
    .maplibregl-popup-tip { display: none !important; }
    .trip-briefing {
      width: 320px;
      background: linear-gradient(180deg, rgba(20, 27, 36, 0.98), rgba(10, 15, 22, 0.98));
      color: #c9d1d9;
      font-family: ui-sans-serif, system-ui, sans-serif;
      border: 1px solid rgba(88, 166, 255, 0.18);
    }
    .trip-briefing__photo {
      position: relative;
      height: 150px;
      max-height: 150px;
      background-size: cover;
      background-position: center;
      border-bottom: 1px solid rgba(88, 166, 255, 0.12);
      overflow: hidden;
    }
    .trip-briefing__photo--image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .trip-briefing__photo-credit {
      position: absolute;
      right: 6px;
      bottom: 6px;
      padding: 2px 6px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #c9d1d9;
      background: rgba(13, 17, 23, 0.72);
      border: 1px solid rgba(88, 166, 255, 0.32);
      text-decoration: none;
    }
    .trip-briefing__photo-credit:hover {
      color: #7cc0ff;
      background: rgba(13, 17, 23, 0.9);
    }
    .trip-briefing__photo--fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background:
        radial-gradient(circle at top left, rgba(88, 166, 255, 0.14), transparent 42%),
        linear-gradient(180deg, #121922, #0c1117);
    }
    .trip-briefing__photo-icon {
      font-size: 20px;
      font-weight: 900;
    }
    .trip-briefing__photo-label {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #8b949e;
    }
    .trip-briefing__body {
      padding: 14px 16px 16px;
    }
    .trip-briefing__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .trip-briefing__eyebrow {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #7cc0ff;
    }
    .trip-briefing__badge {
      border: 1px solid;
      padding: 3px 8px;
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .trip-briefing__title {
      font-size: 18px;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #e6edf3;
      margin-bottom: 8px;
    }
    .trip-briefing__summary {
      font-size: 12px;
      line-height: 1.55;
      color: #8b949e;
      margin-bottom: 14px;
    }
    .trip-briefing__meta {
      display: grid;
      gap: 8px;
    }
    .trip-briefing__meta-row {
      border: 1px solid rgba(48, 54, 61, 0.72);
      background: rgba(13, 17, 23, 0.88);
      padding: 8px 10px;
    }
    .trip-briefing__meta-label {
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #8b949e;
      margin-bottom: 3px;
    }
    .trip-briefing__meta-value {
      font-size: 11px;
      line-height: 1.45;
      color: #c9d1d9;
    }
    .trip-briefing__actions {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .trip-briefing__action {
      border: 1px solid rgba(88, 166, 255, 0.3);
      background: rgba(88, 166, 255, 0.08);
      color: #7cc0ff;
      padding: 7px 10px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      text-decoration: none;
    }

    /* Custom MapLibre markers (replacing google.maps.SymbolPath). */
    .trip-location-marker {
      width: 18px;
      height: 18px;
      transform: rotate(45deg);
      border: 2px solid var(--marker-color, #58A6FF);
      background: color-mix(in srgb, var(--marker-color, #58A6FF) 18%, transparent);
      box-shadow: 0 0 0 1px rgba(13, 17, 23, 0.6);
      cursor: pointer;
      transition: transform 180ms ease, box-shadow 180ms ease;
    }
    .trip-location-marker.is-active {
      transform: rotate(45deg) scale(1.25);
      background: color-mix(in srgb, var(--marker-color, #58A6FF) 32%, transparent);
    }
    .trip-location-label {
      position: absolute;
      top: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%) rotate(-45deg);
      white-space: nowrap;
      font-size: 8px;
      font-weight: 700;
      color: #c9d1d9;
      letter-spacing: 0.08em;
      pointer-events: none;
    }
    .trip-pulse-marker {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      pointer-events: none;
      background: var(--pulse-fill, rgba(88,166,255,0.08));
      border: 1.6px solid var(--pulse-stroke, rgba(88,166,255,0.2));
      transform: translate(-50%, -50%) scale(var(--pulse-scale, 1));
      opacity: var(--pulse-opacity, 0);
      transition: opacity 120ms linear;
    }
    .trip-vehicle-marker {
      width: 0; height: 0;
      cursor: pointer;
    }
    .trip-vehicle-arrow {
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 14px solid var(--vehicle-color, #58A6FF);
      filter: drop-shadow(0 0 1px #0D1117);
      transform-origin: 50% 70%;
    }
    .trip-radar-marker {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      pointer-events: none;
      border: 1.8px solid var(--radar-stroke, rgba(88,166,255,0.34));
      background: var(--radar-fill, rgba(88,166,255,0.06));
      transform: translate(-50%, -50%) scale(var(--radar-scale, 1));
      opacity: var(--radar-opacity, 0);
    }
  `
  document.head.appendChild(style)
}

function MapChip({ active, onClick, children, tone = 'neutral' }) {
  const activeClasses = {
    neutral: 'border-[#58A6FF]/50 bg-[#58A6FF]/12 text-[#C9D1D9]',
    green: 'border-[#3FB950]/50 bg-[#3FB950]/12 text-[#3FB950]',
    amber: 'border-[#D29922]/50 bg-[#D29922]/12 text-[#D29922]',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[2px] border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-colors ${
        active
          ? activeClasses[tone]
          : 'border-[#30363D] bg-[#0d1117] text-[#8B949E] hover:border-[#58A6FF]/40 hover:text-[#C9D1D9]'
      }`}
    >
      {children}
    </button>
  )
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1)
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha
}

function lerpPoint(start, end, alpha) {
  return {
    lat: lerp(start.lat, end.lat, alpha),
    lng: lerp(start.lng, end.lng, alpha),
  }
}

function smoothstep(edgeStart, edgeEnd, value) {
  if (edgeStart === edgeEnd) {
    return value >= edgeEnd ? 1 : 0
  }
  const normalized = clamp01((value - edgeStart) / (edgeEnd - edgeStart))
  return normalized * normalized * (3 - 2 * normalized)
}

function getVehicleColor(route) {
  return TONE_COLORS[route?.tone] || TONE_COLORS.info
}

function buildPathDistanceProfile(path) {
  if (!path?.length || path.length < 2) return null

  const cumulative = [0]
  let totalDistance = 0

  for (let index = 1; index < path.length; index += 1) {
    totalDistance += computeDistanceBetweenMeters(path[index - 1], path[index])
    cumulative.push(totalDistance)
  }

  if (!totalDistance) return null

  return {
    path,
    cumulative,
    totalDistance,
  }
}

function getNearestPathProgress(pathProfile, coordinate) {
  if (!pathProfile || !coordinate) return null

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  pathProfile.path.forEach((point, index) => {
    const distance = computeDistanceBetweenMeters(point, coordinate)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return clamp01(pathProfile.cumulative[nearestIndex] / pathProfile.totalDistance)
}

function buildRoutePlaybackProfile(route, pathProfile, locationsById, routeWindowSlots) {
  if (!pathProfile) return null
  const { path } = pathProfile

  const origin = route?.originCoordinates || path[0]
  const intermediateStops = (route?.stopLocationIds || [])
    .map((locationId) => locationsById.get(locationId)?.coordinates || null)
    .filter(Boolean)
  const destination = route?.destinationLocationId
    ? locationsById.get(route.destinationLocationId)?.coordinates || path[path.length - 1]
    : path[path.length - 1]

  const rawAnchorProgresses = [origin, ...intermediateStops, destination].map((coordinate, index, anchors) => {
    if (index === 0) return 0
    if (index === anchors.length - 1) return 1
    return getNearestPathProgress(pathProfile, coordinate)
  })

  const anchorProgresses = rawAnchorProgresses.map((progress, index, anchors) => {
    if (index === 0) return 0
    if (index === anchors.length - 1) return 1
    return clamp01(Number.isFinite(progress) ? progress : index / (anchors.length - 1))
  })

  for (let index = 1; index < anchorProgresses.length - 1; index += 1) {
    anchorProgresses[index] = Math.max(anchorProgresses[index], anchorProgresses[index - 1] + 0.0005)
  }

  const legDistanceShares = anchorProgresses
    .slice(1)
    .map((progress, index) => Math.max(progress - anchorProgresses[index], 0))
  const totalLegShare = legDistanceShares.reduce((sum, share) => sum + share, 0)
  const stopCount = intermediateStops.length
  const shouldPauseAtStops = stopCount > 0 && routeWindowSlots >= 0.5
  const totalStopFraction = shouldPauseAtStops ? Math.min(0.12 * stopCount, 0.24) : 0

  return {
    anchorProgresses,
    legDistanceShares,
    totalLegShare: totalLegShare || 1,
    perStopFraction: stopCount ? totalStopFraction / stopCount : 0,
    totalTravelFraction: Math.max(1 - totalStopFraction, 0),
  }
}

function getRoutePlaybackState(playbackProfile, rawProgress) {
  const normalized = clamp01(rawProgress)
  if (!playbackProfile || playbackProfile.anchorProgresses.length < 2) {
    return {
      progress: normalized,
      phase: 'travel',
    }
  }

  let consumedFraction = 0
  const lastLegIndex = playbackProfile.anchorProgresses.length - 2

  for (let index = 0; index <= lastLegIndex; index += 1) {
    const legFraction = playbackProfile.totalTravelFraction
      * (playbackProfile.legDistanceShares[index] / playbackProfile.totalLegShare)
    const startProgress = playbackProfile.anchorProgresses[index]
    const endProgress = playbackProfile.anchorProgresses[index + 1]

    if (normalized <= consumedFraction + legFraction || index === lastLegIndex) {
      const legRatio = legFraction > 0 ? (normalized - consumedFraction) / legFraction : 1
      return {
        progress: lerp(startProgress, endProgress, clamp01(legRatio)),
        phase: 'travel',
      }
    }

    consumedFraction += legFraction

    const hasStopAfterLeg = index < lastLegIndex
    if (!hasStopAfterLeg || !playbackProfile.perStopFraction) continue

    if (normalized <= consumedFraction + playbackProfile.perStopFraction) {
      return {
        progress: endProgress,
        phase: 'stop',
      }
    }

    consumedFraction += playbackProfile.perStopFraction
  }

  return {
    progress: 1,
    phase: 'arrival',
  }
}

function getRoutePlaybackProgress(routeEntry, pathProfile, locationsById, rawProgress, routeWindowSlots) {
  const profile = buildRoutePlaybackProfile(
    routeEntry?.route,
    pathProfile,
    locationsById,
    routeWindowSlots,
  )
  return getRoutePlaybackState(profile, rawProgress)
}

function interpolateAlongPath(pathProfile, progress) {
  const path = pathProfile?.path
  if (!path?.length) return null
  if (path.length === 1 || !pathProfile.totalDistance) return path[0]

  const targetDistance = clamp01(progress) * pathProfile.totalDistance

  for (let index = 1; index < path.length; index += 1) {
    const segmentEndDistance = pathProfile.cumulative[index]
    if (segmentEndDistance < targetDistance) continue

    const start = path[index - 1]
    const end = path[index]
    const segmentStartDistance = pathProfile.cumulative[index - 1]
    const segmentDistance = segmentEndDistance - segmentStartDistance
    const segmentRatio = segmentDistance ? (targetDistance - segmentStartDistance) / segmentDistance : 0
    return interpolatePoint(start, end, clamp01(segmentRatio))
  }

  return path[path.length - 1]
}

function appendDistinctPoint(points, point) {
  if (!point) return

  const normalizedPoint = { lat: point.lat, lng: point.lng }
  const lastPoint = points[points.length - 1]
  if (
    lastPoint &&
    Math.abs(lastPoint.lat - normalizedPoint.lat) < 1e-6 &&
    Math.abs(lastPoint.lng - normalizedPoint.lng) < 1e-6
  ) {
    return
  }

  points.push(normalizedPoint)
}

function extractPathSegment(pathProfile, startProgress = 0, endProgress = 1) {
  const path = pathProfile?.path
  if (!path?.length) return []
  if (path.length === 1 || !pathProfile.totalDistance) {
    return path.map((point) => ({ lat: point.lat, lng: point.lng }))
  }

  const start = clamp01(Math.min(startProgress, endProgress))
  const end = clamp01(Math.max(startProgress, endProgress))
  const startDistance = start * pathProfile.totalDistance
  const endDistance = end * pathProfile.totalDistance
  const segment = []

  appendDistinctPoint(segment, interpolateAlongPath(pathProfile, start))

  for (let index = 1; index < path.length - 1; index += 1) {
    const waypointDistance = pathProfile.cumulative[index]
    if (waypointDistance > startDistance && waypointDistance < endDistance) {
      appendDistinctPoint(segment, path[index])
    }
  }

  appendDistinctPoint(segment, interpolateAlongPath(pathProfile, end))
  return segment
}

function buildRouteCameraViewportPoints(pathProfile, progress, mode) {
  if (!pathProfile?.path?.length) return []
  if (mode === 'arrival') return []
  if (mode === 'premove') {
    return pathProfile.path.map((point) => ({ lat: point.lat, lng: point.lng }))
  }

  const clampedProgress = clamp01(progress)
  const tightenAlpha = smoothstep(0.08, 0.74, clampedProgress)
  const trailingContext =
    pathProfile.totalDistance ? Math.min(0.06, 2200 / pathProfile.totalDistance) : 0.04
  const viewportStart = Math.max(0, lerp(0, clampedProgress, tightenAlpha) - trailingContext)

  return extractPathSegment(pathProfile, viewportStart, 1)
}

function findNearestPlaybackStop(position, route, locationsById) {
  if (!position || !route) return null

  const PLAYBACK_STOP_FOCUS_RADIUS_METERS = 1800
  const candidates = [...(route.stopLocationIds || []), route.destinationLocationId]
    .filter(Boolean)
    .map((locationId) => locationsById.get(locationId))
    .filter((location) => location?.coordinates)

  if (!candidates.length) return null

  let nearest = null

  candidates.forEach((location) => {
    const distanceMeters = computeDistanceBetweenMeters(position, location.coordinates)
    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = { location, distanceMeters }
    }
  })

  return nearest && nearest.distanceMeters < PLAYBACK_STOP_FOCUS_RADIUS_METERS ? nearest.location : null
}

function getRouteWindowDistance(route, cursorSlot, itineraryItems = []) {
  const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)

  if (cursorSlot < startSlot) return startSlot - cursorSlot
  if (cursorSlot > endSlot) return cursorSlot - endSlot
  return 0
}

function getRouteSimulationWindow(route, itineraryItems = []) {
  if (!route) {
    return { startSlot: 0, endSlot: 1 }
  }

  if (route.linkedEntityKey) {
    const linked = parseEntityKey(route.linkedEntityKey)
    if (linked.type === 'itineraryItem') {
      const linkedItem = itineraryItems.find((item) => item.id === linked.id)
      if (linkedItem && Number.isFinite(linkedItem.startSlot)) {
        const fallbackSpan = Number.isFinite(linkedItem.span) && linkedItem.span > 0 ? linkedItem.span : 1
        const span = getRouteDurationSlotSpan(route, fallbackSpan)
        return {
          startSlot: linkedItem.startSlot,
          endSlot: linkedItem.startSlot + span,
        }
      }
    }
  }

  const startSlot = Number.isFinite(route.simulationStartSlot) ? route.simulationStartSlot : 0
  const fallbackSpan =
    Number.isFinite(route.simulationEndSlot) && route.simulationEndSlot > startSlot
      ? route.simulationEndSlot - startSlot
      : 1
  const endSlot = startSlot + getRouteDurationSlotSpan(route, fallbackSpan)
  return { startSlot, endSlot }
}

function getCursorDayId(cursorSlot) {
  const dayIndex = Math.min(Math.max(Math.floor(cursorSlot / TIME_SLOTS.length), 0), DAYS.length - 1)
  return DAYS[dayIndex]?.id || DAYS[0]?.id || 'all'
}

function resolveOnsiteCueFamilies(group, itineraryItems, routeEntries, families) {
  if (!group?.primary) return []

  const familyIds = new Set()
  const groupLocationId = group.primary.locationId
  const groupDayId = group.primary.dayId
  const groupStartSlot = group.primary.startSlot

  group.entities.forEach((entity) => {
    ;(entity.familyIds || []).forEach((familyId) => familyIds.add(familyId))
    ;(entity.linkedEntityKeys || []).forEach((key) => {
      const linked = parseEntityKey(key)
      if (linked.type === 'family') {
        familyIds.add(linked.id)
        return
      }
      if (linked.type !== 'itineraryItem') return
      const linkedItem = itineraryItems.find((item) => item.id === linked.id)
      ;(linkedItem?.familyIds || []).forEach((familyId) => familyIds.add(familyId))
    })
  })

  itineraryItems.forEach((item) => {
    if (item.rowId !== 'travel' || !item.familyIds?.length || item.dayId !== groupDayId) return
    const route = routeEntries.find((entry) => entry.route.id === item.routeId)?.route
    const routeWindow = route
      ? getRouteSimulationWindow(route, itineraryItems)
      : {
          startSlot: item.startSlot,
          endSlot: item.startSlot + (Number.isFinite(item.span) ? item.span : 0),
        }

    const sameLocation =
      item.locationId === groupLocationId ||
      route?.destinationLocationId === groupLocationId
    const nearWindow =
      Math.abs(routeWindow.startSlot - groupStartSlot) <= 0.35 ||
      Math.abs(routeWindow.endSlot - groupStartSlot) <= 0.35 ||
      (groupStartSlot >= routeWindow.startSlot && groupStartSlot <= routeWindow.endSlot)

    if (!sameLocation || !nearWindow) return
    item.familyIds.forEach((familyId) => familyIds.add(familyId))
  })

  return families.filter((family) => familyIds.has(family.id))
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getCameraPadding(map, pointCount, mode) {
  const container = map?.getContainer?.()
  const width = Math.max(container?.clientWidth || 0, 1)
  const height = Math.max(container?.clientHeight || 0, 1)
  const compact = pointCount <= 1

  const horizontalRatio =
    compact && mode !== 'active' ? 0.08
    : compact ? 0.1
    : 0.14
  const verticalRatio =
    compact && mode !== 'active' ? 0.1
    : compact ? 0.12
    : 0.16
  const bottomRatio =
    compact && mode === 'active' ? 0.16
    : compact ? 0.1
    : 0.16

  return {
    left: Math.max(width * horizontalRatio, compact ? 52 : 88),
    right: Math.max(width * horizontalRatio, compact ? 52 : 88),
    top: Math.max(height * verticalRatio, compact ? 46 : 72),
    bottom: Math.max(height * bottomRatio, compact ? 58 : 84),
  }
}

function latRad(lat) {
  const sin = Math.sin((lat * Math.PI) / 180)
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2
  return clamp(radX2 / 2, -Math.PI / 2, Math.PI / 2)
}

function getBoundsFromPoints(points) {
  return points.reduce(
    (bounds, point) => ({
      minLat: Math.min(bounds.minLat, point.lat),
      maxLat: Math.max(bounds.maxLat, point.lat),
      minLng: Math.min(bounds.minLng, point.lng),
      maxLng: Math.max(bounds.maxLng, point.lng),
    }),
    {
      minLat: points[0]?.lat ?? 0,
      maxLat: points[0]?.lat ?? 0,
      minLng: points[0]?.lng ?? 0,
      maxLng: points[0]?.lng ?? 0,
    },
  )
}

function getBoundsCenter(points) {
  if (!points.length) return null
  const bounds = getBoundsFromPoints(points)
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  }
}

function getViewportAwareZoom(map, points, padding, { minZoom = 6.9, maxZoom = 10.9 } = {}) {
  if (!map || !points.length) return minZoom

  const container = map.getContainer?.()
  const usableWidth = Math.max((container?.clientWidth || 0) - padding.left - padding.right, 1)
  const usableHeight = Math.max((container?.clientHeight || 0) - padding.top - padding.bottom, 1)

  if (points.length === 1) return maxZoom

  const bounds = getBoundsFromPoints(points)
  const lngDiff = bounds.maxLng - bounds.minLng
  const lngFraction = Math.max(((lngDiff < 0 ? lngDiff + 360 : lngDiff) || 0) / 360, 1e-9)
  const latFraction = Math.max((latRad(bounds.maxLat) - latRad(bounds.minLat)) / Math.PI, 1e-9)

  const lngZoom = Math.log2(usableWidth / (256 * lngFraction))
  const latZoom = Math.log2(usableHeight / (256 * latFraction))

  return clamp(Math.min(lngZoom, latZoom), minZoom, maxZoom)
}

function weightedCenter(points) {
  if (!points.length) return null
  const totals = points.reduce(
    (accumulator, point) => ({
      lat: accumulator.lat + point.lat * point.weight,
      lng: accumulator.lng + point.lng * point.weight,
      weight: accumulator.weight + point.weight,
    }),
    { lat: 0, lng: 0, weight: 0 },
  )
  if (!totals.weight) return { lat: points[0].lat, lng: points[0].lng }
  return {
    lat: totals.lat / totals.weight,
    lng: totals.lng / totals.weight,
  }
}

function buildParticipantCameraTarget({
  map,
  vehicleEntries,
  highlightedLocation,
  cursorSlot,
}) {
  const currentDayId = getCursorDayId(cursorSlot)
  const visibleEntries = vehicleEntries
    .filter((entry) => entry.markerVisible)
    .filter((entry) => {
      const routeDayId = entry.routeEntry?.route?.dayId
      return !routeDayId || routeDayId === 'all' || routeDayId === currentDayId
    })
    .map((entry) => ({
      ...entry,
      position: entry.currentPosition || entry.targetPosition,
    }))
    .filter((entry) => entry.position)

  if (!visibleEntries.length) return null

  const activeEntries = visibleEntries.filter((entry) => entry.isInTransit)
  const preMoveEntries = visibleEntries.filter((entry) => !entry.isInTransit && entry.isPreMove)
  const arrivalEntries = visibleEntries.filter((entry) => !entry.isInTransit && !entry.isPreMove)
  const trackedEntries = activeEntries.length
    ? activeEntries
    : preMoveEntries.length
      ? preMoveEntries
      : arrivalEntries.length
        ? arrivalEntries
        : visibleEntries

  let trackedPoints =
    trackedEntries.length === 1
      ? [
          { ...trackedEntries[0].position, weight: 1.15 },
          { ...(trackedEntries[0].cameraLeadPosition || trackedEntries[0].position), weight: 1.85 },
        ]
      : trackedEntries.map((entry) => ({ ...entry.position, weight: entry.isInTransit ? 1.2 : 1 }))

  const mode = activeEntries.length ? 'active' : preMoveEntries.length ? 'premove' : 'arrival'
  const routeViewportPoints =
    mode === 'arrival'
      ? []
      : trackedEntries.flatMap((entry) => {
          const pathProfile =
            entry.routePathProfile ||
            buildPathDistanceProfile(entry.routeEntry?.currentPath || entry.routeEntry?.route?.path || [])
          return buildRouteCameraViewportPoints(
            pathProfile,
            entry.routePlaybackProgress ?? 0,
            entry.isInTransit ? 'active' : entry.isPreMove ? 'premove' : 'arrival',
          )
        })

  if (highlightedLocation?.coordinates) {
    trackedPoints.push({ ...highlightedLocation.coordinates, weight: 0.95 })
  }

  if (mode === 'arrival' && trackedEntries.length === 1 && highlightedLocation?.coordinates) {
    trackedPoints = [
      { ...highlightedLocation.coordinates, weight: 2.4 },
      { ...trackedEntries[0].position, weight: 1 },
    ]
  }

  const centroid =
    routeViewportPoints.length > 1
      ? getBoundsCenter([
          ...routeViewportPoints,
          ...(highlightedLocation?.coordinates ? [highlightedLocation.coordinates] : []),
        ])
      : weightedCenter(trackedPoints)
  const padding = getCameraPadding(map, trackedEntries.length, mode)
  const currentZoom = map.getZoom()
  const zoomMax =
    trackedEntries.length <= 1
      ? mode === 'arrival' ? 13.2 : 12.2
      : 10.8
  let zoom = getViewportAwareZoom(
    map,
    routeViewportPoints.length > 1
      ? [
          ...routeViewportPoints,
          ...(highlightedLocation?.coordinates ? [highlightedLocation.coordinates] : []),
        ]
      : trackedPoints,
    padding,
    { minZoom: routeViewportPoints.length > 1 ? 5.5 : 6.9, maxZoom: zoomMax },
  )
  if (Number.isFinite(currentZoom) && Math.abs(currentZoom - zoom) < 0.05) {
    zoom = currentZoom
  }

  return {
    center: centroid,
    zoom,
    mode,
    participantCount: trackedEntries.length,
  }
}

function getRouteOrigin(family, route, path) {
  return route?.originCoordinates || path?.[0] || family?.originCoordinates || null
}

function buildRouteCoordinatePath(route, locationsById) {
  if (route?.path?.length) {
    return route.path
  }

  const origin = route?.originCoordinates || null
  const destination = route?.destinationLocationId
    ? locationsById.get(route.destinationLocationId)?.coordinates || null
    : null
  const stops = (route?.stopLocationIds || [])
    .map((locationId) => locationsById.get(locationId)?.coordinates || null)
    .filter(Boolean)

  const points = [origin, ...stops, destination].filter(Boolean)
  return points.length >= 2 ? points : null
}

function pickFamilyRouteEntry(routeEntries, familyId, cursorSlot, focusDayId = 'all', itineraryItems = []) {
  const directCandidates = routeEntries.filter((entry) => entry.route.familyId === familyId)
  if (!directCandidates.length) return null

  const focusedCandidates = directCandidates.filter((entry) => matchesDay(entry.route.dayId, focusDayId))
  const candidates = focusedCandidates.length ? focusedCandidates : directCandidates

  const activeCandidates = candidates.filter((entry) => {
    const { startSlot, endSlot } = getRouteSimulationWindow(entry.route, itineraryItems)
    return cursorSlot >= startSlot && cursorSlot <= endSlot
  })

  if (activeCandidates.length) {
    return activeCandidates.reduce((bestEntry, entry) => {
      if (!bestEntry) return entry

      const bestStart = getRouteSimulationWindow(bestEntry.route, itineraryItems).startSlot
      const nextStart = getRouteSimulationWindow(entry.route, itineraryItems).startSlot
      return nextStart < bestStart ? entry : bestEntry
    }, null)
  }

  return candidates.reduce((bestEntry, entry) => {
    if (!bestEntry) return entry

    const bestDistance = getRouteWindowDistance(bestEntry.route, cursorSlot, itineraryItems)
    const nextDistance = getRouteWindowDistance(entry.route, cursorSlot, itineraryItems)

    if (nextDistance < bestDistance) return entry

    if (nextDistance === bestDistance) {
      const bestStart = getRouteSimulationWindow(bestEntry.route, itineraryItems).startSlot
      const nextStart = getRouteSimulationWindow(entry.route, itineraryItems).startSlot
      if (nextStart < bestStart) return entry
    }

    return bestEntry
  }, null)
}

function getPlaybackDayId(cursorSlot) {
  const slotsPerDay = TIME_SLOTS.length || 1
  const dayIndex = Math.min(Math.max(Math.floor(cursorSlot / slotsPerDay), 0), DAYS.length - 1)
  return DAYS[dayIndex]?.id || DAYS[0]?.id || 'all'
}

// ---------------------------------------------------------------------------
// OSRM fetch helper: uses the public demo endpoint. Cached + throttled. On
// 429 / network failure we fall back to the seeded straight-line path so the
// UI stays responsive (Places API equivalent is simply disabled — no
// enrichment: data comes entirely from tripData.js).
// ---------------------------------------------------------------------------
async function fetchOsrmRoute(origin, destination, waypoints = []) {
  if (!origin || !destination) return null
  const segments = [origin, ...waypoints, destination].map(ll)
  const cacheKey = segments.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(';')
  if (osrmCache.has(cacheKey)) return osrmCache.get(cacheKey)

  const elapsed = Date.now() - osrmLastRequestAt
  if (elapsed < OSRM_MIN_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, OSRM_MIN_GAP_MS - elapsed))
  }
  osrmLastRequestAt = Date.now()

  const coords = segments.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `${OSRM_ENDPOINT}/${coords}?overview=full&geometries=geojson`

  try {
    const response = await fetch(url)
    if (response.status === 429) {
      console.warn('[TripCommand] OSRM rate-limited — using fallback straight line.')
      const fallback = { rateLimited: true }
      osrmCache.set(cacheKey, fallback)
      return fallback
    }
    if (!response.ok) throw new Error(`OSRM ${response.status}`)
    const data = await response.json()
    const route = data.routes?.[0]
    if (!route?.geometry?.coordinates?.length) throw new Error('OSRM empty geometry')

    const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
    const payload = {
      path,
      distanceMeters: route.distance || 0,
      durationSeconds: route.duration || 0,
    }
    osrmCache.set(cacheKey, payload)
    return payload
  } catch (error) {
    console.warn('[TripCommand] OSRM fetch failed', error?.message || error)
    const fallback = { failed: true }
    osrmCache.set(cacheKey, fallback)
    return fallback
  }
}

// Build a DOM node for a location marker (diamond shape, replaces the SVG
// path M -6 0 L 0 -6 L 6 0 L 0 6 Z). Rotated via CSS transform.
function buildLocationMarkerElement(location) {
  const wrapper = document.createElement('div')
  wrapper.className = 'trip-location-marker'
  wrapper.style.setProperty('--marker-color', colorForCategory(location))
  return wrapper
}

// Build a DOM node for a vehicle arrow marker (replaces FORWARD_CLOSED_ARROW).
// The arrow is rotated via maplibregl Marker.setRotation(bearing).
function buildVehicleMarkerElement(color) {
  const wrapper = document.createElement('div')
  wrapper.className = 'trip-vehicle-marker'
  const arrow = document.createElement('div')
  arrow.className = 'trip-vehicle-arrow'
  arrow.style.setProperty('--vehicle-color', color)
  wrapper.appendChild(arrow)
  return { wrapper, arrow }
}

function buildPulseMarkerElement() {
  const el = document.createElement('div')
  el.className = 'trip-pulse-marker'
  return el
}

function buildRadarMarkerElement() {
  const el = document.createElement('div')
  el.className = 'trip-radar-marker'
  return el
}

export default function CommandMap({
  locations,
  routes,
  families,
  itineraryItems = [],
  meals = [],
  activities = [],
  cursorSlot = 0,
  mapUi,
  mapWeather,
  mapWeatherTargets = [],
  selectedLocationId,
  selectedRouteId,
  playbackActive = false,
  playbackHighlightLocationId = null,
  onUpdateMapUi,
  onHydrateLocationDetails,
  onHydrateRouteDetails,
  onSelectEntity,
  onPlaybackFeedItems,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const mapReadyRef = useRef(false)
  const routeEntriesRef = useRef([])
  const markerEntriesRef = useRef([])
  const vehicleEntriesRef = useRef([])
  const animationFrameRef = useRef(null)
  const lastAnimationTimestampRef = useRef(null)
  const lastViewportTargetRef = useRef('')
  const playbackStopSelectionRef = useRef(null)
  const playbackCameraTargetRef = useRef(null)
  const cameraStateRef = useRef(null)
  const prevCursorSlotRef = useRef(null)
  const playbackCueKeysRef = useRef(new Map())
  const routingAvailabilityRef = useRef('unknown')
  const placesAvailabilityRef = useRef('unknown')
  const [status, setStatus] = useState('loading')
  const [statusDetail, setStatusDetail] = useState('Connecting to OpenFreeMap tiles...')
  const [mapLayerCollapsed, setMapLayerCollapsed] = useState(false)
  const [weatherCollapsed, setWeatherCollapsed] = useState(false)
  const effectiveFocusDayId =
    playbackActive && mapUi.focusDayId === 'all' ? getPlaybackDayId(cursorSlot) : mapUi.focusDayId

  const getRoutePath = (entry) => entry.currentPath || entry.route.path

  const showPlaybackCues = useCallback((cues) => {
    const nextCues = (Array.isArray(cues) ? cues : [cues]).filter(Boolean)
    if (!nextCues.length) return

    const freshCues = nextCues.filter((cue) => {
      const nextSignature = getPlaybackCueSignature(cue)
      const previousSignature = playbackCueKeysRef.current.get(cue.key)
      if (previousSignature === nextSignature) return false
      playbackCueKeysRef.current.set(cue.key, nextSignature)
      return true
    })
    if (!freshCues.length) return

    onPlaybackFeedItems?.(freshCues)
  }, [onPlaybackFeedItems])

  const resolveDrivingPath = async (route) => {
    const locationsById = new Map(locations.map((location) => [location.id, location]))
    const fallbackPath = buildRouteCoordinatePath(route, locationsById)
    if (!fallbackPath || fallbackPath.length < 2) {
      return { path: fallbackPath, source: 'seeded' }
    }
    if (!LIVE_EXTERNAL_DATA) return { path: fallbackPath, source: 'seeded' }
    if (SKIP_DEPRECATED_OSRM_IN_DEV) return { path: fallbackPath, source: 'seeded' }
    if (routingAvailabilityRef.current === 'unavailable') return { path: fallbackPath, source: 'seeded' }

    const origin = route?.originCoordinates || fallbackPath[0]
    const destination = route?.destinationLocationId
      ? locationsById.get(route.destinationLocationId)?.coordinates || fallbackPath[fallbackPath.length - 1]
      : fallbackPath[fallbackPath.length - 1]
    const waypointPoints = (route?.stopLocationIds || [])
      .map((locationId) => locationsById.get(locationId)?.coordinates || null)
      .filter(Boolean)

    const result = await fetchOsrmRoute(origin, destination, waypointPoints)
    if (!result || result.failed || result.rateLimited) {
      if (result?.rateLimited) routingAvailabilityRef.current = 'throttled'
      return { path: fallbackPath, source: 'seeded' }
    }

    return {
      path: result.path?.length ? result.path : fallbackPath,
      source: result.path?.length ? 'directions' : 'seeded',
      durationSeconds: result.durationSeconds,
      durationText: formatDurationText(result.durationSeconds),
      distanceMeters: result.distanceMeters,
      distanceText: formatDistanceText(result.distanceMeters),
    }
  }

  // Google Places replacement — Nominatim (OSM) geocoder.
  //
  // Contract (matches the original Google Places caller expectations, with
  // an additional top-level `status` field for soft failure modes):
  //   {
  //     status: 'ok' | 'no-match' | 'skipped',
  //     placeId,               // OSM place_id (numeric, stringified)
  //     name,                  // best-effort display label
  //     address,               // full display_name
  //     coordinates: {lat,lng},
  //     category,              // OSM `category` (e.g. "natural", "tourism")
  //     type,                  // OSM `type`    (e.g. "valley", "hotel")
  //     raw,                   // the untouched Nominatim row, for advanced use
  //     externalUrl,           // link to the OSM entity or /?mlat=&mlon=
  //   }
  //
  // Callers should defensively check `status !== 'ok'` before destructuring.
  // The old caller used `matchedPlace?.geometry?.location` — that shape is NOT
  // produced here; the consolidated hydration loop below consumes the new
  // contract directly.
  const resolvePlaceMatch = async (location) => {
    if (!location) return { status: 'no-match' }
    if (!LIVE_EXTERNAL_DATA) return { status: 'skipped' }
    if (placesAvailabilityRef.current === 'unavailable') return { status: 'skipped' }

    const query = location.placesQuery || location.title || location.name
    if (!query) return { status: 'no-match' }
    if (location.placeId && String(location.placeId).startsWith('osm:')) {
      // already hydrated from OSM, no need to re-query
      return { status: 'no-match' }
    }

    const data = await fetchNominatim(query)
    if (!data) return { status: 'no-match' }

    const lat = parseFloat(data.lat)
    const lng = parseFloat(data.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { status: 'no-match' }

    const osmType = data.osm_type && data.osm_id ? `${data.osm_type}/${data.osm_id}` : null
    const externalUrl = osmType
      ? `https://www.openstreetmap.org/${osmType}`
      : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`

    return {
      status: 'ok',
      placeId: data.place_id ? `osm:${data.place_id}` : null,
      name: (data.display_name || '').split(',')[0] || location.title || query,
      address: data.display_name || location.address || '',
      coordinates: { lat, lng },
      category: data.category || null,
      type: data.type || null,
      raw: data,
      externalUrl,
      // Photo enrichment is fired off separately (Wikimedia Commons API) so
      // we don't block the 1 req/s Nominatim loop. See the hydration loop
      // below — it attaches `livePhotos` asynchronously once the Wikimedia
      // helper resolves.
      livePhotos: null,
    }
  }

  const resolveDriveProfile = async (origin, destination) => {
    if (!origin || !destination) return null
    if (!LIVE_EXTERNAL_DATA) return null
    if (SKIP_DEPRECATED_OSRM_IN_DEV) return null
    if (routingAvailabilityRef.current === 'unavailable') return null

    const result = await fetchOsrmRoute(origin, destination, [])
    if (!result || result.failed || result.rateLimited) return null

    return {
      distanceText: formatDistanceText(result.distanceMeters),
      distanceMeters: result.distanceMeters,
      durationText: formatDurationText(result.durationSeconds),
      durationSeconds: result.durationSeconds,
    }
  }

  // Re-render polyline sources from current entries.
  const syncRouteSources = () => {
    const map = mapRef.current
    if (!map || !mapReadyRef.current) return
    routeEntriesRef.current.forEach((entry) => {
      const baseSource = map.getSource(entry.baseSourceId)
      if (baseSource) baseSource.setData(pathToGeoJSON(entry.currentPath))
      const animSource = map.getSource(entry.animSourceId)
      if (animSource) animSource.setData(pathToGeoJSON(entry.animationPath || entry.currentPath))
    })
  }

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false

    async function initializeMap() {
      try {
        ensureLocationBriefingStyles()

        const initialLocations = locations
        const initialRoutes = routes
        const initialLocationsById = new Map(initialLocations.map((location) => [location.id, location]))

        const initialBasecampCenter =
          initialLocations.find((location) => location.id === 'pine-airbnb')?.coordinates || { lat: 37.8586, lng: -120.2142 }

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: OPENFREEMAP_STYLE_URL,
          center: ll(initialBasecampCenter),
          zoom: 7,
          attributionControl: { compact: true },
        })
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
        mapRef.current = map

        // Traffic layer is not available on OpenFreeMap. Log once.
        console.info('[TripCommand] Traffic layer unavailable (OpenFreeMap). Skipping.')

        await new Promise((resolve, reject) => {
          const onLoad = () => {
            map.off('error', onError)
            resolve()
          }
          const onError = (event) => {
            map.off('load', onLoad)
            reject(event?.error || new Error('Map failed to load'))
          }
          map.once('load', onLoad)
          map.once('error', onError)
        })

        if (cancelled || !containerRef.current) return
        mapReadyRef.current = true

        // Fit bounds over all initial locations for a pleasant first view.
        try {
          const bounds = new maplibregl.LngLatBounds()
          initialLocations.forEach((location) => {
            if (location?.coordinates) bounds.extend(ll(location.coordinates))
          })
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 80, duration: 0 })
          }
        } catch {
          /* ignore */
        }

        cameraStateRef.current = {
          center: initialBasecampCenter,
          zoom: map.getZoom() || 7,
        }

        // ----- Route polylines (base + animated outline) -----
        routeEntriesRef.current = initialRoutes.map((route, index) => {
          const seededPath = buildRouteCoordinatePath(route, initialLocationsById)
          const baseSourceId = `trip-route-base-${route.id || index}`
          const animSourceId = `trip-route-anim-${route.id || index}`
          const baseLayerId = `${baseSourceId}-layer`
          const animLayerId = `${animSourceId}-layer`

          // `lineMetrics: true` is required for `line-gradient` + the
          // `['line-progress']` expression (used below on the animLayer for
          // the travelling-band effect). It has to be set at addSource time;
          // setData() keeps it — but a full removeSource/addSource would not.
          map.addSource(baseSourceId, { type: 'geojson', data: pathToGeoJSON(seededPath), lineMetrics: true })
          map.addLayer({
            id: baseLayerId,
            type: 'line',
            source: baseSourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': TONE_COLORS[route.tone] || TONE_COLORS.info,
              'line-opacity': route.tone === 'muted' ? 0.34 : 0.28,
              'line-width': route.tone === 'muted' ? 2 : 2.5,
            },
          })

          map.addSource(animSourceId, { type: 'geojson', data: pathToGeoJSON(seededPath), lineMetrics: true })
          map.addLayer({
            id: animLayerId,
            type: 'line',
            source: animSourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'visible' },
            paint: {
              // NOTE: `line-gradient` is mutually exclusive with `line-color`
              // on the same layer — MapLibre will only honour the gradient
              // when `line-color` is absent. The travelling-band gradient
              // expression is populated on every RAF tick by the animation
              // loop (`setPaintProperty('line-gradient', …)`). Because the
              // expression is evaluated server-side in the GPU shader, there
              // is no LineAtlas contention like the old `line-dasharray`.
              'line-gradient': [
                'interpolate',
                ['linear'],
                ['line-progress'],
                0, 'rgba(0,0,0,0)',
                1, 'rgba(0,0,0,0)',
              ],
              'line-opacity': route.tone === 'muted' ? 0.45 : 0.55,
              'line-width': route.tone === 'muted' ? 2.5 : 3,
            },
          })

          const handleRouteClick = () => {
            const linked = parseEntityKey(route.linkedEntityKey)
            onSelectEntity(linked.type, linked.id)
          }

          map.on('click', baseLayerId, handleRouteClick)
          map.on('click', animLayerId, handleRouteClick)
          map.on('mouseenter', baseLayerId, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', baseLayerId, () => { map.getCanvas().style.cursor = '' })

          return {
            route,
            baseSourceId,
            animSourceId,
            baseLayerId,
            animLayerId,
            currentPath: seededPath,
            animationPath: seededPath,
            routeSource: 'seeded',
            lengthMeters: Math.max(computePathLengthMeters(seededPath || []), 1),
            offset: 0,
            dashOffset: 0,
            nominalSpeedMetersPerSecond:
              (route.tone === 'warning'
                ? 60000
                : route.tone === 'muted'
                  ? 35000
                  : 50000) * SPEED_REDUCTION_FACTOR,
            loopDurationSeconds: 24,
            shouldAnimate: true,
            visible: true,
          }
        })

        // Fetch OSRM-driven paths asynchronously; fall back to seeded path on
        // failure. OSRM demo policy is throttled via the shared helper.
        for (const entry of routeEntriesRef.current) {
          try {
            const result = await resolveDrivingPath(entry.route)
            if (cancelled) return
            const drivingPath = result.path
            entry.currentPath = drivingPath
            entry.animationPath = buildAnimatedPath(drivingPath)
            entry.routeSource = result.source
            entry.lengthMeters = Math.max(computePathLengthMeters(drivingPath), 1)
            const baseSource = map.getSource(entry.baseSourceId)
            if (baseSource) baseSource.setData(pathToGeoJSON(drivingPath))
            const animSource = map.getSource(entry.animSourceId)
            if (animSource) animSource.setData(pathToGeoJSON(entry.animationPath))
            if (result.source === 'directions') {
              onHydrateRouteDetails?.(entry.route.id, {
                path: drivingPath,
                durationSeconds: result.durationSeconds,
                durationText: result.durationText,
                distanceMeters: result.distanceMeters,
                distanceText: result.distanceText,
              })
            }
          } catch {
            if (routingAvailabilityRef.current === 'unavailable') break
          }
        }

        // ----- Location markers (diamond + pulse) -----
        markerEntriesRef.current = initialLocations.map((location) => {
          const element = buildLocationMarkerElement(location)
          const marker = new maplibregl.Marker({ element, anchor: 'center' })
            .setLngLat(ll(location.coordinates))
            .addTo(map)

          const pulseElement = buildPulseMarkerElement()
          pulseElement.style.setProperty('--pulse-stroke', colorForCategory(location))
          pulseElement.style.setProperty('--pulse-fill', `${colorForCategory(location)}22`)
          const pulseMarker = new maplibregl.Marker({ element: pulseElement, anchor: 'center' })
            .setLngLat(ll(location.coordinates))

          const popup = new maplibregl.Popup({
            closeButton: true,
            closeOnClick: false,
            maxWidth: '340px',
            offset: 14,
          }).setHTML(buildLocationBriefingContent(location))

          element.addEventListener('click', (event) => {
            event.stopPropagation()
            popup.setLngLat(ll(location.coordinates)).addTo(map)
            onSelectEntity('location', location.id)
          })

          return {
            location,
            marker,
            markerElement: element,
            pulseMarker,
            pulseElement,
            pulseAttached: false,
            markerVisible: true,
            popup,
            pulseOffset: Math.random(),
            pulseVisible: false,
            isPlaybackHighlighted: false,
          }
        })

        // ----- Nominatim hydration (per-marker, rate-limited to 1 req/s) -----
        // Runs only when LIVE_EXTERNAL_DATA is on. Sequentially awaited so
        // `fetchNominatim` can enforce the 1 req/s policy across the whole loop.
        if (LIVE_EXTERNAL_DATA) {
          for (const entry of markerEntriesRef.current) {
            if (cancelled) return
            try {
              const matched = await resolvePlaceMatch(entry.location)
              if (cancelled) return
              if (!matched || matched.status !== 'ok' || !matched.coordinates) continue

              entry.location = {
                ...entry.location,
                title: matched.name || entry.location.title,
                address: matched.address || entry.location.address,
                coordinates: matched.coordinates,
                placeId: matched.placeId || entry.location.placeId,
                externalUrl: matched.externalUrl || entry.location.externalUrl,
                osmCategory: matched.category || entry.location.osmCategory,
                osmType: matched.type || entry.location.osmType,
              }

              const coords = matched.coordinates
              entry.marker.setLngLat(ll(coords))
              entry.pulseMarker?.setLngLat(ll(coords))
              entry.popup?.setHTML(buildLocationBriefingContent(entry.location))

              onHydrateLocationDetails?.(entry.location.id, {
                title: entry.location.title,
                address: entry.location.address,
                coordinates: coords,
                placeId: entry.location.placeId,
                externalUrl: entry.location.externalUrl,
                osmCategory: entry.location.osmCategory,
                osmType: entry.location.osmType,
              })

              // Fire-and-forget Wikimedia Commons photo enrichment. We do NOT
              // await this — the Nominatim loop is already serialised at 1
              // req/s, piling Wikimedia on top would stall hydration visibly.
              // The helper has its own 250 ms gap + 14-day localStorage cache.
              const wikiQuery = entry.location.placesQuery || entry.location.title || entry.location.name
              if (wikiQuery) {
                const targetId = entry.location.id
                fetchWikimediaPhotos(wikiQuery, 3)
                  .then((photos) => {
                    if (cancelled || !photos?.length) return
                    // Re-find the live entry — hydration order is async and
                    // the ref may have been rebuilt (unmount/remount).
                    const live = markerEntriesRef.current.find((item) => item?.location?.id === targetId)
                    if (!live) return
                    live.location = { ...live.location, livePhotos: photos }
                    live.popup?.setHTML(buildLocationBriefingContent(live.location))
                    // Propagate upwards so external state (InspectorRail, etc.)
                    // sees the photos too.
                    onHydrateLocationDetails?.(targetId, { livePhotos: photos })
                  })
                  .catch(() => { /* helper already logs */ })
              }
            } catch (error) {
              console.warn('[TripCommand] Nominatim hydration skipped for', entry.location?.id, error?.message || error)
              if (placesAvailabilityRef.current === 'unavailable') break
            }
          }
        }

        // ----- Vehicle markers (arrow) with radar marker -----
        vehicleEntriesRef.current = families.map((family) => {
          const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
          const originPosition = getRouteOrigin(family, routeEntry?.route, routeEntry?.route.path)
          const color = getVehicleColor(routeEntry?.route)
          const { wrapper, arrow } = buildVehicleMarkerElement(color)

          const marker = new maplibregl.Marker({ element: wrapper, anchor: 'center' })
            .setLngLat(ll(originPosition || initialBasecampCenter))
          if (originPosition) marker.addTo(map)

          const radarElement = buildRadarMarkerElement()
          const radarMarker = new maplibregl.Marker({ element: radarElement, anchor: 'center' })
            .setLngLat(ll(originPosition || initialBasecampCenter))

          wrapper.addEventListener('click', () => {
            // Currently no dedicated selector for vehicles — clicking falls
            // through to the nearest route if needed.
          })

          return {
            family,
            routeEntry,
            marker,
            markerElement: wrapper,
            arrowElement: arrow,
            radarMarker,
            radarElement,
            radarAttached: false,
            markerVisible: Boolean(originPosition),
            currentPosition: originPosition || null,
            targetPosition: originPosition || null,
            currentHeading: 0,
            targetHeading: 0,
            alertVisible: false,
            alertTone: color,
          }
        })

        setStatus('ready')
        setStatusDetail(
          LIVE_EXTERNAL_DATA
            ? 'OpenFreeMap tiles online — routing via OSRM demo'
            : 'Seeded demo map online with bundled route intel',
        )
      } catch (error) {
        if (cancelled) return
        setStatus('error')
        setStatusDetail(error?.message || 'Map failed to load')
      }
    }

    initializeMap()

    return () => {
      cancelled = true
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      lastAnimationTimestampRef.current = null

      const map = mapRef.current
      markerEntriesRef.current.forEach(({ marker, pulseMarker, popup }) => {
        popup?.remove()
        pulseMarker?.remove()
        marker?.remove()
      })
      vehicleEntriesRef.current.forEach(({ marker, radarMarker }) => {
        radarMarker?.remove()
        marker?.remove()
      })
      if (map) {
        routeEntriesRef.current.forEach(({ baseLayerId, animLayerId, baseSourceId, animSourceId }) => {
          try { if (map.getLayer(baseLayerId)) map.removeLayer(baseLayerId) } catch {}
          try { if (map.getLayer(animLayerId)) map.removeLayer(animLayerId) } catch {}
          try { if (map.getSource(baseSourceId)) map.removeSource(baseSourceId) } catch {}
          try { if (map.getSource(animSourceId)) map.removeSource(animSourceId) } catch {}
        })
        try { map.remove() } catch {}
      }
      mapRef.current = null
      mapReadyRef.current = false
      routeEntriesRef.current = []
      markerEntriesRef.current = []
      vehicleEntriesRef.current = []
    }
  }, [onHydrateLocationDetails, onHydrateRouteDetails, onSelectEntity])

  useEffect(() => {
    if (status !== 'ready') return

    markerEntriesRef.current.forEach((entry) => {
      const latestLocation = locations.find((location) => location.id === entry.location.id)
      if (!latestLocation) return

      entry.location = latestLocation
      entry.marker.setLngLat(ll(latestLocation.coordinates))
      entry.pulseMarker?.setLngLat(ll(latestLocation.coordinates))
      entry.popup.setHTML(buildLocationBriefingContent(latestLocation))
    })
  }, [locations, status])

  useEffect(() => {
    if (status !== 'ready') return

    vehicleEntriesRef.current.forEach((entry) => {
      const latestFamily = families.find((family) => family.id === entry.family.id)
      const latestRouteEntry = pickFamilyRouteEntry(
        routeEntriesRef.current,
        entry.family.id,
        cursorSlot,
        effectiveFocusDayId,
        itineraryItems,
      )
      if (!latestFamily || !latestRouteEntry) return

      entry.family = latestFamily
      entry.routeEntry = latestRouteEntry
      // MapLibre marker has no title tooltip — marker element carries meaning
      // via position + color.
    })
  }, [cursorSlot, effectiveFocusDayId, families, itineraryItems, routes, status])

  useEffect(() => {
    if (status !== 'ready') return

    routeEntriesRef.current.forEach((entry) => {
      const latestRoute = routes.find((route) => route.id === entry.route.id)
      if (!latestRoute) return
      entry.route = latestRoute
    })
  }, [routes, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    let targetLocationId = playbackActive ? playbackHighlightLocationId : null

    if (playbackActive && !targetLocationId) {
      const locationsById = new Map(locations.map((location) => [location.id, location]))
      vehicleEntriesRef.current.some((entry) => {
        if (!entry.markerVisible) return false
        if (!entry.isInTransit) return false
        const markerPosition = entry.currentPosition
        if (!markerPosition) return false
        const route = entry.routeEntry?.route
        const nearestStop = findNearestPlaybackStop(
          markerPosition,
          route,
          locationsById,
        )
        if (!nearestStop) return false
        targetLocationId = nearestStop.id
        return true
      })
    }

    if (!playbackActive || !targetLocationId) {
      playbackStopSelectionRef.current = null
      return
    }

    const targetEntry = markerEntriesRef.current.find((entry) => entry.location.id === targetLocationId)
    if (!targetEntry) return

    if (playbackStopSelectionRef.current === targetLocationId) {
      return
    }

    playbackStopSelectionRef.current = targetLocationId
    console.info('[TripCommand] Playback focused stop', {
      cursorSlot,
      locationId: targetLocationId,
    })
    onSelectEntity('location', targetLocationId)
  }, [cursorSlot, locations, onSelectEntity, playbackActive, playbackHighlightLocationId, status])

  useEffect(() => {
    if (status !== 'ready') return

    let mounted = true

    const animate = (timestamp) => {
      const previousTimestamp = lastAnimationTimestampRef.current ?? timestamp
      const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.1)
      lastAnimationTimestampRef.current = timestamp
      const cameraAnimationAlpha = 1 - Math.exp(-deltaSeconds * 2.7)
      const map = mapRef.current

      // Route travelling-band animation via `line-gradient` on the animLayer.
      //
      // Why not `setPaintProperty('line-dasharray', …)` anymore?
      //   Driving dasharray from RAF burns through MapLibre's LineAtlas
      //   (256 slots, allocated per unique dash pattern). The atlas fills up
      //   after ~a few seconds and the next frame crashes inside
      //   `setConstantDashPositions` with "Cannot read properties of null".
      //
      // Why not `line-trim-offset`?
      //   Not available on maplibre-gl@5.23 (added in a later minor). The
      //   gradient approach works on every 5.x release.
      //
      // How it works:
      //   Each animLayer source was created with `lineMetrics: true`, which
      //   exposes the `['line-progress']` feature-state data expression (0 at
      //   the start of the line, 1 at the end). We compose a gradient with
      //   three stops — transparent / tone-color / transparent — centred on
      //   a `phase` that cycles 0→1 over the route's `loopDurationSeconds`.
      //   The narrow visible band (width ~0.16) reads as a "travelling dash".
      //
      // Cost: one `setPaintProperty('line-gradient', expr)` per visible route
      // per frame. The expression is a plain JSON array that MapLibre
      // re-compiles into a shader uniform — no atlas allocation, no texture
      // upload, no per-vertex work. Safe at 60 fps.
      if (map) {
        routeEntriesRef.current.forEach((entry) => {
          if (!entry?.animLayerId || !entry.visible) return
          const seconds = timestamp / 1000
          const loopSeconds = Math.max(entry.loopDurationSeconds || 24, 4)
          const phase = (((seconds % loopSeconds) / loopSeconds) + (entry.offset || 0)) % 1
          const tone = TONE_COLORS[entry.route?.tone] || TONE_COLORS.info
          const halfBand = 0.08
          // Clamp edge stops to [0, 1]; when `phase` wraps near the edges we
          // simply let the visible band "exit" and "re-enter" — MapLibre
          // accepts non-monotonic expression inputs by sorting, so we keep
          // the stops in strict ascending order ourselves.
          const a = Math.max(0, phase - halfBand)
          const c = Math.min(1, phase + halfBand)
          const expression = [
            'interpolate',
            ['linear'],
            ['line-progress'],
            0, 'rgba(0,0,0,0)',
            a, 'rgba(0,0,0,0)',
            phase, tone,
            c, 'rgba(0,0,0,0)',
            1, 'rgba(0,0,0,0)',
          ]
          if (!entry.shouldAnimate) {
            // Paused / hidden — collapse the band so the layer becomes fully
            // transparent without flipping visibility (which would thrash
            // tile rendering).
            try {
              map.setPaintProperty(entry.animLayerId, 'line-gradient', [
                'interpolate', ['linear'], ['line-progress'],
                0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)',
              ])
            } catch { /* layer removed mid-frame */ }
            return
          }
          try {
            map.setPaintProperty(entry.animLayerId, 'line-gradient', expression)
          } catch {
            // Layer may have been torn down between scheduling and execution;
            // ignore — the next effect cycle will re-register the layer.
          }
        })
      }

      vehicleEntriesRef.current.forEach((entry) => {
        if (!entry.radarElement) return
        if (!entry.alertVisible || !entry.currentPosition) {
          if (entry.radarAttached) {
            entry.radarMarker.remove()
            entry.radarAttached = false
          }
          entry.radarElement.style.setProperty('--radar-opacity', 0)
          return
        }

        const pulsePhase = (((timestamp / 1000) * 1.18) + (entry.family?.id === 'north-star' ? 0.12 : entry.family?.id === 'silver-peak' ? 0.34 : 0.56)) % 1
        const cycle = 1 - pulsePhase
        if (!entry.radarAttached && map) {
          entry.radarMarker.addTo(map)
          entry.radarAttached = true
        }
        entry.radarMarker.setLngLat(ll(entry.currentPosition))
        const tone = entry.alertTone || '#58A6FF'
        entry.radarElement.style.setProperty('--radar-stroke', tone)
        entry.radarElement.style.setProperty('--radar-fill', `${tone}10`)
        entry.radarElement.style.setProperty('--radar-opacity', (0.34 * cycle).toFixed(3))
        entry.radarElement.style.setProperty('--radar-scale', (0.9 + pulsePhase * 1.4).toFixed(3))
      })

      markerEntriesRef.current.forEach((entry) => {
        if (!entry.pulseElement) return
        if (!entry.pulseVisible || !entry.markerVisible) {
          if (entry.pulseAttached) {
            entry.pulseMarker.remove()
            entry.pulseAttached = false
          }
          entry.pulseElement.style.setProperty('--pulse-opacity', 0)
          return
        }

        const pulsePhase = (((timestamp / 1000) * 0.92) + entry.pulseOffset) % 1
        const cycle = 1 - pulsePhase
        const pulseScale = entry.isPlaybackHighlighted ? 1 + pulsePhase * 1.5 : 0.8 + pulsePhase * 1
        const pulseStrokeOpacity = (entry.isPlaybackHighlighted ? 0.28 : 0.18) * cycle
        const pulseColor = colorForCategory(entry.location)

        if (!entry.pulseAttached && map) {
          entry.pulseMarker.addTo(map)
          entry.pulseAttached = true
        }
        entry.pulseMarker.setLngLat(ll(entry.location.coordinates))
        entry.pulseElement.style.setProperty('--pulse-stroke', pulseColor)
        entry.pulseElement.style.setProperty('--pulse-fill', `${pulseColor}14`)
        entry.pulseElement.style.setProperty('--pulse-opacity', pulseStrokeOpacity.toFixed(3))
        entry.pulseElement.style.setProperty('--pulse-scale', pulseScale.toFixed(3))
      })

      const cameraTarget = playbackCameraTargetRef.current
      if (map && cameraTarget?.center) {
        const mapCenter = map.getCenter()
        const baseCameraState = cameraStateRef.current || {
          center: mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : cameraTarget.center,
          zoom: map.getZoom() || cameraTarget.zoom,
        }
        const nextCenter = lerpPoint(baseCameraState.center, cameraTarget.center, cameraAnimationAlpha)
        const nextZoom = lerp(baseCameraState.zoom, cameraTarget.zoom, cameraAnimationAlpha)
        cameraStateRef.current = {
          center: nextCenter,
          zoom: nextZoom,
        }

        try {
          map.jumpTo({ center: ll(nextCenter), zoom: nextZoom })
        } catch {
          /* ignore */
        }
      }

      if (mounted) {
        animationFrameRef.current = requestAnimationFrame(animate)
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate)

    return () => {
      mounted = false
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      lastAnimationTimestampRef.current = null
    }
  }, [status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    const locationsById = new Map(locations.map((location) => [location.id, location]))
    let playbackAutoLocationId = playbackHighlightLocationId || null

    if (playbackActive && !playbackAutoLocationId) {
      vehicleEntriesRef.current.some((entry) => {
        if (!entry.isInTransit) return false
        const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, entry.family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
        if (!routeEntry) return false

        const { family } = entry
        const { route } = routeEntry
        const relevantToFocus =
          matchesDay(route.dayId, effectiveFocusDayId) &&
          (mapUi.focusFamilyId === 'all' || mapUi.focusFamilyId === family.id)
        const selectedRoute = selectedRouteId === route.id
        const visible = mapUi.showRoutes && (relevantToFocus || selectedRoute)

        if (!visible) return false

        const path = getRoutePath(routeEntry)
        const pathProfile = buildPathDistanceProfile(path)
        const origin = getRouteOrigin(family, route, path)
        const destination = path?.[path.length - 1] || origin
        const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
        const rawProgress = endSlot === startSlot ? 1 : (cursorSlot - startSlot) / (endSlot - startSlot)
        const { progress: mappedProgress } = getRoutePlaybackProgress(
          routeEntry,
          pathProfile,
          locationsById,
          rawProgress,
          endSlot - startSlot,
        )

        let position = origin
        if (cursorSlot >= endSlot) {
          position = destination
        } else if (cursorSlot > startSlot) {
          position = interpolateAlongPath(pathProfile, mappedProgress) || origin
        }

        const nearestStop = findNearestPlaybackStop(position, route, locationsById)
        if (!nearestStop) return false

        playbackAutoLocationId = nearestStop.id
        return true
      })
    }

    routeEntriesRef.current.forEach((entry) => {
      const { route, baseLayerId, animLayerId } = entry
      const visible =
        route.id === selectedRouteId ||
        (mapUi.showRoutes &&
          matchesDay(route.dayId, effectiveFocusDayId) &&
          (mapUi.focusFamilyId === 'all' || route.familyId === 'all' || route.familyId === mapUi.focusFamilyId))
      const emphasized =
        visible && (route.id === selectedRouteId || mapUi.focusFamilyId !== 'all' || mapUi.focusDayId !== 'all')
      const hasSpecificFocus = mapUi.focusFamilyId !== 'all' || mapUi.focusDayId !== 'all'

      try {
        map.setLayoutProperty(baseLayerId, 'visibility', visible ? 'visible' : 'none')
        map.setLayoutProperty(animLayerId, 'visibility', visible ? 'visible' : 'none')
        map.setPaintProperty(baseLayerId, 'line-color', TONE_COLORS[route.tone] || TONE_COLORS.info)
        map.setPaintProperty(
          baseLayerId,
          'line-opacity',
          route.tone === 'muted'
            ? emphasized ? 0.44 : 0.24
            : emphasized ? 0.64 : 0.26,
        )
        map.setPaintProperty(
          baseLayerId,
          'line-width',
          route.tone === 'muted'
            ? emphasized ? 2.6 : 1.8
            : emphasized ? 3.2 : 2.1,
        )
        // animLayer colour travels through `line-gradient` (set from the RAF
        // loop), not `line-color` — setting both would make MapLibre ignore
        // the gradient entirely. We only drive opacity + width here.
        map.setPaintProperty(
          animLayerId,
          'line-opacity',
          entry.routeSource === 'directions'
            ? emphasized ? 0.72 : 0.3
            : route.tone === 'muted' ? (emphasized ? 0.62 : 0.34) : emphasized ? 0.95 : 0.55,
        )
        map.setPaintProperty(
          animLayerId,
          'line-width',
          entry.routeSource === 'directions'
            ? emphasized ? 3.1 : 2.4
            : route.tone === 'muted' ? (emphasized ? 2.9 : 2.3) : emphasized ? 3.6 : 3,
        )
      } catch {
        // Layer may have been removed; ignore.
      }

      const nominalLoopDuration = entry.lengthMeters / entry.nominalSpeedMetersPerSecond
      entry.loopDurationSeconds = Math.min(
        Math.max(nominalLoopDuration, MIN_ROUTE_LOOP_SECONDS),
        MAX_ROUTE_LOOP_SECONDS,
      )
      entry.shouldAnimate =
        visible &&
        (route.id === selectedRouteId ||
          (entry.routeSource === 'seeded' && (!hasSpecificFocus || emphasized)))
      entry.visible = visible
    })

    markerEntriesRef.current.forEach((entry) => {
      const { location, marker, markerElement } = entry
      const highlightedByPlayback = playbackActive && location.id === playbackAutoLocationId
      const visible =
        location.id === selectedLocationId ||
        highlightedByPlayback ||
        (isFacility(location)
          ? mapUi.showFacilities && matchesDay(location.dayId, effectiveFocusDayId)
          : mapUi.showRoutes && matchesDay(location.dayId, effectiveFocusDayId))

      if (visible && !entry.markerVisible) {
        marker.addTo(map)
      } else if (!visible && entry.markerVisible) {
        marker.remove()
        entry.popup?.remove()
      }
      entry.markerVisible = visible
      entry.isPlaybackHighlighted = highlightedByPlayback
      entry.pulseVisible = visible && (location.id === selectedLocationId || highlightedByPlayback)

      marker.setLngLat(ll(location.coordinates))
      markerElement.style.setProperty('--marker-color', colorForCategory(location))
      markerElement.classList.toggle(
        'is-active',
        location.id === selectedLocationId || highlightedByPlayback,
      )
    })

    vehicleEntriesRef.current.forEach((entry) => {
      const routeEntry = pickFamilyRouteEntry(routeEntriesRef.current, entry.family.id, cursorSlot, effectiveFocusDayId, itineraryItems)
      if (!routeEntry) {
        if (entry.markerVisible) {
          entry.marker.remove()
          entry.markerVisible = false
        }
        entry.isInTransit = false
        entry.isPreMove = false
        entry.cameraLeadPosition = null
        entry.routePathProfile = null
        entry.routePlaybackProgress = null
        return
      }

      entry.routeEntry = routeEntry

      const { family } = entry
      const { route } = routeEntry
      const relevantToFocus =
        matchesDay(route.dayId, effectiveFocusDayId) &&
        (mapUi.focusFamilyId === 'all' || mapUi.focusFamilyId === family.id)
      const selectedFamily = mapUi.focusFamilyId === family.id
      const selectedRoute = selectedRouteId === route.id
      const visible = mapUi.showRoutes && (relevantToFocus || selectedRoute)

      if (!visible) {
        if (entry.markerVisible) {
          entry.marker.remove()
          entry.markerVisible = false
        }
        entry.isInTransit = false
        entry.isPreMove = false
        entry.cameraLeadPosition = null
        entry.routePathProfile = null
        entry.routePlaybackProgress = null
        return
      }

      const path = getRoutePath(routeEntry)
      const pathProfile = buildPathDistanceProfile(path)
      const origin = getRouteOrigin(family, route, path)
      const destination = path?.[path.length - 1] || origin
      const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
      const rawProgress = endSlot === startSlot ? 1 : (cursorSlot - startSlot) / (endSlot - startSlot)
      const { progress: mappedProgress } = getRoutePlaybackProgress(
        routeEntry,
        pathProfile,
        locationsById,
        rawProgress,
        endSlot - startSlot,
      )

      let position = origin
      if (cursorSlot >= endSlot) {
        position = destination
      } else if (cursorSlot > startSlot) {
        position = interpolateAlongPath(pathProfile, mappedProgress) || origin
      }

      const lookaheadMeters = pathProfile ? Math.min(Math.max(pathProfile.totalDistance * 0.018, 180), 1400) : 420
      const nextProgress = pathProfile?.totalDistance
        ? clamp01(mappedProgress + lookaheadMeters / pathProfile.totalDistance)
        : clamp01(Math.min(mappedProgress + 0.01, 1))
      const nextPosition =
        cursorSlot >= endSlot
          ? destination
          : interpolateAlongPath(pathProfile, nextProgress) || destination
      const heading =
        position && nextPosition ? computeBearingDegrees(position, nextPosition) || 0 : 0
      const emphasized = selectedRoute || selectedFamily
      const fillColor = getVehicleColor(route)
      const alertWindowSlots = 0.34
      const preMoveWindowStart = startSlot - alertWindowSlots
      const aboutToMove = cursorSlot < startSlot && cursorSlot >= preMoveWindowStart
      const inTransit = cursorSlot >= startSlot && cursorSlot <= endSlot

      if (!entry.markerVisible) {
        entry.marker.addTo(map)
      }
      entry.markerVisible = true
      entry.targetPosition = position
      entry.targetHeading = heading
      entry.currentPosition = position
      entry.currentHeading = heading
      entry.cameraLeadPosition = nextPosition
      entry.isInTransit = inTransit
      entry.isPreMove = aboutToMove
      entry.routePathProfile = pathProfile
      entry.routePlaybackProgress = mappedProgress
      entry.alertVisible = aboutToMove
      entry.alertTone = fillColor

      entry.marker.setLngLat(ll(position))
      // setRotation — MapLibre gives us bearing-controlled rotation on the
      // marker itself (equivalent to google SymbolPath rotation).
      if (typeof entry.marker.setRotation === 'function') {
        entry.marker.setRotation(heading)
      } else {
        entry.arrowElement.style.transform = `rotate(${heading}deg)`
      }
      entry.arrowElement.style.setProperty('--vehicle-color', fillColor)
      entry.markerElement.style.opacity = emphasized ? 1 : 0.9
      entry.markerElement.style.zIndex = emphasized ? 85 : 60
    })

    // Traffic layer is not supported by OpenFreeMap — the UI toggle becomes
    // purely cosmetic (the subtle red overlay in the DOM reacts to showTraffic
    // already).
    if (mapUi.showTraffic) {
      // TODO: MapLibre traffic parity — swap in a tile source from an
      // external traffic provider when available.
    }
  }, [cursorSlot, effectiveFocusDayId, itineraryItems, locations, mapUi, playbackActive, playbackHighlightLocationId, selectedLocationId, selectedRouteId, status])

  useEffect(() => {
    if (status !== 'ready') return

    if (!playbackActive) {
      prevCursorSlotRef.current = null
      playbackCueKeysRef.current.clear()
      return
    }

    const previousCursor = prevCursorSlotRef.current
    if (previousCursor != null && cursorSlot + 0.12 < previousCursor) {
      playbackCueKeysRef.current.clear()
    }

    const locationsById = new Map(locations.map((location) => [location.id, location]))
    const crossedThreshold = (threshold) => {
      if (previousCursor == null) {
        return cursorSlot >= threshold && cursorSlot <= threshold + 0.08
      }
      return previousCursor < threshold && cursorSlot >= threshold
    }

    const onsiteEntities = [
      ...meals,
      ...activities,
      ...itineraryItems.filter((item) => item.rowId !== 'travel' && item.locationId),
    ].filter((entity) => entity.locationId && matchesDay(entity.dayId, effectiveFocusDayId))

    const crossedOnsiteEntityGroups = collapseOnsiteCueEntities(
      onsiteEntities.filter((entity) => crossedThreshold(entity.startSlot)),
    )
    const hasNearbyOnsitePhase = (locationId, slot) =>
      onsiteEntities.some(
        (entity) =>
          entity.locationId === locationId &&
          entity.startSlot >= slot &&
          entity.startSlot <= slot + 0.22,
      )

    const candidates = []

    vehicleEntriesRef.current.forEach((entry) => {
      if (!entry.markerVisible || !entry.routeEntry) return false

      const { family, routeEntry } = entry
      const { route } = routeEntry
      const { startSlot, endSlot } = getRouteSimulationWindow(route, itineraryItems)
      const position = entry.currentPosition || entry.targetPosition

      if (crossedThreshold(startSlot)) {
        candidates.push({
          groupKey: `departure:${route.dayId}:${route.destinationLocationId || route.id}`,
          cueKey: buildPlaybackCueKey({
            kind: 'departure',
            route,
            location: route.destinationLocationId ? locationsById.get(route.destinationLocationId) || null : null,
            slot: startSlot,
          }),
          kind: 'departure',
          family,
          route,
          location: route.destinationLocationId ? locationsById.get(route.destinationLocationId) || null : null,
          anchor: position || route.originCoordinates || null,
        })
        return
      }

      if (!position) return

      const stopLocations = [...(route.stopLocationIds || []), route.destinationLocationId]
        .filter(Boolean)
        .map((locationId) => locationsById.get(locationId))
        .filter((location) => location?.coordinates)

      for (const location of stopLocations) {
        const distanceMeters = computeDistanceBetweenMeters(position, location.coordinates)
        const isArrival = location.id === route.destinationLocationId
        const threshold = isArrival ? 2200 : 1800
        if (distanceMeters <= threshold) {
          if (isArrival && hasNearbyOnsitePhase(location.id, endSlot)) {
            return
          }
          const cueKind = isArrival || crossedThreshold(endSlot) ? 'arrival' : 'stop'
          candidates.push({
            groupKey: `${cueKind}:${route.dayId}:${location.id}`,
            cueKey: buildPlaybackCueKey({
              kind: cueKind,
              route,
              location,
              slot: isArrival ? endSlot : startSlot,
            }),
            kind: cueKind,
            family,
            route,
            location,
            anchor: location.coordinates,
          })
          return
        }
      }
    })

    crossedOnsiteEntityGroups.forEach((group) => {
      const entity = group.primary
      const location = locationsById.get(entity.locationId)
      if (!location) return

      const visibleFamilies = vehicleEntriesRef.current
        .filter((entry) => entry.markerVisible)
        .map((entry) => entry.family)
      const cueFamilies = resolveOnsiteCueFamilies(group, itineraryItems, routeEntriesRef.current, families)

      candidates.push({
        groupKey: `onsite:${entity.dayId}:${entity.locationId}:${Math.round(entity.startSlot * 100)}`,
        cueKey: buildPlaybackCueKey({
          kind: 'onsite',
          entity,
          location,
          slot: entity.startSlot,
        }),
        kind: 'onsite',
        entity,
        location,
        route: visibleFamilies[0]?.id
          ? vehicleEntriesRef.current.find((entry) => entry.family.id === visibleFamilies[0].id)?.routeEntry?.route || null
          : null,
        families: cueFamilies.length ? cueFamilies : visibleFamilies.length ? visibleFamilies : families,
        anchor: location.coordinates,
      })
    })

    let cuesToShow = []
    if (candidates.length) {
      const grouped = new Map()
      candidates.forEach((candidate) => {
        const existing = grouped.get(candidate.groupKey) || {
          cueKey: candidate.cueKey,
          kind: candidate.kind,
          route: candidate.route,
          location: candidate.location,
          entity: candidate.entity || null,
          families: candidate.families ? [...candidate.families] : [],
          anchors: [],
        }
        if (candidate.family) existing.families.push(candidate.family)
        if (candidate.families?.length) {
          existing.families = candidate.families
        }
        if (candidate.anchor) existing.anchors.push(candidate.anchor)
        grouped.set(candidate.groupKey, existing)
      })

      cuesToShow = [...grouped.values()]
        .sort((left, right) => right.families.length - left.families.length)
        .map((group) => buildPlaybackCue({
          cueKey: group.cueKey,
          families: group.families,
          route: group.route,
          kind: group.kind,
          location: group.location,
          anchor: averagePoint(group.anchors) || group.location?.coordinates || null,
          entity: group.entity,
          subtitleOverride:
            group.kind === 'onsite'
              ? group.entity?.type === 'meal' ? 'Meal on site' : 'On site'
              : null,
          captionOverride: group.kind === 'onsite' ? group.entity?.title || null : null,
        }))
        .filter(Boolean)
    }

    if (cuesToShow.length) {
      showPlaybackCues(cuesToShow)
    }

    prevCursorSlotRef.current = cursorSlot
  }, [activities, cursorSlot, effectiveFocusDayId, families, itineraryItems, locations, meals, playbackActive, showPlaybackCues, status])

  useEffect(() => {
    const map = mapRef.current
    const selectedLocation = locations.find((location) => location.id === selectedLocationId)
    const selectedRouteEntry = routeEntriesRef.current.find((entry) => entry.route.id === selectedRouteId)
    if (!map || status !== 'ready') return

    const highlightedLocation =
      locations.find((location) => location.id === playbackHighlightLocationId) ||
      locations.find((location) => location.id === playbackStopSelectionRef.current) ||
      (!playbackActive ? locations.find((location) => location.id === selectedLocationId) : null)

    const participantCameraTarget = buildParticipantCameraTarget({
      map,
      vehicleEntries: vehicleEntriesRef.current,
      highlightedLocation,
      cursorSlot,
    })

    if (participantCameraTarget && (playbackActive || (!selectedRouteEntry && !selectedLocation))) {
      playbackCameraTargetRef.current = participantCameraTarget
      lastViewportTargetRef.current = `participants:${participantCameraTarget.mode}:${participantCameraTarget.participantCount}`
      return
    }

    playbackCameraTargetRef.current = null
    const currentCenter = map.getCenter()
    cameraStateRef.current = currentCenter
      ? {
          center: { lat: currentCenter.lat, lng: currentCenter.lng },
          zoom: map.getZoom() || cameraStateRef.current?.zoom || 7,
        }
      : cameraStateRef.current

    if (selectedRouteEntry) {
      const viewportKey = `route:${selectedRouteEntry.route.id}`
      if (lastViewportTargetRef.current === viewportKey) return
      const routePath = getRoutePath(selectedRouteEntry)
      const routeLengthMeters = selectedRouteEntry.lengthMeters || 0

      if (routeLengthMeters < 25000) {
        const midpoint = routePath[Math.floor(routePath.length / 2)]
        if (midpoint) map.panTo(ll(midpoint))
        if ((map.getZoom() || 0) < 10) {
          map.setZoom(10)
        }
      } else {
        try {
          const bounds = new maplibregl.LngLatBounds()
          routePath.forEach((point) => bounds.extend(ll(point)))
          if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 120 })
        } catch {
          /* ignore */
        }
      }

      const routeCenter = map.getCenter()
      cameraStateRef.current = routeCenter
        ? {
            center: { lat: routeCenter.lat, lng: routeCenter.lng },
            zoom: map.getZoom() || cameraStateRef.current?.zoom || 7,
          }
        : cameraStateRef.current

      lastViewportTargetRef.current = viewportKey
      return
    }

    if (selectedLocation) {
      const viewportKey = `location:${selectedLocation.id}`
      if (lastViewportTargetRef.current === viewportKey) return
      const currentMapCenter = map.getCenter()
      const distanceFromCenter = currentMapCenter
        ? computeDistanceBetweenMeters({ lat: currentMapCenter.lat, lng: currentMapCenter.lng }, selectedLocation.coordinates)
        : Infinity
      map.panTo(ll(selectedLocation.coordinates))
      if (distanceFromCenter > 6000 && (map.getZoom() || 0) < 12) {
        map.setZoom(12)
      }
      cameraStateRef.current = {
        center: selectedLocation.coordinates,
        zoom: map.getZoom() || cameraStateRef.current?.zoom || 12,
      }
      lastViewportTargetRef.current = viewportKey
      return
    }

    lastViewportTargetRef.current = ''
  }, [cursorSlot, locations, mapUi, playbackActive, playbackHighlightLocationId, selectedLocationId, selectedRouteId, status])

  const summaryText = useMemo(() => {
    const summaryBits = []
    if (mapUi.showRoutes) {
      summaryBits.push(
        mapUi.focusFamilyId === 'all'
          ? 'all family routes'
          : `${families.find((item) => item.id === mapUi.focusFamilyId)?.title || 'family'} route focus`,
      )
    }
    if (mapUi.showFacilities) summaryBits.push('logistics facilities')
    if (mapUi.showTraffic) summaryBits.push('live traffic (display only)')
    if (mapUi.focusDayId !== 'all') {
      summaryBits.push(`${DAYS.find((item) => item.id === mapUi.focusDayId)?.title.toLowerCase() || mapUi.focusDayId} focus`)
    }
    return summaryBits.length ? `Showing ${summaryBits.join(', ')}` : 'No operational layers visible'
  }, [families, mapUi])

  const badgeTone =
    status === 'ready'
      ? 'border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950]'
      : status === 'error' || status === 'missing'
        ? 'border-[#F85149]/30 bg-[#F85149]/10 text-[#F85149]'
        : 'border-[#58A6FF]/30 bg-[#58A6FF]/10 text-[#58A6FF]'
  void mapWeather // reserved for future primary-weather chip rendering

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#080a0f]">
      <div ref={containerRef} className="absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0 bg-[#071019] transition-opacity duration-300"
        style={{ opacity: mapUi.showTraffic ? 0.14 : 0 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(17,27,34,0.35)_1px,transparent_1px)] [background-size:32px_32px]" />

      {mapLayerCollapsed ? (
        <button
          type="button"
          onClick={() => setMapLayerCollapsed(false)}
          className="absolute left-6 top-6 z-20 flex items-center gap-2 border border-[#30363D] bg-[#161b22]/92 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#C9D1D9] shadow-lg backdrop-blur"
        >
          <Layers3 size={14} className="text-[#58A6FF]" />
          Map Layer
          <ChevronDown size={14} className="text-[#8B949E]" />
        </button>
      ) : (
        <div className="absolute left-6 top-6 z-20 w-[360px] border border-[#30363D] bg-[#161b22]/92 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
              Map Layer
            </div>
            <div className="flex items-center gap-2">
              <div className={`rounded-[2px] border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${badgeTone}`}>
                {status === 'ready' ? 'Map online' : status === 'loading' ? 'Loading' : 'Attention'}
              </div>
              <button type="button" onClick={() => setMapLayerCollapsed(true)} className="text-[#8B949E] hover:text-[#C9D1D9]">
                <ChevronUp size={14} />
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            <MapChip active={mapUi.showRoutes} onClick={() => onUpdateMapUi({ showRoutes: !mapUi.showRoutes })} tone="green">
              Routes
            </MapChip>
            <MapChip active={mapUi.showFacilities} onClick={() => onUpdateMapUi({ showFacilities: !mapUi.showFacilities })} tone="neutral">
              Facilities
            </MapChip>
            <MapChip active={mapUi.showTraffic} onClick={() => onUpdateMapUi({ showTraffic: !mapUi.showTraffic })} tone="amber">
              Traffic
            </MapChip>
          </div>

          <div className="mb-2 text-[8px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
            Family Focus
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[{ id: 'all', label: 'All Families' }, ...families.map((family) => ({ id: family.id, label: family.title }))].map((item) => (
              <MapChip
                key={item.id}
                active={mapUi.focusFamilyId === item.id}
                onClick={() => onUpdateMapUi({ focusFamilyId: item.id })}
              >
                {item.label}
              </MapChip>
            ))}
          </div>

          <div className="mb-2 text-[8px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
            Day Focus
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {[{ id: 'all', label: 'All Days' }, ...DAYS.map((day) => ({ id: day.id, label: day.title.replace(' Day', '') }))].map((item) => (
              <MapChip
                key={item.id}
                active={mapUi.focusDayId === item.id}
                onClick={() => onUpdateMapUi({ focusDayId: item.id })}
              >
                {item.label}
              </MapChip>
            ))}
          </div>

          <div className="border-t border-[#30363D]/60 pt-2 text-[10px] leading-relaxed text-[#8B949E]">
            {status === 'ready' ? summaryText : statusDetail}
          </div>
        </div>
      )}

      {weatherCollapsed ? (
        <button
          type="button"
          onClick={() => setWeatherCollapsed(false)}
          className="absolute right-6 top-6 z-20 flex items-center gap-2 border border-[#58A6FF]/25 bg-[#111722]/94 px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.42)] backdrop-blur"
        >
          {mapWeatherTargets.slice(0, 2).map((target) => {
            const TargetIcon = WEATHER_ICONS[target.iconKey] || Cloud
            return (
              <div key={target.id} className="flex items-center gap-1 text-[#E6EDF3]">
                <TargetIcon size={14} className={target.active ? 'text-[#7CC0FF]' : 'text-[#8B949E]'} />
                <span className="text-[10px] font-black uppercase tracking-[0.08em]">{target.temperature}</span>
              </div>
            )
          })}
          <ChevronDown size={14} className="text-[#8B949E]" />
        </button>
      ) : (
        <div className="absolute right-6 top-6 z-20 w-[292px] overflow-hidden border border-[#58A6FF]/25 bg-[linear-gradient(180deg,rgba(15,23,34,0.97),rgba(11,17,24,0.95))] shadow-[0_18px_40px_rgba(0,0,0,0.42)] backdrop-blur">
          <div className="flex items-center justify-between border-b border-[#58A6FF]/15 bg-[linear-gradient(90deg,rgba(88,166,255,0.12),rgba(88,166,255,0.02))] px-4 py-2.5">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-[#7CC0FF]">
              Weather Intel
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-[2px] border border-[#58A6FF]/35 bg-[#58A6FF]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#7CC0FF]">
                NOAA
              </div>
              <button type="button" onClick={() => setWeatherCollapsed(true)} className="text-[#8B949E] hover:text-[#C9D1D9]">
                <ChevronUp size={14} />
              </button>
            </div>
          </div>
          <div className="grid gap-px bg-[#58A6FF]/10 p-px">
            {mapWeatherTargets.length ? mapWeatherTargets.map((target) => {
              const TargetIcon = WEATHER_ICONS[target.iconKey] || Cloud
              return (
                <div
                  key={target.id}
                  className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 ${
                    target.active ? 'bg-[#131d28]' : 'bg-[#0d1117]/92'
                  }`}
                >
                  <div className={`rounded-[2px] border px-2 py-2 ${target.active ? 'border-[#58A6FF]/35 bg-[#58A6FF]/10' : 'border-[#30363D] bg-[#161b22]'}`}>
                    <TargetIcon size={16} className={target.active ? 'text-[#7CC0FF]' : 'text-[#8B949E]'} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                      {target.label}
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-[#E6EDF3]">{target.summary}</div>
                    <div className="mt-1 text-[10px] text-[#8B949E]">{target.placeLabel}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-black uppercase tracking-[0.08em] text-[#E6EDF3]">
                      {target.temperature}
                    </div>
                    {target.active ? (
                      <div className="mt-1 text-[8px] font-black uppercase tracking-[0.18em] text-[#7CC0FF]">
                        Focus
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            }) : (
              <div className="bg-[#0d1117]/92 px-4 py-4 text-[11px] text-[#8B949E]">
                Waiting for basecamp and Yosemite weather feeds.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
