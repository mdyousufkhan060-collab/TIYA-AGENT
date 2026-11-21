import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertBengaliDate,
  getCurrentDate,
  getCurrentTime,
  getHijriDate,
  resolveTimezone,
} from './worldTimeCalendar';
import {
  clearWeatherCacheForTests,
  describeWmoWeatherCode,
  fetchWeatherForLocation,
  normalizeWeatherLocationQuery,
} from './weatherService';
import { decideSearchStrategy } from './searchDecisionEngine';
import {
  buildLiveIntelToolSchemas,
  clearSearchCacheForTests,
  executeIntelTool,
  extractGroundingMetadata,
  sanitizeExternalUrl,
} from './liveIntelRouter';

test('TEST 1: Live current time returns accurate IANA timezone clock for Bangladesh, USA, London, Canada, Japan', () => {
  const fixedUtc = new Date('2026-07-15T12:00:00Z'); // Summer (DST active in US/UK/Canada)

  const bd = getCurrentTime('বাংলাদেশে এখন কয়টা?', 'Asia/Dhaka', fixedUtc);
  assert.equal(bd.timezone, 'Asia/Dhaka');
  assert.equal(bd.time24, '18:00'); // UTC+6
  assert.equal(bd.isDst, false);

  const ny = getCurrentTime('আমেরিকায় এখন কয়টা?', 'Asia/Dhaka', fixedUtc);
  assert.equal(ny.timezone, 'America/New_York');
  assert.equal(ny.time24, '08:00'); // EDT = UTC-4 in July
  assert.equal(ny.isDst, true);
  assert.ok(ny.additionalZones && ny.additionalZones.length >= 3);

  const london = getCurrentTime('লন্ডনে এখন কয়টা?', 'Asia/Dhaka', fixedUtc);
  assert.equal(london.timezone, 'Europe/London');
  assert.equal(london.time24, '13:00'); // BST = UTC+1 in July
  assert.equal(london.isDst, true);

  const canada = getCurrentTime('কানাডায় এখন কয়টা?', 'Asia/Dhaka', fixedUtc);
  assert.equal(canada.timezone, 'America/Toronto');
  assert.equal(canada.time24, '08:00');
  assert.ok(canada.additionalZones && canada.additionalZones.length >= 2);

  const japan = getCurrentTime('জাপানে এখন কয়টা?', 'Asia/Dhaka', fixedUtc);
  assert.equal(japan.timezone, 'Asia/Tokyo');
  assert.equal(japan.time24, '21:00'); // JST = UTC+9

  // Live clock (without fixed date) always reflects real current time, never hardcoded
  const liveNow = getCurrentTime('Asia/Dhaka');
  assert.ok(Math.abs(Date.now() - Date.parse(liveNow.isoTimestamp)) < 5000);
});

test('TEST 2: Official 2019 Revised Bangladesh Bangla Calendar & Islamic Hijri conversion accuracy', () => {
  // Verify official 2019 Bangla Academy milestone dates:
  // Pohela Boishakh = April 14
  const pohela = convertBengaliDate('2026-04-14', 'Asia/Dhaka');
  assert.equal(pohela.day, 1);
  assert.equal(pohela.monthBn, 'বৈশাখ');
  assert.equal(pohela.year, 1433);

  // International Mother Language Day (21 Feb) is ALWAYS 8 Falgun under 2019 Bangladesh revision
  const ekusheCommon = convertBengaliDate('2026-02-21', 'Asia/Dhaka');
  assert.equal(ekusheCommon.day, 8);
  assert.equal(ekusheCommon.monthBn, 'ফাল্গুন');
  assert.equal(ekusheCommon.year, 1432);

  // Independence Day (26 March) is ALWAYS 12 Chaitro (both common & leap years!)
  const shadhinotaCommon = convertBengaliDate('2026-03-26', 'Asia/Dhaka');
  assert.equal(shadhinotaCommon.day, 12);
  assert.equal(shadhinotaCommon.monthBn, 'চৈত্র');

  const shadhinotaLeap = convertBengaliDate('2024-03-26', 'Asia/Dhaka');
  assert.equal(shadhinotaLeap.day, 12);
  assert.equal(shadhinotaLeap.monthBn, 'চৈত্র');

  // Victory Day (16 December) is ALWAYS 1 Poush
  const bijoy = convertBengaliDate('2026-12-16', 'Asia/Dhaka');
  assert.equal(bijoy.day, 1);
  assert.equal(bijoy.monthBn, 'পৌষ');
  assert.equal(bijoy.year, 1433);

  // Leap year Feb 29 -> 16 Falgun, Mar 14 -> 30 Falgun, Mar 15 -> 1 Chaitro
  const leapEndFalgun = convertBengaliDate('2024-03-14', 'Asia/Dhaka');
  assert.equal(leapEndFalgun.day, 30);
  assert.equal(leapEndFalgun.monthBn, 'ফাল্গুন');

  // Hijri date includes mandatory moon-sighting note
  const hijri = getHijriDate('2026-11-21', 'Asia/Dhaka');
  assert.equal(hijri.ok, true);
  assert.ok(hijri.year >= 1447);
  assert.ok(hijri.moonSightingNoteBn.includes('চাঁদ দেখা'));
  assert.ok(hijri.moonSightingNoteEn.toLowerCase().includes('moon-sighting'));

  // Combined getCurrentDate returns Gregorian + Bangla + Hijri together
  const today = getCurrentDate('Asia/Dhaka');
  assert.equal(today.timezone, 'Asia/Dhaka');
  assert.ok(today.gregorian.formattedBn.length > 0);
  assert.ok(today.bengali.formattedBn.includes('বঙ্গাব্দ'));
  assert.ok(today.hijri.formattedBn.includes('হিজরি'));
});

test('TEST 3: Live Open-Meteo Weather API retrieves actual real-time Dhaka & New York weather and caches cleanly', async () => {
  clearWeatherCacheForTests();
  assert.equal(normalizeWeatherLocationQuery('ঢাকায়'), 'Dhaka');
  assert.equal(normalizeWeatherLocationQuery('নিউইয়র্ক'), 'New York');
  assert.equal(describeWmoWeatherCode(61).bn, 'হালকা বৃষ্টি');

  const dhaka = await fetchWeatherForLocation('ঢাকা', 3);
  assert.equal(dhaka.ok, true, `Expected live Open-Meteo Dhaka weather, got: ${JSON.stringify(dhaka)}`);
  if (dhaka.ok) {
    assert.equal(dhaka.provider, 'Open-Meteo');
    assert.equal(dhaka.location.country, 'Bangladesh');
    assert.equal(dhaka.location.timezone, 'Asia/Dhaka');
    assert.ok(Number.isFinite(dhaka.current.temperatureC));
    assert.ok(Number.isFinite(dhaka.current.feelsLikeC));
    assert.ok(Number.isFinite(dhaka.current.humidityPct));
    assert.ok(Number.isFinite(dhaka.current.windSpeedKmh));
    assert.ok(dhaka.todaySun.sunrise.length > 0);
    assert.ok(dhaka.todaySun.sunset.length > 0);
    assert.equal(dhaka.dailyForecast.length, 3);
    assert.equal(dhaka.cached, false);

    // Second call within TTL hits cache instead of duplicating upstream call
    const dhakaCached = await fetchWeatherForLocation('Dhaka', 3);
    assert.equal(dhakaCached.ok, true);
    if (dhakaCached.ok) assert.equal(dhakaCached.cached, true);
  }

  // Ambiguous empty location asks for clarification instead of inventing weather
  const emptyLoc = await fetchWeatherForLocation('', 3);
  assert.equal(emptyLoc.ok, false);
  if (!emptyLoc.ok) assert.equal(emptyLoc.ambiguousLocation, true);
});

test('TESTS 4, 5, 6, 7, 8: Intelligent Search Decision Engine routes live news, tech research, verification, and skips unnecessary searches for general knowledge', () => {
  // TEST 1 & 2 & 3 -> live_data (NO web search needed)
  const dTime = decideSearchStrategy('এখন বাংলাদেশে কয়টা বাজে?');
  assert.equal(dTime.category, 'live_data');
  assert.equal(dTime.shouldEnableGoogleSearch, false);
  assert.ok(dTime.recommendedTools.includes('get_current_time'));

  const dBanglaDate = decideSearchStrategy('আজ বাংলা কত তারিখ?');
  assert.equal(dBanglaDate.category, 'live_data');
  assert.equal(dBanglaDate.shouldEnableGoogleSearch, false);
  assert.ok(dBanglaDate.recommendedTools.includes('convert_bengali_date'));

  const dWeather = decideSearchStrategy('আজ ঢাকার আবহাওয়া কেমন?');
  assert.equal(dWeather.category, 'live_data');
  assert.equal(dWeather.shouldEnableGoogleSearch, false);
  assert.ok(dWeather.recommendedTools.includes('get_weather'));

  // TEST 4: USA news -> live_search with Google Search Grounding
  const dUsa = decideSearchStrategy('আজ আমেরিকার বড় খবর কী?');
  assert.equal(dUsa.category, 'live_search');
  assert.equal(dUsa.shouldEnableGoogleSearch, true);
  assert.equal(dUsa.detectedCountry, 'United States');
  assert.equal(dUsa.recency, 'day');

  // TEST 5: Canada news -> live_search with fresh recency
  const dCanada = decideSearchStrategy('কানাডায় নতুন কী ঘটেছে?');
  assert.equal(dCanada.category, 'live_search');
  assert.equal(dCanada.shouldEnableGoogleSearch, true);
  assert.equal(dCanada.detectedCountry, 'Canada');

  // TEST 6: New AI tech discovery -> complex_research with research_topic + google_search
  const dAi = decideSearchStrategy('নতুন কোনো AI প্রযুক্তি বের হয়েছে?');
  assert.equal(dAi.category, 'complex_research');
  assert.equal(dAi.shouldEnableGoogleSearch, true);
  assert.ok(dAi.recommendedTools.includes('research_topic'));

  // TEST 7: Ordinary general knowledge / casual chat -> general_conversation (NO live search!)
  const dGeneral1 = decideSearchStrategy('পাইথাগোরাসের উপপাদ্য কী?');
  assert.equal(dGeneral1.category, 'general_conversation');
  assert.equal(dGeneral1.shouldEnableGoogleSearch, false);

  const dGeneral2 = decideSearchStrategy('আচ্ছা রাখো, আমি কাজ করব।');
  assert.equal(dGeneral2.category, 'general_conversation');
  assert.equal(dGeneral2.shouldEnableGoogleSearch, false);

  // TEST 8: Complex current-affairs / multi-source verification -> complex_research
  const dComplex = decideSearchStrategy('আন্তর্জাতিক অর্থনৈতিক পরিস্থিতি ও শুল্ক নীতির প্রভাব বিস্তারিত বিশ্লেষণ করে যাচাই করো।');
  assert.equal(dComplex.category, 'complex_research');
  assert.equal(dComplex.shouldEnableGoogleSearch, true);
  assert.ok(dComplex.recommendedTools.includes('verify_claim'));
});

test('Universal Tool Router schemas, safe URL/source/suggestion extraction, and TEST 10 transparent unavailable/quota handling', async () => {
  clearSearchCacheForTests();

  // Verify all 9 required tools exist in schema declarations
  const schemas = buildLiveIntelToolSchemas(false);
  const names = schemas.map((s) => s.name);
  for (const required of [
    'google_search',
    'get_current_time',
    'get_current_date',
    'get_weather',
    'get_forecast',
    'convert_bengali_date',
    'get_hijri_date',
    'research_topic',
    'verify_claim',
  ]) {
    assert.ok(names.includes(required), `Missing required tool schema: ${required}`);
  }

  // XSS URL guard rejects javascript: and data: URIs
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(sanitizeExternalUrl('https://www.reuters.com/world/'), 'https://www.reuters.com/world/');

  // Grounding extractor extracts verified sources, classifies tiers, and safely parses Google Search suggestions without raw HTML
  const extracted = extractGroundingMetadata({
    webSearchQueries: ['latest news United States today'],
    groundingChunks: [
      { web: { uri: 'https://www.reuters.com/world/us/update', title: 'Reuters US Update' } },
      { web: { uri: 'javascript:evil()', title: 'Malicious Link' } },
      { web: { uri: 'https://www.whitehouse.gov/briefing', title: 'Official Statement' } },
    ],
    searchEntryPoint: {
      renderedContent:
        '<div><a href="https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc">US top news today</a><a href="https://evil.example.com/phish">Bad Chip</a></div>',
    },
  });
  assert.ok(extracted);
  assert.equal(extracted.sources.length, 2);
  assert.equal(extracted.sources[0].sourceTier, 'news');
  assert.equal(extracted.sources[1].sourceTier, 'official');
  assert.equal(extracted.searchSuggestions.length, 1);
  assert.equal(extracted.searchSuggestions[0].label, 'US top news today');

  // TEST 10A: Simulate quota exhausted on Google Search Grounding -> transparent error, never fabricated
  const quotaOutcome = await executeIntelTool(
    'google_search',
    { query: 'আজ আমেরিকার বড় খবর কী?', country: 'United States', recency: 'day' },
    {
      runGroundedSearch: async () => ({
        ok: false,
        error: '429 RESOURCE_EXHAUSTED: Free tier quota exceeded',
        quotaExceeded: true,
        unavailable: true,
        service: 'Gemini Google Search Grounding',
        paidTierNote: 'Higher search grounding limits require a billing-enabled Gemini API key.',
      }),
    },
  );
  assert.equal(quotaOutcome.result.ok, false);
  assert.equal(quotaOutcome.result.quotaExceeded, true);
  assert.equal(quotaOutcome.grounding?.searchFailed, true);
  assert.equal(quotaOutcome.grounding?.quotaExceeded, true);

  // TEST 10B: Simulate unavailable Weather API -> transparent error, never fabricated temperature
  clearWeatherCacheForTests();
  const offlineWeather = await executeIntelTool(
    'get_weather',
    { location: 'Dhaka' },
    {
      fetchFn: (async () => {
        throw new Error('Simulated network outage');
      }) as typeof fetch,
    },
  );
  assert.equal(offlineWeather.result.ok, false);
  assert.equal(offlineWeather.result.unavailable, true);
  assert.equal(offlineWeather.grounding?.searchFailed, true);

  // Verify timezone fallback works
  assert.equal(resolveTimezone('').iana, 'Asia/Dhaka');
});
