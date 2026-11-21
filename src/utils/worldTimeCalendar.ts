/**
 * Real-time World Clock (IANA Timezone Database), Official 2019 Revised
 * Bangladesh Government Bengali Calendar (Bangla Academy), and Islamic Hijri
 * Calendar conversion engine.
 *
 * Always computes live from the current system clock (Date.now()) unless an
 * explicit historical/target Gregorian date is passed for conversion.
 */

export interface ResolvedTimezoneInfo {
  iana: string;
  labelEn: string;
  labelBn: string;
  countryEn?: string;
  /** Additional primary timezones for multi-timezone countries (e.g. USA, Canada, Australia) */
  additionalZones?: Array<{ iana: string; labelEn: string; labelBn: string }>;
}

export interface LiveTimeResult {
  ok: true;
  requestedInput: string;
  timezone: string;
  locationLabelEn: string;
  locationLabelBn: string;
  isoTimestamp: string;
  time12En: string;
  time24: string;
  time12Bn: string;
  periodBn: string;
  weekdayEn: string;
  weekdayBn: string;
  gregorianDateIso: string;
  gregorianDateEn: string;
  gregorianDateBn: string;
  utcOffset: string;
  isDst: boolean;
  additionalZones?: Array<{
    timezone: string;
    labelEn: string;
    labelBn: string;
    time12En: string;
    time12Bn: string;
    utcOffset: string;
  }>;
}

export interface BengaliDateResult {
  ok: true;
  calendarStandard: 'Bangladesh Government Revised Bangla Calendar (2019 Bangla Academy)';
  timezone: string;
  gregorianDateIso: string;
  year: number;
  yearBn: string;
  monthIndex: number; // 1..12
  monthEn: string;
  monthBn: string;
  day: number;
  dayBn: string;
  seasonEn: string;
  seasonBn: string;
  weekdayEn: string;
  weekdayBn: string;
  formattedBn: string;
  formattedEn: string;
}

export interface HijriDateResult {
  ok: true;
  calendarMethod: 'Islamic Umm al-Qura (astronomical reference)';
  timezone: string;
  gregorianDateIso: string;
  year: number;
  yearBn: string;
  monthIndex: number; // 1..12
  monthEn: string;
  monthBn: string;
  day: number;
  dayBn: string;
  formattedBn: string;
  formattedEn: string;
  moonSightingNoteBn: string;
  moonSightingNoteEn: string;
}

export interface LiveDateResult {
  ok: true;
  timezone: string;
  locationLabelEn: string;
  locationLabelBn: string;
  retrievedAtIso: string;
  gregorian: {
    iso: string;
    year: number;
    yearBn: string;
    monthIndex: number;
    monthEn: string;
    monthBn: string;
    day: number;
    dayBn: string;
    weekdayEn: string;
    weekdayBn: string;
    formattedEn: string;
    formattedBn: string;
  };
  bengali: BengaliDateResult;
  hijri: HijriDateResult;
}

export const DEFAULT_BANGLADESH_TIMEZONE = 'Asia/Dhaka';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBengaliDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

const GREGORIAN_MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const GREGORIAN_MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

const WEEKDAYS_EN = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const WEEKDAYS_BN = [
  'রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার',
];

const BANGLA_MONTHS: Array<{ en: string; bn: string; seasonEn: string; seasonBn: string }> = [
  { en: 'Boishakh', bn: 'বৈশাখ', seasonEn: 'Summer (Grishmo)', seasonBn: 'গ্রীষ্মকাল' },
  { en: 'Jyoishtho', bn: 'জ্যৈষ্ঠ', seasonEn: 'Summer (Grishmo)', seasonBn: 'গ্রীষ্মকাল' },
  { en: 'Asharh', bn: 'আষাঢ়', seasonEn: 'Monsoon (Borsha)', seasonBn: 'বর্ষাকাল' },
  { en: 'Shrabon', bn: 'শ্রাবণ', seasonEn: 'Monsoon (Borsha)', seasonBn: 'বর্ষাকাল' },
  { en: 'Bhadro', bn: 'ভাদ্র', seasonEn: 'Autumn (Shorot)', seasonBn: 'শরৎকাল' },
  { en: 'Ashwin', bn: 'আশ্বিন', seasonEn: 'Autumn (Shorot)', seasonBn: 'শরৎকাল' },
  { en: 'Kartik', bn: 'কার্তিক', seasonEn: 'Late Autumn (Hemonto)', seasonBn: 'হেমন্তকাল' },
  { en: 'Ogrohayon', bn: 'অগ্রহায়ণ', seasonEn: 'Late Autumn (Hemonto)', seasonBn: 'হেমন্তকাল' },
  { en: 'Poush', bn: 'পৌষ', seasonEn: 'Winter (Sheet)', seasonBn: 'শীতকাল' },
  { en: 'Magh', bn: 'মাঘ', seasonEn: 'Winter (Sheet)', seasonBn: 'শীতকাল' },
  { en: 'Falgun', bn: 'ফাল্গুন', seasonEn: 'Spring (Bosonto)', seasonBn: 'বসন্তকাল' },
  { en: 'Chaitro', bn: 'চৈত্র', seasonEn: 'Spring (Bosonto)', seasonBn: 'বসন্তকাল' },
];

const HIJRI_MONTHS: Array<{ en: string; bn: string }> = [
  { en: 'Muharram', bn: 'মহররম' },
  { en: 'Safar', bn: 'সফর' },
  { en: 'Rabi al-Awwal', bn: 'রবিউল আউয়াল' },
  { en: 'Rabi al-Thani', bn: 'রবিউস সানি' },
  { en: 'Jumada al-Awwal', bn: 'জমাদিউল আউয়াল' },
  { en: 'Jumada al-Thani', bn: 'জমাদিউস সানি' },
  { en: 'Rajab', bn: 'রজব' },
  { en: 'Shaban', bn: 'শাবান' },
  { en: 'Ramadan', bn: 'রমজান' },
  { en: 'Shawwal', bn: 'শাওয়াল' },
  { en: 'Dhul Qadah', bn: 'জিলকদ' },
  { en: 'Dhul Hijjah', bn: 'জিলহজ' },
];

interface LocationZoneEntry extends ResolvedTimezoneInfo {
  aliases: string[];
}

const LOCATION_TIMEZONES: LocationZoneEntry[] = [
  {
    iana: 'Asia/Dhaka',
    labelEn: 'Bangladesh (Dhaka)',
    labelBn: 'বাংলাদেশ (ঢাকা)',
    countryEn: 'Bangladesh',
    aliases: ['bangladesh', 'dhaka', 'bd', 'chittagong', 'chattogram', 'sylhet', 'khulna', 'rajshahi', 'barishal', 'rangpur', 'mymensingh', 'বাংলাদেশ', 'বাংলাদেশে', 'ঢাকা', 'ঢাকায়', 'ঢাকায়', 'চট্টগ্রাম', 'সিলেট', 'খুলনা', 'রাজশাহী'],
  },
  {
    iana: 'America/New_York',
    labelEn: 'United States (Eastern / New York)',
    labelBn: 'আমেরিকা (নিউইয়র্ক / ইস্টার্ন টাইম)',
    countryEn: 'United States',
    additionalZones: [
      { iana: 'America/Chicago', labelEn: 'Central (Chicago)', labelBn: 'সেন্ট্রাল (শিকাগো)' },
      { iana: 'America/Denver', labelEn: 'Mountain (Denver)', labelBn: 'মাউন্টেন (ডেনভার)' },
      { iana: 'America/Los_Angeles', labelEn: 'Pacific (Los Angeles)', labelBn: 'প্যাসিফিক (লস অ্যাঞ্জেলেস)' },
    ],
    aliases: ['usa', 'us', 'united states', 'america', 'আমেরিকা', 'আমেরিকায়', 'আমেরিকায়', 'যুক্তরাষ্ট্র', 'যুক্তরাষ্ট্রে'],
  },
  {
    iana: 'America/New_York',
    labelEn: 'New York, USA',
    labelBn: 'নিউইয়র্ক, আমেরিকা',
    countryEn: 'United States',
    aliases: ['new york', 'nyc', 'washington', 'washington dc', 'boston', 'miami', 'atlanta', 'philadelphia', 'নিউইয়র্ক', 'নিউইয়র্ক', 'নিউ ইয়র্ক', 'নিউ ইয়র্ক', 'ওয়াশিংটন', 'ওয়াশিংটন', 'বস্টন', 'মায়ামি'],
  },
  {
    iana: 'America/Chicago',
    labelEn: 'Chicago / Texas (Central USA)',
    labelBn: 'শিকাগো / টেক্সাস (সেন্ট্রাল আমেরিকা)',
    countryEn: 'United States',
    aliases: ['chicago', 'texas', 'dallas', 'houston', 'austin', 'শিকাগো', 'টেক্সাস', 'ডালাস', 'হিউস্টন'],
  },
  {
    iana: 'America/Los_Angeles',
    labelEn: 'Los Angeles / California (Pacific USA)',
    labelBn: 'লস অ্যাঞ্জেলেস / ক্যালিফোর্নিয়া',
    countryEn: 'United States',
    aliases: ['los angeles', 'california', 'san francisco', 'seattle', 'silicon valley', 'las vegas', 'লস অ্যাঞ্জেলেস', 'ক্যালিফোর্নিয়া', 'সান ফ্রান্সিসকো', 'সিয়াটল'],
  },
  {
    iana: 'America/Toronto',
    labelEn: 'Canada (Eastern / Toronto)',
    labelBn: 'কানাডা (টরন্টো / ইস্টার্ন টাইম)',
    countryEn: 'Canada',
    additionalZones: [
      { iana: 'America/Edmonton', labelEn: 'Mountain (Calgary)', labelBn: 'মাউন্টেন (ক্যালগারি)' },
      { iana: 'America/Vancouver', labelEn: 'Pacific (Vancouver)', labelBn: 'প্যাসিফিক (ভ্যাঙ্কুভার)' },
    ],
    aliases: ['canada', 'toronto', 'ottawa', 'montreal', 'quebec', 'কানাডা', 'কানাডায়', 'কানাডায়', 'টরন্টো', 'অটোয়া', 'মন্ট্রিয়ল', 'কুইবেক'],
  },
  {
    iana: 'America/Vancouver',
    labelEn: 'Vancouver, Canada',
    labelBn: 'ভ্যাঙ্কুভার, কানাডা',
    countryEn: 'Canada',
    aliases: ['vancouver', 'british columbia', 'ভ্যাঙ্কুভার'],
  },
  {
    iana: 'America/Edmonton',
    labelEn: 'Calgary / Edmonton, Canada',
    labelBn: 'ক্যালগারি / এডমন্টন, কানাডা',
    countryEn: 'Canada',
    aliases: ['calgary', 'edmonton', 'alberta', 'ক্যালগারি', 'এডমন্টন'],
  },
  {
    iana: 'Europe/London',
    labelEn: 'United Kingdom (London)',
    labelBn: 'যুক্তরাজ্য (লন্ডন)',
    countryEn: 'United Kingdom',
    aliases: ['uk', 'united kingdom', 'britain', 'england', 'london', 'manchester', 'birmingham', 'scotland', 'লন্ডন', 'লন্ডনে', 'যুক্তরাজ্য', 'ইংল্যান্ড', 'ব্রিটেন', 'ম্যানচেস্টার'],
  },
  {
    iana: 'Asia/Kolkata',
    labelEn: 'India (Kolkata / New Delhi)',
    labelBn: 'ভারত (কলকাতা / দিল্লি)',
    countryEn: 'India',
    aliases: ['india', 'kolkata', 'calcutta', 'delhi', 'new delhi', 'mumbai', 'bangalore', 'bengaluru', 'chennai', 'hyderabad', 'ভারত', 'ভারতে', 'ইন্ডিয়া', 'ইন্ডিয়া', 'কলকাতা', 'দিল্লি', 'মুম্বাই'],
  },
  {
    iana: 'Asia/Karachi',
    labelEn: 'Pakistan (Islamabad / Karachi)',
    labelBn: 'পাকিস্তান (ইসলামাবাদ / করাচি)',
    countryEn: 'Pakistan',
    aliases: ['pakistan', 'karachi', 'lahore', 'islamabad', 'পাকিস্তান', 'করাচি', 'লাহোর', 'ইসলামাবাদ'],
  },
  {
    iana: 'Asia/Shanghai',
    labelEn: 'China (Beijing / Shanghai)',
    labelBn: 'চীন (বেইজিং / সাংহাই)',
    countryEn: 'China',
    aliases: ['china', 'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'চীন', 'চীনে', 'বেইজিং', 'সাংহাই'],
  },
  {
    iana: 'Asia/Tokyo',
    labelEn: 'Japan (Tokyo)',
    labelBn: 'জাপান (টোকিও)',
    countryEn: 'Japan',
    aliases: ['japan', 'tokyo', 'osaka', 'kyoto', 'জাপান', 'জাপানে', 'টোকিও', 'ওসাকা'],
  },
  {
    iana: 'Australia/Sydney',
    labelEn: 'Australia (Sydney / Melbourne)',
    labelBn: 'অস্ট্রেলিয়া (সিডনি / মেলবোর্ন)',
    countryEn: 'Australia',
    additionalZones: [
      { iana: 'Australia/Perth', labelEn: 'Western (Perth)', labelBn: 'ওয়েস্টার্ন (পার্থ)' },
    ],
    aliases: ['australia', 'sydney', 'melbourne', 'canberra', 'অস্ট্রেলিয়া', 'অস্ট্রেলিয়া', 'সিডনি', 'মেলবোর্ন'],
  },
  {
    iana: 'Europe/Berlin',
    labelEn: 'Germany (Berlin)',
    labelBn: 'জার্মানি (বার্লিন)',
    countryEn: 'Germany',
    aliases: ['germany', 'berlin', 'munich', 'frankfurt', 'জার্মানি', 'বার্লিন', 'মিউনিখ'],
  },
  {
    iana: 'Europe/Paris',
    labelEn: 'France (Paris)',
    labelBn: 'ফ্রান্স (প্যারিস)',
    countryEn: 'France',
    aliases: ['france', 'paris', 'ফ্রান্স', 'প্যারিস'],
  },
  {
    iana: 'Asia/Riyadh',
    labelEn: 'Saudi Arabia (Riyadh / Makkah)',
    labelBn: 'সৌদি আরব (রিয়াদ / মক্কা)',
    countryEn: 'Saudi Arabia',
    aliases: ['saudi arabia', 'saudi', 'riyadh', 'makkah', 'mecca', 'madinah', 'medina', 'jeddah', 'সৌদি আরব', 'সৌদি', 'রিয়াদ', 'রিয়াদ', 'মক্কা', 'মদিনা', 'জেদ্দা'],
  },
  {
    iana: 'Asia/Dubai',
    labelEn: 'United Arab Emirates (Dubai / Abu Dhabi)',
    labelBn: 'সংযুক্ত আরব আমিরাত (দুবাই)',
    countryEn: 'United Arab Emirates',
    aliases: ['uae', 'united arab emirates', 'dubai', 'abu dhabi', 'sharjah', 'দুবাই', 'আবুধাবি', 'আরব আমিরাত', 'আমিরাত'],
  },
  {
    iana: 'Asia/Qatar',
    labelEn: 'Qatar (Doha)',
    labelBn: 'কাতার (দোহা)',
    countryEn: 'Qatar',
    aliases: ['qatar', 'doha', 'কাতার', 'দোহা'],
  },
  {
    iana: 'Asia/Kuwait',
    labelEn: 'Kuwait',
    labelBn: 'কুয়েত',
    countryEn: 'Kuwait',
    aliases: ['kuwait', 'কুয়েত', 'কুয়েত'],
  },
  {
    iana: 'Asia/Muscat',
    labelEn: 'Oman (Muscat)',
    labelBn: 'ওমান (মাস্কাট)',
    countryEn: 'Oman',
    aliases: ['oman', 'muscat', 'ওমান', 'মাস্কাট'],
  },
  {
    iana: 'Asia/Singapore',
    labelEn: 'Singapore',
    labelBn: 'সিঙ্গাপুর',
    countryEn: 'Singapore',
    aliases: ['singapore', 'সিঙ্গাপুর'],
  },
  {
    iana: 'Asia/Kuala_Lumpur',
    labelEn: 'Malaysia (Kuala Lumpur)',
    labelBn: 'মালয়েশিয়া (কুয়ালালামপুর)',
    countryEn: 'Malaysia',
    aliases: ['malaysia', 'kuala lumpur', 'মালয়েশিয়া', 'মালয়েশিয়া', 'কুয়ালালামপুর'],
  },
  {
    iana: 'Asia/Seoul',
    labelEn: 'South Korea (Seoul)',
    labelBn: 'দক্ষিণ কোরিয়া (সিউল)',
    countryEn: 'South Korea',
    aliases: ['south korea', 'korea', 'seoul', 'দক্ষিণ কোরিয়া', 'কোরিয়া', 'সিউল'],
  },
  {
    iana: 'Asia/Bangkok',
    labelEn: 'Thailand (Bangkok)',
    labelBn: 'থাইল্যান্ড (ব্যাংকক)',
    countryEn: 'Thailand',
    aliases: ['thailand', 'bangkok', 'থাইল্যান্ড', 'ব্যাংকক'],
  },
  {
    iana: 'Asia/Jakarta',
    labelEn: 'Indonesia (Jakarta)',
    labelBn: 'ইন্দোনেশিয়া (জাকার্তা)',
    countryEn: 'Indonesia',
    aliases: ['indonesia', 'jakarta', 'ইন্দোনেশিয়া', 'জাকার্তা'],
  },
  {
    iana: 'Asia/Kathmandu',
    labelEn: 'Nepal (Kathmandu)',
    labelBn: 'নেপাল (কাঠমান্ডু)',
    countryEn: 'Nepal',
    aliases: ['nepal', 'kathmandu', 'নেপাল', 'কাঠমান্ডু'],
  },
  {
    iana: 'Europe/Istanbul',
    labelEn: 'Turkey (Istanbul / Ankara)',
    labelBn: 'তুরস্ক (ইস্তাম্বুল)',
    countryEn: 'Turkey',
    aliases: ['turkey', 'turkiye', 'istanbul', 'ankara', 'তুরস্ক', 'ইস্তাম্বুল'],
  },
  {
    iana: 'Europe/Rome',
    labelEn: 'Italy (Rome)',
    labelBn: 'ইতালি (রোম)',
    countryEn: 'Italy',
    aliases: ['italy', 'rome', 'milan', 'ইতালি', 'রোম', 'মিলান'],
  },
  {
    iana: 'Europe/Madrid',
    labelEn: 'Spain (Madrid)',
    labelBn: 'স্পেন (মাদ্রিদ)',
    countryEn: 'Spain',
    aliases: ['spain', 'madrid', 'barcelona', 'স্পেন', 'মাদ্রিদ', 'বার্সেলোনা'],
  },
  {
    iana: 'Europe/Moscow',
    labelEn: 'Russia (Moscow)',
    labelBn: 'রাশিয়া (মস্কো)',
    countryEn: 'Russia',
    aliases: ['russia', 'moscow', 'রাশিয়া', 'রাশিয়া', 'মস্কো'],
  },
  {
    iana: 'Africa/Cairo',
    labelEn: 'Egypt (Cairo)',
    labelBn: 'মিশর (কায়রো)',
    countryEn: 'Egypt',
    aliases: ['egypt', 'cairo', 'মিশর', 'কায়রো'],
  },
  {
    iana: 'America/Sao_Paulo',
    labelEn: 'Brazil (São Paulo)',
    labelBn: 'ব্রাজিল (সাও পাওলো)',
    countryEn: 'Brazil',
    aliases: ['brazil', 'sao paulo', 'rio', 'ব্রাজিল'],
  },
  {
    iana: 'Pacific/Auckland',
    labelEn: 'New Zealand (Auckland)',
    labelBn: 'নিউজিল্যান্ড (অকল্যান্ড)',
    countryEn: 'New Zealand',
    aliases: ['new zealand', 'auckland', 'wellington', 'নিউজিল্যান্ড', 'অকল্যান্ড'],
  },
  {
    iana: 'UTC',
    labelEn: 'UTC / GMT',
    labelBn: 'ইউটিসি / জিএমটি',
    aliases: ['utc', 'gmt'],
  },
];

export function isValidIanaTimezone(tz: string): boolean {
  const clean = (tz || '').trim();
  if (!clean) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clean });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(input?: string | null, fallbackTimezone = DEFAULT_BANGLADESH_TIMEZONE): ResolvedTimezoneInfo {
  const raw = (input || '').normalize('NFC').trim();
  if (!raw) {
    const fallbackMatch = LOCATION_TIMEZONES.find((z) => z.iana === fallbackTimezone);
    if (fallbackMatch) return fallbackMatch;
    return {
      iana: isValidIanaTimezone(fallbackTimezone) ? fallbackTimezone : DEFAULT_BANGLADESH_TIMEZONE,
      labelEn: fallbackTimezone,
      labelBn: fallbackTimezone,
    };
  }

  // 1. Direct valid IANA timezone string (e.g. "America/New_York", "Asia/Tokyo")
  if (raw.includes('/') || raw.toUpperCase() === 'UTC') {
    if (isValidIanaTimezone(raw)) {
      const known = LOCATION_TIMEZONES.find((z) => z.iana.toLowerCase() === raw.toLowerCase());
      if (known) return known;
      return {
        iana: raw,
        labelEn: raw.replace(/_/g, ' '),
        labelBn: raw.replace(/_/g, ' '),
      };
    }
  }

  const lower = raw.toLowerCase().replace(/[।.,!?'"()]/g, ' ').replace(/\s+/g, ' ').trim();

  // 2. Exact alias match
  for (const entry of LOCATION_TIMEZONES) {
    if (entry.aliases.some((a) => a.toLowerCase() === lower)) {
      return entry;
    }
  }

  // 3. Substring alias match (longest alias first so "new york" beats "us")
  let best: { entry: LocationZoneEntry; len: number } | null = null;
  for (const entry of LOCATION_TIMEZONES) {
    for (const alias of entry.aliases) {
      const a = alias.toLowerCase();
      if (a.length >= 2 && lower.includes(a)) {
        if (!best || a.length > best.len) {
          best = { entry, len: a.length };
        }
      }
    }
  }
  if (best) return best.entry;

  // 4. Safe fallback to configured timezone
  const fb = LOCATION_TIMEZONES.find((z) => z.iana === fallbackTimezone) || LOCATION_TIMEZONES[0];
  return fb;
}

function getZonedDateParts(date: Date, timeZone: string): {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  second: number;
  weekdayIndex: number; // 0 (Sun) .. 6 (Sat)
  utcOffset: string;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });
  const parts = dtf.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  let hour = Number(pick('hour')) || 0;
  if (hour === 24) hour = 0;

  return {
    year: Number(pick('year')) || date.getUTCFullYear(),
    month: Number(pick('month')) || date.getUTCMonth() + 1,
    day: Number(pick('day')) || date.getUTCDate(),
    hour,
    minute: Number(pick('minute')) || 0,
    second: Number(pick('second')) || 0,
    weekdayIndex: wdMap[pick('weekday')] ?? date.getUTCDay(),
    utcOffset: pick('timeZoneName') || 'GMT',
  };
}

function getOffsetMinutesForDate(date: Date, timeZone: string): number {
  const p = getZonedDateParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function detectDstActive(date: Date, timeZone: string): boolean {
  try {
    const year = date.getUTCFullYear();
    const jan = getOffsetMinutesForDate(new Date(Date.UTC(year, 0, 1, 12, 0, 0)), timeZone);
    const jul = getOffsetMinutesForDate(new Date(Date.UTC(year, 6, 1, 12, 0, 0)), timeZone);
    if (jan === jul) return false;
    const std = Math.min(jan, jul);
    const cur = getOffsetMinutesForDate(date, timeZone);
    return cur > std;
  } catch {
    return false;
  }
}

function getBengaliPeriodOfDay(hour24: number): string {
  if (hour24 >= 4 && hour24 < 6) return 'ভোর';
  if (hour24 >= 6 && hour24 < 12) return 'সকাল';
  if (hour24 >= 12 && hour24 < 15) return 'দুপুর';
  if (hour24 >= 15 && hour24 < 18) return 'বিকাল';
  if (hour24 >= 18 && hour24 < 20) return 'সন্ধ্যা';
  return 'রাত';
}

function formatClock(hour24: number, minute: number): {
  time12En: string;
  time24: string;
  time12Bn: string;
  periodBn: string;
} {
  const mm = String(minute).padStart(2, '0');
  const hh24 = String(hour24).padStart(2, '0');
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const periodBn = getBengaliPeriodOfDay(hour24);
  return {
    time12En: `${h12}:${mm} ${ampm}`,
    time24: `${hh24}:${mm}`,
    time12Bn: `${periodBn} ${toBengaliDigits(h12)}:${toBengaliDigits(mm)}`,
    periodBn,
  };
}

export function getCurrentTime(
  timezoneOrLocation?: string | null,
  fallbackTimezone = DEFAULT_BANGLADESH_TIMEZONE,
  now: Date = new Date(),
): LiveTimeResult {
  const resolved = resolveTimezone(timezoneOrLocation, fallbackTimezone);
  const p = getZonedDateParts(now, resolved.iana);
  const clock = formatClock(p.hour, p.minute);
  const isoDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

  const additionalZones = resolved.additionalZones?.map((az) => {
    const zp = getZonedDateParts(now, az.iana);
    const zc = formatClock(zp.hour, zp.minute);
    return {
      timezone: az.iana,
      labelEn: az.labelEn,
      labelBn: az.labelBn,
      time12En: zc.time12En,
      time12Bn: zc.time12Bn,
      utcOffset: zp.utcOffset,
    };
  });

  return {
    ok: true,
    requestedInput: (timezoneOrLocation || '').trim() || resolved.iana,
    timezone: resolved.iana,
    locationLabelEn: resolved.labelEn,
    locationLabelBn: resolved.labelBn,
    isoTimestamp: now.toISOString(),
    time12En: clock.time12En,
    time24: clock.time24,
    time12Bn: clock.time12Bn,
    periodBn: clock.periodBn,
    weekdayEn: WEEKDAYS_EN[p.weekdayIndex],
    weekdayBn: WEEKDAYS_BN[p.weekdayIndex],
    gregorianDateIso: isoDate,
    gregorianDateEn: `${GREGORIAN_MONTHS_EN[p.month - 1]} ${p.day}, ${p.year}`,
    gregorianDateBn: `${toBengaliDigits(p.day)} ${GREGORIAN_MONTHS_BN[p.month - 1]} ${toBengaliDigits(p.year)}`,
    utcOffset: p.utcOffset,
    isDst: detectDstActive(now, resolved.iana),
    ...(additionalZones ? { additionalZones } : {}),
  };
}

export function isGregorianLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Official 2019 Revised Bangladesh Government Bangla Calendar (Bangla Academy):
 * - Pohela Boishakh = April 14 every year.
 * - Boishakh through Ashwin (months 1–6) = 31 days each (6 × 31 = 186 days).
 * - Kartik through Magh (months 7–10) = 30 days each.
 * - Falgun (month 11) = 29 days in a common Gregorian year, 30 days in a leap year.
 * - Chaitro (month 12) = 30 days.
 * Ensures 21 Feb = 8 Falgun, 26 Mar = 12 Chaitro, 16 Dec = 1 Poush every year.
 */
export function convertBengaliDate(
  gregorianDate?: string | Date | null,
  timezone = DEFAULT_BANGLADESH_TIMEZONE,
): BengaliDateResult {
  const tz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_BANGLADESH_TIMEZONE;

  let year: number;
  let month: number;
  let day: number;
  let weekdayIndex: number;

  if (typeof gregorianDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(gregorianDate.trim())) {
    const [y, m, d] = gregorianDate.trim().split('-').map(Number);
    year = y;
    month = m;
    day = d;
    weekdayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  } else {
    const dObj = gregorianDate instanceof Date ? gregorianDate : new Date();
    const p = getZonedDateParts(dObj, tz);
    year = p.year;
    month = p.month;
    day = p.day;
    weekdayIndex = p.weekdayIndex;
  }

  const isOnOrAfterPohelaBoishakh = month > 4 || (month === 4 && day >= 14);
  const banglaYear = isOnOrAfterPohelaBoishakh ? year - 593 : year - 594;
  const boishakhStartGregorianYear = isOnOrAfterPohelaBoishakh ? year : year - 1;
  // Falgun falls in Feb–Mar of (boishakhStartGregorianYear + 1)
  const falgunGregorianYear = boishakhStartGregorianYear + 1;
  const falgunDays = isGregorianLeapYear(falgunGregorianYear) ? 30 : 29;

  const monthLengths = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, falgunDays, 30];

  const startUtcMs = Date.UTC(boishakhStartGregorianYear, 3, 14); // April 14 (0-indexed month 3)
  const targetUtcMs = Date.UTC(year, month - 1, day);
  let dayOffset = Math.floor((targetUtcMs - startUtcMs) / 86_400_000);
  if (dayOffset < 0) dayOffset = 0;

  let monthIdx = 0;
  while (monthIdx < 11 && dayOffset >= monthLengths[monthIdx]) {
    dayOffset -= monthLengths[monthIdx];
    monthIdx++;
  }
  const banglaDay = dayOffset + 1;
  const monthMeta = BANGLA_MONTHS[monthIdx];
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    ok: true,
    calendarStandard: 'Bangladesh Government Revised Bangla Calendar (2019 Bangla Academy)',
    timezone: tz,
    gregorianDateIso: iso,
    year: banglaYear,
    yearBn: toBengaliDigits(banglaYear),
    monthIndex: monthIdx + 1,
    monthEn: monthMeta.en,
    monthBn: monthMeta.bn,
    day: banglaDay,
    dayBn: toBengaliDigits(banglaDay),
    seasonEn: monthMeta.seasonEn,
    seasonBn: monthMeta.seasonBn,
    weekdayEn: WEEKDAYS_EN[weekdayIndex],
    weekdayBn: WEEKDAYS_BN[weekdayIndex],
    formattedBn: `${toBengaliDigits(banglaDay)} ${monthMeta.bn} ${toBengaliDigits(banglaYear)} বঙ্গাব্দ`,
    formattedEn: `${banglaDay} ${monthMeta.en} ${banglaYear} BS`,
  };
}

export function getHijriDate(
  gregorianDate?: string | Date | null,
  locationOrTimezone?: string | null,
): HijriDateResult {
  const resolved = resolveTimezone(locationOrTimezone, DEFAULT_BANGLADESH_TIMEZONE);
  const tz = resolved.iana;

  let targetDate: Date;
  let isoDate: string;

  if (typeof gregorianDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(gregorianDate.trim())) {
    const [y, m, d] = gregorianDate.trim().split('-').map(Number);
    targetDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    isoDate = gregorianDate.trim();
  } else {
    targetDate = gregorianDate instanceof Date ? gregorianDate : new Date();
    const p = getZonedDateParts(targetDate, tz);
    isoDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  let parts: Intl.DateTimeFormatPart[] = [];
  for (const locale of ['en-u-ca-islamic-umalqura', 'en-u-ca-islamic-civil', 'en-u-ca-islamic']) {
    try {
      const fmt = new Intl.DateTimeFormat(locale, {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
      parts = fmt.formatToParts(targetDate);
      if (parts.some((p) => p.type === 'year')) break;
    } catch {
      // try next calendar locale
    }
  }

  const getNum = (type: string) => {
    const raw = parts.find((p) => p.type === type)?.value || '';
    const digits = raw.replace(/[^\d]/g, '');
    return Number(digits) || 1;
  };

  const hYear = getNum('year');
  const hMonthIdx = Math.min(12, Math.max(1, getNum('month')));
  const hDay = Math.min(30, Math.max(1, getNum('day')));
  const meta = HIJRI_MONTHS[hMonthIdx - 1] || HIJRI_MONTHS[0];

  return {
    ok: true,
    calendarMethod: 'Islamic Umm al-Qura (astronomical reference)',
    timezone: tz,
    gregorianDateIso: isoDate,
    year: hYear,
    yearBn: toBengaliDigits(hYear),
    monthIndex: hMonthIdx,
    monthEn: meta.en,
    monthBn: meta.bn,
    day: hDay,
    dayBn: toBengaliDigits(hDay),
    formattedBn: `${toBengaliDigits(hDay)} ${meta.bn} ${toBengaliDigits(hYear)} হিজরি`,
    formattedEn: `${hDay} ${meta.en} ${hYear} AH`,
    moonSightingNoteBn: 'চাঁদ দেখার ওপর ভিত্তি করে স্থানীয়ভাবে হিজরি তারিখ ১ দিন কমবেশি হতে পারে।',
    moonSightingNoteEn: 'Islamic Hijri dates may differ by ±1 day depending on local moon-sighting practice.',
  };
}

export function getCurrentDate(
  timezoneOrLocation?: string | null,
  fallbackTimezone = DEFAULT_BANGLADESH_TIMEZONE,
  now: Date = new Date(),
): LiveDateResult {
  const resolved = resolveTimezone(timezoneOrLocation, fallbackTimezone);
  const p = getZonedDateParts(now, resolved.iana);
  const iso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

  // Official Bangladesh Bengali Calendar defaults to Asia/Dhaka unless another timezone is requested
  const bengali = convertBengaliDate(iso, resolved.iana);
  const hijri = getHijriDate(iso, resolved.iana);

  return {
    ok: true,
    timezone: resolved.iana,
    locationLabelEn: resolved.labelEn,
    locationLabelBn: resolved.labelBn,
    retrievedAtIso: now.toISOString(),
    gregorian: {
      iso,
      year: p.year,
      yearBn: toBengaliDigits(p.year),
      monthIndex: p.month,
      monthEn: GREGORIAN_MONTHS_EN[p.month - 1],
      monthBn: GREGORIAN_MONTHS_BN[p.month - 1],
      day: p.day,
      dayBn: toBengaliDigits(p.day),
      weekdayEn: WEEKDAYS_EN[p.weekdayIndex],
      weekdayBn: WEEKDAYS_BN[p.weekdayIndex],
      formattedEn: `${WEEKDAYS_EN[p.weekdayIndex]}, ${GREGORIAN_MONTHS_EN[p.month - 1]} ${p.day}, ${p.year}`,
      formattedBn: `${WEEKDAYS_BN[p.weekdayIndex]}, ${toBengaliDigits(p.day)} ${GREGORIAN_MONTHS_BN[p.month - 1]} ${toBengaliDigits(p.year)}`,
    },
    bengali,
    hijri,
  };
}
