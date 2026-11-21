/**
 * Real-time Weather & Multi-Day Forecast Intelligence powered by Open-Meteo
 * (free tier, no API key required, accurate WMO weather codes & coordinates).
 *
 * Strictly separates current observed conditions from forecasts, caches briefly
 * (10 min weather / 30 min geocode) to avoid duplicate calls, and never invents
 * weather data when a location is ambiguous or the service is unavailable.
 */

export interface DailyForecastItem {
  date: string;
  conditionEn: string;
  conditionBn: string;
  tempMaxC: number;
  tempMinC: number;
  rainProbabilityMaxPct: number | null;
  precipitationSumMm: number;
  snowfallSumCm: number;
  windSpeedMaxKmh: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherResult {
  ok: true;
  provider: 'Open-Meteo';
  cached: boolean;
  location: {
    name: string;
    admin1?: string;
    country: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    observedAt: string;
    temperatureC: number;
    feelsLikeC: number;
    conditionEn: string;
    conditionBn: string;
    weatherCode: number;
    humidityPct: number;
    windSpeedKmh: number;
    precipitationMm: number;
    snowfallCm: number;
    rainProbabilityNextHourPct: number | null;
    isDay: boolean;
  };
  todaySun: {
    sunrise: string;
    sunset: string;
  };
  dailyForecast: DailyForecastItem[];
  retrievedAtIso: string;
}

export interface WeatherErrorResult {
  ok: false;
  unavailable?: boolean;
  ambiguousLocation?: boolean;
  candidates?: string[];
  error: string;
  service: 'Open-Meteo Weather API';
}

export type WeatherResponse = WeatherResult | WeatherErrorResult;

interface GeocodeCandidate {
  name: string;
  admin1?: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population?: number;
}

const GEOCODE_TTL_MS = 30 * 60 * 1000;
const WEATHER_TTL_MS = 10 * 60 * 1000;

const geocodeCache = new Map<string, { at: number; results: GeocodeCandidate[] }>();
const weatherCache = new Map<string, { at: number; data: WeatherResult }>();

export function clearWeatherCacheForTests(): void {
  geocodeCache.clear();
  weatherCache.clear();
}

const BENGALI_LOCATION_MAP: Record<string, string> = {
  'ঢাকা': 'Dhaka',
  'ঢাকায়': 'Dhaka',
  'ঢাকায়': 'Dhaka',
  'চট্টগ্রাম': 'Chattogram',
  'সিলেট': 'Sylhet',
  'খুলনা': 'Khulna',
  'রাজশাহী': 'Rajshahi',
  'বরিশাল': 'Barishal',
  'রংপুর': 'Rangpur',
  'ময়মনসিংহ': 'Mymensingh',
  'ময়মনসিংহ': 'Mymensingh',
  'কুমিল্লা': 'Comilla',
  'নোয়াখালী': 'Noakhali',
  'কক্সবাজার': 'Coxs Bazar',
  'বাংলাদেশ': 'Dhaka',
  'কলকাতা': 'Kolkata',
  'দিল্লি': 'New Delhi',
  'মুম্বাই': 'Mumbai',
  'নিউইয়র্ক': 'New York',
  'নিউইয়র্ক': 'New York',
  'নিউ ইয়র্ক': 'New York',
  'নিউ ইয়র্ক': 'New York',
  'আমেরিকা': 'New York',
  'যুক্তরাষ্ট্র': 'New York',
  'লন্ডন': 'London',
  'যুক্তরাজ্য': 'London',
  'কানাডা': 'Toronto',
  'টরন্টো': 'Toronto',
  'ভ্যাঙ্কুভার': 'Vancouver',
  'মন্ট্রিয়ল': 'Montreal',
  'ক্যালগারি': 'Calgary',
  'অটোয়া': 'Ottawa',
  'টোকিও': 'Tokyo',
  'জাপান': 'Tokyo',
  'দুবাই': 'Dubai',
  'আবুধাবি': 'Abu Dhabi',
  'রিয়াদ': 'Riyadh',
  'রিয়াদ': 'Riyadh',
  'মক্কা': 'Mecca',
  'মদিনা': 'Medina',
  'প্যারিস': 'Paris',
  'বার্লিন': 'Berlin',
  'সিডনি': 'Sydney',
  'মেলবোর্ন': 'Melbourne',
  'সিঙ্গাপুর': 'Singapore',
  'কুয়ালালামপুর': 'Kuala Lumpur',
  'ইসলামাবাদ': 'Islamabad',
  'করাচি': 'Karachi',
  'লাহোর': 'Lahore',
  'বেইজিং': 'Beijing',
  'সাংহাই': 'Shanghai',
  'কাঠমান্ডু': 'Kathmandu',
  'ইস্তাম্বুল': 'Istanbul',
  'দোহা': 'Doha',
};

export function normalizeWeatherLocationQuery(rawLocation: string): string {
  const cleaned = (rawLocation || '')
    .normalize('NFC')
    .replace(/[।.,!?'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  // Exact match in Bengali map
  if (BENGALI_LOCATION_MAP[cleaned]) return BENGALI_LOCATION_MAP[cleaned];

  // Strip common Bengali locative suffixes (এ / য় / য় / র / এর)
  for (const [bn, en] of Object.entries(BENGALI_LOCATION_MAP)) {
    if (cleaned.includes(bn)) return en;
  }

  return cleaned;
}

export function describeWmoWeatherCode(code: number): { en: string; bn: string } {
  if (code === 0) return { en: 'Clear sky', bn: 'পরিষ্কার আকাশ' };
  if (code === 1) return { en: 'Mainly clear', bn: 'প্রায় পরিষ্কার আকাশ' };
  if (code === 2) return { en: 'Partly cloudy', bn: 'আংশিক মেঘলা' };
  if (code === 3) return { en: 'Overcast', bn: 'ঘন মেঘলা' };
  if (code === 45 || code === 48) return { en: 'Foggy', bn: 'কুয়াশাচ্ছন্ন' };
  if (code === 51 || code === 53 || code === 55) return { en: 'Drizzle', bn: 'গুঁড়ি গুঁড়ি বৃষ্টি' };
  if (code === 56 || code === 57) return { en: 'Freezing drizzle', bn: 'হিমশীতল গুঁড়ি বৃষ্টি' };
  if (code === 61) return { en: 'Light rain', bn: 'হালকা বৃষ্টি' };
  if (code === 63) return { en: 'Moderate rain', bn: 'মাঝারি বৃষ্টি' };
  if (code === 65) return { en: 'Heavy rain', bn: 'ভারী বৃষ্টি' };
  if (code === 66 || code === 67) return { en: 'Freezing rain', bn: 'হিমশীতল বৃষ্টি' };
  if (code === 71) return { en: 'Light snowfall', bn: 'হালকা তুষারপাত' };
  if (code === 73) return { en: 'Moderate snowfall', bn: 'মাঝারি তুষারপাত' };
  if (code === 75) return { en: 'Heavy snowfall', bn: 'ভারী তুষারপাত' };
  if (code === 77) return { en: 'Snow grains', bn: 'তুষারকণা' };
  if (code === 80) return { en: 'Light rain showers', bn: 'হালকা দমকা বৃষ্টি' };
  if (code === 81) return { en: 'Moderate rain showers', bn: 'মাঝারি দমকা বৃষ্টি' };
  if (code === 82) return { en: 'Heavy rain showers', bn: 'ভারী দমকা বৃষ্টি' };
  if (code === 85 || code === 86) return { en: 'Snow showers', bn: 'তুষারঝড় / তুষারপাত' };
  if (code === 95) return { en: 'Thunderstorm', bn: 'বজ্রসহ বৃষ্টি' };
  if (code === 96 || code === 99) return { en: 'Thunderstorm with hail', bn: 'শিলাবৃষ্টিসহ বজ্রঝড়' };
  return { en: 'Variable weather', bn: 'পরিবর্তনশীল আবহাওয়া' };
}

async function geocodeLocation(
  locationQuery: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; candidates: GeocodeCandidate[] } | { ok: false; error: string; unavailable?: boolean }> {
  const normalized = normalizeWeatherLocationQuery(locationQuery);
  if (!normalized) {
    return { ok: false, error: 'Please specify a city or location name.' };
  }

  const cacheKey = normalized.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GEOCODE_TTL_MS) {
    return { ok: true, candidates: cached.results };
  }

  const params = new URLSearchParams({
    name: normalized,
    count: '5',
    language: 'en',
    format: 'json',
  });

  try {
    const res = await fetchFn(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) {
      return {
        ok: false,
        unavailable: true,
        error: `Open-Meteo geocoding returned HTTP ${res.status}.`,
      };
    }
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const candidates: GeocodeCandidate[] = (json.results || []).map((r) => ({
      name: String(r.name || ''),
      admin1: r.admin1 ? String(r.admin1) : undefined,
      country: String(r.country || ''),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timezone: String(r.timezone || 'UTC'),
      population: typeof r.population === 'number' ? r.population : undefined,
    }));

    if (candidates.length > 0) {
      geocodeCache.set(cacheKey, { at: Date.now(), results: candidates });
    }
    return { ok: true, candidates };
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Network error reaching Open-Meteo geocoding.',
    };
  }
}

export async function fetchWeatherForLocation(
  locationQuery: string,
  days = 5,
  fetchFn: typeof fetch = fetch,
): Promise<WeatherResponse> {
  const clampedDays = Math.min(7, Math.max(1, Math.round(Number(days) || 5)));
  const trimmed = (locationQuery || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      ambiguousLocation: true,
      error: 'Location is unclear. Please ask the user which city or country they want weather for.',
      service: 'Open-Meteo Weather API',
    };
  }

  const geo = await geocodeLocation(trimmed, fetchFn);
  if (!geo.ok) {
    return {
      ok: false,
      unavailable: geo.unavailable,
      error: geo.error,
      service: 'Open-Meteo Weather API',
    };
  }

  if (geo.candidates.length === 0) {
    return {
      ok: false,
      ambiguousLocation: true,
      error: `Could not find coordinates for "${trimmed}". Ask the user to clarify the city or country name.`,
      service: 'Open-Meteo Weather API',
    };
  }

  // Pick highest-population / top ranked match
  const best = geo.candidates[0];
  const cacheKey = `${best.latitude.toFixed(3)},${best.longitude.toFixed(3)}:${clampedDays}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.at < WEATHER_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const params = new URLSearchParams({
    latitude: String(best.latitude),
    longitude: String(best.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,snowfall,weather_code,wind_speed_10m',
    hourly: 'precipitation_probability',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,snowfall_sum,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: String(clampedDays),
  });

  try {
    const res = await fetchFn(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return {
        ok: false,
        unavailable: true,
        error: `Open-Meteo forecast returned HTTP ${res.status}.`,
        service: 'Open-Meteo Weather API',
      };
    }

    const json = (await res.json()) as {
      timezone?: string;
      current?: Record<string, unknown>;
      hourly?: { time?: string[]; precipitation_probability?: Array<number | null> };
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        sunrise?: string[];
        sunset?: string[];
        precipitation_probability_max?: Array<number | null>;
        precipitation_sum?: number[];
        snowfall_sum?: number[];
        wind_speed_10m_max?: number[];
      };
    };

    const cur = json.current || {};
    const curTime = String(cur.time || new Date().toISOString());
    const curCode = Number(cur.weather_code ?? 0);
    const curDesc = describeWmoWeatherCode(curCode);

    // Match nearest hourly precipitation probability to current local hour
    let nextHourRainProb: number | null = null;
    if (json.hourly?.time && json.hourly?.precipitation_probability) {
      const hourPrefix = curTime.slice(0, 13);
      const idx = json.hourly.time.findIndex((t) => t.startsWith(hourPrefix));
      const val = idx >= 0 ? json.hourly.precipitation_probability[idx] : json.hourly.precipitation_probability[0];
      if (typeof val === 'number' && Number.isFinite(val)) nextHourRainProb = val;
    }

    const dailyTimes = json.daily?.time || [];
    const dailyForecast: DailyForecastItem[] = dailyTimes.map((dateStr, i) => {
      const code = Number(json.daily?.weather_code?.[i] ?? 0);
      const d = describeWmoWeatherCode(code);
      const prob = json.daily?.precipitation_probability_max?.[i];
      return {
        date: dateStr,
        conditionEn: d.en,
        conditionBn: d.bn,
        tempMaxC: Number(json.daily?.temperature_2m_max?.[i] ?? 0),
        tempMinC: Number(json.daily?.temperature_2m_min?.[i] ?? 0),
        rainProbabilityMaxPct: typeof prob === 'number' ? prob : null,
        precipitationSumMm: Number(json.daily?.precipitation_sum?.[i] ?? 0),
        snowfallSumCm: Number(json.daily?.snowfall_sum?.[i] ?? 0),
        windSpeedMaxKmh: Number(json.daily?.wind_speed_10m_max?.[i] ?? 0),
        sunrise: String(json.daily?.sunrise?.[i] || ''),
        sunset: String(json.daily?.sunset?.[i] || ''),
      };
    });

    const result: WeatherResult = {
      ok: true,
      provider: 'Open-Meteo',
      cached: false,
      location: {
        name: best.name,
        admin1: best.admin1,
        country: best.country,
        latitude: best.latitude,
        longitude: best.longitude,
        timezone: String(json.timezone || best.timezone || 'UTC'),
      },
      current: {
        observedAt: curTime,
        temperatureC: Number(cur.temperature_2m ?? 0),
        feelsLikeC: Number(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
        conditionEn: curDesc.en,
        conditionBn: curDesc.bn,
        weatherCode: curCode,
        humidityPct: Number(cur.relative_humidity_2m ?? 0),
        windSpeedKmh: Number(cur.wind_speed_10m ?? 0),
        precipitationMm: Number(cur.precipitation ?? 0),
        snowfallCm: Number(cur.snowfall ?? 0),
        rainProbabilityNextHourPct: nextHourRainProb,
        isDay: Number(cur.is_day ?? 1) === 1,
      },
      todaySun: {
        sunrise: dailyForecast[0]?.sunrise || '',
        sunset: dailyForecast[0]?.sunset || '',
      },
      dailyForecast,
      retrievedAtIso: new Date().toISOString(),
    };

    weatherCache.set(cacheKey, { at: Date.now(), data: result });
    return result;
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      error: err instanceof Error ? err.message : 'Failed to fetch live weather from Open-Meteo.',
      service: 'Open-Meteo Weather API',
    };
  }
}
