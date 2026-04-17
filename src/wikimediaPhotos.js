// ---------------------------------------------------------------------------
// Wikimedia Commons photo lookup helper.
//
// Free, keyless replacement for the Google Places Photos hydration we lost
// when migrating to MapLibre + OpenFreeMap + Nominatim. Wikimedia Commons
// accepts cross-origin requests when `origin=*` is provided, so no proxy is
// required.
//
// API docs (MediaWiki action=query + generator=search, namespace 6 = File):
//   https://commons.wikimedia.org/w/api.php?action=help&modules=query
//
// Etiquette / policy:
//   * No API key. `origin=*` disables cookie-auth — CORS stays wide open.
//   * User-Agent is set by the browser; we can still declare intent via a
//     query string tag that shows up in Wikimedia server logs.
//   * Be polite: cache aggressively (localStorage, 14-day TTL) and serialise
//     requests with a short rate-limit gap (250 ms).
//   * Every response is best-effort — `null` on failure, the caller falls back
//     to the existing "◆" category icon.
// ---------------------------------------------------------------------------

const CACHE_STORAGE_KEY = 'palantir-trip:wikimedia-photos:v1'
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days
const MIN_REQUEST_GAP_MS = 250
const USER_AGENT_TAG = 'palantir-trip-command/1.0'

const inMemoryCache = new Map()
let lastRequestAt = 0
let cacheHydrated = false

// sha1 via SubtleCrypto — browser built-in, no extra dep. Falls back to a
// cheap rolling hash for non-browser environments (tests, SSR).
async function sha1(input) {
  try {
    if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
      const encoded = new TextEncoder().encode(input)
      const digest = await crypto.subtle.digest('SHA-1', encoded)
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    }
  } catch {
    /* fall through to rolling hash */
  }
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  }
  return `fb_${(hash >>> 0).toString(16)}`
}

function hydrateCacheOnce() {
  if (cacheHydrated) return
  cacheHydrated = true
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    const now = Date.now()
    Object.entries(parsed).forEach(([key, value]) => {
      if (value && typeof value.ts === 'number' && now - value.ts < CACHE_TTL_MS) {
        inMemoryCache.set(key, value)
      }
    })
  } catch {
    /* ignore — cache is best-effort */
  }
}

function persistCache() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    const snapshot = {}
    inMemoryCache.forEach((value, key) => {
      snapshot[key] = value
    })
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* ignore — cache is best-effort */
  }
}

async function enforceRateLimit() {
  const gap = Date.now() - lastRequestAt
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_GAP_MS - gap))
  }
  lastRequestAt = Date.now()
}

function normaliseQuery(query) {
  return String(query || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function parsePages(pages, limit) {
  if (!pages || typeof pages !== 'object') return []
  const rows = Object.values(pages)
  // Wikimedia returns `index` on each row — preserve search relevance order.
  rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const out = []
  for (const row of rows) {
    const info = Array.isArray(row.imageinfo) ? row.imageinfo[0] : null
    if (!info) continue
    const url = info.thumburl || info.url
    if (!url) continue
    out.push({
      url: info.url || info.thumburl,
      thumbUrl: info.thumburl || info.url,
      width: info.thumbwidth || info.width || null,
      height: info.thumbheight || info.height || null,
      title: row.title || '',
      sourceUrl: row.title
        ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(row.title)}`
        : 'https://commons.wikimedia.org/',
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Fetch up to `count` photo candidates from Wikimedia Commons matching `query`.
 * Returns `null` on error / no results. Never throws.
 *
 * Shape of each entry:
 *   { url, thumbUrl, width, height, title, sourceUrl }
 */
export async function fetchWikimediaPhotos(query, count = 3) {
  const cleaned = normaliseQuery(query)
  if (!cleaned) return null
  const limit = Math.max(1, Math.min(count | 0 || 3, 10))

  hydrateCacheOnce()

  const cacheKey = `${await sha1(cleaned)}:${limit}`
  const cached = inMemoryCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data
  }

  await enforceRateLimit()

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: cleaned,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size',
    iiurlwidth: '480',
    format: 'json',
    origin: '*',
    // Helps Wikimedia trace traffic back to this app in server logs; the
    // browser will still set its own User-Agent header.
    uselang: 'en',
  })

  const url = `https://commons.wikimedia.org/w/api.php?${params.toString()}&ua=${encodeURIComponent(USER_AGENT_TAG)}`

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Explicit CORS mode so the browser respects the `origin=*` contract.
      mode: 'cors',
      credentials: 'omit',
    })
    if (!response.ok) throw new Error(`wikimedia ${response.status}`)
    const json = await response.json()
    const pages = json?.query?.pages
    const photos = parsePages(pages, limit)
    const data = photos.length ? photos : null
    inMemoryCache.set(cacheKey, { data, ts: Date.now() })
    persistCache()
    return data
  } catch (error) {
    // Cache short-lived nulls too so we don't hammer the API on transient
    // failures (TTL still 14d, errors unblock themselves when cache expires).
    inMemoryCache.set(cacheKey, { data: null, ts: Date.now() })
    persistCache()
    if (typeof console !== 'undefined') {
      console.warn('[TripCommand] Wikimedia lookup failed:', error?.message || error)
    }
    return null
  }
}

export default fetchWikimediaPhotos
