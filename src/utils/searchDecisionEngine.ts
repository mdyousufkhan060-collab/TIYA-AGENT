/**
 * Intelligent Search Decision Engine for TIYA AI.
 *
 * Classifies user queries accurately so TIYA:
 * - ALWAYS uses live tools for current time, calendar dates, weather, breaking
 *   world news, recent releases, discoveries, and changing factual information.
 * - Uses multi-source research / verification for complex current affairs,
 *   disputed claims, and scientific/technology breakthroughs.
 * - NEVER wastes web search quota on general conversation, emotional moments,
 *   greetings, goodbyes, phone actions, or settled textbook general knowledge.
 */

export type SearchDecisionCategory =
  | 'live_data'
  | 'live_search'
  | 'complex_research'
  | 'uncertain_or_factual_verification'
  | 'general_conversation';

export type IntelToolName =
  | 'google_search'
  | 'get_current_time'
  | 'get_current_date'
  | 'get_weather'
  | 'get_forecast'
  | 'convert_bengali_date'
  | 'get_hijri_date'
  | 'research_topic'
  | 'verify_claim';

export interface SearchDecision {
  category: SearchDecisionCategory;
  shouldEnableGoogleSearch: boolean;
  recommendedTools: IntelToolName[];
  detectedCountry?: string;
  detectedLocation?: string;
  recency: 'day' | 'week' | 'month' | 'any';
  language: 'bn' | 'en';
  reason: string;
}

const COUNTRY_PATTERNS: Array<{ country: string; re: RegExp }> = [
  { country: 'Bangladesh', re: /(?:বাংলাদেশ|ঢাকা|চট্টগ্রাম|সিলেট|খুলনা|রাজশাহী|\bbangladesh\b|\bdhaka\b)/i },
  { country: 'United States', re: /(?:আমেরিকা|যুক্তরাষ্ট্র|নিউইয়র্ক|নিউইয়র্ক|ওয়াশিংটন|ওয়াশিংটন|\bamerica\b|\busa\b|\bunited states\b|\bu\.s\.?\b|\bnew york\b)/i },
  { country: 'Canada', re: /(?:কানাডা|টরন্টো|ভ্যাঙ্কুভার|মন্ট্রিয়ল|অটোয়া|\bcanada\b|\bcanadian\b|\btoronto\b|\bvancouver\b)/i },
  { country: 'United Kingdom', re: /(?:যুক্তরাজ্য|লন্ডন|ব্রিটেন|ইংল্যান্ড|\bunited kingdom\b|\buk\b|\blondon\b|\bbritain\b)/i },
  { country: 'India', re: /(?:ভারত|ইন্ডিয়া|ইন্ডিয়া|কলকাতা|দিল্লি|মুম্বাই|\bindia\b|\bindian\b|\bdelhi\b|\bkolkata\b)/i },
  { country: 'Pakistan', re: /(?:পাকিস্তান|করাচি|ইসলামাবাদ|লাহোর|\bpakistan\b|\bkarachi\b|\bislamabad\b)/i },
  { country: 'China', re: /(?:চীন|বেইজিং|সাংহাই|\bchina\b|\bchinese\b|\bbeijing\b)/i },
  { country: 'Japan', re: /(?:জাপান|টোকিও|\bjapan\b|\bjapanese\b|\btokyo\b)/i },
  { country: 'Australia', re: /(?:অস্ট্রেলিয়া|অস্ট্রেলিয়া|সিডনি|মেলবোর্ন|\baustralia\b|\bsydney\b)/i },
  { country: 'Germany', re: /(?:জার্মানি|বার্লিন|\bgermany\b|\bgerman\b|\bberlin\b)/i },
  { country: 'France', re: /(?:ফ্রান্স|প্যারিস|\bfrance\b|\bfrench\b|\bparis\b)/i },
  { country: 'Saudi Arabia', re: /(?:সৌদি\s*আরব|সৌদি|রিয়াদ|রিয়াদ|মক্কা|মদিনা|\bsaudi\b|\briyadh\b)/i },
  { country: 'United Arab Emirates', re: /(?:আরব\s*আমিরাত|আমিরাত|দুবাই|আবুধাবি|\buae\b|\bdubai\b|\babu dhabi\b)/i },
  { country: 'Europe', re: /(?:ইউরোপ|\beurope\b|\beuropean\b)/i },
];

const TIME_PATTERNS = [
  /(?:এখন\s*)?(?:কয়টা|কয়টা|কটা)\s*(?:বাজে|বাজলো|বাজছে|হলো|হল)?/i,
  /(?:বর্তমান|এখনকার)\s*(?:সময়|সময়)/i,
  /(?:সময়|সময়)\s*(?:কত|কয়টা|কয়টা)/i,
  /\b(?:what(?:'s| is)?\s+the\s+(?:current\s+)?time|current\s+time|time\s+in\s+|time\s+now|local\s+time)\b/i,
];

const BANGLA_DATE_PATTERNS = [
  /বাংলা\s*(?:কত\s*)?(?:তারিখ|সাল|মাস|কোন\s*মাস|বছর|বঙ্গাব্দ)/i,
  /(?:আজ|এখন)\s*বাংলা\s*(?:কত|কোন)/i,
  /\b(?:bengali|bangla)\s*(?:date|month|year|calendar)\b/i,
];

const HIJRI_DATE_PATTERNS = [
  /(?:হিজরি|হিজরী|আরবি|আরবী|ইসলামিক)\s*(?:কত\s*)?(?:তারিখ|সাল|মাস|কোন\s*মাস)/i,
  /\b(?:hijri|islamic)\s*(?:date|month|year|calendar)\b/i,
];

const DATE_PATTERNS = [
  /(?:আজ|এখন)\s*(?:ইংরেজি\s*)?(?:কত\s*তারিখ|কোন\s*তারিখ|কত\s*সাল|কোন\s*মাস|কী\s*বার|কি\s*বার)/i,
  /(?:আজকের|এখনকার)\s*(?:তারিখ|দিন|বার)/i,
  /\b(?:what(?:'s| is)?\s+(?:today'?s\s+)?(?:date|day)|what\s+year\s+is\s+it|current\s+date|today'?s\s+date)\b/i,
];

const WEATHER_PATTERNS = [
  /(?:আবহাওয়া|আবহাওয়া|তাপমাত্রা|কত\s*ডিগ্রি|কত\s*ডিগ্রী|বৃষ্টি\s*হবে|বৃষ্টি\s*হচ্ছে|তুষারপাত|রোদ|কুয়াশা|কুয়াশা|ঝড়|ঝড়|গরম|ঠান্ডা\s*কেমন)/i,
  /\b(?:weather|temperature|forecast|rain(?:ing)?\s+today|will\s+it\s+rain|snow(?:ing|fall)?|humidity|sunrise|sunset)\b/i,
];

const FORECAST_PATTERNS = [
  /(?:কাল|আগামীকাল|কালকের|আগামী\s*(?:কয়েক|কয়েক|\d+|[০-৯]+)\s*দিন|সপ্তাহের|পূর্বাভাস)/i,
  /\b(?:tomorrow|forecast|next\s+\d*\s*days|this\s+week)\b/i,
];

const NEWS_AND_LIVE_PATTERNS = [
  /(?:আজকের?\s*)?(?:খবর|সংবাদ|নিউজ|হেডলাইন|ব্রেকিং|আপডেট|কী\s*ঘটেছে|কি\s*ঘটেছে|কী\s*হচ্ছে|কি\s*হচ্ছে|ঘটনা|পরিস্থিতি)/i,
  /(?:সর্বশেষ|সাম্প্রতিক|নতুন\s*(?:খবর|ঘোষণা|আপডেট|রিলিজ|মডেল|প্রযুক্তি|আবিষ্কার|গবেষণা|পণ্য|আইন|সিদ্ধান্ত|ফোন|স্মার্টফোন))/i,
  /(?:সরকার(?:ি|ী)?\s*ঘোষণা|অর্থনীতি|বাজারদর|শেয়ার\s*বাজার|ডলার\s*রেট|সোনার\s*দাম|খেলা(?:র)?\s*স্কোর|ম্যাচ(?:ের)?\s*ফল)/i,
  /\b(?:latest|breaking|today'?s|recent|current|happening\s+(?:in|today)|news|headlines|update(?:s)?|announced|released|just\s+launched|stock\s+price|exchange\s+rate|score|election|government\s+announcement)\b/i,
];

const RESEARCH_DISCOVERY_PATTERNS = [
  /(?:নতুন\s*(?:কোনো\s*)?(?:ai|এআই|প্রযুক্তি|বৈজ্ঞানিক\s*আবিষ্কার|আবিষ্কার|গবেষণা|চিকিৎসা|মহাকাশ|সফটওয়্যার|সফটওয়্যার|মডেল|উদ্ভাবন|প্রকৌশল))/i,
  /\b(?:new\s+(?:ai|scientific|science|space|medical|tech|technology|software|engineering|business)\s*(?:discover|model|release|breakthrough|invention|research|product|update|development)|latest\s+(?:ai|technology|scientific|medical|space|economic))\b/i,
];

const VERIFY_CLAIM_PATTERNS = [
  /(?:সত্যি\s*কি|আসলে\s*কি\s*সত্য|গুজব\s*নাকি|যাচাই\s*করো|নিশ্চিত\s*কি|কতটুকু\s*সত্য|বিতর্ক|দাবি)/i,
  /\b(?:is\s+it\s+true|fact\s*check|verify|rumor|rumour|confirmed\s+or|disputed|compare\s+sources)\b/i,
];

const COMPLEX_CURRENT_AFFAIRS_PATTERNS = [
  /(?:বিশ্লেষণ|বিস্তারিত|তুলনা|প্রভাব|কেন\s*(?:হলো|হচ্ছে|ঘটলো)|আন্তর্জাতিক|ভূ-রাজনীতি|অর্থনৈতিক\s*প্রভাব|যুদ্ধ|চুক্তি|নিষেধাজ্ঞা|শুল্ক|মুদ্রাস্ফীতি)/i,
  /\b(?:analy[sz]e|in\s+depth|detailed|impact\s+of|why\s+did|geopolitic|international\s+developments|economic\s+developments|tariff|sanction|treaty|conflict|crisis)\b/i,
];

const GENERAL_TEXTBOOK_OR_CONVO_PATTERNS = [
  /^(?:হ্যালো|হাই|সালাম|আসসালামু\s*আলাইকুম|কেমন\s*আছো|কেমন\s*আছেন|ভালো\s*আছি|ধন্যবাদ|থ্যাংক\s*ইউ|আচ্ছা|ওকে|ঠিক\s*আছে|বাই|রাখো|রাখি|পরে\s*কথা\s*বলব|hello|hi|hey|how\s+are\s+you|thanks|thank\s+you|ok|okay|bye)/i,
  /(?:পাইথাগোরাস|নিউটনের\s*সূত্র|সালোকসংশ্লেষণ|পানির\s*সংকেত|ডিএনএ\s*কী|কবিতা\s*লিখে|গল্প\s*বলো|জোক\s*বলো|অনুবাদ\s*করো|\bpythagoras\b|\bnewton'?s\s+law\b|\bphotosynthesis\b|\bwrite\s+a\s+(?:poem|story|email|code)\b|\bexplain\s+(?:recursion|gravity|photosynthesis|dna)\b)/i,
];

function hasBengaliScript(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text);
}

function detectCountry(text: string): string | undefined {
  for (const item of COUNTRY_PATTERNS) {
    if (item.re.test(text)) return item.country;
  }
  return undefined;
}

export function decideSearchStrategy(rawQuery: string): SearchDecision {
  const query = (rawQuery || '').normalize('NFC').trim();
  const language: 'bn' | 'en' = hasBengaliScript(query) ? 'bn' : 'en';

  if (!query) {
    return {
      category: 'general_conversation',
      shouldEnableGoogleSearch: false,
      recommendedTools: [],
      recency: 'any',
      language,
      reason: 'Empty message.',
    };
  }

  const detectedCountry = detectCountry(query);
  const tools = new Set<IntelToolName>();

  const asksTime = TIME_PATTERNS.some((re) => re.test(query));
  const asksBanglaDate = BANGLA_DATE_PATTERNS.some((re) => re.test(query));
  const asksHijriDate = HIJRI_DATE_PATTERNS.some((re) => re.test(query));
  const asksDate = DATE_PATTERNS.some((re) => re.test(query));
  const asksWeather = WEATHER_PATTERNS.some((re) => re.test(query));
  const asksForecast = FORECAST_PATTERNS.some((re) => re.test(query));
  const asksVerify = VERIFY_CLAIM_PATTERNS.some((re) => re.test(query));
  const asksResearch = RESEARCH_DISCOVERY_PATTERNS.some((re) => re.test(query));
  const asksNewsOrLive = NEWS_AND_LIVE_PATTERNS.some((re) => re.test(query));
  const asksComplexAffairs = COMPLEX_CURRENT_AFFAIRS_PATTERNS.some((re) => re.test(query));

  if (asksTime) tools.add('get_current_time');
  if (asksBanglaDate) tools.add('convert_bengali_date');
  if (asksHijriDate) tools.add('get_hijri_date');
  if (asksDate && !asksBanglaDate && !asksHijriDate) tools.add('get_current_date');
  if (asksWeather) {
    tools.add(asksForecast ? 'get_forecast' : 'get_weather');
  }

  // Country-wide snow/weather queries like "কানাডায় কোথায় তুষারপাত হচ্ছে?" benefit from both weather & live search
  const asksWhereSnowing =
    /(?:কোথায়|কোথায়|which\s+cit|where).{0,25}(?:তুষারপাত|snow)/i.test(query) ||
    /(?:তুষারপাত|snow).{0,25}(?:কোথায়|কোথায়|where)/i.test(query);

  if (tools.size > 0 && !asksNewsOrLive && !asksResearch && !asksVerify && !asksWhereSnowing) {
    return {
      category: 'live_data',
      shouldEnableGoogleSearch: false,
      recommendedTools: Array.from(tools),
      detectedCountry,
      detectedLocation: detectedCountry,
      recency: 'day',
      language,
      reason: 'Deterministic live time, calendar, or weather data query.',
    };
  }

  // Explicit general conversation / textbook knowledge guard (only if no live/news/research triggers matched)
  if (
    !asksNewsOrLive &&
    !asksResearch &&
    !asksVerify &&
    !asksWhereSnowing &&
    tools.size === 0 &&
    GENERAL_TEXTBOOK_OR_CONVO_PATTERNS.some((re) => re.test(query))
  ) {
    return {
      category: 'general_conversation',
      shouldEnableGoogleSearch: false,
      recommendedTools: [],
      detectedCountry,
      recency: 'any',
      language,
      reason: 'General conversation or settled knowledge; live search unnecessary.',
    };
  }

  const recency: 'day' | 'week' | 'month' | 'any' = /(?:আজ|today|এখন|breaking|ব্রেকিং|right now)/i.test(query)
    ? 'day'
    : /(?:সপ্তাহ|this week|সাম্প্রতিক|recent|নতুন|latest)/i.test(query)
      ? 'week'
      : /(?:এই\s*মাস|this month|2025|2026|২০২৫|২০২৬)/i.test(query)
        ? 'month'
        : 'any';

  if (asksVerify) {
    tools.add('verify_claim');
    tools.add('google_search');
    return {
      category: 'complex_research',
      shouldEnableGoogleSearch: true,
      recommendedTools: Array.from(tools),
      detectedCountry,
      recency,
      language,
      reason: 'Claim verification requiring multi-source comparison.',
    };
  }

  if (asksResearch || (asksNewsOrLive && asksComplexAffairs)) {
    tools.add('research_topic');
    tools.add('google_search');
    return {
      category: 'complex_research',
      shouldEnableGoogleSearch: true,
      recommendedTools: Array.from(tools),
      detectedCountry,
      recency: recency === 'any' ? 'week' : recency,
      language,
      reason: 'Technology discovery or complex current-affairs research requiring multi-source synthesis.',
    };
  }

  if (asksNewsOrLive || asksWhereSnowing) {
    tools.add('google_search');
    return {
      category: 'live_search',
      shouldEnableGoogleSearch: true,
      recommendedTools: Array.from(tools),
      detectedCountry,
      recency: recency === 'any' ? 'day' : recency,
      language,
      reason: 'Live news, current events, or changing external world information.',
    };
  }

  // Questions asking about specific current officeholders, recent years (2025/2026), prices, or stats
  if (
    /(?:বর্তমান\s*(?:প্রধানমন্ত্রী|রাষ্ট্রপতি|প্রেসিডেন্ট|সিইও|চেয়ারম্যান)|কে\s*(?:এখন|বর্তমানে)|কত\s*টাকা|দাম\s*কত|2025|2026|২০২৫|২০২৬|\bwho\s+is\s+(?:the\s+)?current\b|\bcurrent\s+(?:ceo|president|prime\s+minister|price)\b)/i.test(
      query,
    )
  ) {
    tools.add('google_search');
    return {
      category: 'uncertain_or_factual_verification',
      shouldEnableGoogleSearch: true,
      recommendedTools: Array.from(tools),
      detectedCountry,
      recency: 'month',
      language,
      reason: 'Changing factual entity or post-cutoff verification.',
    };
  }

  return {
    category: 'general_conversation',
    shouldEnableGoogleSearch: false,
    recommendedTools: Array.from(tools),
    detectedCountry,
    recency: 'any',
    language,
    reason: 'General conversation or reasoning query; no web search needed.',
  };
}
