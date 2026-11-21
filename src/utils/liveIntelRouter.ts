/**
 * Universal Real-Time Information Tool Router & Official Google Search Grounding
 * integration for TIYA AI.
 *
 * Shared cleanly between the Express backend (`server.ts`, using `@google/genai`)
 * and static/offline fallback mode (`src/lib/clientApi.ts`, using Gemini REST).
 *
 * Capabilities:
 * 1. google_search(query, country?, language?, recency?)
 * 2. get_current_time(timezone?, location?)
 * 3. get_current_date(timezone?, location?)
 * 4. get_weather(location, date?)
 * 5. get_forecast(location, days?)
 * 6. convert_bengali_date(gregorian_date?, timezone?)
 * 7. get_hijri_date(date?, location?)
 * 8. research_topic(topic, depth?)
 * 9. verify_claim(claim)
 */

import {
  GroundingSearchSuggestion,
  GroundingSource,
  LiveSearchMetadata,
} from '../types/tiya';
import {
  convertBengaliDate,
  DEFAULT_BANGLADESH_TIMEZONE,
  getCurrentDate,
  getCurrentTime,
  getHijriDate,
} from './worldTimeCalendar';
import { fetchWeatherForLocation } from './weatherService';

export interface IntelToolSchema {
  name: string;
  description: string;
  behavior?: 'NON_BLOCKING';
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export function buildLiveIntelToolSchemas(nonBlocking = false): IntelToolSchema[] {
  const nb = nonBlocking ? { behavior: 'NON_BLOCKING' as const } : {};
  return [
    {
      name: 'google_search',
      description:
        'Performs a real live Google Search via official Gemini Google Search Grounding. Use whenever the user asks about today’s news, current world/country events, breaking developments, technology/AI releases, business, economy, government announcements, sports scores, or changing facts. NEVER guess current events.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          query: {
            type: 'STRING',
            description: 'Focused search query (include specific topic, country/city, and current year/date context if relevant).',
          },
          country: {
            type: 'STRING',
            description: 'Optional country or region name (e.g. United States, Canada, Bangladesh, Europe, Japan).',
          },
          language: {
            type: 'STRING',
            description: 'Optional preferred response/search language (e.g. Bengali or English).',
          },
          recency: {
            type: 'STRING',
            description: 'Freshness focus: day, week, month, or any.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_current_time',
      description:
        'Returns the exact live current local time using the real server clock and IANA timezone database (DST-aware). Use whenever the user asks what time it is now anywhere in the world (e.g., Bangladesh, USA, Canada, London, Japan).',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          timezone: {
            type: 'STRING',
            description: 'IANA timezone (e.g. Asia/Dhaka, America/New_York, Europe/London, America/Toronto, Asia/Tokyo) or city/country name in Bengali or English.',
          },
          location: {
            type: 'STRING',
            description: 'Optional city or country name if timezone is omitted (e.g. ঢাকা, আমেরিকা, লন্ডন, কানাডা, জাপান).',
          },
        },
      },
    },
    {
      name: 'get_current_date',
      description:
        'Returns today’s exact live Gregorian date/year/weekday, Official 2019 Revised Bangladesh Bengali calendar date, and Islamic Hijri date (with moon-sighting note).',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          timezone: {
            type: 'STRING',
            description: 'IANA timezone or location name (defaults to Asia/Dhaka).',
          },
        },
      },
    },
    {
      name: 'convert_bengali_date',
      description:
        'Converts today or a given Gregorian date (YYYY-MM-DD) to the Official 2019 Revised Bangladesh Government Bangla Calendar (Bangla Academy standard, default Asia/Dhaka).',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          gregorian_date: {
            type: 'STRING',
            description: 'Optional Gregorian date in YYYY-MM-DD format. Omit for today.',
          },
          timezone: {
            type: 'STRING',
            description: 'Optional IANA timezone (defaults to Asia/Dhaka).',
          },
        },
      },
    },
    {
      name: 'get_hijri_date',
      description:
        'Returns the Islamic Hijri date for today or a specified Gregorian date, with local moon-sighting disclosure.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          date: {
            type: 'STRING',
            description: 'Optional Gregorian date in YYYY-MM-DD format. Omit for today.',
          },
          location: {
            type: 'STRING',
            description: 'Optional city, country, or timezone (defaults to Asia/Dhaka).',
          },
        },
      },
    },
    {
      name: 'get_weather',
      description:
        'Retrieves real live current weather conditions and today’s forecast from Open-Meteo (temperature, feels-like, condition, rain probability, humidity, wind, sunrise/sunset). NEVER invent weather.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          location: {
            type: 'STRING',
            description: 'City or place name in English or Bengali (e.g. Dhaka, New York, Toronto, London, ঢাকা, নিউইয়র্ক).',
          },
          date: {
            type: 'STRING',
            description: 'Optional target date (today, tomorrow, or YYYY-MM-DD).',
          },
        },
        required: ['location'],
      },
    },
    {
      name: 'get_forecast',
      description:
        'Retrieves a real multi-day weather forecast (1–7 days) for a city or location from Open-Meteo, distinguishing current conditions from daily forecast.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          location: {
            type: 'STRING',
            description: 'City or place name in English or Bengali.',
          },
          days: {
            type: 'NUMBER',
            description: 'Number of forecast days (1 to 7, default 5).',
          },
        },
        required: ['location'],
      },
    },
    {
      name: 'research_topic',
      description:
        'Performs structured multi-angle live Google Search research on new scientific discoveries, AI models, technology releases, medicine, space, engineering, business, or complex current affairs—separating official announcements, published research, news reports, and unconfirmed rumors.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          topic: {
            type: 'STRING',
            description: 'Topic, discovery, technology, or current affairs subject to research.',
          },
          depth: {
            type: 'STRING',
            description: 'brief or deep (default deep).',
          },
        },
        required: ['topic'],
      },
    },
    {
      name: 'verify_claim',
      description:
        'Cross-checks an important factual claim or breaking rumor across multiple independent reputable sources (official government, company announcements, scientific journals, major international news) and reports consensus or disagreements.',
      ...nb,
      parameters: {
        type: 'OBJECT',
        properties: {
          claim: {
            type: 'STRING',
            description: 'The specific claim, breaking rumor, or disputed statement to verify.',
          },
        },
        required: ['claim'],
      },
    },
  ];
}

export const LIVE_INTEL_TOOL_NAMES = new Set<string>([
  'google_search',
  'get_current_time',
  'get_current_date',
  'convert_bengali_date',
  'get_hijri_date',
  'get_weather',
  'get_forecast',
  'research_topic',
  'verify_claim',
]);

export function isLiveIntelToolName(name: string): boolean {
  return LIVE_INTEL_TOOL_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Safe URL validation, Source Tier classification & Grounding extraction
// ---------------------------------------------------------------------------

export function sanitizeExternalUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

export function classifySourceTier(uriOrHost: string): GroundingSource['sourceTier'] {
  const lower = (uriOrHost || '').toLowerCase();
  if (/\.(?:gov|gov\.[a-z]{2}|mil|int|un\.org|who\.int|nasa\.gov|esa\.int|nih\.gov|cdc\.gov)/.test(lower)) {
    return 'official';
  }
  if (/(?:nature\.com|science\.org|arxiv\.org|thelancet\.com|nejm\.org|ieee\.org|acm\.org|mit\.edu|stanford\.edu|harvard\.edu|oxford\.ac|pubmed|sciencedirect)/.test(lower)) {
    return 'research';
  }
  if (/(?:reuters\.com|apnews\.com|bbc\.(?:com|co\.uk)|aljazeera\.com|nytimes\.com|theguardian\.com|washingtonpost\.com|bloomberg\.com|ft\.com|cbc\.ca|prothomalo\.com|thedailystar\.net|bdnews24\.com|dw\.com|france24\.com|nhk\.or\.jp|cnn\.com|npr\.org)/.test(lower)) {
    return 'news';
  }
  if (/(?:openai\.com|blog\.google|deepmind\.google|ai\.google|anthropic\.com|microsoft\.com|apple\.com|meta\.com|nvidia\.com|techcrunch\.com|theverge\.com|arstechnica\.com|wired\.com|github\.com)/.test(lower)) {
    return 'specialist';
  }
  return 'web';
}

function extractHostname(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Safely parses Google Search Suggestion links from `searchEntryPoint.renderedContent`
 * WITHOUT ever rendering raw HTML. Accepts ONLY validated Google Search / Vertex AI
 * Search suggestion links and falls back cleanly to `webSearchQueries`.
 */
export function extractSafeSearchSuggestions(
  groundingMetadata: any,
): GroundingSearchSuggestion[] {
  const out: GroundingSearchSuggestion[] = [];
  const seen = new Set<string>();

  const renderedHtml = typeof groundingMetadata?.searchEntryPoint?.renderedContent === 'string'
    ? groundingMetadata.searchEntryPoint.renderedContent
    : '';

  if (renderedHtml) {
    // Parse anchor href + inner text safely via regex (no DOM injection / no eval)
    const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchorRe.exec(renderedHtml)) !== null) {
      const safeHref = sanitizeExternalUrl(match[1].replace(/&amp;/g, '&'));
      if (!safeHref) continue;
      const host = extractHostname(safeHref).toLowerCase();
      const allowedHost =
        host === 'vertexaisearch.cloud.google.com' ||
        host === 'google.com' ||
        host.endsWith('.google.com');
      if (!allowedHost) continue;

      const label = match[2]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      if (label && !seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        out.push({ label: label.slice(0, 120), url: safeHref });
      }
      if (out.length >= 6) break;
    }
  }

  // Fallback to webSearchQueries as safe Google Search links if renderedContent didn't supply anchors
  const queries: string[] = Array.isArray(groundingMetadata?.webSearchQueries)
    ? groundingMetadata.webSearchQueries.filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];

  if (out.length === 0) {
    for (const q of queries.slice(0, 4)) {
      const clean = q.trim();
      if (!seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        out.push({
          label: clean.slice(0, 120),
          url: `https://www.google.com/search?q=${encodeURIComponent(clean)}`,
        });
      }
    }
  }

  return out;
}

export function extractGroundingMetadata(
  rawGroundingMetadata: any,
  usedTools: string[] = [],
): LiveSearchMetadata | null {
  if (!rawGroundingMetadata && usedTools.length === 0) return null;

  const sources: GroundingSource[] = [];
  const seenUris = new Set<string>();

  const chunks = Array.isArray(rawGroundingMetadata?.groundingChunks)
    ? rawGroundingMetadata.groundingChunks
    : [];

  for (const chunk of chunks) {
    const web = chunk?.web;
    if (!web) continue;
    const safeUri = sanitizeExternalUrl(web.uri);
    if (!safeUri || seenUris.has(safeUri)) continue;
    seenUris.add(safeUri);

    const host = extractHostname(safeUri);
    const title = String(web.title || host || 'Web source').trim().slice(0, 160);
    // Vertex grounding redirect URIs often put the real domain in web.title when domain isn't separate
    const publisher = String(web.domain || (host.includes('vertexaisearch.cloud.google.com') ? title : host) || 'Google Search')
      .trim()
      .slice(0, 80);

    sources.push({
      title,
      publisher,
      uri: safeUri,
      sourceTier: classifySourceTier(`${publisher} ${safeUri}`),
    });
  }

  const searchQueries: string[] = Array.isArray(rawGroundingMetadata?.webSearchQueries)
    ? Array.from(
        new Set(
          rawGroundingMetadata.webSearchQueries
            .filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q: string) => q.trim()),
        ),
      )
    : [];

  const searchSuggestions = extractSafeSearchSuggestions(rawGroundingMetadata);

  if (sources.length === 0 && searchQueries.length === 0 && searchSuggestions.length === 0 && usedTools.length === 0) {
    return null;
  }

  return {
    usedTools: Array.from(new Set(usedTools)),
    sources: sources.slice(0, 10),
    searchQueries: searchQueries.slice(0, 6),
    searchSuggestions,
    retrievedAt: new Date().toISOString(),
  };
}

export function mergeGroundingMetadata(
  items: Array<LiveSearchMetadata | null | undefined>,
): LiveSearchMetadata | undefined {
  const valid = items.filter((x): x is LiveSearchMetadata => Boolean(x));
  if (valid.length === 0) return undefined;

  const usedTools = new Set<string>();
  const sources: GroundingSource[] = [];
  const seenUris = new Set<string>();
  const queries = new Set<string>();
  const suggestions: GroundingSearchSuggestion[] = [];
  const seenSugg = new Set<string>();

  let searchFailed = false;
  let failureReason: string | undefined;
  let quotaExceeded = false;
  let retrievedAt = valid[valid.length - 1].retrievedAt || new Date().toISOString();

  for (const m of valid) {
    for (const t of m.usedTools || []) usedTools.add(t);
    for (const s of m.sources || []) {
      if (!seenUris.has(s.uri)) {
        seenUris.add(s.uri);
        sources.push(s);
      }
    }
    for (const q of m.searchQueries || []) queries.add(q);
    for (const sg of m.searchSuggestions || []) {
      const k = sg.label.toLowerCase();
      if (!seenSugg.has(k)) {
        seenSugg.add(k);
        suggestions.push(sg);
      }
    }
    if (m.searchFailed) {
      searchFailed = true;
      failureReason = m.failureReason || failureReason;
    }
    if (m.quotaExceeded) quotaExceeded = true;
    if (m.retrievedAt) retrievedAt = m.retrievedAt;
  }

  return {
    usedTools: Array.from(usedTools),
    sources: sources.slice(0, 10),
    searchQueries: Array.from(queries).slice(0, 6),
    searchSuggestions: suggestions.slice(0, 6),
    retrievedAt,
    ...(searchFailed ? { searchFailed, failureReason } : {}),
    ...(quotaExceeded ? { quotaExceeded } : {}),
  };
}

// ---------------------------------------------------------------------------
// Search Grounding Runner Interface + Short-TTL Cache
// ---------------------------------------------------------------------------

export interface GroundedSearchRunnerResult {
  ok: true;
  summary: string;
  grounding: LiveSearchMetadata;
}

export interface GroundedSearchRunnerError {
  ok: false;
  error: string;
  quotaExceeded?: boolean;
  unavailable?: boolean;
  service: 'Gemini Google Search Grounding';
  paidTierNote?: string;
}

export type GroundedSearchRunner = (params: {
  prompt: string;
  systemInstruction: string;
}) => Promise<GroundedSearchRunnerResult | GroundedSearchRunnerError>;

const SEARCH_CACHE_LIVE_TTL_MS = 3 * 60 * 1000; // 3 min for breaking/today queries
const SEARCH_CACHE_GENERAL_TTL_MS = 10 * 60 * 1000; // 10 min for general/research queries
const searchCache = new Map<string, { at: number; ttl: number; value: GroundedSearchRunnerResult }>();

export function clearSearchCacheForTests(): void {
  searchCache.clear();
}

export interface ToolExecutionOutcome {
  toolName: string;
  result: Record<string, unknown>;
  grounding?: LiveSearchMetadata;
}

function todayReferenceStamp(): string {
  const dhaka = getCurrentDate(DEFAULT_BANGLADESH_TIMEZONE);
  const utcNow = new Date().toISOString();
  return `Live Server UTC: ${utcNow} | Bangladesh Date (Asia/Dhaka): ${dhaka.gregorian.formattedEn} (${dhaka.bengali.formattedBn})`;
}

/**
 * Executes any of the 9 Universal Information Tool Router functions using real
 * server time, real Open-Meteo weather/forecast APIs, and real Gemini Google
 * Search Grounding.
 */
export async function executeIntelTool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  options: {
    defaultTimezone?: string;
    runGroundedSearch?: GroundedSearchRunner;
    fetchFn?: typeof fetch;
  } = {},
): Promise<ToolExecutionOutcome> {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  const defaultTz = options.defaultTimezone || DEFAULT_BANGLADESH_TIMEZONE;
  const fetchFn = options.fetchFn || fetch;

  switch (toolName) {
    case 'get_current_time': {
      const tzOrLoc = String(args.timezone || args.location || '').trim();
      const timeData = getCurrentTime(tzOrLoc || null, defaultTz);
      return {
        toolName,
        result: timeData as unknown as Record<string, unknown>,
        grounding: {
          usedTools: ['get_current_time'],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: timeData.isoTimestamp,
        },
      };
    }

    case 'get_current_date': {
      const tzOrLoc = String(args.timezone || args.location || '').trim();
      const dateData = getCurrentDate(tzOrLoc || null, defaultTz);
      return {
        toolName,
        result: dateData as unknown as Record<string, unknown>,
        grounding: {
          usedTools: ['get_current_date'],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: dateData.retrievedAtIso,
        },
      };
    }

    case 'convert_bengali_date': {
      const gDate = typeof args.gregorian_date === 'string' && args.gregorian_date.trim()
        ? args.gregorian_date.trim()
        : undefined;
      const tz = typeof args.timezone === 'string' && args.timezone.trim()
        ? args.timezone.trim()
        : DEFAULT_BANGLADESH_TIMEZONE;
      const bnData = convertBengaliDate(gDate, tz);
      return {
        toolName,
        result: bnData as unknown as Record<string, unknown>,
        grounding: {
          usedTools: ['convert_bengali_date'],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: new Date().toISOString(),
        },
      };
    }

    case 'get_hijri_date': {
      const gDate = typeof args.date === 'string' && args.date.trim() ? args.date.trim() : undefined;
      const loc = typeof args.location === 'string' && args.location.trim()
        ? args.location.trim()
        : typeof args.timezone === 'string' && args.timezone.trim()
          ? args.timezone.trim()
          : DEFAULT_BANGLADESH_TIMEZONE;
      const hijriData = getHijriDate(gDate, loc);
      return {
        toolName,
        result: hijriData as unknown as Record<string, unknown>,
        grounding: {
          usedTools: ['get_hijri_date'],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: new Date().toISOString(),
        },
      };
    }

    case 'get_weather':
    case 'get_forecast': {
      const location = String(args.location || '').trim();
      const days = toolName === 'get_forecast' ? Number(args.days || 5) : 3;
      const weather = await fetchWeatherForLocation(location, days, fetchFn);

      if (!weather.ok) {
        return {
          toolName,
          result: {
            ...weather,
            instruction: weather.ambiguousLocation
              ? 'Ask the user politely which specific city or country they mean. Do NOT invent weather.'
              : 'Weather API is currently unavailable. Tell the user transparently that live weather could not be retrieved right now. Do NOT guess temperature or conditions.',
          },
          grounding: {
            usedTools: [toolName],
            sources: [],
            searchQueries: [],
            searchSuggestions: [],
            retrievedAt: new Date().toISOString(),
            searchFailed: Boolean(weather.unavailable),
            failureReason: weather.unavailable ? weather.error : undefined,
          },
        };
      }

      return {
        toolName,
        result: weather as unknown as Record<string, unknown>,
        grounding: {
          usedTools: [toolName],
          sources: [
            {
              title: `Open-Meteo Weather (${weather.location.name}, ${weather.location.country})`,
              publisher: 'open-meteo.com',
              uri: 'https://open-meteo.com/',
              sourceTier: 'specialist',
            },
          ],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: weather.retrievedAtIso,
        },
      };
    }

    case 'google_search':
    case 'research_topic':
    case 'verify_claim': {
      const rawQuery = String(args.query || args.topic || args.claim || '').trim().slice(0, 400);
      const country = String(args.country || '').trim().slice(0, 80);
      const language = String(args.language || 'Bengali').trim().slice(0, 40);
      const recency = String(args.recency || (toolName === 'google_search' ? 'day' : 'week')).trim().toLowerCase();
      const depth = String(args.depth || 'deep').trim().toLowerCase();

      if (!rawQuery) {
        return {
          toolName,
          result: { ok: false, error: 'Search query cannot be empty.' },
        };
      }

      if (!options.runGroundedSearch) {
        return {
          toolName,
          result: {
            ok: false,
            unavailable: true,
            service: 'Gemini Google Search Grounding',
            error: 'Live Google Search Grounding is unavailable because no Gemini API key is configured.',
            instruction:
              'Transparently inform the user that live Google Search could not be executed because the Gemini API key is not configured. Do NOT invent current news or pretend to have searched.',
          },
          grounding: {
            usedTools: [toolName],
            sources: [],
            searchQueries: [],
            searchSuggestions: [],
            retrievedAt: new Date().toISOString(),
            searchFailed: true,
            failureReason: 'Gemini API key is not configured for Google Search Grounding.',
          },
        };
      }

      const cacheKey = `${toolName}|${rawQuery.toLowerCase()}|${country.toLowerCase()}|${recency}|${depth}`;
      const hit = searchCache.get(cacheKey);
      if (hit && Date.now() - hit.at < hit.ttl) {
        return {
          toolName,
          result: {
            ok: true,
            cached: true,
            summary: hit.value.summary,
            sources: hit.value.grounding.sources,
            searchQueries: hit.value.grounding.searchQueries,
            retrievedAt: hit.value.grounding.retrievedAt,
          },
          grounding: { ...hit.value.grounding, usedTools: [toolName] },
        };
      }

      const stamp = todayReferenceStamp();
      let searchSystem = '';
      let searchPrompt = '';

      if (toolName === 'verify_claim') {
        searchSystem =
          'You are a strict multi-source fact verification research assistant using live Google Search Grounding. ' +
          `${stamp}. ` +
          'Prioritize sources in order: (1) Official government sources, (2) Official company announcements, (3) Scientific journals & research institutions, (4) Reputable international news organizations (Reuters, AP, BBC, Al Jazeera, etc.), (5) Specialist publications. ' +
          'Cross-check multiple independent sources. Clearly separate confirmed facts from allegations, opinions, and unconfirmed rumors. If sources disagree, explicitly report the disagreement. Check publication dates and actual event dates—never present old events as today. Never fabricate facts or URLs.';
        searchPrompt = `Verify this claim across multiple independent reputable sources as of today (${stamp}): "${rawQuery}". Report: (1) Verification status (Confirmed / Partially confirmed / Disputed / Unconfirmed rumor / False), (2) Exact event & publication dates, (3) What multiple sources say and any disagreements.`;
      } else if (toolName === 'research_topic') {
        searchSystem =
          'You are a rigorous technology, science, and world-affairs research engine using live Google Search Grounding. ' +
          `${stamp}. ` +
          'Always verify publication dates and actual announcement/release dates. Strictly distinguish: Official announcements, Published research, Verified product releases, Reputable news reports, and Rumors/unconfirmed claims. Never present a rumor as an established fact and never present outdated releases as brand new.';
        searchPrompt = `Conduct ${depth === 'brief' ? 'concise' : 'multi-angle'} live research on: "${rawQuery}"${
          country ? ` (focus region: ${country})` : ''
        }. Current date reference: ${stamp}. Include publication/release dates, official vs media status, key breakthroughs/facts, and why it matters.`;
      } else {
        searchSystem =
          'You are a real-time global news and live information retrieval engine using official Google Search Grounding. ' +
          `${stamp}. ` +
          'ALWAYS check publication dates and actual event dates. NEVER present old news from previous weeks/months/years as today’s news. Prioritize reputable international/national news publishers and official sources. For important news, capture: Headline, What happened, When it happened (exact date), Where it happened, and Why it matters. If no verified current update is found, explicitly say so—never invent breaking news.';
        searchPrompt = `Search Google for live, up-to-date information (${recency} recency${
          country ? `, country/region: ${country}` : ''
        }, user language preference: ${language}): "${rawQuery}". Current date reference: ${stamp}. Provide factual, date-verified findings based strictly on search results.`;
      }

      const searchOutcome = await options.runGroundedSearch({
        prompt: searchPrompt,
        systemInstruction: searchSystem,
      });

      if (!searchOutcome.ok) {
        const failureMeta: LiveSearchMetadata = {
          usedTools: [toolName],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: new Date().toISOString(),
          searchFailed: true,
          failureReason: searchOutcome.error,
          quotaExceeded: Boolean(searchOutcome.quotaExceeded),
        };
        return {
          toolName,
          result: {
            ...searchOutcome,
            instruction: searchOutcome.quotaExceeded
              ? 'Google Search Grounding free quota limit has been reached. Transparently inform the user that live Google Search could not run due to Gemini API quota limits (and that higher quota requires a paid Gemini API billing tier). Do NOT invent news or pretend you searched.'
              : 'Live Google Search failed or is unavailable right now. Transparently tell the user that live information could not be retrieved instead of inventing an answer.',
          },
          grounding: failureMeta,
        };
      }

      const ttl = recency === 'day' ? SEARCH_CACHE_LIVE_TTL_MS : SEARCH_CACHE_GENERAL_TTL_MS;
      searchCache.set(cacheKey, { at: Date.now(), ttl, value: searchOutcome });

      return {
        toolName,
        result: {
          ok: true,
          cached: false,
          summary: searchOutcome.summary,
          sources: searchOutcome.grounding.sources,
          searchQueries: searchOutcome.grounding.searchQueries,
          retrievedAt: searchOutcome.grounding.retrievedAt,
        },
        grounding: {
          ...searchOutcome.grounding,
          usedTools: [toolName],
        },
      };
    }

    default:
      return {
        toolName,
        result: { ok: false, error: `Unknown intelligence tool: ${toolName}` },
      };
  }
}
