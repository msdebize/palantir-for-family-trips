import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  CarFront,
  Cloud,
  CloudRain,
  Download,
  ExternalLink,
  Flag,
  Gauge,
  Globe,
  Home,
  LayoutGrid,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Pause,
  Phone,
  Play,
  Receipt,
  RotateCcw,
  Route,
  Search,
  Settings,
  Star,
  Sun,
  Users,
  Utensils,
  X,
} from 'lucide-react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import palantirLogo from './assets/palantir-logo.svg'
import CommandMap from './CommandMap'
import InspectorRail from './InspectorRail'
import { PUBLISH_CONFIG, isLiveExternalDataEnabled } from './publishConfig'
import { usePersistedTripState } from './usePersistedTripState'
import { DAYS, INITIAL_FAMILIES, NAV_ITEMS, TIME_SLOTS, TRIP_META } from './tripData'
import {
  ENTITY_PAGE,
  ensureSelectionForPage,
  getDayMeta,
  getEntityById,
  getEntityBySelection,
  getEntitySummary,
  getEntityTitle,
  getFamilyReadiness,
  TRIP_DOCUMENT_STORAGE_KEY,
  VIEWER_PROFILE_STORAGE_KEY,
  clearLegacyTripStorage,
  getInitialTripDocument,
  getLinkedEntities,
  getLocationForEntity,
  getPageNote,
  getRouteForEntity,
  getItineraryItemEffectiveSpan,
  getRouteSimulationWindow,
  getSearchResults,
  getSlotLabel,
  getTasksByFamily,
  getTasksForDay,
  getTasksForEntity,
  getTimelineContext,
  makeEntityKey,
  projectTripDocument,
  synchronizeRoutePaths,
  updateEntityInCollection,
} from './tripModel'
import { fetchWeatherBundle, getMapWeather, getMapWeatherTargets, getTripDayWeather } from './weather'

// Google Maps constants removed — enrichment disabled; map migrated to MapLibre+OSRM.

function cn(...inputs) {
  return twMerge(clsx(inputs))
}

const PAGE_ICONS = {
  itinerary: LayoutGrid,
  stay: Home,
  meals: Utensils,
  activities: MapIcon,
  expenses: Receipt,
  families: Users,
}

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

const STATUS_STYLES = {
  Transit: 'bg-[#58A6FF]/18 text-[#58A6FF]',
  'Friday Arrival': 'bg-[#D29922]/18 text-[#D29922]',
  Assigned: 'bg-[#58A6FF]/18 text-[#58A6FF]',
  Pending: 'bg-[#D29922]/18 text-[#D29922]',
  Open: 'bg-[#D29922]/18 text-[#D29922]',
  Settled: 'bg-[#3FB950]/18 text-[#3FB950]',
  Go: 'bg-[#3FB950]/18 text-[#3FB950]',
  Watch: 'bg-[#D29922]/18 text-[#D29922]',
}

const TIMELINE_COLORS = {
  info: 'border-[#58A6FF] bg-[#58A6FF]/10 text-[#C9D1D9]',
  warning: 'border-[#D29922] bg-[#D29922]/10 text-[#D29922]',
  success: 'border-[#3FB950] bg-[#3FB950]/10 text-[#3FB950]',
  critical: 'border-[#F85149] bg-[#F85149]/10 text-[#F85149]',
  violet: 'border-[#A371F7] bg-[#A371F7]/10 text-[#A371F7]',
  muted: 'border-[#4B5563] bg-[#4B5563]/10 text-[#8B949E]',
}

const EXPENSE_SPLIT_LABELS = {
  equal: 'Equal split',
  manual: 'Manual allocation',
  individual: 'Individual',
}

const PLAYBACK_SPEED_OPTIONS = [1, 2, 3, 4]
const TIMELINE_HOURS_PER_SLOT = 6
const TIMELINE_HOUR_STEPS = 24
const VISIBLE_TIMELINE_START_HOUR = 6
const VISIBLE_TIMELINE_END_HOUR = 24
const MISSION_LAUNCH_HOUR = 9
const VISIBLE_TIMELINE_SLOT_START = VISIBLE_TIMELINE_START_HOUR / TIMELINE_HOURS_PER_SLOT
const VISIBLE_TIMELINE_SLOT_END = VISIBLE_TIMELINE_END_HOUR / TIMELINE_HOURS_PER_SLOT
const VISIBLE_TIMELINE_SLOT_SPAN = VISIBLE_TIMELINE_SLOT_END - VISIBLE_TIMELINE_SLOT_START
const MISSION_TIME_PRESETS = [6, 9, 12, 15, 18, 21]
const PLAYBACK_SLOT_UNITS_PER_SECOND = 0.1
const MISSION_FEED_LIFETIME_MS = 3000
const MISSION_FEED_FADE_MS = 500
const MISSION_FEED_TICK_MS = 100
const PLAYBACK_MAX_FRAME_DELTA_SECONDS = 0.18
const PLAYBACK_STALL_RESET_SECONDS = 0.6

const SEEDED_PLAN_REFRESH_IDS = {
  families: new Set(['north-star', 'silver-peak', 'desert-bloom']),
  locations: new Set(['pine-airbnb', 'pine-lake-beach', 'yosemite', 'grill-pml', 'two-guys-pizza', 'mountain-room', 'priest-station', 'around-horn']),
  meals: new Set(['thu-dinner', 'fri-lunch', 'fri-dinner', 'sat-lunch', 'sat-dinner']),
  activities: new Set(['fri-lake', 'sat-yosemite']),
  tasks: new Set(['task-grill-kit', 'task-grocery-run', 'task-priest-station-plan']),
  itineraryItems: new Set([
    'north-star-drive',
    'silver-peak-drive',
    'desert-bloom-drive',
    'north-star-grill-shuttle',
    'silver-peak-grill-shuttle',
    'north-star-grill-return',
    'silver-peak-grill-return',
    'thu-dinner-ops',
    'fri-lake',
    'groceries',
    'park-prep',
    'north-star-lake-hop',
    'silver-peak-lake-hop',
    'north-star-mountain-room-return',
    'silver-peak-mountain-room-return',
    'north-star-yosemite-push',
    'silver-peak-yosemite-push',
    'desert-bloom-yosemite-push',
    'north-star-priest-station',
    'silver-peak-priest-station',
    'desert-bloom-priest-station',
    'north-star-basecamp-return',
    'silver-peak-basecamp-return',
    'desert-bloom-basecamp-return',
  ]),
  routes: new Set([
    'route-la-north-star',
    'route-sf-silver-peak',
    'route-sf-desert-bloom',
    'route-thu-grill-north-star',
    'route-thu-grill-silver-peak',
    'route-thu-return-north-star',
    'route-thu-return-silver-peak',
    'route-fri-beach-north-star',
    'route-fri-beach-silver-peak',
    'route-fri-return-north-star',
    'route-fri-return-silver-peak',
    'route-sat-yosemite-north-star',
    'route-sat-yosemite-silver-peak',
    'route-sat-yosemite-desert-bloom',
    'route-sat-priest-station-north-star',
    'route-sat-priest-station-silver-peak',
    'route-sat-priest-station-desert-bloom',
    'route-sat-basecamp-return-north-star',
    'route-sat-basecamp-return-silver-peak',
    'route-sat-basecamp-return-desert-bloom',
  ]),
}

const OBSOLETE_PLAN_ROUTE_IDS = new Set([
  'route-yosemite-day',
  'route-fri-beach-desert-bloom',
  'route-fri-mountain-room-north-star',
  'route-fri-mountain-room-silver-peak',
  'route-fri-mountain-room-desert-bloom',
  'route-fri-return-desert-bloom',
])

const OBSOLETE_PLAN_ITINERARY_IDS = new Set([
  'desert-bloom-lake-hop',
  'north-star-mountain-room',
  'silver-peak-mountain-room',
  'desert-bloom-mountain-room',
  'desert-bloom-mountain-room-return',
])

const DAY_BRIEFING_COPY = {
  thu: {
    code: 'Insertion / Consolidation',
    tone: 'Amber',
    summary:
      'Thursday is about getting everyone in cleanly. The main threat is staggered arrival timing, road fatigue, and losing momentum before basecamp is fully online. Win condition: all families reach Pine Mountain Lake, get through the gate, settle basecamp, and keep dinner simple enough that nobody burns out on night one.',
    lookouts: [
      'Protect arrival energy. Long-drive families should prioritize clean breaks over pushing nonstop.',
      'Gate + check-in friction is the main avoidable failure point, so keep address, fee, and access details ready.',
      'Do not over-schedule the evening. Dinner and reset are the operation.',
    ],
  },
  fri: {
    code: 'Basecamp / Local Ops',
    tone: 'Blue',
    summary:
      'Friday is the stabilization day. Everyone is in theater, so the goal shifts from transit to rhythm: house setup, lake access, kid-friendly pacing, and preserving energy for the Yosemite push. Keep the day flexible and bias toward a low-friction, high-enjoyment tempo.',
    lookouts: [
      'Parking, beach timing, and family split-ups can create unnecessary overhead if not lightly coordinated.',
      'Use this day to test house logistics, meal flow, and what each family actually needs before Saturday.',
      'Avoid turning the lake day into a checklist marathon. The point is to settle in.',
    ],
  },
  sat: {
    code: 'Yosemite Main Mission',
    tone: 'Red',
    summary:
      'Saturday is the primary excursion and the highest-complexity day of the trip. This is the longest operating window with the most movement, the most dependency on traffic and timing, and the highest risk of decision fatigue. Win condition: enter Yosemite smoothly, pick a manageable plan, and preserve enough margin for a calm return and cookout evening.',
    lookouts: [
      'Departure discipline matters more than itinerary ambition. Late starts compound quickly on Yosemite day.',
      'Pick a realistic park scope and protect turnaround timing before everyone gets tired.',
      'This is the day to simplify decisions, not multiply them.',
    ],
  },
  sun: {
    code: 'Exfil / Reset',
    tone: 'Green',
    summary:
      'Sunday is a controlled exit. The mission is not sightseeing, it is a clean departure: brunch, pack-out, house reset, and staggered family departures without chaos. The smoother the morning feels, the better the whole weekend lands in memory.',
    lookouts: [
      'Keep brunch simple and start pack-out early enough that checkout does not become the whole mood.',
      'Assign quiet ownership for trash, fridge sweep, and final vehicle loading.',
      'Avoid one-last-thing sprawl. The goal is a graceful exit, not extra complexity.',
    ],
  },
}

const MISSION_OBJECTIVE_COPY = {
  thu: 'Get inbound units through the gate, staged at basecamp, and settled before evening tempo begins.',
  fri: 'Push the local ops window cleanly, keep coordination light, and preserve energy for the main park day.',
  sat: 'Launch the park convoy on time, keep the group inside a realistic scope, and hold margin for a calm return.',
  sun: 'Run a controlled pack-out and stagger departures without turning checkout into the whole mood.',
}

const MISSION_LAUNCH_THEME = {
  thu: {
    accent: '#F2CC60',
    accentStrong: '#FFD76B',
    accentSoft: 'rgba(242, 204, 96, 0.14)',
    accentGlow: 'rgba(242, 204, 96, 0.28)',
    accentBorder: 'rgba(242, 204, 96, 0.34)',
    accentText: '#F2CC60',
    panelGlow: 'rgba(242, 204, 96, 0.18)',
  },
  fri: {
    accent: '#58A6FF',
    accentStrong: '#7AB8FF',
    accentSoft: 'rgba(88, 166, 255, 0.14)',
    accentGlow: 'rgba(88, 166, 255, 0.26)',
    accentBorder: 'rgba(88, 166, 255, 0.34)',
    accentText: '#58A6FF',
    panelGlow: 'rgba(88, 166, 255, 0.18)',
  },
  sat: {
    accent: '#F85149',
    accentStrong: '#FF7B72',
    accentSoft: 'rgba(248, 81, 73, 0.14)',
    accentGlow: 'rgba(248, 81, 73, 0.26)',
    accentBorder: 'rgba(248, 81, 73, 0.34)',
    accentText: '#F85149',
    panelGlow: 'rgba(248, 81, 73, 0.18)',
  },
  sun: {
    accent: '#3FB950',
    accentStrong: '#56D364',
    accentSoft: 'rgba(63, 185, 80, 0.14)',
    accentGlow: 'rgba(63, 185, 80, 0.26)',
    accentBorder: 'rgba(63, 185, 80, 0.34)',
    accentText: '#3FB950',
    panelGlow: 'rgba(63, 185, 80, 0.18)',
  },
}

const MISSION_LAUNCH_KEYFRAMES = `
  @keyframes mission-launch-panel-in {
    0% {
      opacity: 0;
      transform: translateY(24px) scale(0.97);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes mission-launch-halo {
    0%, 100% {
      transform: scale(1);
      opacity: 0.92;
    }
    50% {
      transform: scale(1.02);
      opacity: 1;
    }
  }

  @keyframes mission-launch-digit-in {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.9);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`

function formatCurrency(amount) {
  const value = Number.isFinite(amount) ? amount : Number(amount) || 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function parseCurrencyInput(value) {
  if (typeof value !== 'string') return Number(value) || 0
  const normalized = value.replace(/[^0-9.]/g, '')
  if (!normalized.trim()) return 0
  return Number(normalized) || 0
}

function getFamilyLabel(families, familyId) {
  return families.find((family) => family.id === familyId)?.title || 'Unknown family'
}

function stampFamilyMetadata(item, familyId) {
  if (!familyId) return item

  const timestamp = new Date().toISOString()
  return {
    ...item,
    lastEditedByFamilyId: familyId,
    lastEditedAt: timestamp,
    createdByFamilyId: item.createdByFamilyId || familyId,
    createdAt: item.createdAt || timestamp,
  }
}

function buildEqualExpenseAllocations(amount, families) {
  if (!families.length) return []

  const totalCents = Math.max(Math.round((Number(amount) || 0) * 100), 0)
  const baseCents = Math.floor(totalCents / families.length)
  const remainder = totalCents - baseCents * families.length

  return families.map((family, index) => ({
    familyId: family.id,
    title: family.title,
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
  }))
}

function getExpenseAllocations(expense, families) {
  if (!expense || !families.length) return []
  if (expense.allocationMode === 'individual') {
    return families.map((family) => ({
      familyId: family.id,
      title: family.title,
      amount: 0,
    }))
  }
  if (expense.allocationMode === 'manual') {
    return families.map((family) => ({
      familyId: family.id,
      title: family.title,
      amount: Number(expense.allocations?.[family.id]) || 0,
    }))
  }
  return buildEqualExpenseAllocations(expense.amount, families)
}

function buildManualAllocationSeed(amount, families) {
  return Object.fromEntries(
    buildEqualExpenseAllocations(amount, families).map((item) => [item.familyId, item.amount]),
  )
}

function getFamilyExpenseBurden(expenses, families) {
  const totals = Object.fromEntries(families.map((family) => [family.id, 0]))

  expenses.forEach((expense) => {
    if (expense.allocationMode === 'individual') return
    getExpenseAllocations(expense, families).forEach((allocation) => {
      totals[allocation.familyId] = (totals[allocation.familyId] || 0) + allocation.amount
    })
  })

  return families.map((family) => ({
    familyId: family.id,
    title: family.title,
    amount: totals[family.id] || 0,
  }))
}

function clampTimelineCursor(slot) {
  const maxCursor = DAYS.length * TIME_SLOTS.length - 0.001
  return Math.min(Math.max(slot, 0), maxCursor)
}

function getDayVisibleCursorRange(dayIndex) {
  const dayStart = dayIndex * TIME_SLOTS.length
  return {
    start: dayStart + VISIBLE_TIMELINE_SLOT_START,
    end: dayStart + VISIBLE_TIMELINE_SLOT_END,
  }
}

function projectCursorToVisibleTimelineRatio(cursorSlot, dayCount = DAYS.length) {
  const normalizedCursor = clampTimelineCursor(cursorSlot)
  const dayIndex = Math.min(Math.max(Math.floor(normalizedCursor / TIME_SLOTS.length), 0), dayCount - 1)
  const dayOffset = normalizedCursor - dayIndex * TIME_SLOTS.length
  const clampedDayOffset = Math.min(Math.max(dayOffset, VISIBLE_TIMELINE_SLOT_START), VISIBLE_TIMELINE_SLOT_END)
  const visibleCursor = dayIndex * VISIBLE_TIMELINE_SLOT_SPAN + (clampedDayOffset - VISIBLE_TIMELINE_SLOT_START)
  const totalVisibleSlots = Math.max(dayCount * VISIBLE_TIMELINE_SLOT_SPAN, 0.0001)
  return Math.min(Math.max(visibleCursor / totalVisibleSlots, 0), 0.999999)
}

function projectVisibleTimelineRatioToCursor(ratio, dayCount = DAYS.length) {
  const totalVisibleSlots = Math.max(dayCount * VISIBLE_TIMELINE_SLOT_SPAN, 0.0001)
  const clampedRatio = Math.min(Math.max(ratio, 0), 0.999999)
  const visibleCursor = clampedRatio * totalVisibleSlots
  const dayIndex = Math.min(Math.max(Math.floor(visibleCursor / VISIBLE_TIMELINE_SLOT_SPAN), 0), dayCount - 1)
  const dayVisibleOffset = visibleCursor - dayIndex * VISIBLE_TIMELINE_SLOT_SPAN
  return clampTimelineCursor(dayIndex * TIME_SLOTS.length + VISIBLE_TIMELINE_SLOT_START + dayVisibleOffset)
}

function getCursorHourInDay(cursorSlot) {
  const normalizedCursor = clampTimelineCursor(cursorSlot)
  const dayOffset = normalizedCursor - Math.floor(normalizedCursor / TIME_SLOTS.length) * TIME_SLOTS.length
  return dayOffset * TIMELINE_HOURS_PER_SLOT
}

function getMissionLaunchCursor(dayIndex) {
  return clampTimelineCursor(dayIndex * TIME_SLOTS.length + MISSION_LAUNCH_HOUR / TIMELINE_HOURS_PER_SLOT)
}

function getSuggestedPlaybackStartCursor(doc, cursorSlot, operationCheckpoints = []) {
  const windows = (doc.routes || [])
    .map((route) => getRouteSimulationWindow(doc, route))
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end))
    .sort((left, right) => left.start - right.start)
  const checkpoints = (operationCheckpoints || [])
    .filter((checkpoint) => Number.isFinite(checkpoint?.startSlot))
    .sort((left, right) => left.startSlot - right.startSlot)
  const routeLeadIn = 0.08
  const checkpointLeadIn = 0.03

  const normalizedCursor = clampTimelineCursor(cursorSlot)
  if (!windows.length && !checkpoints.length) return normalizedCursor

  const activeWindow = windows.find((window) => normalizedCursor >= window.start && normalizedCursor <= window.end)
  if (activeWindow) return normalizedCursor

  const nextWindow = windows.find((window) => window.start > normalizedCursor)
  const nextCheckpoint = checkpoints.find((checkpoint) => checkpoint.startSlot > normalizedCursor)

  if (nextCheckpoint && (!nextWindow || nextCheckpoint.startSlot <= nextWindow.start)) {
    return clampTimelineCursor(Math.max(nextCheckpoint.startSlot - checkpointLeadIn, 0))
  }

  if (nextWindow) {
    return clampTimelineCursor(Math.max(nextWindow.start - routeLeadIn, 0))
  }

  if (nextCheckpoint) {
    return clampTimelineCursor(Math.max(nextCheckpoint.startSlot - checkpointLeadIn, 0))
  }

  if (windows.length) {
    return clampTimelineCursor(Math.max(windows[0].start - routeLeadIn, 0))
  }

  return normalizedCursor
}

function getCurrentTripCursor(now = new Date()) {
  const currentYear = now.getFullYear()
  const tripStart = new Date(currentYear, 3, 9, 0, 0, 0, 0)
  const tripEnd = new Date(currentYear, 3, 13, 0, 0, 0, 0)
  const tripDurationHours = (tripEnd.getTime() - tripStart.getTime()) / (1000 * 60 * 60)
  const hoursIntoTrip = (now.getTime() - tripStart.getTime()) / (1000 * 60 * 60)
  const clampedHours = Math.min(Math.max(hoursIntoTrip, 0), tripDurationHours)
  return clampTimelineCursor(clampedHours / TIMELINE_HOURS_PER_SLOT)
}

function getCompactTravelLabel(item) {
  const status = (item?.status || '').toLowerCase()
  const title = (item?.title || '').toLowerCase()

  if (status.includes('return') || title.includes('rtb') || title.includes('homebound')) return 'RTB'
  if (status.includes('dinner') || title.includes('dinner')) return 'DIN'
  if (status.includes('lunch') || title.includes('lunch')) return 'LCH'
  if (status.includes('park') || title.includes('yosemite')) return 'YOS'
  if (status.includes('arrival') || title.includes('drive')) return 'DRV'
  if (status.includes('hop')) return 'HOP'

  const fallback = item?.status || item?.title || 'DRV'
  return fallback.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'DRV'
}

function getCursorDay(cursorSlot) {
  const dayIndex = Math.min(Math.floor(cursorSlot / TIME_SLOTS.length), DAYS.length - 1)
  return DAYS[Math.max(dayIndex, 0)] || DAYS[0]
}

function formatNameList(labels) {
  const cleanLabels = labels.filter(Boolean)
  if (!cleanLabels.length) return ''
  if (cleanLabels.length === 1) return cleanLabels[0]
  if (cleanLabels.length === 2) return `${cleanLabels[0]} + ${cleanLabels[1]}`
  return `${cleanLabels.slice(0, -1).join(', ')} + ${cleanLabels[cleanLabels.length - 1]}`
}

function stripDayPrefix(label) {
  return (label || '').replace(/^[A-Za-z]{3}\s+/, '')
}

function dedupeById(items) {
  const seen = new Set()
  return items.filter((item) => {
    if (!item?.id) return false
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function pickMostFrequentEntity(items) {
  const counts = new Map()
  let bestItem = null
  let bestCount = 0

  items.forEach((item) => {
    if (!item?.id) return
    const nextCount = (counts.get(item.id) || 0) + 1
    counts.set(item.id, nextCount)
    if (nextCount > bestCount) {
      bestCount = nextCount
      bestItem = item
    }
  })

  return bestItem || items.find(Boolean) || null
}

function getRelatedTravelItemsForGate(doc, gate) {
  const gateItems = gate?.items || []
  const primaryItem = gateItems[0]
  if (!primaryItem) return []

  const gateEntityKeys = new Set(
    gateItems.flatMap((item) => [makeEntityKey('itineraryItem', item.id), ...(item.linkedEntityKeys || [])]),
  )
  const sameDayTravelItems = doc.itineraryItems.filter((item) => item.rowId === 'travel' && item.dayId === primaryItem.dayId)
  const directlyLinkedTravelItems = sameDayTravelItems.filter((item) =>
    (item.linkedEntityKeys || []).some((key) => gateEntityKeys.has(key)),
  )
  if (directlyLinkedTravelItems.length) return directlyLinkedTravelItems

  const launchWaveEnd = gate.startSlot + 1.2
  const sameWaveTravelItems = sameDayTravelItems.filter((item) => {
    const itemEnd = item.startSlot + getItineraryItemEffectiveSpan(doc, item)
    return itemEnd >= gate.startSlot - 0.1 && item.startSlot <= launchWaveEnd
  })
  if (sameWaveTravelItems.length) return sameWaveTravelItems

  return sameDayTravelItems.filter((item) => item.startSlot >= gate.startSlot - 0.25 && item.startSlot <= gate.startSlot + 0.55)
}

function buildOperationGateContext(doc, gate) {
  if (!gate?.items?.length) return null

  const primaryItem = gate.items[0]
  const dayId = primaryItem.dayId || gate.dayId || 'thu'
  const dayMeta = getDayMeta(dayId) || getCursorDay(gate.startSlot)
  const theme = MISSION_LAUNCH_THEME[dayId] || MISSION_LAUNCH_THEME.fri
  const briefing = DAY_BRIEFING_COPY[dayId] || DAY_BRIEFING_COPY.thu
  const gateItemsWithType = gate.items.map((item) => ({ ...item, type: 'itineraryItem' }))
  const linkedEntities = dedupeById(
    gateItemsWithType.flatMap((item) => getLinkedEntities(doc, item)),
  )
  const relatedTravelItems = getRelatedTravelItemsForGate(doc, gate)
  const relatedRoutes = dedupeById(
    relatedTravelItems
      .map((item) => getRouteForEntity(doc, { ...item, type: 'itineraryItem' }))
      .filter(Boolean),
  )
  const gateLocations = dedupeById(
    [
      getLocationForEntity(doc, { ...primaryItem, type: 'itineraryItem' }),
      ...linkedEntities.filter((entity) => entity.type === 'location'),
      ...relatedRoutes
        .map((route) => getEntityById(doc, 'location', route.destinationLocationId))
        .filter(Boolean),
    ].filter(Boolean),
  )
  const targetLocation = pickMostFrequentEntity(gateLocations)
  const familyIds = [
    ...gate.items.flatMap((item) => item.familyIds || []),
    ...relatedTravelItems.flatMap((item) => item.familyIds || []),
    ...relatedRoutes.map((route) => route.familyId).filter((familyId) => familyId && familyId !== 'all'),
  ]
  const families = dedupeById(
    familyIds
      .map((familyId) => getEntityById(doc, 'family', familyId))
      .filter(Boolean),
  )
  const unitCount = families.length || Math.max(relatedRoutes.length, 1)
  const launchLabel = stripDayPrefix(getSlotLabel(gate.startSlot))
  const etaSlot = relatedTravelItems.length
    ? Math.max(...relatedTravelItems.map((item) => item.startSlot + getItineraryItemEffectiveSpan(doc, item)))
    : gate.startSlot + getItineraryItemEffectiveSpan(doc, primaryItem)
  const etaLabel = stripDayPrefix(getSlotLabel(etaSlot))
  const participantLabel =
    !families.length
      ? gate.dayLabel || 'All units'
      : families.length === doc.families.length
        ? 'All families'
        : formatNameList(families.map((family) => family.title))
  const targetTitle = targetLocation?.title || gate.title
  const targetMeta = targetLocation ? getEntitySummary(targetLocation) : primaryItem.status || gate.subtitle
  const routeCount = relatedRoutes.length || Math.max(relatedTravelItems.length, 1)
  const deploymentLabel = targetLocation
    ? `${participantLabel} deploying to ${targetTitle}.`
    : `${participantLabel} moving on ${gate.title}.`
  const objective = MISSION_OBJECTIVE_COPY[dayId] || `Advance ${participantLabel.toLowerCase()} into ${gate.title.toLowerCase()}.`

  return {
    dayId,
    dayMeta,
    theme,
    title: gate.title,
    operationLabel: gate.subtitle || 'Primary operation',
    code: briefing.code,
    targetTitle,
    targetMeta,
    deploymentLabel,
    objective,
    launchLabel,
    etaLabel,
    unitCount,
    routeCount,
    families,
    briefingSummary: briefing.summary,
  }
}

function buildOperationCheckpoints(doc) {
  return DAYS.map((day, dayIndex) => {
    const mainOp = doc.itineraryItems
      .filter((item) => item.rowId === 'activities' && item.dayId === day.id)
      .sort((left, right) => left.startSlot - right.startSlot)[0]

    if (!mainOp) return null

    return {
      id: `op:main-op:${day.id}:${mainOp.id}`,
      dayId: day.id,
      startSlot: Math.max(mainOp.startSlot, getMissionLaunchCursor(dayIndex)),
      title: mainOp.title,
      subtitle: 'Primary operation',
      dayLabel: day.title,
      items: [mainOp],
      type: 'main-op',
      autoAdvanceMs: 4200,
    }
  }).filter(Boolean)
}

function findUpcomingOperationCheckpoint(checkpoints, cursorSlot, threshold = 0.14) {
  return checkpoints.find((item) => item.startSlot >= cursorSlot && item.startSlot - cursorSlot <= threshold) || null
}

function findCrossedOperationCheckpoint(checkpoints, previousCursor, nextCursor, triggeredIds) {
  return checkpoints.find((item) =>
    !triggeredIds.has(item.id)
    && previousCursor <= item.startSlot
    && nextCursor >= item.startSlot,
  ) || null
}

function getPlaybackHighlightLocation(doc, context) {
  return null
}

function buildDailyBriefing(doc, context) {
  const day = getCursorDay(context.cursorSlot)
  const base = DAY_BRIEFING_COPY[day.id] || DAY_BRIEFING_COPY.thu
  const meals = doc.meals.filter((meal) => meal.dayId === day.id).slice(0, 3)
  const activities = doc.activities.filter((activity) => activity.dayId === day.id).slice(0, 3)
  const tasks = getTasksForDay(doc, day.id).filter((task) => task.status !== 'done').slice(0, 4)
  const liveItems = context.liveEntities.filter((item) => item.dayId === day.id)
  const soonItems = [...context.nextEntities, ...context.prepSoon]
    .filter((item) => item.dayId === day.id)
    .slice(0, 4)

  return {
    day,
    code: base.code,
    tone: base.tone,
    summary: base.summary,
    lookouts: base.lookouts,
    meals,
    activities,
    tasks,
    liveItems,
    soonItems,
  }
}

function StatusPill({ children, tone = 'Transit', className }) {
  return (
    <span
      className={cn(
        'rounded-[2px] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider',
        STATUS_STYLES[tone] || 'bg-[#30363D] text-[#C9D1D9]',
        className,
      )}
    >
      {children}
    </span>
  )
}

function SectionTitle({ eyebrow, title, meta }) {
  return (
    <div className="mb-4">
      {eyebrow ? (
        <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
          {eyebrow}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
          {title}
        </h2>
        {meta ? <div className="text-[10px] font-bold text-[#8B949E]">{meta}</div> : null}
      </div>
    </div>
  )
}

function NotesBox({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="min-h-24 w-full resize-none border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] leading-relaxed text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
    />
  )
}

function SelectableCard({ selected, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border text-left transition-colors hover:border-[#58A6FF]/40 hover:bg-[#1f2a34]/40',
        selected ? 'border-[#58A6FF] bg-[#24313d]/60' : 'border-[#30363D] bg-[#161b22]',
        className,
      )}
    >
      {children}
    </button>
  )
}

function PageNotesCard({ title, value, onChange, onConvert, placeholder }) {
  return (
    <div className="border border-[#30363D] bg-[#161b22] p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">{title}</div>
        <button
          type="button"
          onClick={onConvert}
          className="text-[9px] font-black uppercase tracking-wider text-[#58A6FF]"
        >
          note to task
        </button>
      </div>
      <NotesBox value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  )
}

function AppShell({
  doc,
  onSetSelectedPage,
  onExport,
  onOpenChat,
  onOpenSettings,
  onSearchChange,
  searchResults,
  onOpenEntity,
  families,
  activeFamily,
  onSetActiveFamily,
  children,
}) {
  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[#0d1117] font-sans text-[#C9D1D9] antialiased">
      <div className="flex w-16 flex-col border-r border-[#30363D] bg-[#0d1117]">
        <div className="flex h-14 items-center justify-center border-b border-[#30363D] text-[#58A6FF]">
          <img
            src={palantirLogo}
            alt="Palantir"
            className="h-4 w-auto opacity-90"
            style={{ filter: 'invert(1) grayscale(1) brightness(1.15)' }}
          />
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = PAGE_ICONS[item.id]
          const active = doc.selectedPage === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSetSelectedPage(item.id)}
              className={cn(
                'flex items-center justify-center border-l-2 px-3 py-3.5 transition-colors',
                active
                  ? 'border-[#58A6FF] bg-[#24313d] text-[#58A6FF]'
                  : 'border-transparent text-[#8B949E] hover:bg-[#1f2a34] hover:text-[#C9D1D9]',
              )}
              title={item.label}
            >
              <Icon size={22} strokeWidth={1.6} />
            </button>
          )
        })}
        <div className="mt-auto border-t border-[#30363D]">
          <button
            type="button"
            onClick={onExport}
            className="flex w-full items-center justify-center px-3 py-3.5 text-[#8B949E] transition-colors hover:bg-[#1f2a34] hover:text-[#C9D1D9]"
            title="Export trip state"
          >
            <Download size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="flex w-full items-center justify-center px-3 py-3.5 text-[#8B949E] transition-colors hover:bg-[#1f2a34] hover:text-[#C9D1D9]"
            title="Messages"
          >
            <MessageSquare size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center justify-center px-3 py-3.5 text-[#8B949E] transition-colors hover:bg-[#1f2a34] hover:text-[#C9D1D9]"
            title="Settings"
          >
            <Settings size={20} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-[#30363D] bg-[#161b22] px-6">
          <div className="flex items-center gap-6">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#3FB950]">
              UNCLASSIFIED // FAMILY OPS
            </div>
            <div className="h-5 w-px bg-[#30363D]" />
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#8B949E]">
              {TRIP_META.commandName}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                Working as
              </div>
              <div className="flex items-center gap-1.5">
                {families.map((family) => (
                  <button
                    key={family.id}
                    type="button"
                    onClick={() => onSetActiveFamily(family.id)}
                    className={cn(
                      'border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em]',
                      activeFamily?.id === family.id
                        ? 'border-[#58A6FF]/50 bg-[#58A6FF]/12 text-[#C9D1D9]'
                        : 'border-[#30363D] bg-[#0d1117] text-[#8B949E]',
                    )}
                  >
                    {family.title}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[#58A6FF]">
              autosave live
            </div>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B949E]"
              />
              <input
                type="text"
                value={doc.ui.searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search..."
                className="w-64 rounded-[2px] border border-[#30363D] bg-[#0d1117] py-1.5 pl-10 pr-4 text-[11px] outline-none focus:border-[#58A6FF]"
              />
              {doc.ui.searchQuery && searchResults.length ? (
                <div className="absolute right-0 top-10 z-40 w-80 border border-[#30363D] bg-[#161b22] shadow-xl">
                  {searchResults.map((item) => (
                    <button
                      key={`${item.type}:${item.id}`}
                      type="button"
                      onClick={() => onOpenEntity(item.type, item.id)}
                      className="flex w-full items-center justify-between border-b border-[#30363D]/40 px-3 py-2 text-left last:border-b-0 hover:bg-[#1f2a34]/60"
                    >
                      <div>
                        <div className="text-[11px] font-bold text-[#C9D1D9]">{getEntityTitle(item)}</div>
                        <div className="text-[10px] text-[#8B949E]">{getEntitySummary(item)}</div>
                      </div>
                      <div className="text-[9px] font-black uppercase tracking-wider text-[#58A6FF]">
                        {item.type}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </div>

      {!activeFamily ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0b0f14]/86 backdrop-blur-sm">
          <div className="w-[420px] border border-[#30363D] bg-[#161b22] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
              Family Profile
            </div>
            <div className="text-[18px] font-black uppercase tracking-[0.08em] text-[#E6EDF3]">
              Choose your family
            </div>
            <div className="mt-2 text-[12px] leading-relaxed text-[#8B949E]">
              This stays local in your browser, personalizes the planner to your family, and attributes edits and new expenses to you.
            </div>
            <div className="mt-5 grid gap-2">
              {families.map((family) => (
                <button
                  key={family.id}
                  type="button"
                  onClick={() => onSetActiveFamily(family.id)}
                  className="flex items-center justify-between border border-[#30363D] bg-[#0d1117] px-4 py-3 text-left transition-colors hover:border-[#58A6FF]/40 hover:bg-[#1f2a34]/50"
                >
                  <div>
                    <div className="text-[12px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
                      {family.title}
                    </div>
                    <div className="mt-1 text-[10px] text-[#8B949E]">
                      {family.shortOrigin} inbound · {family.headcount}
                    </div>
                  </div>
                  <ArrowRight size={14} className="text-[#58A6FF]" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Merge live doc.families with INITIAL_FAMILIES entries (by id) so the roster
// picks up the `vehicles[]` structure from tripData.js plus any placeholder
// family (e.g. Santos) that is not yet present in the persisted doc. Live doc
// fields always win; only `vehicles` and placeholder families are injected.
function mergeFamiliesForRoster(liveFamilies) {
  const byId = new Map(liveFamilies.map((family) => [family.id, family]))
  INITIAL_FAMILIES.forEach((seed) => {
    const live = byId.get(seed.id)
    if (live) {
      byId.set(seed.id, {
        ...live,
        vehicles: live.vehicles || seed.vehicles || null,
      })
    } else {
      byId.set(seed.id, {
        ...seed,
        title: seed.title || seed.name,
        placeholder: true,
      })
    }
  })
  return Array.from(byId.values())
}

function FamilyList({ doc, selection, onSelectEntity }) {
  const [expandedVehicles, setExpandedVehicles] = useState({})
  const roster = mergeFamiliesForRoster(doc.families)
  const toggleVehicles = (id) => {
    setExpandedVehicles((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  return (
    <div className="overflow-hidden border border-[#30363D] bg-[#0d1117]">
      {roster.map((family) => {
        const selected = selection.type === 'family' && selection.id === family.id
        const hasVehicles = Array.isArray(family.vehicles) && family.vehicles.length > 0
        const expanded = !!expandedVehicles[family.id]
        return (
          <div
            key={family.id}
            className={cn(
              'border-b border-[#30363D]/50 last:border-b-0',
              selected ? 'bg-[#24313d] shadow-[inset_4px_0_0_#58A6FF]' : '',
            )}
          >
            <button
              type="button"
              onClick={() => !family.placeholder && onSelectEntity('family', family.id)}
              disabled={family.placeholder}
              className={cn(
                'flex w-full items-start justify-between gap-3 px-4 py-3 text-left',
                family.placeholder
                  ? 'cursor-default opacity-75'
                  : selected
                    ? ''
                    : 'hover:bg-[#1f2a34]/60',
              )}
            >
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[#C9D1D9]">
                    {family.title}
                  </span>
                  {family.placeholder ? (
                    <span className="border border-[#30363D] bg-[#0d1117] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#8B949E]">
                      Placeholder
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] font-medium text-[#8B949E]">
                  {family.shortOrigin} inbound, {family.headcount}
                </div>
                {family.responsibility ? (
                  <div className="mt-1 text-[10px] text-[#8B949E]">
                    {family.responsibility}
                  </div>
                ) : null}
              </div>
              <StatusPill tone={family.status}>{family.status}</StatusPill>
            </button>
            <div className="border-t border-[#30363D]/30 px-4 pb-3 pt-2">
              {hasVehicles ? (
                <>
                  <button
                    type="button"
                    onClick={() => toggleVehicles(family.id)}
                    className="flex w-full items-center justify-between text-[9px] font-black uppercase tracking-widest text-[#58A6FF] hover:text-[#C9D1D9]"
                  >
                    <span>
                      Vehicles ({family.vehicles.length})
                    </span>
                    <span className="font-mono text-[10px]">{expanded ? '[-]' : '[+]'}</span>
                  </button>
                  {expanded ? (
                    <ul className="mt-2 space-y-1 font-mono text-[10px] text-[#C9D1D9]">
                      {family.vehicles.map((vehicle) => (
                        <li
                          key={vehicle.id}
                          className="border border-[#30363D]/50 bg-[#0d1117] px-2 py-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#C9D1D9]">{vehicle.name}</span>
                            <span className="text-[#8B949E]">{vehicle.seats} seats</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[#8B949E]">
                            <span>drv: {vehicle.driver}</span>
                            <span>{vehicle.departureWindow}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : family.vehicle ? (
                <div className="text-[10px] font-mono text-[#8B949E]">
                  Vehicle: {family.vehicle}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SettingsDialog({ open, onClose }) {
  const dialogRef = useRef(null)
  const [settings, setSettings] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_TRIP_SETTINGS
    try {
      const raw = window.localStorage.getItem(TRIP_SETTINGS_STORAGE_KEY)
      if (!raw) return DEFAULT_TRIP_SETTINGS
      return { ...DEFAULT_TRIP_SETTINGS, ...JSON.parse(raw) }
    } catch {
      return DEFAULT_TRIP_SETTINGS
    }
  })

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const persist = useCallback((next) => {
    setSettings(next)
    try {
      window.localStorage.setItem(TRIP_SETTINGS_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // swallow
    }
  }, [])

  const handleResetState = () => {
    if (typeof window === 'undefined') return
    const ok = window.confirm('This will clear all persisted trip state and reload. Continue?')
    if (!ok) return
    try {
      window.localStorage.clear()
    } catch {
      // ignore
    }
    window.location.reload()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      className="w-[480px] border border-[#30363D] bg-[#161b22] p-0 text-[#C9D1D9] backdrop:bg-[#0b0f14]/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
            Trip Command
          </div>
          <div className="text-[13px] font-black uppercase tracking-[0.08em] text-[#E6EDF3]">
            Settings
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-[#30363D] bg-[#0d1117] p-1.5 text-[#8B949E] hover:border-[#58A6FF]/40 hover:text-[#C9D1D9]"
          title="Close"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4 font-mono text-[11px]">
        <label className="flex items-center justify-between gap-4 border border-[#30363D]/50 bg-[#0d1117] px-3 py-2">
          <span className="text-[#C9D1D9]">
            Use live OSRM routing
            <span className="mt-0.5 block text-[9px] font-sans tracking-wide text-[#8B949E]">
              Overrides VITE_OSRM_BASE at runtime (reload to apply).
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.liveOsrm}
            onChange={(event) => persist({ ...settings, liveOsrm: event.target.checked })}
            className="h-4 w-4 accent-[#58A6FF]"
          />
        </label>

        <label className="flex items-center justify-between gap-4 border border-[#30363D]/50 bg-[#0d1117] px-3 py-2">
          <span className="text-[#C9D1D9]">
            Use Nominatim place search
            <span className="mt-0.5 block text-[9px] font-sans tracking-wide text-[#8B949E]">
              Future flag (wired up by another pass).
            </span>
          </span>
          <input
            type="checkbox"
            checked={settings.nominatim}
            onChange={(event) => persist({ ...settings, nominatim: event.target.checked })}
            className="h-4 w-4 accent-[#58A6FF]"
          />
        </label>

        <label className="flex flex-col gap-2 border border-[#30363D]/50 bg-[#0d1117] px-3 py-2">
          <span className="text-[#C9D1D9]">
            Map style
            <span className="mt-0.5 block text-[9px] font-sans tracking-wide text-[#8B949E]">
              Applies on next map build.
            </span>
          </span>
          <select
            value={settings.mapStyle}
            onChange={(event) => persist({ ...settings, mapStyle: event.target.value })}
            className="border border-[#30363D] bg-[#0d1117] px-2 py-1.5 text-[11px] text-[#C9D1D9] focus:border-[#58A6FF] focus:outline-none"
          >
            <option value="liberty">liberty</option>
            <option value="positron">positron</option>
            <option value="bright">bright</option>
            <option value="fiord">fiord</option>
          </select>
        </label>

        <div className="flex flex-col gap-2 border border-[#F85149]/30 bg-[#0d1117] px-3 py-2">
          <div className="text-[#C9D1D9]">
            Reset persisted trip state
            <span className="mt-0.5 block text-[9px] font-sans tracking-wide text-[#8B949E]">
              Clears localStorage and reloads.
            </span>
          </div>
          <button
            type="button"
            onClick={handleResetState}
            className="border border-[#F85149]/50 bg-[#F85149]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#F85149] hover:bg-[#F85149]/20"
          >
            Reset & reload
          </button>
        </div>
      </div>

      <div className="flex justify-end border-t border-[#30363D] px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="border border-[#30363D] bg-[#0d1117] px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#C9D1D9] hover:border-[#58A6FF]/40"
        >
          Close
        </button>
      </div>
    </dialog>
  )
}

function ChatDialog({ open, onClose }) {
  const dialogRef = useRef(null)
  const listRef = useRef(null)
  const [author, setAuthor] = useState(() => {
    if (typeof window === 'undefined') return ''
    try {
      return window.localStorage.getItem(TRIP_CHAT_AUTHOR_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })
  const [messages, setMessages] = useState(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(TRIP_CHAT_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (author) return
    if (typeof window === 'undefined') return
    const input = window.prompt('Your name for local chat?', '')
    if (input && input.trim()) {
      const trimmed = input.trim()
      setAuthor(trimmed)
      try {
        window.localStorage.setItem(TRIP_CHAT_AUTHOR_STORAGE_KEY, trimmed)
      } catch {
        // ignore
      }
    }
  }, [open, author])

  useEffect(() => {
    if (!open) return
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [open, messages])

  const persistMessages = (next) => {
    setMessages(next)
    try {
      window.localStorage.setItem(TRIP_CHAT_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  const handleSend = () => {
    const text = draft.trim()
    if (!text) return
    const who = author || 'Anonymous'
    const next = [
      ...messages,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, author: who, text, ts: Date.now() },
    ]
    persistMessages(next)
    setDraft('')
  }

  const handleClear = () => {
    if (typeof window === 'undefined') return
    const ok = window.confirm('Clear all local chat messages?')
    if (!ok) return
    persistMessages([])
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      className="w-[520px] border border-[#30363D] bg-[#161b22] p-0 text-[#C9D1D9] backdrop:bg-[#0b0f14]/75 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-[#30363D] px-5 py-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
            Trip Command
          </div>
          <div className="text-[13px] font-black uppercase tracking-[0.08em] text-[#E6EDF3]">
            Chat
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="border border-[#30363D] bg-[#0d1117] p-1.5 text-[#8B949E] hover:border-[#58A6FF]/40 hover:text-[#C9D1D9]"
          title="Close"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="border-b border-[#D29922]/30 bg-[#D29922]/10 px-5 py-2 text-[10px] text-[#D29922]">
        Local-only chat. No sync between devices yet.
      </div>

      <div
        ref={listRef}
        className="h-[280px] overflow-y-auto bg-[#0d1117] px-5 py-3 font-mono text-[11px]"
      >
        {messages.length === 0 ? (
          <div className="py-12 text-center text-[10px] text-[#8B949E]">
            No messages yet. Leave a note for the next browser session.
          </div>
        ) : (
          <ul className="space-y-2">
            {messages.map((message) => {
              const when = new Date(message.ts)
              const stamp = Number.isNaN(when.getTime())
                ? ''
                : when.toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
              return (
                <li key={message.id} className="border border-[#30363D]/50 bg-[#161b22] px-2 py-1.5">
                  <div className="flex items-center justify-between text-[9px] text-[#58A6FF]">
                    <span className="font-black uppercase tracking-widest">{message.author}</span>
                    <span className="text-[#8B949E]">{stamp}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[11px] text-[#C9D1D9]">
                    {message.text}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[#30363D] px-5 py-3">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
          placeholder={author ? `Message as ${author}` : 'Message...'}
          className="flex-1 border border-[#30363D] bg-[#0d1117] px-3 py-1.5 font-mono text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
        />
        <button
          type="button"
          onClick={handleSend}
          className="border border-[#58A6FF]/50 bg-[#58A6FF]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#58A6FF] hover:bg-[#58A6FF]/20"
        >
          Send
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="border border-[#30363D] bg-[#0d1117] px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-[#8B949E] hover:border-[#F85149]/40 hover:text-[#F85149]"
          title="Clear chat"
        >
          Clear
        </button>
      </div>
    </dialog>
  )
}

const TRIP_SETTINGS_STORAGE_KEY = 'tripCommandSettings'
const TRIP_CHAT_STORAGE_KEY = 'tripCommandChat'
const TRIP_CHAT_AUTHOR_STORAGE_KEY = 'tripCommandChatAuthor'
const DEFAULT_TRIP_SETTINGS = {
  liveOsrm: false,
  nominatim: false,
  mapStyle: 'liberty',
}

function ScenarioControls({ doc, cursorSlot = doc.ui.timeline.cursorSlot, onSetCursor }) {
  const clampedCursor = clampTimelineCursor(cursorSlot)
  const cursorDayIndex = Math.min(Math.max(Math.floor(clampedCursor / TIME_SLOTS.length), 0), DAYS.length - 1)
  const selectedDay = DAYS[cursorDayIndex]
  const cursorHour = getCursorHourInDay(clampedCursor)
  const selectedHour = MISSION_TIME_PRESETS.reduce((bestHour, hour) => (
    Math.abs(hour - cursorHour) < Math.abs(bestHour - cursorHour) ? hour : bestHour
  ), MISSION_TIME_PRESETS[0])
  const selectedSlotValue = String(selectedHour).padStart(2, '0')

  return (
    <div className="border border-[#30363D] bg-[#161b22] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">
            Scenario Mode
          </div>
          <div className="mt-1 text-[12px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
            Time scrub
          </div>
        </div>
        <div className="rounded-[2px] border border-[#30363D] bg-[#0d1117] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-[#8B949E]">
          {selectedDay.shortLabel} {selectedSlotValue}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {DAYS.map((day, dayIndex) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onSetCursor(dayIndex * TIME_SLOTS.length + selectedHour / TIMELINE_HOURS_PER_SLOT)}
            className={cn(
              'border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider',
              day.id === selectedDay.id
                ? 'border-[#58A6FF] bg-[#58A6FF]/10 text-[#58A6FF]'
                : 'border-[#30363D] bg-[#0d1117] text-[#8B949E]',
            )}
          >
            {day.shortLabel}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {MISSION_TIME_PRESETS.map((hour) => {
          const slot = String(hour).padStart(2, '0')
          return (
            <button
              key={slot}
              type="button"
              onClick={() => onSetCursor(cursorDayIndex * TIME_SLOTS.length + hour / TIMELINE_HOURS_PER_SLOT)}
              className={cn(
                'flex-1 border px-2 py-2 text-[10px] font-mono',
                slot === selectedSlotValue
                  ? 'border-[#58A6FF] bg-[#58A6FF]/10 text-[#58A6FF]'
                  : 'border-[#30363D] bg-[#0d1117] text-[#8B949E]',
              )}
            >
              {slot}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DailyBriefingModal({ briefing, onClose, onOpenEntity }) {
  if (!briefing) return null

  const toneStyles = {
    Amber: 'border-[#D29922]/40 text-[#D29922]',
    Blue: 'border-[#58A6FF]/40 text-[#58A6FF]',
    Red: 'border-[#F85149]/40 text-[#F85149]',
    Green: 'border-[#3FB950]/40 text-[#3FB950]',
  }

  const railSection = (title, items, emptyLabel) => (
    <div className="border border-[#30363D] bg-[#0d1117]">
      <div className="border-b border-[#30363D]/50 px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
        {title}
      </div>
      <div className="p-4">
        {items.length ? (
          <div className="space-y-2">
            {items.map((item) => (
              <button
                key={`${item.type}:${item.id}`}
                type="button"
                onClick={() => onOpenEntity(item.type, item.id)}
                className="flex w-full items-start justify-between gap-3 border border-[#30363D] bg-[#161b22] px-3 py-3 text-left transition-colors hover:border-[#58A6FF]/40"
              >
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-[#C9D1D9]">{getEntityTitle(item)}</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-[#8B949E]">{getEntitySummary(item)}</div>
                </div>
                {'status' in item && item.status ? <StatusPill tone={item.status}>{item.status}</StatusPill> : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-[#8B949E]">{emptyLabel}</div>
        )}
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 py-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '100% 4px, 4px 100%',
        }}
      />
      <div
        className="relative max-h-full w-full max-w-5xl overflow-hidden border border-[#30363D] bg-[#10161e] shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-[#30363D] bg-[linear-gradient(135deg,rgba(88,166,255,0.08),rgba(13,17,23,0.95)_58%)] px-6 py-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-[9px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
                Daily Briefing
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-[22px] font-black uppercase tracking-[0.14em] text-[#F0F6FC]">
                  {briefing.day.title}
                </h2>
                <span className={`border px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${toneStyles[briefing.tone] || toneStyles.Blue}`}>
                  {briefing.code}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#C9D1D9] transition-colors hover:border-[#58A6FF]/40 hover:text-[#58A6FF]"
            >
              <X size={14} />
              Close
            </button>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="border border-[#30363D] bg-[#0d1117]/85 p-4">
              <div className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Command summary</div>
              <p className="text-[13px] leading-7 text-[#C9D1D9]">{briefing.summary}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="border border-[#30363D] bg-[#0d1117] p-4 text-center">
                <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Live now</div>
                <div className="mt-2 text-[22px] font-black text-[#F0F6FC]">{briefing.liveItems.length}</div>
              </div>
              <div className="border border-[#30363D] bg-[#0d1117] p-4 text-center">
                <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Upcoming</div>
                <div className="mt-2 text-[22px] font-black text-[#F0F6FC]">{briefing.soonItems.length}</div>
              </div>
              <div className="border border-[#30363D] bg-[#0d1117] p-4 text-center">
                <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Open tasks</div>
                <div className="mt-2 text-[22px] font-black text-[#F0F6FC]">{briefing.tasks.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid max-h-[calc(100vh-220px)] gap-5 overflow-y-auto p-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-5">
            <div className="border border-[#30363D] bg-[#161b22] p-4">
              <SectionTitle eyebrow="Watch For" title="What matters today" />
              <div className="space-y-3">
                {briefing.lookouts.map((item) => (
                  <div key={item} className="border border-[#30363D] bg-[#0d1117] px-3 py-3 text-[11px] leading-relaxed text-[#C9D1D9]">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            {railSection('Live surfaces', briefing.liveItems, 'Nothing is active yet for this day window.')}
            {railSection('Coming up', briefing.soonItems, 'No immediate follow-ups are queued right now.')}
          </div>

          <div className="space-y-5">
            <div className="border border-[#30363D] bg-[#161b22] p-4">
              <SectionTitle eyebrow="Planned beats" title="Activities + meals" />
              <div className="space-y-3">
                {briefing.activities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    onClick={() => onOpenEntity('activity', activity.id)}
                    className="flex w-full items-start justify-between gap-3 border border-[#30363D] bg-[#0d1117] px-3 py-3 text-left transition-colors hover:border-[#58A6FF]/40"
                  >
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#C9D1D9]">{activity.title}</div>
                      <div className="mt-1 text-[10px] text-[#8B949E]">{activity.window}</div>
                    </div>
                    <StatusPill tone={activity.status}>{activity.status}</StatusPill>
                  </button>
                ))}
                {briefing.meals.map((meal) => (
                  <button
                    key={meal.id}
                    type="button"
                    onClick={() => onOpenEntity('meal', meal.id)}
                    className="flex w-full items-start justify-between gap-3 border border-[#30363D] bg-[#0d1117] px-3 py-3 text-left transition-colors hover:border-[#58A6FF]/40"
                  >
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#C9D1D9]">{meal.title}</div>
                      <div className="mt-1 text-[10px] text-[#8B949E]">{meal.timeLabel}</div>
                    </div>
                    <StatusPill tone={meal.status}>{meal.status}</StatusPill>
                  </button>
                ))}
                {!briefing.activities.length && !briefing.meals.length ? (
                  <div className="text-[11px] text-[#8B949E]">No day-specific beats are attached yet.</div>
                ) : null}
              </div>
            </div>

            <div className="border border-[#30363D] bg-[#161b22] p-4">
              <SectionTitle eyebrow="Open loops" title="Tasks to keep in mind" />
              <div className="space-y-2">
                {briefing.tasks.length ? briefing.tasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpenEntity('task', task.id)}
                    className="w-full border border-[#30363D] bg-[#0d1117] px-3 py-3 text-left text-[11px] text-[#C9D1D9] transition-colors hover:border-[#58A6FF]/40"
                  >
                    {task.title}
                  </button>
                )) : (
                  <div className="text-[11px] text-[#8B949E]">No open day-specific tasks. Good hunting.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MissionLaunchModal({ doc, gate, remainingMs, onProceed, onAbort }) {
  if (!gate) return null

  const context = buildOperationGateContext(doc, gate)
  if (!context) return null

  const totalMs = gate.autoAdvanceMs || 4200
  const progress = Math.min(Math.max(1 - remainingMs / totalMs, 0), 1)
  const radius = 76
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - progress)
  const countdownValue = Math.max(1, 3 - Math.min(2, Math.floor(progress * 3)))
  const theme = context.theme
  const statusCards = [
    { label: 'Launch', value: context.launchLabel, icon: Flag },
    { label: 'ETA', value: context.etaLabel, icon: Route },
    { label: 'Units', value: `${context.unitCount}`, icon: Users },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#03070b]/28 px-6 py-8 backdrop-blur-[2px]">
      <style>{MISSION_LAUNCH_KEYFRAMES}</style>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            `radial-gradient(circle at 50% 42%, ${theme.accentGlow}, transparent 24%), linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(180deg, rgba(3,7,11,0.12), rgba(3,7,11,0.82))`,
          backgroundSize: '100% 100%, 100% 9px, 9px 100%, 100% 100%',
        }}
      />
      <div
        className="relative w-full max-w-[720px] overflow-hidden border bg-[linear-gradient(180deg,rgba(7,11,17,0.86),rgba(4,8,13,0.94))] shadow-[0_30px_96px_rgba(0,0,0,0.62)]"
        style={{
          borderColor: theme.accentBorder,
          boxShadow: `0 30px 96px rgba(0, 0, 0, 0.62), 0 0 0 1px ${theme.panelGlow}`,
          animation: 'mission-launch-panel-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(120deg, ${theme.accentSoft}, transparent 38%), radial-gradient(circle at 78% 18%, ${theme.panelGlow}, transparent 24%)`,
          }}
        />

        <div className="relative border-b border-white/8 px-7 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.28em]" style={{ color: theme.accentText }}>
                {context.dayMeta?.title || gate.dayLabel} Mission Launch
              </div>
              <div className="mt-2 text-[12px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                {context.code}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="text-[32px] font-black uppercase tracking-[0.05em] text-[#F0F6FC] sm:text-[38px]">
              {context.title}
            </div>
            <div className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-[#C9D1D9]">
              {context.deploymentLabel}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {statusCards.map((card) => {
                const Icon = card.icon
                return (
                  <div
                    key={card.label}
                    className="inline-flex items-center gap-2 border px-3 py-2 text-[11px] font-semibold text-[#F0F6FC]"
                    style={{
                      borderColor: theme.accentBorder,
                      background: 'rgba(12, 17, 24, 0.72)',
                    }}
                  >
                    <Icon size={12} style={{ color: theme.accentText }} />
                    <span className="uppercase tracking-[0.14em] text-[#8B949E]">{card.label}</span>
                    <span>{card.value}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="relative grid gap-6 px-7 py-6 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
          <div className="flex items-center justify-center">
            <div
              className="relative flex h-[190px] w-[190px] items-center justify-center rounded-full border"
              style={{
                borderColor: theme.accentBorder,
                background: `radial-gradient(circle, ${theme.accentSoft}, rgba(8,12,18,0.12) 60%, transparent 75%)`,
                animation: 'mission-launch-halo 2.6s ease-in-out infinite',
              }}
            >
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 190 190">
                <circle cx="95" cy="95" r={radius} fill="none" stroke="rgba(48,54,61,0.72)" strokeWidth="9" />
                <circle
                  cx="95"
                  cy="95"
                  r={radius}
                  fill="none"
                  stroke={theme.accentStrong}
                  strokeWidth="9"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-[16px] rounded-full border border-white/8" />
              <div className="relative text-center">
                <div className="text-[8px] font-black uppercase tracking-[0.22em] text-[#8B949E]">Launch In</div>
                <div
                  key={countdownValue}
                  className="mt-2 text-[78px] font-black leading-none text-[#F0F6FC]"
                  style={{ animation: 'mission-launch-digit-in 220ms ease-out' }}
                >
                  {countdownValue}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border border-white/8 bg-[#0b1118]/76 px-5 py-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                <MapPin size={12} style={{ color: theme.accentText }} />
                Target
              </div>
              <div className="mt-2 text-[20px] font-black uppercase tracking-[0.05em] text-[#F0F6FC]">
                {context.targetTitle}
              </div>
              <div className="mt-3 text-[14px] leading-relaxed text-[#C9D1D9]">
                {context.objective}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onAbort}
                className="border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] text-[#F0F6FC] transition-colors hover:border-[#F0F6FC]/30 hover:bg-white/6"
                style={{
                  borderColor: 'rgba(255,255,255,0.14)',
                  background: 'rgba(13,17,23,0.78)',
                }}
              >
                Abort
              </button>
              <button
                type="button"
                onClick={onProceed}
                className="inline-flex items-center gap-2 border px-4 py-3 text-[11px] font-black uppercase tracking-[0.18em] transition-colors"
                style={{
                  borderColor: theme.accentBorder,
                  background: theme.accentSoft,
                  color: theme.accentStrong,
                }}
              >
                Proceed Now
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MissionFeedTray({ items, onActivateItem }) {
  if (!items.length) return null

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-40 w-[320px]" aria-live="polite" aria-atomic="false">
      <div className="pointer-events-auto flex max-h-[calc(100vh-2rem)] flex-col-reverse gap-2 overflow-y-auto pr-1">
        {items.map((item) => {
          const FeedIcon =
            item.kind === 'departure'
              ? CarFront
              : item.kind === 'arrival'
                ? Flag
                : item.kind === 'onsite' && item.entityType === 'meal'
                  ? Utensils
                  : MapPin

          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onActivateItem(item)}
              className={`w-full rounded-2xl border px-4 py-3 text-left shadow-[0_18px_40px_rgba(0,0,0,0.42)] backdrop-blur transition-all duration-500 ease-out ${
                item.phase === 'fading'
                  ? 'translate-y-2 opacity-0'
                  : 'translate-y-0 opacity-100'
              }`}
              style={{
                borderColor: `${item.tone}66`,
                background: 'linear-gradient(180deg, rgba(17,22,29,0.96), rgba(11,16,24,0.94))',
                boxShadow: `0 18px 40px rgba(0,0,0,0.42), 0 0 0 1px ${item.tone}22`,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                  style={{ borderColor: `${item.tone}66`, backgroundColor: `${item.tone}18`, color: item.tone }}
                >
                  <FeedIcon size={16} strokeWidth={2.2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: item.tone }}>
                      {item.subtitle}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-[13px] font-black uppercase tracking-[0.06em] text-[#F0F6FC]">
                    {item.title}
                  </div>
                  <div className="mt-1 truncate text-[10px] uppercase tracking-[0.14em] text-[#8B949E]">
                    {item.caption}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SituationBoard({ context, onOpenEntity, onOpenBriefing }) {
  const sections = [
    { title: 'Live now', items: context.liveEntities, emptyLabel: 'Nothing active in this window.' },
    { title: 'Coming up', items: [...context.nextEntities, ...context.prepSoon].slice(0, 4), emptyLabel: 'No immediate follow-ups.' },
  ]

  return (
    <div className="border border-[#30363D] bg-[#161b22]">
      <div className="border-b border-[#30363D] bg-[#1f2a34]/30 p-5">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.22em] text-[#58A6FF]">
          Current situation
        </div>
        <div className="text-[18px] font-black text-[#F0F6FC]">{context.cursorLabel}</div>
        <div className="mt-1 text-[11px] text-[#8B949E]">
          {context.liveEntities.length
            ? `${context.liveEntities.length} live item${context.liveEntities.length > 1 ? 's' : ''} in motion`
            : 'No live items in this window'}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-center">
            <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Live</div>
            <div className="mt-1 text-[13px] font-black text-[#C9D1D9]">{context.liveEntities.length}</div>
          </div>
          <div className="border border-[#30363D] bg-[#0d1117] px-3 py-2 text-center">
            <div className="text-[8px] font-black uppercase tracking-widest text-[#8B949E]">Soon</div>
            <div className="mt-1 text-[13px] font-black text-[#C9D1D9]">
              {context.nextEntities.length + context.prepSoon.length}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenBriefing}
          className="mt-4 flex w-full items-center justify-center border border-[#58A6FF]/30 bg-[#58A6FF]/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] text-[#58A6FF] transition-colors hover:border-[#58A6FF] hover:bg-[#58A6FF]/14"
        >
          Daily briefing
        </button>
      </div>

      <div className="space-y-4 p-4">
        {sections.map((section) => (
          <div key={section.title}>
            <div className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
              {section.title}
            </div>
            <div className="overflow-hidden border border-[#30363D] bg-[#0d1117]">
              {section.items.length ? section.items.map((item) => (
                <button
                  key={`${item.type}:${item.id}`}
                  type="button"
                  onClick={() => onOpenEntity(item.type, item.id)}
                  className="flex w-full items-start justify-between gap-3 border-b border-[#30363D]/30 px-4 py-3 text-left last:border-b-0 hover:bg-[#1f2a34]/40"
                >
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-[#C9D1D9]">{getEntityTitle(item)}</div>
                    <div className="mt-1 text-[10px] leading-relaxed text-[#8B949E]">
                      {getEntitySummary(item)}
                    </div>
                  </div>
                  {'status' in item && item.status ? <StatusPill tone={item.status}>{item.status}</StatusPill> : null}
                </button>
              )) : (
                <div className="px-4 py-3 text-[11px] text-[#8B949E]">{section.emptyLabel}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineBoard({
  doc,
  selection,
  onSelectEntity,
  onSetCursor,
  weatherDays,
  cursorSlot = doc.ui.timeline.cursorSlot,
  isPlaying = false,
  playbackSpeed = 1,
  onTogglePlayback,
  onRestartPlayback,
  onSetPlaybackSpeed,
}) {
  const days = weatherDays?.length ? weatherDays : DAYS
  const totalVisibleSlots = days.length * VISIBLE_TIMELINE_SLOT_SPAN
  const visibleHoursPerDay = VISIBLE_TIMELINE_END_HOUR - VISIBLE_TIMELINE_START_HOUR
  const timelineRef = useRef(null)
  const draggingRef = useRef(false)
  const [liveNow, setLiveNow] = useState(() => new Date())
  const [hoverCursorSlot, setHoverCursorSlot] = useState(null)
  const rowHeights = {
    travel: 72,
    activities: 44,
    support: 44,
  }
  const rows = [
    { id: 'travel', label: 'Transit' },
    { id: 'activities', label: 'Main Ops' },
    { id: 'support', label: 'Support' },
  ]
  const rowLayouts = rows.map((row, index) => ({
    ...row,
    height: rowHeights[row.id] || 40,
    top: rows.slice(0, index).reduce((sum, item) => sum + (rowHeights[item.id] || 40), 0),
  }))
  const timelineHeight = rowLayouts.reduce((sum, row) => sum + row.height, 0)
  const familyLaneMap = new Map(doc.families.map((family, index) => [family.id, index]))
  const actualTimelineRatio = projectCursorToVisibleTimelineRatio(getCurrentTripCursor(liveNow), days.length)
  const actualNowLabel = `${liveNow.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })} ${liveNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  const hoverCursorLabel = hoverCursorSlot == null ? null : getSlotLabel(hoverCursorSlot)
  const cursorRatio = projectCursorToVisibleTimelineRatio(cursorSlot, days.length)

  useEffect(() => {
    const timerId = window.setInterval(() => setLiveNow(new Date()), 60 * 1000)
    return () => window.clearInterval(timerId)
  }, [])

  const scrubToClientX = useCallback((clientX) => {
    if (!timelineRef.current) return null
    const bounds = timelineRef.current.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - bounds.left) / bounds.width, 0), 0.999999)
    return projectVisibleTimelineRatioToCursor(ratio, days.length)
  }, [days.length])

  useEffect(() => {
    const handlePointerUp = () => {
      draggingRef.current = false
    }

    window.addEventListener('mouseup', handlePointerUp)
    return () => window.removeEventListener('mouseup', handlePointerUp)
  }, [])

  return (
    <div className="shrink-0 border-t border-[#30363D] bg-[#161b22] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex h-14 border-b border-[#30363D]/50">
        <div className="flex w-28 flex-col justify-center gap-1 border-r border-[#30363D] bg-[#0d1117]/50 px-2">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={onTogglePlayback}
              className="inline-flex h-7 w-7 items-center justify-center border border-[#58A6FF]/40 bg-[#58A6FF]/10 text-[#58A6FF] transition-colors hover:border-[#58A6FF]"
              title={isPlaying ? 'Pause playback' : 'Play playback'}
            >
              {isPlaying ? <Pause size={13} /> : <Play size={13} className="translate-x-[1px]" />}
            </button>
            <button
              type="button"
              onClick={onRestartPlayback}
              className="inline-flex h-7 w-7 items-center justify-center border border-[#30363D] bg-[#0d1117] text-[#8B949E] transition-colors hover:border-[#58A6FF]/40 hover:text-[#C9D1D9]"
              title="Restart playback from trip start"
            >
              <RotateCcw size={13} />
            </button>
          </div>
          <div className="flex items-center justify-center gap-1">
            <Gauge size={10} className="text-[#8B949E]" />
            <button
              type="button"
              onClick={() => {
                const currentIndex = PLAYBACK_SPEED_OPTIONS.indexOf(playbackSpeed)
                const nextSpeed = PLAYBACK_SPEED_OPTIONS[(currentIndex + 1) % PLAYBACK_SPEED_OPTIONS.length]
                onSetPlaybackSpeed?.(nextSpeed)
              }}
              className="text-[9px] font-black uppercase tracking-[0.16em] text-[#8B949E] transition-colors hover:text-[#C9D1D9]"
            >
              {playbackSpeed}x
            </button>
          </div>
        </div>
        <div className="flex flex-1 divide-x divide-[#30363D]/30">
          {days.map((day) => {
            const WeatherIcon = WEATHER_ICONS[day.weatherIconKey] || Cloud
            return (
              <div key={day.id} className="flex flex-1 items-center gap-3 px-4">
                <WeatherIcon size={18} className="text-[#58A6FF]" />
                <div>
                  <div className="text-[9px] font-black uppercase tracking-tighter text-[#8B949E]">
                    {day.weather}
                  </div>
                  <div className="text-[11px] font-bold text-[#C9D1D9]">{day.temperature}</div>
                  {day.weatherLocation ? (
                    <div className="text-[9px] text-[#8B949E]">{day.weatherLocation}</div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex" style={{ height: `${timelineHeight}px` }}>
        <div className="flex w-28 flex-col border-r border-[#30363D] bg-[#0d1117]/50">
          {rowLayouts.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-center border-b border-[#30363D]/30 px-2 text-center text-[9px] font-black uppercase tracking-widest text-[#8B949E] last:border-b-0"
              style={{ height: `${row.height}px` }}
            >
              {row.label}
            </div>
          ))}
        </div>

        <div
          ref={timelineRef}
          className="relative flex-1 overflow-hidden cursor-col-resize"
          style={{ height: `${timelineHeight}px` }}
          onMouseLeave={() => {
            if (!draggingRef.current) setHoverCursorSlot(null)
          }}
          onMouseDown={(event) => {
            draggingRef.current = true
            const nextCursorSlot = scrubToClientX(event.clientX)
            if (nextCursorSlot != null) {
              setHoverCursorSlot(nextCursorSlot)
              onSetCursor?.(nextCursorSlot)
            }
          }}
          onMouseMove={(event) => {
            const nextCursorSlot = scrubToClientX(event.clientX)
            if (nextCursorSlot == null) return
            setHoverCursorSlot(nextCursorSlot)
            if (draggingRef.current) {
              onSetCursor?.(nextCursorSlot)
            }
          }}
          onClick={(event) => {
            const nextCursorSlot = scrubToClientX(event.clientX)
            if (nextCursorSlot != null) {
              onSetCursor?.(nextCursorSlot)
            }
          }}
        >
          <div className="absolute inset-0">
            {Array.from({ length: days.length * visibleHoursPerDay + 1 }).map((_, index) => {
              const hour = index % visibleHoursPerDay
              const actualHour = VISIBLE_TIMELINE_START_HOUR + hour
              const isMajor = hour % TIMELINE_HOURS_PER_SLOT === 0
              return (
                <div
                  key={`grid-${index}`}
                  className={cn(
                    'absolute bottom-0 top-0',
                    isMajor ? 'border-l border-[#30363D]/32' : 'border-l border-[#30363D]/10',
                  )}
                  style={{ left: `${(index / (days.length * visibleHoursPerDay)) * 100}%` }}
                  data-hour={actualHour}
                />
              )
            })}
          </div>

          <div className="absolute inset-0">
            {rowLayouts.map((row) => {
              const rowItems = doc.itineraryItems.filter((item) => item.rowId === row.id)
              const laneCount = row.id === 'travel' ? Math.max(doc.families.length, 1) : 1
              const laneHeight = row.height / laneCount

              return (
                <div
                  key={row.id}
                  className="absolute left-0 right-0 border-b border-[#30363D]/30 last:border-b-0"
                  style={{ top: `${row.top}px`, height: `${row.height}px` }}
                >
                  {row.id === 'travel'
                    ? doc.families.slice(1).map((_, index) => (
                        <div
                          key={`travel-divider-${index}`}
                          className="absolute left-0 right-0 border-t border-[#30363D]/20"
                          style={{ top: `${laneHeight * (index + 1)}px` }}
                        />
                      ))
                    : null}

                  {rowItems.map((item) => {
                    const itemSpan = getItineraryItemEffectiveSpan(doc, item)
                    const itemEnd = item.startSlot + itemSpan
                    const itemDayIndex = Math.min(Math.max(Math.floor(item.startSlot / TIME_SLOTS.length), 0), days.length - 1)
                    const visibleRange = getDayVisibleCursorRange(itemDayIndex)
                    const clippedStart = Math.max(item.startSlot, visibleRange.start)
                    const clippedEnd = Math.min(itemEnd, visibleRange.end)
                    if (clippedEnd <= clippedStart) return null
                    const laneIndex =
                      row.id === 'travel' ? familyLaneMap.get(item.familyIds?.[0]) ?? 0 : 0
                    const itemTop = row.id === 'travel' ? laneIndex * laneHeight + 2 : 6
                    const itemHeight = row.id === 'travel' ? laneHeight - 4 : row.height - 12
                    const selected = selection.type === item.type && selection.id === item.id
                    const compactTravelItem = row.id === 'travel' && itemSpan <= 0.22
                    const shortTravelItem = row.id === 'travel' && itemSpan <= 0.42
                    const compactTravelLabel = compactTravelItem ? getCompactTravelLabel(item) : null

                    const itemWidthPercent = (
                      projectCursorToVisibleTimelineRatio(clippedEnd, days.length)
                      - projectCursorToVisibleTimelineRatio(clippedStart, days.length)
                    ) * 100
                    const travelMinWidthPx =
                      row.id === 'travel'
                        ? compactTravelItem
                          ? 26
                          : shortTravelItem
                            ? 34
                            : 0
                        : 0

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onSetCursor?.(item.startSlot)
                          onSelectEntity(item.type, item.id)
                        }}
                        className={cn(
                          'absolute flex cursor-pointer items-center rounded-[1px] border px-2 text-left transition-[transform,box-shadow] hover:-translate-y-[1px]',
                          TIMELINE_COLORS[item.color],
                          selected ? 'ring-1 ring-white/80 shadow-[0_0_0_1px_rgba(255,255,255,0.15)]' : '',
                          compactTravelItem ? 'justify-center px-1' : '',
                        )}
                        title={item.title}
                        style={{
                          top: `${itemTop}px`,
                          height: `${itemHeight}px`,
                          left: `${projectCursorToVisibleTimelineRatio(clippedStart, days.length) * 100}%`,
                          width:
                            row.id === 'travel' && travelMinWidthPx
                              ? `max(${itemWidthPercent}%, ${travelMinWidthPx}px)`
                              : `${itemWidthPercent}%`,
                        }}
                      >
                        {row.id === 'travel' ? (
                          <span className={cn('flex min-w-0 items-center gap-1', compactTravelItem ? 'justify-center' : '')}>
                            {compactTravelItem ? null : <CarFront size={10} className="shrink-0" />}
                            <span
                              className={cn(
                                'truncate font-black uppercase',
                                compactTravelItem ? 'text-[7px] tracking-[0.12em]' : 'text-[8px] tracking-widest',
                              )}
                            >
                              {compactTravelItem ? compactTravelLabel : item.title}
                            </span>
                          </span>
                        ) : (
                          <span className="truncate text-[8px] font-black uppercase tracking-widest">
                            {item.title}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>

          <div
            className="absolute bottom-0 top-0 z-10 w-px bg-[#58A6FF] shadow-[0_0_6px_rgba(88,166,255,0.8)]"
            style={{ left: `${actualTimelineRatio * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-[#58A6FF] px-2 py-0.5 text-[9px] font-black uppercase text-[#0A0C10]">
              now
            </div>
            <div className="absolute top-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#0d1117] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#58A6FF]">
              {actualNowLabel}
            </div>
          </div>

          {hoverCursorSlot != null ? (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-[15] w-px bg-white/30"
              style={{ left: `${projectCursorToVisibleTimelineRatio(hoverCursorSlot, days.length) * 100}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap border border-white/15 bg-[#0d1117]/90 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-[#C9D1D9]">
                {hoverCursorLabel}
              </div>
            </div>
          ) : null}

          <div
            className="absolute bottom-0 top-0 z-20 w-px bg-white shadow-[0_0_8px_white]"
            style={{ left: `${cursorRatio * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 bg-white px-2 py-0.5 text-[9px] font-black uppercase text-[#0A0C10]">
              cursor
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-10 border-t border-[#30363D] bg-[#0d1117]">
        <div className="flex w-28 items-center justify-center border-r border-[#30363D] px-2">
          <div className="text-center text-[9px] font-black uppercase tracking-[0.16em] text-[#8B949E]">
            mission scrub
          </div>
        </div>
        <div className="flex flex-1 divide-x divide-[#30363D]/50">
          {days.map((day, dayIndex) => (
            <div key={day.id} className="relative flex flex-1 flex-col">
              <div className="absolute -top-2 left-2 bg-[#0d1117] px-1.5 text-[8px] font-black uppercase tracking-widest text-[#58A6FF]">
                {day.shortLabel}
              </div>
              <div className="flex h-full">
                {Array.from({ length: visibleHoursPerDay }).map((_, hourOffset) => {
                  const hour = VISIBLE_TIMELINE_START_HOUR + hourOffset
                  const hourCursor = clampTimelineCursor(dayIndex * TIME_SLOTS.length + hour / TIMELINE_HOURS_PER_SLOT)
                  const showLabel = (hour - VISIBLE_TIMELINE_START_HOUR) % 3 === 0
                  const isActive = Math.abs(cursorSlot - hourCursor) < (1 / TIMELINE_HOURS_PER_SLOT) / 2

                  return (
                    <button
                      key={`${day.id}-${hour}`}
                      type="button"
                      onMouseEnter={() => setHoverCursorSlot(hourCursor)}
                      onMouseLeave={() => {
                        if (!draggingRef.current) setHoverCursorSlot(null)
                      }}
                      onClick={() => onSetCursor?.(hourCursor)}
                      className={cn(
                        'flex flex-1 cursor-pointer items-center justify-center border-r border-[#30363D]/10 text-[9px] font-mono transition-colors last:border-r-0',
                        isActive
                          ? 'bg-[#58A6FF]/10 text-[#58A6FF]'
                          : 'text-[#8B949E] hover:bg-[#1f2a34]/40 hover:text-[#C9D1D9]',
                      )}
                    >
                      {showLabel ? String(hour).padStart(2, '0') : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function IntelAction({ icon: Icon, label, onClick, tone = 'default' }) {
  const tones = {
    default: 'border-[#30363D] bg-[#0d1117] text-[#C9D1D9] hover:border-[#58A6FF]/40 hover:text-[#58A6FF]',
    amber: 'border-[#D29922]/30 bg-[#D29922]/10 text-[#D29922] hover:border-[#D29922]',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-colors',
        tones[tone] || tones.default,
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

function InfoRow({ icon: Icon, label, value, muted = false }) {
  if (!value) return null

  return (
    <div className="flex items-start gap-2 text-[11px]">
      {Icon ? <Icon size={13} className="mt-0.5 text-[#58A6FF]" /> : null}
      <div className="min-w-0">
        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">{label}</div>
        <div className={muted ? 'mt-0.5 text-[#8B949E]' : 'mt-0.5 text-[#C9D1D9]'}>{value}</div>
      </div>
    </div>
  )
}

function formatMealTravelSignal(meal, location) {
  if (!location) return 'Venue pending'
  if (location.id === 'pine-airbnb') return 'Basecamp meal'
  if (location.basecampDrive?.durationText) {
    return `${location.basecampDrive.durationText} from basecamp`
  }
  if (meal.dayId === 'sat') return 'Park day lunch'
  return 'Venue intel loading'
}

function getMealContextNarrative(meal, location, linkedMission) {
  if (location?.id === 'pine-airbnb') {
    return 'Cook-in coverage keeps the day flexible and reduces logistics overhead for families with kids.'
  }
  if (meal.id === 'sat-lunch') {
    return 'This stop needs clean timing because it sits inside the Yosemite mission and depends on traffic, entry flow, and kid energy.'
  }
  if (meal.id === 'fri-dinner') {
    return 'This reservation is the reset valve after lake time and late arrival handoff, so preserving margin matters more than squeezing in extras.'
  }
  if (meal.id === 'thu-dinner') {
    return 'First-night dinner should stay frictionless so arrival, gate access, and room setup do not cascade into everyone else.'
  }
  return linkedMission?.summary || location?.summary || meal.note
}

function getMealMedia(location) {
  const seen = new Set()
  return [...(location?.livePhotos || []), ...(location?.photos || [])].filter((media) => {
    const key = media.imageUrl || media.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const ACTIVITY_RESEARCH = {
  'thu-transit': {
    headline: 'Arrival day should optimize for smooth landfall, not ambition.',
    cards: [
      {
        eyebrow: 'Night Objective',
        title: 'Check in, decompress, dinner, done',
        bullets: [
          'The mission is to get each family through gate access, unload only the essentials, and preserve enough energy for an easy first night.',
          'Use dinner as the reset point. Do not stack optional errands or sightseeing after arrival.',
          'If anyone is running late, the fallback is minimum-viable cabin setup plus direct handoff into dinner/rest mode.',
        ],
      },
      {
        eyebrow: 'Transit Focus',
        title: 'Each family runs a different inbound playbook',
        bullets: [
          'Parkers have the long LA haul, so road-trip stops and dinner timing matter most there.',
          'Jiangs can act as the most flexible support unit if another family slips.',
          'The first family on site should not silently inherit all setup work, so arrival responsibilities need to stay explicit.',
        ],
      },
    ],
  },
  'fri-lake': {
    headline: 'Friday should feel local, flexible, and easy on kid energy.',
    cards: [
      {
        eyebrow: 'PML Ideas',
        title: 'Family-friendly options at Pine Mountain Lake',
        bullets: [
          'Marina Beach is the most full-service zone, with picnic tables, grills, a cafe/store, and the easiest all-in family setup.',
          'Lake Lodge Beach is smaller and has a playground nearby, which makes it a strong fit for alternating swim + play cycles.',
          'Dunn Court Beach is quieter and works better if you want a lower-stimulus backup.',
        ],
      },
      {
        eyebrow: 'Extra Options',
        title: 'Ways to vary the day without leaving PML',
        bullets: [
          'The lake community also has a pool, tennis/pickleball, golf, marina/boat access, and an equestrian center.',
          'A lighter split plan could be beach for the kids while another adult group checks the pool, pickleball, or marina store.',
          'Because this is inside the gated community, it is the best day to keep logistics low and recover from Thursday transit.',
        ],
      },
    ],
  },
  'sat-yosemite': {
    headline: 'Yosemite should be structured around a few high-payoff, low-friction stops.',
    cards: [
      {
        eyebrow: 'Best Easy Stops',
        title: 'Family-friendly Yosemite Valley flow',
        bullets: [
          'Lower Yosemite Fall is one of the easiest iconic walks in the valley and works well for a first major stop.',
          "Cook's Meadow is flat, scenic, and a good low-effort way to get valley views without overcommitting.",
          'Swinging Bridge is useful as a picnic / water / reset stop if kid energy needs a break.',
        ],
      },
      {
        eyebrow: 'Operational Notes',
        title: 'Keep the mission flexible',
        bullets: [
          'Tunnel View is the easiest headline photo stop if timing or walking tolerance tightens up.',
          'Shuttle use inside Yosemite Valley can reduce parking churn if the valley is busy.',
          'If weather or kid pacing degrades, shorten the day and preserve enough energy for the cookout dinner back at basecamp.',
        ],
      },
    ],
  },
  'sun-home': {
    headline: 'Sunday wins when it feels boring, orderly, and pre-decided.',
    cards: [
      {
        eyebrow: 'Morning Flow',
        title: 'Brunch, reset, depart in waves',
        bullets: [
          'Cook brunch early enough that cleanup and final packing do not overlap into a chaotic checkout sprint.',
          'Assign one adult to cabin reset and one to vehicle staging so the same person is not doing both.',
          'If possible, pre-pack most kid gear Saturday night and keep only morning essentials out.',
        ],
      },
      {
        eyebrow: 'Departure Logic',
        title: 'Reduce Sunday friction',
        bullets: [
          'Do a last sweep by zones: kitchen, bathrooms, bedrooms, charging cables, outdoor gear.',
          'Treat garbage, fridge clean-out, and wet gear as explicit checkout tasks, not end-of-trip surprises.',
          'Stagger departures if needed instead of forcing everyone into the same checkout bottleneck.',
        ],
      },
    ],
  },
}

const JIANG_ROAD_TRIP_STOP_DEFAULTS = [
  {
    id: 'north-star-kettleman-lunch',
    type: 'location',
    title: 'Bravo Farms',
    category: 'logistics',
    dayId: 'thu',
    stopType: 'Lunch stop',
    placesQuery: 'Bravo Farms Kettleman City CA',
    address: '19950 Bernard Dr, Kettleman City, CA 93239',
    coordinates: { lat: 35.9934, lng: -119.9617 },
    externalUrl: 'https://www.google.com/maps/search/?api=1&query=Bravo+Farms+Kettleman+City',
    summary: 'Good halfway lunch + restroom + leg-stretch stop on the LA inbound drive.',
    linkedEntityKeys: [makeEntityKey('family', 'north-star'), makeEntityKey('itineraryItem', 'north-star-drive')],
    photos: [],
    note: '',
  },
  {
    id: 'north-star-oakdale-break',
    type: 'location',
    title: 'Oakdale Cheese & Specialties',
    category: 'logistics',
    dayId: 'thu',
    stopType: 'Light break',
    placesQuery: 'Oakdale Cheese & Specialties Oakdale CA',
    address: '10040 CA-120, Oakdale, CA 95361',
    coordinates: { lat: 37.7975, lng: -120.8108 },
    externalUrl: 'https://www.google.com/maps/search/?api=1&query=Oakdale+Cheese+%26+Specialties',
    summary: 'Final reset stop before the mountain leg. Good for snacks, bathrooms, and a quick stretch.',
    linkedEntityKeys: [makeEntityKey('family', 'north-star'), makeEntityKey('itineraryItem', 'north-star-drive')],
    photos: [],
    note: '',
  },
]

const FAMILY_VEHICLE_DEFAULTS = {
  'north-star': {
    originAddress: '2800 E Observatory Rd, Los Angeles, CA 90027',
    originCoordinates: { lat: 34.1184, lng: -118.3004 },
    vehicleLabel: 'Vehicle 1',
    plannedStopIds: ['north-star-kettleman-lunch', 'north-star-oakdale-break'],
    routeSummary: 'Plan lunch in Kettleman City and a final light break in Oakdale before the last mountain leg into Pine Mountain Lake.',
  },
  'silver-peak': {
    originAddress: '1 Ferry Building, San Francisco, CA 94111',
    originCoordinates: { lat: 37.7955, lng: -122.3937 },
    vehicleLabel: 'Vehicle 2',
    plannedStopIds: ['north-star-oakdale-break'],
    routeSummary: 'Plan a quick Oakdale Cheese reset stop before the final push into Pine Mountain Lake.',
  },
  'desert-bloom': {
    originAddress: '10 N Virginia St, Reno, NV 89501',
    originCoordinates: { lat: 39.5296, lng: -119.8138 },
    vehicleLabel: 'Vehicle 3',
    plannedStopIds: [],
    routeSummary: 'Friday arrival push from Reno straight into Pine Mountain Lake.',
  },
}

const YOSEMITE_ROUTE_DEFAULTS = {
  title: 'Big Oak Flat Entrance',
  placesQuery: 'Big Oak Flat Entrance Yosemite National Park CA',
  address: 'Big Oak Flat Rd, Yosemite National Park, CA 95321',
  coordinates: { lat: 37.8108, lng: -119.8744 },
  externalUrl: 'https://www.google.com/maps/search/?api=1&query=Big+Oak+Flat+Entrance+Yosemite',
  summary:
    'Primary Saturday route anchor. Using the west entrance keeps park access, traffic watch, and drive planning grounded in a real checkpoint.',
}

const ROUTE_SIM_DEFAULTS = {
  'route-la-north-star': {
    originCoordinates: { lat: 34.1184, lng: -118.3004 },
    stopLocationIds: ['north-star-kettleman-lunch', 'north-star-oakdale-break'],
    destinationLocationId: 'pine-airbnb',
    simulationStartSlot: 1.75,
    simulationEndSlot: 2.67,
    durationSeconds: 5.5 * 60 * 60,
    simulationMilestones: [
      { t: 0, progress: 0 },
      { t: 0.46, progress: 0.44 },
      { t: 0.56, progress: 0.44 },
      { t: 0.82, progress: 0.82 },
      { t: 0.9, progress: 0.82 },
      { t: 1, progress: 1 },
    ],
  },
  'route-sf-silver-peak': {
    originCoordinates: { lat: 37.7955, lng: -122.3937 },
    stopLocationIds: ['north-star-oakdale-break'],
    destinationLocationId: 'pine-airbnb',
    simulationStartSlot: 2.09,
    simulationEndSlot: 2.67,
    durationSeconds: 3.5 * 60 * 60,
    simulationMilestones: [
      { t: 0, progress: 0 },
      { t: 0.72, progress: 0.74 },
      { t: 0.82, progress: 0.74 },
      { t: 1, progress: 1 },
    ],
  },
  'route-sf-desert-bloom': {
    originCoordinates: { lat: 39.5296, lng: -119.8138 },
    stopLocationIds: [],
    destinationLocationId: 'pine-airbnb',
    simulationStartSlot: 5.33,
    simulationEndSlot: 6.16,
    durationSeconds: 5 * 60 * 60,
    simulationMilestones: [
      { t: 0, progress: 0 },
      { t: 0.52, progress: 0.5 },
      { t: 1, progress: 1 },
    ],
  },
}

function ActivityResearchCard({ eyebrow, title, bullets }) {
  return (
    <div className="border border-[#30363D] bg-[#0d1117] p-4">
      <SectionTitle eyebrow={eyebrow} title={title} />
      <div className="space-y-2">
        {bullets.map((bullet) => (
          <div key={bullet} className="text-[11px] leading-relaxed text-[#C9D1D9]">
            {bullet}
          </div>
        ))}
      </div>
    </div>
  )
}

function TransitStopCard({ stop, onSelectEntity }) {
  return (
    <button
      type="button"
      onClick={() => onSelectEntity('location', stop.id)}
      className="border border-[#30363D] bg-[#0d1117] p-4 text-left transition-colors hover:border-[#58A6FF]/40 hover:bg-[#1f2a34]/30"
    >
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#D29922]">
        {stop.stopType || 'Stop'}
      </div>
      <div className="mt-1 text-[12px] font-black uppercase tracking-[0.08em] text-[#C9D1D9]">{stop.title}</div>
      <div className="mt-2 text-[10px] leading-relaxed text-[#8B949E]">{stop.summary || stop.address}</div>
      {stop.address ? <div className="mt-2 text-[10px] text-[#8B949E]">{stop.address}</div> : null}
    </button>
  )
}

function ItineraryPage({
  doc,
  selection,
  onSelectEntity,
  onOpenEntity,
  onSetCursor,
  onUpdateMapUi,
  onHydrateRouteDetails,
  onUpdatePageNote,
  onConvertPageNote,
  weatherDays,
  mapWeather,
  mapWeatherTargets,
}) {
  const [briefingOpen, setBriefingOpen] = useState(false)
  const [playbackCursorSlot, setPlaybackCursorSlot] = useState(null)
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [missionFeedItems, setMissionFeedItems] = useState([])
  const [missionFeedNow, setMissionFeedNow] = useState(() => Date.now())
  const [operationGate, setOperationGate] = useState(null)
  const [operationGateRemainingMs, setOperationGateRemainingMs] = useState(0)
  const playbackCursorRef = useRef(doc.ui.timeline.cursorSlot)
  const playbackRunRef = useRef({ anchorCursor: doc.ui.timeline.cursorSlot, anchorTimestamp: null })
  const operationGateRef = useRef(null)
  const triggeredOperationCheckpointIdsRef = useRef(new Set())
  const effectiveCursorSlot = playbackCursorSlot ?? doc.ui.timeline.cursorSlot
  const context = useMemo(() => getTimelineContext(doc, effectiveCursorSlot), [doc, effectiveCursorSlot])
  const dailyBriefing = useMemo(() => buildDailyBriefing(doc, context), [doc, context])
  const operationCheckpoints = useMemo(() => buildOperationCheckpoints(doc), [doc])
  const playbackHighlightLocationId = useMemo(
    () => (isPlaybackPlaying ? getPlaybackHighlightLocation(doc, context) : null),
    [context, doc, isPlaybackPlaying],
  )
  const renderedMissionFeedItems = useMemo(() => {
    const expirationMs = MISSION_FEED_LIFETIME_MS + MISSION_FEED_FADE_MS
    return missionFeedItems
      .map((item) => {
        const ageMs = Math.max(missionFeedNow - (item.createdAt || 0), 0)
        if (ageMs >= expirationMs) return null
        return {
          ...item,
          phase: ageMs >= MISSION_FEED_LIFETIME_MS ? 'fading' : 'visible',
        }
      })
      .filter(Boolean)
  }, [missionFeedItems, missionFeedNow])

  useEffect(() => {
    playbackCursorRef.current = effectiveCursorSlot
  }, [effectiveCursorSlot])

  useEffect(() => {
    operationGateRef.current = operationGate
  }, [operationGate])

  const updateMissionFeedItems = useCallback((updater) => {
    setMissionFeedItems((current) => (typeof updater === 'function' ? updater(current) : updater))
  }, [])

  const clearMissionFeed = useCallback(() => {
    setMissionFeedNow(Date.now())
    updateMissionFeedItems([])
  }, [])

  useEffect(() => {
    if (!missionFeedItems.length) return undefined

    const tick = () => {
      const now = Date.now()
      const expirationMs = MISSION_FEED_LIFETIME_MS + MISSION_FEED_FADE_MS
      setMissionFeedNow(now)
      updateMissionFeedItems((current) => {
        const next = current.filter((item) => now - (item.createdAt || 0) < expirationMs)
        return next.length === current.length ? current : next
      })
    }

    tick()
    const intervalId = window.setInterval(tick, MISSION_FEED_TICK_MS)
    return () => window.clearInterval(intervalId)
  }, [missionFeedItems.length, updateMissionFeedItems])

  const handlePlaybackFeedItems = useCallback((items) => {
    const nextItems = (Array.isArray(items) ? items : [items]).filter(Boolean)
    if (!nextItems.length) return

    const createdAt = Date.now()
    updateMissionFeedItems((current) => {
      const next = [...current]
      nextItems.forEach((item) => {
        const nextItem = {
          ...item,
          createdAt,
        }
        const existingIndex = next.findIndex((existing) => existing.key === item.key)
        if (existingIndex >= 0) {
          next.splice(existingIndex, 1)
        }
        next.push(nextItem)
      })
      return next
    })
    setMissionFeedNow(createdAt)
  }, [updateMissionFeedItems])

  const handleMissionFeedActivate = useCallback((item) => {
    if (item.entityType && item.entityId) {
      onOpenEntity(item.entityType, item.entityId)
      return
    }

    if (item.locationId) {
      onSelectEntity('location', item.locationId)
      return
    }

    if (item.familyId) {
      onSelectEntity('family', item.familyId)
    }
  }, [onOpenEntity, onSelectEntity])

  const proceedOperationGate = useCallback(() => {
    operationGateRef.current = null
    setOperationGate(null)
    setOperationGateRemainingMs(0)
  }, [])

  const armOperationCheckpointsFromCursor = useCallback((cursorSlot) => {
    const normalizedCursor = clampTimelineCursor(cursorSlot)
    triggeredOperationCheckpointIdsRef.current = new Set(
      operationCheckpoints
        .filter((checkpoint) => checkpoint.startSlot <= normalizedCursor + 0.001)
        .map((checkpoint) => checkpoint.id),
    )
  }, [operationCheckpoints])

  const triggerOperationGate = useCallback((checkpoint) => {
    const holdCursor = clampTimelineCursor(checkpoint.startSlot)
    playbackCursorRef.current = holdCursor
    setPlaybackCursorSlot(holdCursor)
    setOperationGate({
      ...checkpoint,
      autoAdvanceMs: checkpoint.autoAdvanceMs || 3000,
    })
    setOperationGateRemainingMs(checkpoint.autoAdvanceMs || 3000)
  }, [])

  const abortOperationGate = useCallback(() => {
    const committedCursor = clampTimelineCursor(playbackCursorRef.current)
    operationGateRef.current = null
    setIsPlaybackPlaying(false)
    setPlaybackCursorSlot(null)
    setOperationGate(null)
    setOperationGateRemainingMs(0)
    onSetCursor(committedCursor)
  }, [onSetCursor])

  useEffect(() => {
    if (!operationGate) return undefined

    setOperationGateRemainingMs(operationGate.autoAdvanceMs)
    const startedAt = Date.now()
    const intervalId = window.setInterval(() => {
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(operationGate.autoAdvanceMs - elapsed, 0)
      setOperationGateRemainingMs(remaining)
      if (remaining <= 0) {
        window.clearInterval(intervalId)
        proceedOperationGate()
      }
    }, 80)

    return () => window.clearInterval(intervalId)
  }, [operationGate, proceedOperationGate])

  useEffect(() => {
    if (!briefingOpen) return undefined

    console.info('[TripCommand] Daily briefing opened', {
      cursorSlot: effectiveCursorSlot,
      day: dailyBriefing?.day?.id,
    })

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        console.info('[TripCommand] Daily briefing closed via Escape')
        setBriefingOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [briefingOpen])

  useEffect(() => {
    if (!isPlaybackPlaying) return undefined

    let frameId = null
    const maxCursor = clampTimelineCursor(DAYS.length * TIME_SLOTS.length)
    playbackRunRef.current = {
      anchorCursor: playbackCursorRef.current,
      anchorTimestamp: null,
    }

    const animate = (timestamp) => {
      if (operationGateRef.current) {
        playbackRunRef.current.anchorTimestamp = timestamp
        frameId = window.requestAnimationFrame(animate)
        return
      }

      const previousTimestamp = playbackRunRef.current.anchorTimestamp
      playbackRunRef.current.anchorTimestamp = timestamp

      if (previousTimestamp == null) {
        frameId = window.requestAnimationFrame(animate)
        return
      }

      const rawDeltaSeconds = Math.max((timestamp - previousTimestamp) / 1000, 0)
      const deltaSeconds =
        rawDeltaSeconds > PLAYBACK_STALL_RESET_SECONDS
          ? 0
          : Math.min(rawDeltaSeconds, PLAYBACK_MAX_FRAME_DELTA_SECONDS)
      const currentCursor = playbackCursorRef.current
      const nextCursor = clampTimelineCursor(
        currentCursor + deltaSeconds * PLAYBACK_SLOT_UNITS_PER_SECOND * playbackSpeed,
      )
      const crossedCheckpoint = findCrossedOperationCheckpoint(
        operationCheckpoints,
        currentCursor,
        nextCursor,
        triggeredOperationCheckpointIdsRef.current,
      )

      if (crossedCheckpoint) {
        triggeredOperationCheckpointIdsRef.current.add(crossedCheckpoint.id)
        triggerOperationGate(crossedCheckpoint)
        playbackRunRef.current.anchorTimestamp = timestamp
        frameId = window.requestAnimationFrame(animate)
        return
      }

      playbackCursorRef.current = nextCursor
      setPlaybackCursorSlot(nextCursor)

      if (nextCursor >= maxCursor - 0.002) {
        setIsPlaybackPlaying(false)
        setPlaybackCursorSlot(null)
        onSetCursor(maxCursor)
        return
      }

      frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId)
    }
  }, [isPlaybackPlaying, onSetCursor, operationCheckpoints, playbackSpeed, triggerOperationGate])

  const handleTimelineCursorChange = useCallback(
    (slot) => {
      const nextCursor = clampTimelineCursor(slot)
      setOperationGate(null)
      setOperationGateRemainingMs(0)
      operationGateRef.current = null
      armOperationCheckpointsFromCursor(nextCursor)
      clearMissionFeed()
      if (isPlaybackPlaying) {
        playbackRunRef.current = {
          anchorCursor: nextCursor,
          anchorTimestamp: null,
        }
        playbackCursorRef.current = nextCursor
        setPlaybackCursorSlot(nextCursor)
      return
      }
      setPlaybackCursorSlot(null)
      onSetCursor(nextCursor)
    },
    [armOperationCheckpointsFromCursor, clearMissionFeed, isPlaybackPlaying, onSetCursor],
  )

  const handleTogglePlayback = useCallback(() => {
    console.info('[TripCommand] Playback button clicked', {
      isPlaybackPlaying,
      cursorSlot: playbackCursorRef.current,
      playbackSpeed,
    })

    if (isPlaybackPlaying) {
      const committedCursor = clampTimelineCursor(playbackCursorRef.current)
      setIsPlaybackPlaying(false)
      setPlaybackCursorSlot(null)
      operationGateRef.current = null
      setOperationGate(null)
      setOperationGateRemainingMs(0)
      console.info('[TripCommand] Playback paused', { committedCursor })
      onSetCursor(committedCursor)
      return
    }

    const startingCursor = getSuggestedPlaybackStartCursor(doc, doc.ui.timeline.cursorSlot, operationCheckpoints)
    armOperationCheckpointsFromCursor(startingCursor)
    clearMissionFeed()
    playbackRunRef.current = {
      anchorCursor: startingCursor,
      anchorTimestamp: null,
    }
    playbackCursorRef.current = startingCursor
    setPlaybackCursorSlot(startingCursor)
    setIsPlaybackPlaying(true)
    console.info('[TripCommand] Playback started', { startingCursor, playbackSpeed })
  }, [armOperationCheckpointsFromCursor, clearMissionFeed, doc, doc.ui.timeline.cursorSlot, isPlaybackPlaying, onSetCursor, operationCheckpoints, playbackSpeed])

  const handleRestartPlayback = useCallback(() => {
    const restartCursor = 0
    console.info('[TripCommand] Playback restarted', { restartCursor, isPlaybackPlaying })
    setOperationGate(null)
    setOperationGateRemainingMs(0)
    operationGateRef.current = null
    triggeredOperationCheckpointIdsRef.current.clear()
    clearMissionFeed()
    playbackRunRef.current = {
      anchorCursor: restartCursor,
      anchorTimestamp: null,
    }
    playbackCursorRef.current = restartCursor
    if (isPlaybackPlaying) {
      setPlaybackCursorSlot(restartCursor)
      return
    }
    onSetCursor(restartCursor)
  }, [clearMissionFeed, isPlaybackPlaying, onSetCursor])

  const handleOpenBriefing = useCallback(() => {
    console.info('[TripCommand] Daily briefing button clicked', {
      cursorSlot: effectiveCursorSlot,
      day: dailyBriefing?.day?.id,
    })
    setBriefingOpen(true)
  }, [dailyBriefing?.day?.id, effectiveCursorSlot])

  return (
    <>
      <div className="grid h-full min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-[#30363D] bg-[#0d1117]">
          <div className="space-y-4 p-4">
            <SituationBoard context={context} onOpenEntity={onOpenEntity} onOpenBriefing={handleOpenBriefing} />
            <div>
              <SectionTitle eyebrow="Response Plans" title="Travel units" meta={`${doc.families.length} families`} />
              <FamilyList doc={doc} selection={selection} onSelectEntity={onSelectEntity} />
            </div>
            <div>
              <ScenarioControls doc={doc} cursorSlot={effectiveCursorSlot} onSetCursor={handleTimelineCursorChange} />
            </div>
            <div>
              <PageNotesCard
                title="Planner note"
                value={getPageNote(doc, 'itinerary')}
                onChange={(value) => onUpdatePageNote('itinerary', value)}
                onConvert={() => onConvertPageNote('itinerary')}
                placeholder="Add a planning note..."
              />
            </div>
          </div>
        </div>

        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
          <div className="relative min-h-0 min-w-0 overflow-hidden">
            <CommandMap
              locations={doc.locations}
              routes={doc.routes}
              families={doc.families}
              itineraryItems={doc.itineraryItems}
              meals={doc.meals}
              activities={doc.activities}
              cursorSlot={effectiveCursorSlot}
              mapUi={doc.ui.map}
              mapWeather={mapWeather}
              mapWeatherTargets={mapWeatherTargets}
              selectedLocationId={getLocationForEntity(doc, getEntityBySelection(doc, selection))?.id || null}
              selectedRouteId={getRouteForEntity(doc, getEntityBySelection(doc, selection))?.id || null}
              playbackActive={isPlaybackPlaying}
              playbackHighlightLocationId={playbackHighlightLocationId}
              onUpdateMapUi={onUpdateMapUi}
              onHydrateRouteDetails={onHydrateRouteDetails}
              onSelectEntity={onSelectEntity}
              onPlaybackFeedItems={handlePlaybackFeedItems}
            />
            <MissionFeedTray
              items={renderedMissionFeedItems}
              onActivateItem={handleMissionFeedActivate}
            />
          </div>
          <div className="min-w-0 shrink-0">
            <TimelineBoard
              doc={doc}
              selection={selection}
              onSelectEntity={onSelectEntity}
              onSetCursor={handleTimelineCursorChange}
              weatherDays={weatherDays}
              cursorSlot={effectiveCursorSlot}
              isPlaying={isPlaybackPlaying}
              playbackSpeed={playbackSpeed}
              onTogglePlayback={handleTogglePlayback}
              onRestartPlayback={handleRestartPlayback}
              onSetPlaybackSpeed={setPlaybackSpeed}
            />
          </div>
        </div>
      </div>
      {briefingOpen ? (
        <DailyBriefingModal
          briefing={dailyBriefing}
          onClose={() => setBriefingOpen(false)}
          onOpenEntity={(type, id) => {
            onOpenEntity(type, id)
            setBriefingOpen(false)
          }}
        />
      ) : null}
      {operationGate ? (
        <MissionLaunchModal
          doc={doc}
          gate={operationGate}
          remainingMs={operationGateRemainingMs}
          onProceed={proceedOperationGate}
          onAbort={abortOperationGate}
        />
      ) : null}
    </>
  )
}

function StayPage({ doc, selection, onSelectEntity, onUpdatePageNote, onConvertPageNote }) {
  const airbnb = getEntityById(doc, 'location', 'pine-airbnb')
  const showExternalListing = Boolean(airbnb?.externalUrl)
  const showManual = Boolean(airbnb?.manualUrl)
  const isSanitizedStay = !showExternalListing && !showManual

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,440px)_1fr] overflow-hidden">
      <div className="overflow-y-auto border-r border-[#30363D] bg-[#161b22] p-6">
        <SectionTitle eyebrow="Basecamp" title={airbnb?.title || 'Basecamp'} meta={TRIP_META.subtitle} />
        <SelectableCard
          selected={selection.type === 'location' && selection.id === airbnb.id}
          onClick={() => onSelectEntity('location', airbnb.id)}
          className="mb-6 p-4"
        >
          <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#8B949E]">Location</div>
          <div className="text-[12px] text-[#C9D1D9]">{airbnb.address}</div>
          {showExternalListing ? (
            <div className="mt-3 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#58A6FF]">
              Open listing <ExternalLink size={12} />
            </div>
          ) : null}
        </SelectableCard>
        <div className="space-y-4">
          {doc.stayItems.map((item) => (
            <SelectableCard
              key={item.id}
              selected={selection.type === item.type && selection.id === item.id}
              onClick={() => onSelectEntity(item.type, item.id)}
              className="p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-[12px] font-black uppercase tracking-widest text-[#C9D1D9]">{item.title}</div>
                <div className="text-[9px] font-black uppercase tracking-wider text-[#58A6FF]">{item.category}</div>
              </div>
              <div className="text-[11px] leading-relaxed text-[#8B949E]">{item.summary}</div>
            </SelectableCard>
          ))}
        </div>
      </div>
      <div className="overflow-y-auto bg-[#0d1117] p-6">
        <SectionTitle eyebrow="Basecamp Intel" title="Arrival, access, and house ops" meta="Visible without drill-in" />
        <div className="mb-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border border-[#30363D] bg-[#161b22] p-4">
            <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">
              Arrival packet
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-[#30363D] bg-[#0d1117] p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">Check-in</div>
                <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">{airbnb.checkIn}</div>
              </div>
              <div className="border border-[#30363D] bg-[#0d1117] p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">Check-out</div>
                <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">{airbnb.checkOut}</div>
              </div>
              {airbnb.wifiNetwork || airbnb.wifiPassword ? (
                <div className="border border-[#30363D] bg-[#0d1117] p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">WiFi</div>
                  <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">{airbnb.wifiNetwork}</div>
                  <div className="mt-1 text-[10px] text-[#8B949E]">{airbnb.wifiPassword}</div>
                </div>
              ) : null}
              {airbnb.lockNote ? (
                <div className="border border-[#30363D] bg-[#0d1117] p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">Access</div>
                  <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">{airbnb.lockNote}</div>
                </div>
              ) : null}
              {airbnb.hostName || airbnb.coHostName || airbnb.guestSummary ? (
                <div className="border border-[#30363D] bg-[#0d1117] p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">Host</div>
                  <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">
                    {airbnb.hostName}
                    {airbnb.coHostName ? ` / ${airbnb.coHostName}` : ''}
                  </div>
                  <div className="mt-1 text-[10px] text-[#8B949E]">{airbnb.guestSummary}</div>
                </div>
              ) : null}
              <div className="border border-[#30363D] bg-[#0d1117] p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-[#8B949E]">
                  {isSanitizedStay ? 'Sanitized demo mode' : 'Gate fee'}
                </div>
                <div className="mt-1 text-[12px] font-bold text-[#C9D1D9]">{airbnb.vehicleFee}</div>
                <div className="mt-1 text-[10px] text-[#8B949E]">
                  {isSanitizedStay ? 'Operational access details are intentionally withheld.' : 'Per vehicle at Pine Mountain Dr entrance'}
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3 border-t border-[#30363D]/50 pt-4 text-[11px] leading-relaxed text-[#8B949E]">
              <div>
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[#58A6FF]">Arrival route</div>
                <div>{airbnb.directionsNote}</div>
              </div>
              <div>
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[#58A6FF]">Gate + access</div>
                <div>{airbnb.accessNote}</div>
              </div>
              <div>
                <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[#58A6FF]">Parking + Friday ops</div>
                <div>{airbnb.parkingNote}</div>
              </div>
              {airbnb.confirmationCode ? (
                <div>
                  <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-[#58A6FF]">Confirmation</div>
                  <div>{airbnb.confirmationCode}</div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border border-[#30363D] bg-[#161b22] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#58A6FF]">
                Links + media
              </div>
              {showExternalListing ? (
                <button
                  type="button"
                  onClick={() => window.open(airbnb.externalUrl, '_blank', 'noreferrer')}
                  className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-[#58A6FF]"
                >
                  Open listing <ExternalLink size={12} />
                </button>
              ) : null}
            </div>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              {(airbnb.photos || []).slice(0, 2).map((media) => (
                <a
                  key={media.id}
                  href={media.sourceUrl || media.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden border border-[#30363D] bg-[#0d1117]"
                >
                  <div
                    className="h-28 w-full bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.03]"
                    style={{ backgroundImage: `url(${media.imageUrl})` }}
                  />
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-[10px] font-bold text-[#C9D1D9]">
                    <span>{media.label}</span>
                    <ExternalLink size={12} className="text-[#58A6FF]" />
                  </div>
                </a>
              ))}
            </div>
            <div className="space-y-2">
              {showManual ? (
                <button
                  type="button"
                  onClick={() => window.open(airbnb.manualUrl, '_blank', 'noreferrer')}
                  className="flex w-full items-center justify-between border border-[#30363D] bg-[#0d1117] px-3 py-3 text-left hover:border-[#58A6FF]/40"
                >
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-[#58A6FF]">House manual</div>
                    <div className="mt-1 text-[11px] text-[#C9D1D9]">Open the full guest handbook and rules</div>
                  </div>
                  <ExternalLink size={13} className="text-[#58A6FF]" />
                </button>
              ) : null}
              <div className="border border-[#30363D] bg-[#0d1117] px-3 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#58A6FF]">Address</div>
                <div className="mt-1 text-[11px] text-[#C9D1D9]">{airbnb.address}</div>
              </div>
            </div>
          </div>
        </div>

        <SectionTitle eyebrow="House Ops" title="Basecamp assignments" meta="Sleep + arrival + reset" />
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          {doc.families.map((family, index) => (
            <SelectableCard
              key={family.id}
              selected={selection.type === 'family' && selection.id === family.id}
              onClick={() => onSelectEntity('family', family.id)}
              className="p-4"
            >
              <div className="mb-2 text-[11px] font-black uppercase tracking-widest text-[#C9D1D9]">
                Room {index + 1}
              </div>
              <div className="text-[12px] font-bold text-[#58A6FF]">{family.title}</div>
              <div className="mt-1 text-[10px] text-[#8B949E]">{family.headcount}</div>
            </SelectableCard>
          ))}
        </div>
        <PageNotesCard
          title="Stay note"
          value={getPageNote(doc, 'stay')}
          onChange={(value) => onUpdatePageNote('stay', value)}
          onConvert={() => onConvertPageNote('stay')}
          placeholder="Record gate instructions, sleeping concerns, quiet hours, or house logistics..."
        />
      </div>
    </div>
  )
}

function MealsPage({ doc, selection, onSelectEntity, onToggleMealStatus, onUpdatePageNote, onConvertPageNote }) {
  const selectedMeal = selection.type === 'meal'
    ? getEntityById(doc, 'meal', selection.id) || doc.meals[0]
    : doc.meals[0]
  const selectedLocation = getLocationForEntity(doc, selectedMeal)
  const selectedTasks = getTasksForEntity(doc, selectedMeal).filter((task) => task.status !== 'done').slice(0, 2)
  const linkedMission = getLinkedEntities(doc, selectedMeal).find(
    (entity) => entity.type === 'activity' || entity.type === 'itineraryItem',
  )
  const media = getMealMedia(selectedLocation).slice(0, 3)
  const travelSummary = selectedLocation?.basecampDrive
    ? `${selectedLocation.basecampDrive.durationText} · ${selectedLocation.basecampDrive.distanceText}`
    : selectedLocation?.id === 'pine-airbnb'
      ? 'No drive required'
      : 'Directions-driven travel estimate will populate after route intel syncs.'
  const hoursPreview = selectedLocation?.openingHours?.slice(0, 3).join(' | ')
  const ratingSummary = selectedLocation?.rating
    ? `${selectedLocation.rating.toFixed(1)} rating${selectedLocation.userRatingsTotal ? ` · ${selectedLocation.userRatingsTotal} reviews` : ''}`
    : 'Place details syncing'

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,0.78fr)_minmax(520px,1.22fr)] overflow-hidden">
      <div className="overflow-y-auto border-r border-[#30363D] bg-[#161b22] p-6">
        <SectionTitle eyebrow="Meal Logistics" title="Shared feeding plan" meta="Ownership + prep + kid friendliness" />
        <div className="space-y-3">
          {doc.meals.map((meal) => (
            <div
              key={meal.id}
              className={cn(
                'grid grid-cols-[1fr_auto] gap-3 border px-4 py-4 transition-colors',
                selection.type === 'meal' && selection.id === meal.id ? 'bg-[#24313d]/50' : '',
                selection.type === 'meal' && selection.id === meal.id
                  ? 'border-[#58A6FF]'
                  : 'border-[#30363D] bg-[#0d1117] hover:border-[#58A6FF]/30 hover:bg-[#1f2a34]/30',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectEntity('meal', meal.id)}
                className="grid min-w-0 grid-cols-[86px_1fr_120px] gap-3 text-left"
              >
                <div>
                  <div className="font-bold text-[#8B949E]">{getDayMeta(meal.dayId)?.shortLabel || meal.dayId}</div>
                  <div className="mt-1 text-[12px] font-black text-[#C9D1D9]">{meal.timeLabel}</div>
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-[#C9D1D9]">{meal.title}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[#D29922]">
                    {getLocationForEntity(doc, meal)?.title || 'Venue pending'}
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-[#8B949E]">{meal.note}</div>
                </div>
                <div className="space-y-2 text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8B949E]">
                    {meal.reservationType}
                  </div>
                  <div className="text-[10px] text-[#C9D1D9]">{meal.owner}</div>
                  <div className="text-[10px] text-[#8B949E]">
                    {formatMealTravelSignal(meal, getLocationForEntity(doc, meal))}
                  </div>
                </div>
              </button>
              <div className="justify-self-end">
                <button
                  type="button"
                  onClick={() => onToggleMealStatus(meal.id)}
                  className="border border-transparent"
                >
                  <StatusPill tone={meal.status}>{meal.status}</StatusPill>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-y-auto bg-[#0d1117] p-6">
        {selectedMeal ? (
          <>
            <div className="border border-[#30363D] bg-[#161b22] p-5">
              <div className="mb-2 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
                    Venue planning surface
                  </div>
                  <h2 className="text-[18px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
                    {selectedMeal.title}
                  </h2>
                  <div className="mt-2 text-[11px] text-[#8B949E]">
                    {getDayMeta(selectedMeal.dayId)?.title} at {selectedMeal.timeLabel} · {selectedMeal.reservationType}
                  </div>
                </div>
                <StatusPill tone={selectedMeal.status}>{selectedMeal.status}</StatusPill>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {selectedLocation?.externalUrl ? (
                  <IntelAction
                    icon={MapPin}
                    label="Open in Google Maps"
                    onClick={() => window.open(selectedLocation.externalUrl, '_blank', 'noreferrer')}
                  />
                ) : null}
                {selectedLocation?.websiteUrl ? (
                  <IntelAction
                    icon={Globe}
                    label="Venue website"
                    onClick={() => window.open(selectedLocation.websiteUrl, '_blank', 'noreferrer')}
                  />
                ) : null}
                {linkedMission ? (
                  <IntelAction
                    icon={Route}
                    label={`Linked to ${linkedMission.title}`}
                    onClick={() => onSelectEntity(linkedMission.type, linkedMission.id)}
                    tone="amber"
                  />
                ) : null}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="border border-[#30363D] bg-[#0d1117] p-4">
                  <SectionTitle eyebrow="Venue Intel" title={selectedLocation?.title || 'Venue pending'} meta={ratingSummary} />
                  <div className="space-y-3">
                    <InfoRow icon={MapPin} label="Location" value={selectedLocation?.address || 'Waiting for place resolution'} />
                    <InfoRow icon={Phone} label="Phone" value={selectedLocation?.phoneNumber} />
                    <InfoRow icon={Star} label="Reservation note" value={selectedLocation?.reservationNote || selectedMeal.note} muted />
                    <InfoRow
                      icon={ExternalLink}
                      label="Hours"
                      value={hoursPreview || 'Opening hours will appear when place details are available.'}
                      muted={!hoursPreview}
                    />
                  </div>
                </div>

                <div className="border border-[#30363D] bg-[#0d1117] p-4">
                  <SectionTitle eyebrow="Movement" title="Drive / prep context" meta={travelSummary} />
                  <div className="space-y-3">
                    <InfoRow
                      icon={Route}
                      label="From basecamp"
                      value={travelSummary}
                      muted={!selectedLocation?.basecampDrive && selectedLocation?.id !== 'pine-airbnb'}
                    />
                    <InfoRow
                      icon={ArrowRight}
                      label="Why this matters"
                      value={getMealContextNarrative(selectedMeal, selectedLocation, linkedMission)}
                      muted
                    />
                    {selectedTasks.length ? (
                      <div className="rounded-[2px] border border-[#30363D] bg-[#161b22] px-3 py-3">
                        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
                          Critical calls
                        </div>
                        <div className="space-y-2">
                          {selectedTasks.map((task) => (
                            <div key={task.id} className="text-[11px] text-[#C9D1D9]">
                              {task.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {media.length ? (
              <div className="mt-5 border border-[#30363D] bg-[#161b22] p-5">
                <SectionTitle eyebrow="Visual Intel" title="Venue references" meta={`${media.length} asset${media.length > 1 ? 's' : ''}`} />
                <div className="grid gap-4 md:grid-cols-3">
                  {media.map((item) => (
                    <a
                      key={item.id}
                      href={item.sourceUrl || selectedLocation?.externalUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden border border-[#30363D] bg-[#0d1117]"
                    >
                      <div className="aspect-[4/3] overflow-hidden">
                        <img
                          src={item.imageUrl}
                          alt={item.label}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="border-t border-[#30363D] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#C9D1D9]">
                        {item.label}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5">
              <PageNotesCard
                title="Feeding note"
                value={getPageNote(doc, 'meals')}
                onChange={(value) => onUpdatePageNote('meals', value)}
                onConvert={() => onConvertPageNote('meals')}
                placeholder="Capture grocery strategy, allergy notes, kid fallback meals, or timing calls for restaurant stops..."
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function ActivitiesPage({ doc, selection, onSelectEntity, onUpdatePageNote, onConvertPageNote, onAddActivity }) {
  const selectedActivity = useMemo(
    () => (selection.type === 'activity' ? doc.activities.find((activity) => activity.id === selection.id) || doc.activities[0] : doc.activities[0]),
    [doc.activities, selection],
  )
  const selectedLocation = useMemo(() => getLocationForEntity(doc, selectedActivity), [doc, selectedActivity])
  const linkedEntities = useMemo(() => getLinkedEntities(doc, selectedActivity), [doc, selectedActivity])
  const linkedTimelineItems = useMemo(
    () => linkedEntities.filter((entity) => entity.type === 'itineraryItem'),
    [linkedEntities],
  )
  const research = selectedActivity ? ACTIVITY_RESEARCH[selectedActivity.id] : null
  const transitFamilies = useMemo(() => {
    if (!selectedActivity || selectedActivity.id !== 'thu-transit') return []

    return linkedTimelineItems
      .filter((item) => item.familyIds?.length === 1)
      .map((item) => {
        const family = getEntityById(doc, 'family', item.familyIds[0])
        const route = getRouteForEntity(doc, item)
        const stops = (route?.stopLocationIds || [])
          .map((stopId) => getEntityById(doc, 'location', stopId))
          .filter(Boolean)

        return family && route
          ? {
              family,
              route,
              itineraryItem: item,
              stops,
            }
          : null
      })
      .filter(Boolean)
  }, [doc, linkedTimelineItems, selectedActivity])
  const [selectedTransitFamilyId, setSelectedTransitFamilyId] = useState(null)
  useEffect(() => {
    if (!transitFamilies.length) {
      setSelectedTransitFamilyId(null)
      return
    }

    if (!transitFamilies.some((entry) => entry.family.id === selectedTransitFamilyId)) {
      setSelectedTransitFamilyId(transitFamilies[0].family.id)
    }
  }, [selectedTransitFamilyId, transitFamilies])
  const selectedTransitPlan = useMemo(
    () => transitFamilies.find((entry) => entry.family.id === selectedTransitFamilyId) || transitFamilies[0] || null,
    [selectedTransitFamilyId, transitFamilies],
  )
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDayId, setDraftDayId] = useState('fri')
  const [draftWindow, setDraftWindow] = useState('Fri / flexible')
  const [draftDescription, setDraftDescription] = useState('')

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_minmax(560px,1fr)] overflow-hidden">
      <div className="overflow-y-auto border-r border-[#30363D] bg-[#161b22] p-6">
        <SectionTitle eyebrow="Activity Board" title="Day missions" meta={`${doc.activities.length} tracked`} />
        <div className="space-y-4">
          {doc.activities.map((activity) => (
            <SelectableCard
              key={activity.id}
              selected={selection.type === 'activity' && selection.id === activity.id}
              onClick={() => onSelectEntity('activity', activity.id)}
              className="p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-black uppercase tracking-widest text-[#C9D1D9]">{activity.title}</h3>
                <StatusPill tone={activity.status}>{activity.status}</StatusPill>
              </div>
              <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#58A6FF]">
                {activity.window}
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-[#C9D1D9]">{activity.description}</p>
              <div className="border-t border-[#30363D]/50 pt-3 text-[10px] leading-relaxed text-[#8B949E]">
                <span className="font-black uppercase tracking-widest text-[#D29922]">Fallback:</span> {activity.backup}
              </div>
            </SelectableCard>
          ))}
        </div>
        <div className="mt-5 border border-[#30363D] bg-[#0d1117] p-4">
          <SectionTitle eyebrow="Planner" title="Add activity" />
          <div className="space-y-3">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Activity title"
              className="w-full border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
            />
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <select
                value={draftDayId}
                onChange={(event) => setDraftDayId(event.target.value)}
                className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
              >
                {DAYS.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.shortLabel.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                value={draftWindow}
                onChange={(event) => setDraftWindow(event.target.value)}
                placeholder="Window label"
                className="w-full border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
              />
            </div>
            <NotesBox
              value={draftDescription}
              onChange={setDraftDescription}
              placeholder="Short description or planning purpose..."
            />
            <button
              type="button"
              onClick={() => {
                if (!draftTitle.trim()) return
                onAddActivity({
                  title: draftTitle.trim(),
                  dayId: draftDayId,
                  window: draftWindow.trim(),
                  description: draftDescription.trim(),
                })
                setDraftTitle('')
                setDraftDescription('')
              }}
              className="w-full border border-[#30363D] bg-[#161b22] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#C9D1D9] transition-colors hover:border-[#58A6FF]/40 hover:text-[#58A6FF]"
            >
              Add activity
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-y-auto bg-[#0d1117] p-6">
        {selectedActivity ? (
          <>
            <div className="border border-[#30363D] bg-[#161b22] p-5">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#58A6FF]">
                    Mission planning surface
                  </div>
                  <h2 className="text-[18px] font-black uppercase tracking-[0.12em] text-[#C9D1D9]">
                    {selectedActivity.title}
                  </h2>
                  <div className="mt-2 text-[11px] text-[#8B949E]">
                    {getDayMeta(selectedActivity.dayId)?.title || selectedActivity.dayId} · {selectedActivity.window}
                  </div>
                </div>
                <StatusPill tone={selectedActivity.status}>{selectedActivity.status}</StatusPill>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {selectedLocation?.externalUrl ? (
                  <IntelAction
                    icon={MapPin}
                    label="Open location"
                    onClick={() => window.open(selectedLocation.externalUrl, '_blank', 'noreferrer')}
                  />
                ) : null}
                {selectedLocation ? (
                  <IntelAction
                    icon={Route}
                    label={`Inspect ${selectedLocation.title}`}
                    onClick={() => onSelectEntity('location', selectedLocation.id)}
                    tone="amber"
                  />
                ) : null}
              </div>

              <div className="border border-[#30363D] bg-[#0d1117] p-4">
                <SectionTitle eyebrow="Mission Frame" title="Why this day matters" />
                <div className="space-y-3">
                  <InfoRow icon={ArrowRight} label="Core plan" value={selectedActivity.description} />
                  <InfoRow icon={MapPin} label="Anchor location" value={selectedLocation?.title || 'No anchor location set'} />
                  <InfoRow icon={Search} label="Research read" value={research?.headline || selectedActivity.note || 'Build the mission details for this day.'} muted />
                  <InfoRow icon={Settings} label="Fallback" value={selectedActivity.backup} muted />
                </div>
              </div>
            </div>

            {selectedActivity.id === 'thu-transit' && selectedTransitPlan ? (
              <div className="mt-5 border border-[#30363D] bg-[#161b22] p-5">
                <SectionTitle eyebrow="Transit Planning" title="Family road trips" meta={`${transitFamilies.length} active routes`} />
                <div className="mb-4 flex flex-wrap gap-2">
                  {transitFamilies.map((entry) => (
                    <button
                      key={entry.family.id}
                      type="button"
                      onClick={() => {
                        setSelectedTransitFamilyId(entry.family.id)
                        onSelectEntity('family', entry.family.id)
                      }}
                      className={cn(
                        'border px-3 py-2 text-[10px] font-black uppercase tracking-wider',
                        selectedTransitPlan.family.id === entry.family.id
                          ? 'border-[#58A6FF] bg-[#58A6FF]/10 text-[#58A6FF]'
                          : 'border-[#30363D] bg-[#0d1117] text-[#C9D1D9]',
                      )}
                    >
                      {entry.family.title}
                    </button>
                  ))}
                </div>
                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="border border-[#30363D] bg-[#0d1117] p-4">
                    <SectionTitle eyebrow="Selected Family" title={selectedTransitPlan.family.title} meta={selectedTransitPlan.family.eta} />
                    <div className="space-y-3">
                      <InfoRow icon={MapPin} label="Origin" value={selectedTransitPlan.family.origin} />
                      <InfoRow icon={Route} label="Route read" value={selectedTransitPlan.family.routeSummary} muted />
                      <InfoRow icon={Users} label="Vehicle / group" value={`${selectedTransitPlan.family.vehicle} · ${selectedTransitPlan.family.headcount}`} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <IntelAction
                        icon={Users}
                        label="Inspect family"
                        onClick={() => onSelectEntity('family', selectedTransitPlan.family.id)}
                      />
                      <IntelAction
                        icon={Route}
                        label="Inspect route"
                        onClick={() => onSelectEntity('route', selectedTransitPlan.route.id)}
                        tone="amber"
                      />
                    </div>
                  </div>
                  <div className="border border-[#30363D] bg-[#0d1117] p-4">
                    <SectionTitle eyebrow="Road-trip Stops" title="Good break points" meta={`${selectedTransitPlan.stops.length} planned`} />
                    {selectedTransitPlan.stops.length ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {selectedTransitPlan.stops.map((stop) => (
                          <TransitStopCard key={stop.id} stop={stop} onSelectEntity={onSelectEntity} />
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#8B949E]">No stop plan attached to this route yet.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : research?.cards?.length ? (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {research.cards.map((card) => (
                  <ActivityResearchCard
                    key={`${selectedActivity.id}-${card.title}`}
                    eyebrow={card.eyebrow}
                    title={card.title}
                    bullets={card.bullets}
                  />
                ))}
              </div>
            ) : null}

            <div className="mt-5">
              <PageNotesCard
                title="Activities note"
                value={getPageNote(doc, 'activities')}
                onChange={(value) => onUpdatePageNote('activities', value)}
                onConvert={() => onConvertPageNote('activities')}
                placeholder="Capture alternate plans, micro-itineraries, weather triggers, or new activity ideas..."
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function ExpensesPage({
  doc,
  selection,
  currentFamily,
  onSelectEntity,
  onAddExpense,
  onToggleExpenseSettled,
  onUpdateExpenseFields,
  onSetExpenseAllocationMode,
  onUpdateExpenseAllocation,
  onResetExpenseAllocationsToEqual,
  onUpdatePageNote,
  onConvertPageNote,
}) {
  const activeExpenseId =
    selection.type === 'expense' && doc.expenses.some((expense) => expense.id === selection.id)
      ? selection.id
      : doc.expenses[0]?.id
  const activeExpense = doc.expenses.find((expense) => expense.id === activeExpenseId) || null
  const [amountDraft, setAmountDraft] = useState('')
  const [manualAllocationDrafts, setManualAllocationDrafts] = useState({})
  const [customPayerDraft, setCustomPayerDraft] = useState('')
  const total = useMemo(() => doc.expenses.reduce((sum, expense) => sum + expense.amount, 0), [doc.expenses])
  const outstanding = useMemo(
    () => doc.expenses.filter((expense) => !expense.settled).reduce((sum, expense) => sum + expense.amount, 0),
    [doc.expenses],
  )
  const familyBurden = useMemo(() => getFamilyExpenseBurden(doc.expenses, doc.families), [doc.expenses, doc.families])
  const activeAllocations = useMemo(
    () => (activeExpense ? getExpenseAllocations(activeExpense, doc.families) : []),
    [activeExpense, doc.families],
  )
  const manualAllocatedTotal = useMemo(
    () => activeAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
    [activeAllocations],
  )
  const allocationDelta = activeExpense?.allocationMode === 'manual'
    ? Number((activeExpense.amount || 0) - manualAllocatedTotal)
    : 0
  const payerOptions = useMemo(
    () => [
      ...doc.families.map((family) => family.title),
      'Each family',
      'Unassigned',
    ],
    [doc.families],
  )
  const payerMode = activeExpense && payerOptions.includes(activeExpense.payer) ? activeExpense.payer : '__custom__'

  useEffect(() => {
    if (!activeExpense) return

    setAmountDraft(activeExpense.amount === 0 ? '' : String(activeExpense.amount))
    setCustomPayerDraft(payerMode === '__custom__' ? activeExpense.payer || '' : '')
  }, [activeExpense, payerMode])

  useEffect(() => {
    if (!activeExpense || activeExpense.allocationMode !== 'manual') {
      setManualAllocationDrafts({})
      return
    }

    setManualAllocationDrafts(
      Object.fromEntries(
        getExpenseAllocations(activeExpense, doc.families).map((allocation) => [
          allocation.familyId,
          allocation.amount === 0 ? '' : String(allocation.amount),
        ]),
      ),
    )
  }, [activeExpense, doc.families])

  const commitAmountDraft = useCallback(() => {
    if (!activeExpense) return
    const parsed = parseCurrencyInput(amountDraft)
    onUpdateExpenseFields(activeExpense.id, { amount: parsed })
    setAmountDraft(parsed === 0 ? '' : String(parsed))
  }, [activeExpense, amountDraft, onUpdateExpenseFields])

  const commitManualAllocationDraft = useCallback((familyId) => {
    if (!activeExpense) return
    const parsed = parseCurrencyInput(manualAllocationDrafts[familyId] || '')
    onUpdateExpenseAllocation(activeExpense.id, familyId, parsed)
    setManualAllocationDrafts((current) => ({
      ...current,
      [familyId]: parsed === 0 ? '' : String(parsed),
    }))
  }, [activeExpense, manualAllocationDrafts, onUpdateExpenseAllocation])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,0.95fr)_minmax(440px,1.05fr)] overflow-hidden">
      <div className="overflow-y-auto border-r border-[#30363D] bg-[#161b22] p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <SectionTitle eyebrow="Shared Costs" title="Expense ledger" meta="Editable + split-aware" />
          <button
            type="button"
            onClick={onAddExpense}
            className="border border-[#58A6FF]/40 bg-[#58A6FF]/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#C9D1D9]"
          >
            Add expense
          </button>
        </div>
        {currentFamily ? (
          <div className="mb-4 border border-[#30363D] bg-[#0d1117] px-3 py-2 text-[11px] text-[#8B949E]">
            Adding and editing as <span className="font-bold text-[#C9D1D9]">{currentFamily.title}</span>.
          </div>
        ) : null}
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="border border-[#30363D] bg-[#0d1117] p-4">
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#8B949E]">Total tracked</div>
            <div className="text-[20px] font-black text-[#C9D1D9]">{formatCurrency(total)}</div>
          </div>
          <div className="border border-[#30363D] bg-[#0d1117] p-4">
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-[#8B949E]">Outstanding</div>
            <div className="text-[20px] font-black text-[#D29922]">{formatCurrency(outstanding)}</div>
          </div>
        </div>

        <div className="border border-[#30363D] bg-[#0d1117]">
          {doc.expenses.map((expense) => (
            <div
              key={expense.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectEntity('expense', expense.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectEntity('expense', expense.id)
                }
              }}
              className={cn(
                'grid cursor-pointer grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_100px_92px] items-center gap-3 border-b border-[#30363D]/40 px-4 py-3 last:border-b-0',
                activeExpenseId === expense.id ? 'bg-[#24313d]/50' : 'hover:bg-[#1f2a34]/40',
              )}
            >
              <div className="min-w-0 text-left">
                <div className="font-bold text-[#C9D1D9]">{expense.title}</div>
                <div className="text-[10px] text-[#8B949E]">
                  {expense.payer} · {expense.split}
                </div>
                {(expense.createdByFamilyId || expense.lastEditedByFamilyId) ? (
                  <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-[#58A6FF]">
                    {expense.createdByFamilyId ? `Created by ${getFamilyLabel(doc.families, expense.createdByFamilyId)}` : ''}
                    {expense.createdByFamilyId && expense.lastEditedByFamilyId ? ' · ' : ''}
                    {expense.lastEditedByFamilyId ? `Edited by ${getFamilyLabel(doc.families, expense.lastEditedByFamilyId)}` : ''}
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 text-[11px] text-[#C9D1D9]">
                {expense.allocationMode === 'individual'
                  ? 'Not shared'
                  : `${doc.families.length} families`}
              </div>
              <div className="font-mono text-[12px] text-[#C9D1D9]">{formatCurrency(expense.amount)}</div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleExpenseSettled(expense.id)
                }}
                className="justify-self-end"
              >
                <StatusPill tone={expense.settled ? 'Settled' : 'Open'}>
                  {expense.settled ? 'Settled' : 'Open'}
                </StatusPill>
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-y-auto bg-[#0d1117] p-6">
        {activeExpense ? (
          <>
            <SectionTitle
              eyebrow="Selected Expense"
              title={activeExpense.title}
              meta={activeExpense.settled ? 'Settled' : 'Open'}
            />
            {(activeExpense.createdByFamilyId || activeExpense.lastEditedByFamilyId) ? (
              <div className="mb-4 border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#8B949E]">
                {activeExpense.createdByFamilyId ? (
                  <span>Created by <span className="font-bold text-[#C9D1D9]">{getFamilyLabel(doc.families, activeExpense.createdByFamilyId)}</span></span>
                ) : null}
                {activeExpense.createdByFamilyId && activeExpense.lastEditedByFamilyId ? ' · ' : null}
                {activeExpense.lastEditedByFamilyId ? (
                  <span>Last edited by <span className="font-bold text-[#C9D1D9]">{getFamilyLabel(doc.families, activeExpense.lastEditedByFamilyId)}</span></span>
                ) : null}
              </div>
            ) : null}

            <div className="mb-6 grid gap-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Expense title</span>
                  <input
                    value={activeExpense.title || ''}
                    onChange={(event) => onUpdateExpenseFields(activeExpense.id, { title: event.target.value })}
                    className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Payer</span>
                  <div className="grid gap-2">
                    <select
                      value={payerMode}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === '__custom__') {
                          onUpdateExpenseFields(activeExpense.id, { payer: customPayerDraft || activeExpense.payer || '' })
                          return
                        }
                        onUpdateExpenseFields(activeExpense.id, { payer: value })
                      }}
                      className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                    >
                      {payerOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                    {payerMode === '__custom__' ? (
                      <input
                        value={customPayerDraft}
                        onChange={(event) => setCustomPayerDraft(event.target.value)}
                        onBlur={() => onUpdateExpenseFields(activeExpense.id, { payer: customPayerDraft.trim() || 'Unassigned' })}
                        placeholder="Custom payer label"
                        className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                      />
                    ) : null}
                  </div>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Amount</span>
                  <input
                    inputMode="decimal"
                    value={amountDraft}
                    onChange={(event) => setAmountDraft(event.target.value)}
                    onBlur={commitAmountDraft}
                    onFocus={(event) => event.target.select()}
                    placeholder="0"
                    className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                  />
                </label>
                <div className="grid gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Settlement</span>
                  <button
                    type="button"
                    onClick={() => onToggleExpenseSettled(activeExpense.id)}
                    className={cn(
                      'border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-left',
                      activeExpense.settled
                        ? 'border-[#3FB950]/30 bg-[#3FB950]/10 text-[#3FB950]'
                        : 'border-[#D29922]/30 bg-[#D29922]/10 text-[#D29922]',
                    )}
                  >
                    {activeExpense.settled ? 'Settled' : 'Open'}
                  </button>
                </div>
              </div>

              <div className="border border-[#30363D] bg-[#161b22] p-4">
                <SectionTitle eyebrow="Split Mode" title="Family allocation" meta={EXPENSE_SPLIT_LABELS[activeExpense.allocationMode] || activeExpense.split} />
                <div className="mb-4 flex flex-wrap gap-2">
                  {[
                    { id: 'equal', label: 'Equal split' },
                    { id: 'manual', label: 'Manual allocation' },
                    { id: 'individual', label: 'Individual' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onSetExpenseAllocationMode(activeExpense.id, mode.id)}
                      className={cn(
                        'border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em]',
                        activeExpense.allocationMode === mode.id
                          ? 'border-[#58A6FF]/50 bg-[#58A6FF]/12 text-[#C9D1D9]'
                          : 'border-[#30363D] bg-[#0d1117] text-[#8B949E]',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {activeExpense.allocationMode === 'individual' ? (
                  <div className="text-[11px] leading-relaxed text-[#8B949E]">
                    This cost is marked as family-specific, so it does not contribute to shared reimbursement totals.
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {activeAllocations.map((allocation) => (
                      <div
                        key={allocation.familyId}
                        className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-3 border border-[#30363D]/60 bg-[#0d1117] px-3 py-3"
                      >
                        <div>
                          <div className="text-[11px] font-bold text-[#C9D1D9]">{allocation.title}</div>
                          <div className="text-[10px] text-[#8B949E]">
                            {activeExpense.allocationMode === 'equal' ? 'Auto-calculated share' : 'Assigned share'}
                          </div>
                        </div>
                        {activeExpense.allocationMode === 'manual' ? (
                          <input
                            inputMode="decimal"
                            value={manualAllocationDrafts[allocation.familyId] ?? ''}
                            onChange={(event) =>
                              setManualAllocationDrafts((current) => ({
                                ...current,
                                [allocation.familyId]: event.target.value,
                              }))
                            }
                            onBlur={() => commitManualAllocationDraft(allocation.familyId)}
                            onFocus={(event) => event.target.select()}
                            placeholder="0"
                            className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                          />
                        ) : (
                          <div className="text-right text-[12px] font-black text-[#C9D1D9]">{formatCurrency(allocation.amount)}</div>
                        )}
                      </div>
                    ))}

                    {activeExpense.allocationMode === 'manual' ? (
                      <>
                        <div className="mt-2 flex items-center justify-between border border-[#30363D]/60 bg-[#0d1117] px-3 py-3">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#8B949E]">Manual total</div>
                            <div className="text-[12px] font-bold text-[#C9D1D9]">
                              {formatCurrency(manualAllocatedTotal)} / {formatCurrency(activeExpense.amount)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onResetExpenseAllocationsToEqual(activeExpense.id)}
                            className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#C9D1D9]"
                          >
                            Reset to equal
                          </button>
                        </div>
                        {Math.abs(allocationDelta) > 0.009 ? (
                          <div className="border border-[#D29922]/30 bg-[#D29922]/10 px-3 py-2 text-[11px] text-[#D29922]">
                            {allocationDelta > 0
                              ? `${formatCurrency(allocationDelta)} still unassigned.`
                              : `${formatCurrency(Math.abs(allocationDelta))} over-assigned. Adjust the family shares.`}
                          </div>
                        ) : (
                          <div className="border border-[#3FB950]/30 bg-[#3FB950]/10 px-3 py-2 text-[11px] text-[#3FB950]">
                            Manual allocation matches the total exactly.
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>

              <label className="grid gap-1.5">
                <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#8B949E]">Expense note</span>
                <textarea
                  value={activeExpense.note || ''}
                  onChange={(event) => onUpdateExpenseFields(activeExpense.id, { note: event.target.value })}
                  rows={4}
                  className="border border-[#30363D] bg-[#161b22] px-3 py-2 text-[11px] leading-relaxed text-[#C9D1D9] outline-none focus:border-[#58A6FF]"
                />
              </label>
            </div>
          </>
        ) : null}

        <div className="mb-6 border border-[#30363D] bg-[#161b22] p-4">
          <SectionTitle eyebrow="Shared Burden" title="Per-family exposure" />
          <div className="grid gap-2">
            {familyBurden.map((entry) => (
              <div
                key={entry.familyId}
                className="flex items-center justify-between border border-[#30363D]/60 bg-[#0d1117] px-3 py-2"
              >
                <div className="text-[11px] font-bold text-[#C9D1D9]">{entry.title}</div>
                <div className="text-[12px] font-black text-[#C9D1D9]">{formatCurrency(entry.amount)}</div>
              </div>
            ))}
          </div>
        </div>

        <PageNotesCard
          title="Expenses note"
          value={getPageNote(doc, 'expenses')}
          onChange={(value) => onUpdatePageNote('expenses', value)}
          onConvert={() => onConvertPageNote('expenses')}
          placeholder="Capture split assumptions, cash items, or things to settle after the trip..."
        />
      </div>
    </div>
  )
}

function FamiliesPage({ doc, selection, onSelectEntity, onUpdatePageNote, onConvertPageNote }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] overflow-hidden">
      <div className="overflow-y-auto border-r border-[#30363D] bg-[#161b22] p-6">
        <SectionTitle eyebrow="Travel Units" title="Family roster" />
        <FamilyList doc={doc} selection={selection} onSelectEntity={onSelectEntity} />
        <div className="mt-5">
          <PageNotesCard
            title="Families note"
            value={getPageNote(doc, 'families')}
            onChange={(value) => onUpdatePageNote('families', value)}
            onConvert={() => onConvertPageNote('families')}
            placeholder="Capture cross-family coordination details..."
          />
        </div>
      </div>

      <div className="overflow-y-auto bg-[#0d1117] p-6">
        <SectionTitle eyebrow="Readiness" title="Family task posture" />
        <div className="grid gap-4">
          {doc.families.map((family) => {
            const tasks = getTasksByFamily(doc, family.id)
            const readiness = getFamilyReadiness(doc, family.id)
            return (
              <SelectableCard
                key={family.id}
                selected={selection.type === 'family' && selection.id === family.id}
                onClick={() => onSelectEntity('family', family.id)}
                className="p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-[12px] font-black uppercase tracking-widest text-[#C9D1D9]">{family.title}</div>
                    <div className="text-[10px] text-[#8B949E]">{family.origin}</div>
                  </div>
                  <StatusPill tone={family.status}>{family.status}</StatusPill>
                </div>
                <div className="mb-3 h-1.5 overflow-hidden rounded-full border border-[#30363D]/30 bg-[#0d1117]">
                  <div
                    className="h-full bg-[#58A6FF] shadow-[0_0_8px_rgba(88,166,255,0.4)]"
                    style={{ width: `${readiness}%` }}
                  />
                </div>
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between text-[11px]">
                      <span className="text-[#C9D1D9]">{task.title}</span>
                      <span className={task.status === 'done' ? 'text-[#3FB950]' : 'text-[#D29922]'}>
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              </SelectableCard>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function withRefreshedFamilies(nextDoc) {
  return {
    ...nextDoc,
    families: nextDoc.families.map((family) => ({
      ...family,
      readiness: getFamilyReadiness(nextDoc, family.id),
    })),
  }
}

function App() {
  const [doc, setDoc] = usePersistedTripState(TRIP_DOCUMENT_STORAGE_KEY, getInitialTripDocument())
  const [viewerProfile, setViewerProfile] = usePersistedTripState(VIEWER_PROFILE_STORAGE_KEY, { familyId: null })
  const visibilityMode = PUBLISH_CONFIG.visibilityMode
  const liveExternalData = isLiveExternalDataEnabled()
  const displayDoc = useMemo(() => projectTripDocument(doc, visibilityMode), [doc, visibilityMode])
  const startupTimelineSyncRef = useRef(false)
  const seededPlanRefreshRef = useRef(false)
  const [weatherState, setWeatherState] = useState({
    status: 'loading',
    targets: {},
    updatedAt: null,
    error: null,
  })
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const selection = displayDoc.selection
  const currentFamily = displayDoc.families.find((family) => family.id === viewerProfile?.familyId) || null
  const currentFamilyId = currentFamily?.id || null
  const selectedEntity = getEntityBySelection(displayDoc, selection)
  const selectedLocation = getLocationForEntity(displayDoc, selectedEntity)
  const selectedRoute = getRouteForEntity(displayDoc, selectedEntity)

  useEffect(() => {
    clearLegacyTripStorage()
  }, [])

  const setActiveFamilyProfile = useCallback((familyId) => {
    setViewerProfile({ familyId })
  }, [setViewerProfile])

  useEffect(() => {
    if (startupTimelineSyncRef.current) return
    startupTimelineSyncRef.current = true

    const nowCursor = getCurrentTripCursor()
    setDoc((current) => ({
      ...current,
      ui: {
        ...current.ui,
        timeline: {
          ...current.ui.timeline,
          cursorSlot: nowCursor,
        },
        map: {
          ...current.ui.map,
          focusFamilyId: 'all',
          focusDayId: 'all',
        },
      },
    }))
  }, [setDoc])

  useEffect(() => {
    const jiangRoute = doc.routes.find((route) => route.id === 'route-la-north-star')
    const jiangFamily = doc.families.find((family) => family.id === 'north-star')
    const yosemiteLocation = doc.locations.find((location) => location.id === 'yosemite')
    const missingStopLocations = JIANG_ROAD_TRIP_STOP_DEFAULTS.filter(
      (stop) => !doc.locations.some((location) => location.id === stop.id),
    )

    const needsRouteStops = jiangRoute && !jiangRoute.stopLocationIds?.length
    const needsFamilyStops = jiangFamily && !jiangFamily.plannedStopIds?.length
    const needsVehicleFamilyBackfill = doc.families.some((family) => {
      const defaults = FAMILY_VEHICLE_DEFAULTS[family.id]
      if (!defaults) return false
      return (
        !family.originAddress ||
        !family.originCoordinates ||
        !family.vehicleLabel ||
        (defaults.plannedStopIds?.length && !family.plannedStopIds?.length)
      )
    })
    const needsVehicleRouteBackfill = doc.routes.some((route) => {
      const defaults = ROUTE_SIM_DEFAULTS[route.id]
      if (!defaults) return false
      return (
        ('simulationStartSlot' in defaults && route.simulationStartSlot == null) ||
        ('simulationEndSlot' in defaults && route.simulationEndSlot == null) ||
        ('durationSeconds' in defaults && route.durationSeconds == null) ||
        ('originCoordinates' in defaults && !route.originCoordinates) ||
        ('destinationLocationId' in defaults && !route.destinationLocationId) ||
        ('stopLocationIds' in defaults && !Array.isArray(route.stopLocationIds))
      )
    })
    const needsYosemiteBackfill =
      yosemiteLocation &&
      (
        yosemiteLocation.title !== YOSEMITE_ROUTE_DEFAULTS.title ||
        yosemiteLocation.placesQuery !== YOSEMITE_ROUTE_DEFAULTS.placesQuery ||
        yosemiteLocation.coordinates?.lat !== YOSEMITE_ROUTE_DEFAULTS.coordinates.lat ||
        yosemiteLocation.coordinates?.lng !== YOSEMITE_ROUTE_DEFAULTS.coordinates.lng
      )

    if (
      !needsRouteStops &&
      !needsFamilyStops &&
      !missingStopLocations.length &&
      !needsVehicleFamilyBackfill &&
      !needsVehicleRouteBackfill &&
      !needsYosemiteBackfill
    ) {
      return
    }

    setDoc((current) => {
      const nextLocations = [
        ...current.locations,
        ...JIANG_ROAD_TRIP_STOP_DEFAULTS.filter(
          (stop) => !current.locations.some((location) => location.id === stop.id),
        ),
      ].map((location) =>
        location.id === 'yosemite'
          ? {
              ...location,
              ...YOSEMITE_ROUTE_DEFAULTS,
            }
          : location,
      )
      const nextFamilies = current.families.map((family) => {
        const defaults = FAMILY_VEHICLE_DEFAULTS[family.id]
        if (!defaults && family.id !== 'north-star') return family

        return {
          ...family,
          originAddress: family.originAddress || defaults?.originAddress,
          originCoordinates: family.originCoordinates || defaults?.originCoordinates,
          vehicleLabel: family.vehicleLabel || defaults?.vehicleLabel,
          plannedStopIds: family.plannedStopIds?.length ? family.plannedStopIds : defaults?.plannedStopIds || family.plannedStopIds,
          routeSummary: family.routeSummary || defaults?.routeSummary || family.routeSummary,
        }
      })

      const nextRoutes = synchronizeRoutePaths(
        current.routes.map((route) => {
          const defaults = ROUTE_SIM_DEFAULTS[route.id]
          if (!defaults) return route

          return {
            ...route,
            originCoordinates: route.originCoordinates || defaults.originCoordinates || route.path?.[0],
            path:
              route.path?.length > 1 && defaults.originCoordinates
                ? [route.originCoordinates || defaults.originCoordinates, ...route.path.slice(1)]
                : route.path,
            stopLocationIds:
              Array.isArray(route.stopLocationIds)
                ? route.stopLocationIds
                : defaults.stopLocationIds ?? route.stopLocationIds,
            destinationLocationId: route.destinationLocationId || defaults.destinationLocationId || route.destinationLocationId,
            simulationStartSlot:
              'simulationStartSlot' in defaults
                ? route.simulationStartSlot ?? defaults.simulationStartSlot
                : route.simulationStartSlot,
            simulationEndSlot:
              'simulationEndSlot' in defaults
                ? route.simulationEndSlot ?? defaults.simulationEndSlot
                : route.simulationEndSlot,
            durationSeconds:
              'durationSeconds' in defaults
                ? route.durationSeconds ?? defaults.durationSeconds
                : route.durationSeconds,
            simulationMilestones:
              'simulationMilestones' in defaults
                ? route.simulationMilestones?.length ? route.simulationMilestones : defaults.simulationMilestones
                : route.simulationMilestones,
          }
        }),
        nextLocations,
      )

      return {
        ...current,
        locations: nextLocations,
        families: nextFamilies,
        routes: nextRoutes,
      }
    })
  }, [doc.families, doc.locations, doc.routes, setDoc])

  useEffect(() => {
    if (seededPlanRefreshRef.current) return

    const initialDoc = getInitialTripDocument()
    const currentById = (collection) => new Map(collection.map((item) => [item.id, item]))
    const collectionNeedsRefresh = (currentCollection, initialCollection, refreshIds) => {
      const currentMap = currentById(currentCollection)
      const initialMap = currentById(initialCollection)
      return [...refreshIds].some((id) => {
        const currentItem = currentMap.get(id)
        const initialItem = initialMap.get(id)
        return !currentItem || !initialItem || JSON.stringify(currentItem) !== JSON.stringify(initialItem)
      })
    }
    const missingRoutes = initialDoc.routes.filter((route) => !doc.routes.some((currentRoute) => currentRoute.id === route.id))
    const missingItineraryItems = initialDoc.itineraryItems.filter(
      (item) => !doc.itineraryItems.some((currentItem) => currentItem.id === item.id),
    )
    const hasObsoleteRoutes = doc.routes.some((route) => OBSOLETE_PLAN_ROUTE_IDS.has(route.id))
    const hasObsoleteItineraryItems = doc.itineraryItems.some((item) => OBSOLETE_PLAN_ITINERARY_IDS.has(item.id))
    const needsPlanRefresh =
      collectionNeedsRefresh(doc.families, initialDoc.families, SEEDED_PLAN_REFRESH_IDS.families) ||
      collectionNeedsRefresh(doc.locations, initialDoc.locations, SEEDED_PLAN_REFRESH_IDS.locations) ||
      collectionNeedsRefresh(doc.meals, initialDoc.meals, SEEDED_PLAN_REFRESH_IDS.meals) ||
      collectionNeedsRefresh(doc.activities, initialDoc.activities, SEEDED_PLAN_REFRESH_IDS.activities) ||
      collectionNeedsRefresh(doc.tasks, initialDoc.tasks, SEEDED_PLAN_REFRESH_IDS.tasks) ||
      collectionNeedsRefresh(doc.routes, initialDoc.routes, SEEDED_PLAN_REFRESH_IDS.routes) ||
      collectionNeedsRefresh(doc.itineraryItems, initialDoc.itineraryItems, SEEDED_PLAN_REFRESH_IDS.itineraryItems)

    if (!missingRoutes.length && !missingItineraryItems.length && !hasObsoleteRoutes && !hasObsoleteItineraryItems && !needsPlanRefresh) {
      seededPlanRefreshRef.current = true
      return
    }

    seededPlanRefreshRef.current = true
    setDoc((current) => {
      const syncCollection = (currentCollection, initialCollection, refreshIds, obsoleteIds = new Set()) => {
        const initialMap = new Map(initialCollection.map((item) => [item.id, item]))
        const filtered = currentCollection.filter((item) => !obsoleteIds.has(item.id))
        const existingIds = new Set(filtered.map((item) => item.id))
        const replaced = filtered.map((item) => (refreshIds.has(item.id) && initialMap.has(item.id) ? initialMap.get(item.id) : item))
        const additions = [...refreshIds]
          .filter((id) => !existingIds.has(id) && initialMap.has(id))
          .map((id) => initialMap.get(id))
        return [...replaced, ...additions]
      }

      const nextLocations = syncCollection(
        current.locations,
        initialDoc.locations,
        SEEDED_PLAN_REFRESH_IDS.locations,
      )
      const nextRoutes = synchronizeRoutePaths(
        syncCollection(
          [
            ...current.routes,
            ...initialDoc.routes.filter((route) => !current.routes.some((currentRoute) => currentRoute.id === route.id)),
          ],
          initialDoc.routes,
          SEEDED_PLAN_REFRESH_IDS.routes,
          OBSOLETE_PLAN_ROUTE_IDS,
        ),
        nextLocations,
      )
      const nextItineraryItems = syncCollection(
        [
          ...current.itineraryItems,
          ...initialDoc.itineraryItems.filter((item) => !current.itineraryItems.some((currentItem) => currentItem.id === item.id)),
        ],
        initialDoc.itineraryItems,
        SEEDED_PLAN_REFRESH_IDS.itineraryItems,
        OBSOLETE_PLAN_ITINERARY_IDS,
      )
      const nextSelection =
        (current.selection?.type === 'route' && OBSOLETE_PLAN_ROUTE_IDS.has(current.selection.id)) ||
        (current.selection?.type === 'itineraryItem' && OBSOLETE_PLAN_ITINERARY_IDS.has(current.selection.id))
          ? initialDoc.selection
          : current.selection

      return {
        ...current,
        selection: nextSelection,
        pageNotes: {
          ...current.pageNotes,
          meals: initialDoc.pageNotes.meals,
          activities: initialDoc.pageNotes.activities,
        },
        families: syncCollection(current.families, initialDoc.families, SEEDED_PLAN_REFRESH_IDS.families),
        locations: nextLocations,
        meals: syncCollection(current.meals, initialDoc.meals, SEEDED_PLAN_REFRESH_IDS.meals),
        activities: syncCollection(current.activities, initialDoc.activities, SEEDED_PLAN_REFRESH_IDS.activities),
        tasks: syncCollection(current.tasks, initialDoc.tasks, SEEDED_PLAN_REFRESH_IDS.tasks),
        routes: nextRoutes,
        itineraryItems: nextItineraryItems,
      }
    })
  }, [doc.activities, doc.families, doc.itineraryItems, doc.locations, doc.meals, doc.routes, doc.tasks, setDoc])
  const searchResults = useMemo(
    () => getSearchResults(displayDoc, displayDoc.ui.searchQuery),
    [displayDoc],
  )
  const timelineWeatherDays = useMemo(
    () => DAYS.map((day) => ({ ...day, ...getTripDayWeather(weatherState.targets, day) })),
    [weatherState.targets],
  )
  const mapWeather = useMemo(
    () => getMapWeather(weatherState.targets, doc.ui.map.focusDayId),
    [doc.ui.map.focusDayId, weatherState.targets],
  )
  const mapWeatherTargets = useMemo(
    () => getMapWeatherTargets(weatherState.targets, doc.ui.map.focusDayId),
    [doc.ui.map.focusDayId, weatherState.targets],
  )

  const setSelectedPage = useCallback((pageId) => {
    setDoc((current) => ({
      ...current,
      selectedPage: pageId,
      selection: ensureSelectionForPage(current, pageId),
      ui: {
        ...current.ui,
        searchQuery: '',
      },
    }))
  }, [setDoc])

  const selectEntity = useCallback((type, id) => {
    setDoc((current) => {
      if (current.selection?.type === type && current.selection?.id === id && current.ui.searchQuery === '') {
        return current
      }

      return {
        ...current,
        selection: { type, id },
        ui: { ...current.ui, searchQuery: '' },
      }
    })
  }, [setDoc])

  const openEntity = useCallback((type, id) => {
    setDoc((current) => ({
      ...current,
      selection: { type, id },
      ui: { ...current.ui, searchQuery: '' },
    }))
  }, [setDoc])

  const hydrateLocationDetails = useCallback((locationId, patch) => {
    if (!locationId || !patch) return

    setDoc((current) => {
      let changed = false
      const locations = current.locations.map((location) => {
        if (location.id !== locationId) return location

        const nextLocation = {
          ...location,
          ...patch,
        }

        if (JSON.stringify(nextLocation) !== JSON.stringify(location)) {
          changed = true
        }

        return nextLocation
      })

      if (!changed) return current

      return {
        ...current,
        locations,
        routes: synchronizeRoutePaths(current.routes, locations),
      }
    })
  }, [setDoc])

  const hydrateRouteDetails = useCallback((routeId, patch) => {
    if (!routeId || !patch) return

    setDoc((current) => {
      let changed = false
      const routes = current.routes.map((route) => {
        if (route.id !== routeId) return route

        const nextRoute = {
          ...route,
          ...patch,
        }

        if (JSON.stringify(nextRoute) !== JSON.stringify(route)) {
          changed = true
        }

        return nextRoute
      })

      if (!changed) return current

      return {
        ...current,
        routes,
      }
    })
  }, [setDoc])

  const updateLocationFields = useCallback((locationId, patch) => {
    setDoc((current) => {
      const locations = current.locations.map((location) =>
        location.id === locationId ? stampFamilyMetadata({ ...location, ...patch }, currentFamilyId) : location,
      )

      return {
        ...current,
        locations,
        routes: synchronizeRoutePaths(current.routes, locations),
      }
    })
  }, [currentFamilyId, setDoc])

  // Meal/location intel hydration via Google Places/Directions was removed when
  // the map migrated to MapLibre+OSRM. The app now relies exclusively on the
  // static `tripData.js` values (photos, drive times, ratings, opening hours,
  // phone, website). `hydrateLocationDetails` is preserved as a generic patch
  // helper for manual edits and future OSRM-based enrichment. `externalUrl`
  // fields remain as Google Maps search deep links — those work without the
  // JS API.

  useEffect(() => {
    if (!liveExternalData) {
      setWeatherState({
        status: 'idle',
        targets: {},
        updatedAt: null,
        error: null,
      })
      return
    }

    const basecamp = doc.locations.find((location) => location.id === 'pine-airbnb')
    const yosemite = doc.locations.find((location) => location.id === 'yosemite')
    if (!basecamp?.coordinates || !yosemite?.coordinates) return

    let cancelled = false

    const loadWeather = async () => {
      try {
        const [basecampBundle, yosemiteBundle] = await Promise.all([
          fetchWeatherBundle({ label: 'Groveland Basecamp', coordinates: basecamp.coordinates }),
          fetchWeatherBundle({ label: 'Yosemite West Entrance', coordinates: yosemite.coordinates }),
        ])

        if (cancelled) return

        setWeatherState({
          status: 'ready',
          targets: {
            basecamp: basecampBundle,
            yosemite: yosemiteBundle,
          },
          updatedAt: new Date().toISOString(),
          error: null,
        })
      } catch (error) {
        if (cancelled) return
        setWeatherState((current) => ({
          ...current,
          status: 'error',
          error: error?.message || 'Weather fetch failed',
        }))
      }
    }

    loadWeather()
    const refreshId = window.setInterval(loadWeather, 10 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(refreshId)
    }
  }, [doc.locations, liveExternalData])

  const updatePageNote = (pageId, value) => {
    setDoc((current) => ({
      ...current,
      pageNotes: { ...current.pageNotes, [pageId]: value },
      pageNoteMeta: {
        ...(current.pageNoteMeta || {}),
        [pageId]: currentFamilyId
          ? {
              updatedByFamilyId: currentFamilyId,
              updatedAt: new Date().toISOString(),
            }
          : current.pageNoteMeta?.[pageId],
      },
    }))
  }

  const updateEntityNote = (type, id, value) => {
    setDoc((current) => {
      const collectionName = {
        family: 'families',
        location: 'locations',
        route: 'routes',
        itineraryItem: 'itineraryItems',
        meal: 'meals',
        activity: 'activities',
        stayItem: 'stayItems',
        expense: 'expenses',
        task: 'tasks',
      }[type]
      if (!collectionName) return current
      return {
        ...current,
        [collectionName]: updateEntityInCollection(current[collectionName], id, (item) => ({
          ...stampFamilyMetadata(item, currentFamilyId),
          note: value,
        })),
      }
    })
  }

  const toggleTask = (taskId) => {
    setDoc((current) => {
      const nextDoc = {
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId
            ? { ...task, status: task.status === 'done' ? 'open' : 'done' }
            : task,
        ),
      }
      return withRefreshedFamilies(nextDoc)
    })
  }

  const addTask = (entityType, entityId, title) => {
    setDoc((current) => {
      const entity = getEntityById(current, entityType, entityId)
      if (!entity || !title.trim()) return current
      const newTaskId = `task-user-${Date.now()}`
      const newTask = {
        id: newTaskId,
        type: 'task',
        title,
        dayId: entity.dayId || 'all',
        status: 'open',
        ownerFamilyId:
          entityType === 'family'
            ? entity.id
            : entity.familyIds?.length === 1
              ? entity.familyIds[0]
              : null,
        linkedEntityKeys: [makeEntityKey(entityType, entityId)],
        note: '',
      }
      const stampedTask = stampFamilyMetadata(newTask, currentFamilyId)

      const collectionName = {
        family: 'families',
        location: 'locations',
        route: 'routes',
        itineraryItem: 'itineraryItems',
        meal: 'meals',
        activity: 'activities',
        stayItem: 'stayItems',
        expense: 'expenses',
        task: 'tasks',
      }[entityType]

      const nextDoc = {
        ...current,
        tasks: [...current.tasks, stampedTask],
        [collectionName]:
          entityType === 'task'
            ? current[collectionName]
            : updateEntityInCollection(current[collectionName], entityId, (item) => ({
                ...item,
                taskIds: [...(item.taskIds || []), newTaskId],
              })),
      }

      return withRefreshedFamilies(nextDoc)
    })
  }

  const addActivity = ({ title, dayId, window, description }) => {
    if (!title?.trim()) return

    const fallbackWindow = `${getDayMeta(dayId)?.shortLabel?.toUpperCase() || dayId?.toUpperCase() || 'DAY'} / flexible`
    const newActivity = stampFamilyMetadata({
      id: `activity-user-${Date.now()}`,
      type: 'activity',
      title: title.trim(),
      dayId: dayId || 'fri',
      window: window?.trim() || fallbackWindow,
      status: 'Pending',
      riskLevel: 'Low',
      weatherSensitivity: 'Low',
      locationId: dayId === 'sun' ? 'pine-airbnb' : null,
      linkedEntityKeys: [],
      taskIds: [],
      description: description?.trim() || 'Custom activity stub. Define the actual plan, why it matters, and what the fallback looks like.',
      backup: 'If this becomes too ambitious, downgrade to the easiest nearby alternative.',
      note: '',
    }, currentFamilyId)

    setDoc((current) => ({
      ...current,
      activities: [...current.activities, newActivity],
      selection: { type: 'activity', id: newActivity.id },
    }))
  }

  const convertNoteToTask = (entityType, entityId) => {
    const entity = getEntityById(doc, entityType, entityId)
    if (!entity?.note?.trim()) return
    addTask(entityType, entityId, entity.note.trim().split('\n')[0].slice(0, 96))
  }

  const convertPageNoteToTask = (pageId) => {
    const note = getPageNote(doc, pageId)
    if (!note.trim()) return
    const pageToEntityType = {
      itinerary: 'activity',
      stay: 'stayItem',
      meals: 'meal',
      activities: 'activity',
      expenses: 'expense',
      families: 'family',
    }
    const entityType = pageToEntityType[pageId]
    const collectionName = ENTITY_PAGE[entityType] ? {
      activity: 'activities',
      stayItem: 'stayItems',
      meal: 'meals',
      expense: 'expenses',
      family: 'families',
    }[entityType] : null
    const target = collectionName ? doc[collectionName]?.[0] : null
    if (!target) return
    addTask(target.type, target.id, note.trim().split('\n')[0].slice(0, 96))
  }

  const toggleMealStatus = (mealId) => {
    setDoc((current) => ({
      ...current,
      meals: current.meals.map((meal) =>
        meal.id === mealId
          ? stampFamilyMetadata({ ...meal, status: meal.status === 'Assigned' ? 'Pending' : 'Assigned' }, currentFamilyId)
          : meal,
      ),
    }))
  }

  const toggleExpenseSettled = (expenseId) => {
    setDoc((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === expenseId
          ? stampFamilyMetadata({ ...expense, settled: !expense.settled }, currentFamilyId)
          : expense,
      ),
    }))
  }

  const updateExpenseFields = (expenseId, patch) => {
    setDoc((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => {
        if (expense.id !== expenseId) return expense

        const nextExpense = { ...expense, ...patch }
        if ('amount' in patch && nextExpense.allocationMode === 'equal') {
          nextExpense.allocations = {}
        }
        return stampFamilyMetadata(nextExpense, currentFamilyId)
      }),
    }))
  }

  const setExpenseAllocationMode = (expenseId, allocationMode) => {
    setDoc((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => {
        if (expense.id !== expenseId) return expense

        if (allocationMode === 'manual') {
          return stampFamilyMetadata({
            ...expense,
            allocationMode,
            split: EXPENSE_SPLIT_LABELS[allocationMode],
            allocations:
              expense.allocationMode === 'manual' && expense.allocations && Object.keys(expense.allocations).length
                ? expense.allocations
                : buildManualAllocationSeed(expense.amount, current.families),
          }, currentFamilyId)
        }

        return stampFamilyMetadata({
          ...expense,
          allocationMode,
          split: EXPENSE_SPLIT_LABELS[allocationMode],
          allocations: {},
        }, currentFamilyId)
      }),
    }))
  }

  const updateExpenseAllocation = (expenseId, familyId, amount) => {
    setDoc((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === expenseId
          ? stampFamilyMetadata({
              ...expense,
              allocationMode: 'manual',
              split: EXPENSE_SPLIT_LABELS.manual,
              allocations: {
                ...(expense.allocations || {}),
                [familyId]: amount,
              },
            }, currentFamilyId)
          : expense,
      ),
    }))
  }

  const resetExpenseAllocationsToEqual = (expenseId) => {
    setDoc((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.id === expenseId
          ? stampFamilyMetadata({
              ...expense,
              allocationMode: 'manual',
              split: EXPENSE_SPLIT_LABELS.manual,
              allocations: buildManualAllocationSeed(expense.amount, current.families),
            }, currentFamilyId)
          : expense,
      ),
    }))
  }

  const addExpense = () => {
    setDoc((current) => {
      const familyLabel = getFamilyLabel(current.families, currentFamilyId)
      const newExpense = stampFamilyMetadata({
        id: `expense-user-${Date.now()}`,
        type: 'expense',
        title: 'New shared expense',
        payer: currentFamilyId ? familyLabel : 'Unassigned',
        amount: 0,
        split: EXPENSE_SPLIT_LABELS.equal,
        allocationMode: 'equal',
        allocations: {},
        settled: false,
        linkedEntityKeys: currentFamilyId ? [makeEntityKey('family', currentFamilyId)] : [],
        note: '',
      }, currentFamilyId)

      return {
        ...current,
        expenses: [...current.expenses, newExpense],
        selection: { type: 'expense', id: newExpense.id },
        selectedPage: 'expenses',
      }
    })
  }

  const updateMapUi = (patch) => {
    setDoc((current) => ({
      ...current,
      ui: {
        ...current.ui,
        map: { ...current.ui.map, ...patch },
      },
    }))
  }

  const setTimelineCursor = useCallback((cursorSlot) => {
    setDoc((current) => ({
      ...current,
      ui: {
        ...current.ui,
        timeline: { ...current.ui.timeline, cursorSlot: clampTimelineCursor(cursorSlot) },
      },
    }))
  }, [setDoc])

  const updateSearchQuery = (searchQuery) => {
    setDoc((current) => ({
      ...current,
      ui: { ...current.ui, searchQuery },
    }))
  }

  const exportState = () => {
    const blob = new Blob([JSON.stringify(displayDoc, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'pine-mountain-lake-command-center.json'
    anchor.click()
    window.URL.revokeObjectURL(url)
  }

  const pageProps = {
    doc: displayDoc,
    selection,
    currentFamily,
    currentFamilyId,
    onSelectEntity: selectEntity,
    onOpenEntity: openEntity,
    onUpdatePageNote: updatePageNote,
    onConvertPageNote: convertPageNoteToTask,
    onAddActivity: addActivity,
  }

  let content = null
  if (displayDoc.selectedPage === 'itinerary') {
    content = (
      <ItineraryPage
        {...pageProps}
        onSetCursor={setTimelineCursor}
        onUpdateMapUi={updateMapUi}
        onHydrateRouteDetails={hydrateRouteDetails}
        weatherDays={timelineWeatherDays}
        mapWeather={mapWeather}
        mapWeatherTargets={mapWeatherTargets}
      />
    )
  } else if (displayDoc.selectedPage === 'stay') {
    content = <StayPage {...pageProps} />
  } else if (displayDoc.selectedPage === 'meals') {
    content = <MealsPage {...pageProps} onToggleMealStatus={toggleMealStatus} />
  } else if (displayDoc.selectedPage === 'activities') {
    content = <ActivitiesPage {...pageProps} />
  } else if (displayDoc.selectedPage === 'expenses') {
    content = (
      <ExpensesPage
        {...pageProps}
        onToggleExpenseSettled={toggleExpenseSettled}
        onUpdateExpenseFields={updateExpenseFields}
        onSetExpenseAllocationMode={setExpenseAllocationMode}
        onUpdateExpenseAllocation={updateExpenseAllocation}
        onResetExpenseAllocationsToEqual={resetExpenseAllocationsToEqual}
        onAddExpense={addExpense}
      />
    )
  } else if (displayDoc.selectedPage === 'families') {
    content = <FamiliesPage {...pageProps} />
  }

  const mainWithInspector = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_auto] overflow-hidden">
      <div className="flex min-h-0 min-w-0 overflow-hidden">{content}</div>
      <InspectorRail
        doc={displayDoc}
        pageId={displayDoc.selectedPage}
        selection={selection}
        activeFamilyId={currentFamilyId}
        onSelectEntity={selectEntity}
        onUpdateLocationFields={updateLocationFields}
        onToggleTask={toggleTask}
        onUpdateEntityNote={updateEntityNote}
        onAddTask={addTask}
        onConvertNoteToTask={convertNoteToTask}
        onToggleMealStatus={toggleMealStatus}
        onToggleExpenseSettled={toggleExpenseSettled}
      />
    </div>
  )

  return (
    <>
      <AppShell
        doc={displayDoc}
        onSetSelectedPage={setSelectedPage}
        onExport={exportState}
        onOpenChat={() => setChatOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearchChange={updateSearchQuery}
        searchResults={searchResults}
        onOpenEntity={openEntity}
        families={displayDoc.families}
        activeFamily={currentFamily}
        onSetActiveFamily={setActiveFamilyProfile}
      >
        {mainWithInspector}
      </AppShell>
      <ChatDialog open={chatOpen} onClose={() => setChatOpen(false)} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

export default App
