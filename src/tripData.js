const PUBLIC_BASECAMP_LOCATION = 'Pine Mountain Lake, Groveland, CA 95321'
const PUBLIC_BASECAMP_COORDINATES = { lat: 37.8586, lng: -120.2142 }

export const TRIP_META = {
  title: 'Pine Mountain Lake / Yosemite Weekend',
  subtitle: 'Thu 4/09 to Sun 4/12',
  commandName: 'Family Trip Command Center',
  airbnb: {
    name: 'Pine Mountain Lake Basecamp',
    url: null,
    manualUrl: null,
    location: PUBLIC_BASECAMP_LOCATION,
    checkIn: 'Check-in after 4:00 PM',
    checkOut: 'Check-out before 11:00 AM',
    gateNote: 'Community access details are intentionally withheld in the sanitized demo.',
    parkingNote: 'Parking guidance is intentionally simplified in the sanitized demo.',
    directionsNote: 'Use the Pine Mountain Lake waypoint for planning. Exact arrival instructions are intentionally withheld.',
    lockNote: null,
    wifiNetwork: null,
    wifiPassword: null,
    hostName: null,
    coHostName: null,
    guestSummary: null,
    confirmationCode: null,
    vehicleFee: 'Community access details withheld',
  },
}

export const MAP_POINTS = [
  {
    id: 'sf-silver-peak',
    label: 'Jiangs',
    caption: 'San Francisco',
    familyId: 'silver-peak',
    focusDay: 'thursday',
    tone: 'critical',
    position: { lat: 37.7855, lng: -122.4068 },
  },
  {
    id: 'sf-desert-bloom',
    label: 'Riveras',
    caption: 'Reno',
    familyId: 'desert-bloom',
    focusDay: 'friday',
    tone: 'violet',
    position: { lat: 39.5296, lng: -119.8138 },
  },
  {
    id: 'la-north-star',
    label: 'Parkers',
    caption: 'Los Angeles',
    familyId: 'north-star',
    focusDay: 'thursday',
    tone: 'warning',
    position: { lat: 34.0522, lng: -118.2437 },
  },
  {
    id: 'pine-mountain-lake',
    label: 'Basecamp',
    caption: 'Pine Mountain Lake',
    familyId: 'all',
    focusDay: 'all',
    tone: 'success',
    position: PUBLIC_BASECAMP_COORDINATES,
  },
  {
    id: 'yosemite',
    label: 'Yosemite',
    caption: 'Primary target',
    familyId: 'all',
    focusDay: 'saturday',
    tone: 'muted',
    position: { lat: 37.8651, lng: -119.5383 },
  },
]

export const MAP_ROUTES = [
  {
    id: 'route-sf-silver-peak',
    familyId: 'silver-peak',
    focusDay: 'thursday',
    tone: 'critical',
    path: [
      { lat: 37.7855, lng: -122.4068 },
      { lat: 38.032, lng: -121.86 },
      PUBLIC_BASECAMP_COORDINATES,
    ],
  },
  {
    id: 'route-sf-desert-bloom',
    familyId: 'desert-bloom',
    focusDay: 'friday',
    tone: 'violet',
    dashed: true,
    path: [
      { lat: 39.5296, lng: -119.8138 },
      PUBLIC_BASECAMP_COORDINATES,
    ],
  },
  {
    id: 'route-la-north-star',
    familyId: 'north-star',
    focusDay: 'thursday',
    tone: 'warning',
    path: [
      { lat: 34.0522, lng: -118.2437 },
      { lat: 35.298, lng: -119.148 },
      PUBLIC_BASECAMP_COORDINATES,
    ],
  },
  {
    id: 'route-yosemite-day',
    familyId: 'all',
    focusDay: 'saturday',
    tone: 'muted',
    path: [
      PUBLIC_BASECAMP_COORDINATES,
      { lat: 37.861, lng: -119.93 },
      { lat: 37.8651, lng: -119.5383 },
    ],
  },
]

export const MAP_FACILITIES = [
  {
    id: 'groveland-gas',
    label: 'Groveland fuel',
    caption: 'Gas / supply stop',
    category: 'logistics',
    position: { lat: 37.8396, lng: -120.2314 },
  },
  {
    id: 'groveland-grocery',
    label: 'Groveland grocery',
    caption: 'Last major grocery run',
    category: 'logistics',
    position: { lat: 37.8381, lng: -120.2302 },
  },
  {
    id: 'pine-mountain-lake-beach',
    label: 'Lake day',
    caption: 'Friday ops zone',
    category: 'activity',
    position: { lat: 37.8604, lng: -120.2019 },
  },
  {
    id: 'yosemite-entrance',
    label: 'Big Oak Flat',
    caption: 'Park entry / traffic watch',
    category: 'park',
    position: { lat: 37.8108, lng: -119.8744 },
  },
]

export const NAV_ITEMS = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'stay', label: 'Stay' },
  { id: 'meals', label: 'Meals' },
  { id: 'activities', label: 'Activities' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'families', label: 'Families' },
]

export const DAYS = [
  {
    id: 'thu',
    shortLabel: 'Thu 4/09',
    title: 'Transit Day',
    weather: 'Sunny',
    temperature: '72 F',
    caution: 'Low',
  },
  {
    id: 'fri',
    shortLabel: 'Fri 4/10',
    title: 'Pine Mountain Lake',
    weather: 'Partly Cloudy',
    temperature: '68 F',
    caution: 'Low',
  },
  {
    id: 'sat',
    shortLabel: 'Sat 4/11',
    title: 'Yosemite Day',
    weather: 'Showers',
    temperature: '62 F',
    caution: 'Medium',
  },
  {
    id: 'sun',
    shortLabel: 'Sun 4/12',
    title: 'Drive Home',
    weather: 'Sunny',
    temperature: '75 F',
    caution: 'Low',
  },
]

export const TIME_SLOTS = ['00', '06', '12', '18']

export const INITIAL_FAMILIES = [
  {
    id: 'north-star',
    name: 'Parkers',
    title: 'Parkers',
    origin: 'Los Angeles',
    shortOrigin: 'LA',
    status: 'Transit',
    eta: 'Thu 4:00 PM',
    driveTime: '5.5 hrs',
    headcount: '2 adults, 1 kid',
    vehicle: 'SUV',
    vehicles: [
      {
        id: 'north-star-1',
        name: 'Parker SUV',
        seats: 5,
        driver: 'Parkers',
        departureWindow: 'Thu 09:30',
      },
    ],
    responsibility: 'Firewood + snacks',
    readiness: 82,
    routeSummary: 'Single-leg drive from LA to Pine Mountain Lake',
    checklist: [
      { id: 'car-pack', label: 'Car packed night before', done: true },
      { id: 'kid-bag', label: 'Kid activity bag loaded', done: true },
      { id: 'groceries', label: 'Road snacks secured', done: false },
      { id: 'firewood', label: 'Pickup firewood on arrival', done: false },
    ],
  },
  {
    id: 'silver-peak',
    name: 'Jiangs',
    title: 'Jiangs',
    origin: 'San Francisco',
    shortOrigin: 'SF',
    status: 'Transit',
    eta: 'Thu 4:00 PM',
    driveTime: '3.5 hrs',
    headcount: '2 adults, 1 kid',
    vehicle: 'SUV',
    vehicles: [
      {
        id: 'silver-peak-1',
        name: 'Jiang SUV',
        seats: 5,
        driver: 'Jiangs',
        departureWindow: 'Thu 11:30',
      },
    ],
    responsibility: 'Coolers + breakfast fruit',
    readiness: 88,
    routeSummary: 'Short Bay Area drive with a quick Oakdale reset before Pine Mountain Lake',
    checklist: [
      { id: 'lake-gear', label: 'Lake towels and floaties', done: true },
      { id: 'breakfast', label: 'Breakfast fruit packed', done: true },
      { id: 'kids-shoes', label: 'Backup shoes for kid', done: false },
      { id: 'charger', label: 'Portable charger packed', done: true },
    ],
  },
  {
    id: 'desert-bloom',
    name: 'Riveras',
    title: 'Riveras',
    origin: 'Reno',
    shortOrigin: 'RN',
    status: 'Friday Arrival',
    eta: 'Fri 1:00 PM',
    driveTime: '5 hrs',
    headcount: '2 adults, 1 kid',
    vehicle: 'SUV',
    vehicles: [
      {
        id: 'desert-bloom-1',
        name: 'Rivera SUV',
        seats: 5,
        driver: 'Riveras',
        departureWindow: 'Fri 08:00',
      },
    ],
    responsibility: 'Grill kit + Saturday lunch',
    readiness: 71,
    routeSummary: 'Friday arrival from Reno straight into Pine Mountain Lake',
    checklist: [
      { id: 'late-arrival', label: 'Friday arrival window confirmed', done: true },
      { id: 'grill-kit', label: 'Grill kit packed', done: false },
      { id: 'yosemite-daypack', label: 'Yosemite daypacks staged', done: false },
      { id: 'park-pass', label: 'Park entry docs confirmed', done: true },
    ],
  },
  {
    id: 'santos',
    name: 'Santos',
    title: 'Santos',
    origin: 'São Paulo',
    shortOrigin: 'SP',
    status: 'Planning',
    eta: 'Thursday night',
    driveTime: 'Flight + rental',
    headcount: '4 adults',
    vehicle: 'Rental · SUV',
    vehicles: [
      {
        id: 'santos-1',
        name: 'Rental Tahoe',
        seats: 5,
        driver: 'TBD',
        departureWindow: 'Thu 10:00',
      },
    ],
    responsibility: 'Intl logistics & supplies',
    readiness: 20,
    routeSummary: 'International arrival via SFO, rental pickup, drive to Pine Mountain Lake',
    tasks: [],
    checklist: [],
  },
]

export const ITINERARY_ROWS = [
  {
    id: 'travel',
    label: 'Transit',
    segments: [
      { id: 'north-star-drive', familyId: 'north-star', start: 1.75, span: 0.92, color: 'warning', label: 'Parkers drive' },
      { id: 'silver-peak-drive', familyId: 'silver-peak', start: 2.09, span: 0.58, color: 'critical', label: 'Jiangs drive' },
      { id: 'desert-bloom-drive', familyId: 'desert-bloom', start: 5.33, span: 0.83, color: 'violet', label: 'Riveras drive' },
    ],
  },
  {
    id: 'activities',
    label: 'Main Ops',
    segments: [
      { id: 'thu-dinner', start: 0.7, span: 2.53, color: 'critical', label: 'Transit + settle in' },
      { id: 'fri-lake', start: 4, span: 4, color: 'info', label: 'Pine Mountain Lake day' },
      { id: 'sat-yosemite', start: 8, span: 4, color: 'warning', label: 'Yosemite day mission' },
      { id: 'sun-return', start: 12, span: 3, color: 'success', label: 'Drive home' },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    segments: [
      { id: 'airbnb-checkin', start: 2, span: 1, color: 'muted', label: 'Basecamp check-in' },
      { id: 'groceries', start: 4, span: 1, color: 'muted', label: 'Groceries and restock' },
      { id: 'park-prep', start: 7, span: 1, color: 'muted', label: 'Yosemite prep window' },
    ],
  },
]

export const INITIAL_MEALS = [
  { id: 'thu-dinner', day: 'Thursday', meal: 'Two Guys Pizza Pies', owner: 'Walk-in', status: 'Assigned', note: 'Simple first-night pizza dinner plan around 6:00 PM with a one-hour stop before heading back to basecamp' },
  { id: 'fri-breakfast', day: 'Friday', meal: 'Basecamp breakfast', owner: 'Shared', status: 'Assigned', note: 'Keep breakfast easy at basecamp before the local Friday reset day' },
  { id: 'fri-lunch', day: 'Friday', meal: 'The Grill at Pine Mountain Lake', owner: 'Shared', status: 'Assigned', note: 'Local lunch outing without creating a Friday evening convoy' },
  { id: 'fri-dinner', day: 'Friday', meal: 'Basecamp dinner', owner: 'Shared', status: 'Assigned', note: 'Dinner at basecamp keeps Friday evening drive-free' },
  { id: 'sat-lunch', day: 'Saturday', meal: 'Packed Yosemite lunch', owner: 'Shared', status: 'Assigned', note: 'Portable lunch to keep the Yosemite day flexible' },
  { id: 'sat-dinner', day: 'Saturday', meal: 'Around The Horn Brewing Company', owner: 'Walk-in', status: 'Assigned', note: 'Return-drive dinner stop in Groveland after Yosemite' },
  { id: 'sun-breakfast', day: 'Sunday', meal: 'Basecamp brunch before departure', owner: 'Shared', status: 'Assigned', note: 'Cook brunch at basecamp before checkout and the drive home' },
]

export const INITIAL_EXPENSES = [
  { id: 'airbnb', label: 'Basecamp booking', payer: 'Parkers', amount: 1280, split: '3 families', settled: false },
  { id: 'groceries', label: 'Groceries', payer: 'Jiangs', amount: 210, split: 'shared food', settled: false },
  { id: 'gas', label: 'Gas + driving', payer: 'Each family', amount: 0, split: 'individual', settled: true },
  { id: 'parking', label: 'Activity / gate / parking extras', payer: 'Unassigned', amount: 60, split: 'shared', settled: false },
]

export const ACTIVITIES = [
  {
    id: 'thu-transit',
    title: 'Transit + settle in',
    status: 'Go',
    window: 'Thu / all day',
    description: 'Two families move on Thursday. First-night goal is arrival, check-in, kid decompression, and an easy dinner.',
    backup: 'If traffic spikes, switch to late arrival meal and minimum-viable setup.',
  },
  {
    id: 'fri-lake',
    title: 'Pine Mountain Lake Day',
    status: 'Go',
    window: 'Fri / all day',
    description: 'Local lake day close to basecamp. Lower logistics load, easier for kids, flexible for the Friday-arrival family.',
    backup: 'If weather or parking gets weird, shift to cabin hang + shorter local outing.',
  },
  {
    id: 'sat-yosemite',
    title: 'Yosemite Day',
    status: 'Watch',
    window: 'Sat / early start',
    description: 'Primary excursion day. Needs early departure, packed lunches, kid pacing, and weather-aware backup logic.',
    backup: 'If showers worsen, downgrade to scenic stops + flexible walking plan.',
  },
  {
    id: 'sun-home',
    title: 'Sunday Return',
    status: 'Go',
    window: 'Sun / checkout',
    description: 'Pack, cabin reset, check-out, and staggered drive home windows.',
    backup: 'Pre-pack Saturday night to reduce morning chaos.',
  },
]

export const STAY_DETAILS = {
  commandSummary: 'Basecamp operations run through the Groveland-area staging house.',
  houseOps: [
    'Confirm gate access and arrival sequence before Thursday departures.',
    'Stage sleeping assignments before first family arrival.',
    'Consolidate beach / lake parking assumptions before Friday.',
    'Pre-pack Yosemite day gear Friday night.',
  ],
  rooms: [
    { label: 'Room 1', assignment: 'Parkers' },
    { label: 'Room 2', assignment: 'Jiangs' },
    { label: 'Room 3', assignment: 'Riveras' },
    { label: 'Kid overflow', assignment: 'Flexible based on bedtime logistics' },
  ],
}

export const INITIAL_NOTES = {
  itinerary: 'Mission priority: reduce Friday arrival chaos and make Saturday easy on the kids.',
  stay: 'Need one clean arrival protocol so the first family is not doing all the setup work.',
  meals: 'Restaurant anchors are set for Thursday and Friday, while the rest of the weekend leans into basecamp cook-in logistics.',
  activities: 'Yosemite is the headline day, but Pine Mountain Lake should feel fully worth the trip on its own.',
  expenses: 'Keep this light. Shared visibility matters more than perfect accounting.',
  families: 'Each family should know its task package before Thursday morning.',
}
