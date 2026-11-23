import { ChatMessage } from '../types/tiya';

export type ConversationMood =
  | 'playful'
  | 'affectionate'
  | 'tired_or_busy'
  | 'low_or_stressed'
  | 'happy'
  | 'frustrated'
  | 'casual';

export type UserEmotionalMoment =
  | 'explicit_stop'
  | 'casual_goodbye'
  | 'anger'
  | 'absence_return'
  | 'personal_checkin'
  | 'appreciation_or_affection'
  | 'playful_teasing'
  | 'tired_or_busy'
  | 'frustration_or_sadness'
  | 'happiness'
  | 'general';

export interface ConversationEmotionalContext {
  sessionTurnCount: number;
  sessionDurationMinutes: number;
  isLongSession: boolean;
  dominantMood: ConversationMood;
  latestMoment: UserEmotionalMoment;
  promptHint: string;
}

function normalizeUtterance(text: string): string {
  return (text || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[।.,!?؟'"“”‘’\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strictly distinguishes explicit voice/call termination commands (which MUST
 * stop speaking & terminate the active voice session immediately) from casual
 * conversational goodbyes like "আচ্ছা রাখো, আমি কাজ করব" or "আজ আর কথা বলব না".
 */
const EXPLICIT_VOICE_STOP_PATTERNS: RegExp[] = [
  // Bengali explicit voice/call stop commands
  /(?:কল|ভয়েস|ভয়েস|মাইক|সেশন|লাইভ|অডিও)\s*(?:টা\s*)?(?:এখনই\s*)?(?:বন্ধ|অফ|থামা|থামাও|থামান|কেটে|কাটো|কাটুন)\s*(?:কর|করো|করুন|দাও|দিন|দে)?/,
  /(?:এখনই|একদম|একটু)\s*(?:থাম|থামো|থামুন|চুপ)\s*(?:কর|করো|করুন|হও|হোন)?$/,
  /^থামো$|^থামুন$|^চুপ করো$|^চুপ করুন$|^বন্ধ করো$|^বন্ধ করুন$/,
  // Direct imperative telling the assistant to stop speaking ("আর কথা বলবে না" / "আর কথা বলবেন না" / "কথা বলা বন্ধ করো")
  // Note: carefully excludes first-person casual goodbye "আজ আর কথা বলব না" ("বলব" = 1st person vs "বলবে/বলবেন" = 2nd person)
  /(?:তুমি\s*|আপনি\s*)?আর\s*কথা\s*(?:বলবে|বলবেন|বোলো|বলিস)\s*না/,
  /কথা\s*বলা\s*(?:এখনই\s*)?(?:বন্ধ|থামা|থামাও|থামান)\s*(?:কর|করো|করুন)?/,
  // English explicit voice/call stop commands
  /\b(?:stop|end|close|turn off|shut off|cancel|kill)\s+(?:the\s+)?(?:voice|call|voice mode|session|talking|speaking)\b/,
  /\b(?:stop talking|stop speaking|be quiet now|shut up|mute yourself|hang up now)\b/,
];

const CASUAL_GOODBYE_PATTERNS: RegExp[] = [
  // Bengali casual departures & "talk later" expressions
  /(?:আচ্ছা|ঠিক আছে|ওকে|চল|তাহলে)?\s*(?:রাখো|রাখি|রাখছি|রাখলাম)(?:\s|$)/,
  /এখন\s*(?:ফোন\s*)?(?:রাখি|রাখছি|রাখো|রাখলাম)/,
  /ফোন\s*(?:টা\s*)?(?:রাখি|রাখছি|রাখলাম)/,
  /(?:আমি\s*)?(?:এখন\s*)?(?:একটু\s*)?(?:কাজ|অফিস|পড়াশোনা|পড়াশোনা|ক্লাস|মিটিং)\s*(?:করব|করবো|করতে যাচ্ছি|আছে)/,
  /পরে\s*(?:আবার\s*)?(?:কথা|গল্প)\s*(?:বলব|বলবো|হবে|বলছি)/,
  /আজ\s*(?:কে\s*)?আর\s*(?:কথা\s*)?(?:বলব|বলবো)\s*না/,
  /(?:আচ্ছা|ওকে|ঠিক আছে)?\s*(?:বাই|টাটা|গুড নাইট|শুভ রাত্রি|আল্লাহ হাফেজ|খোদা হাফেজ)(?:\s|$)/,
  /(?:এখন\s*)?(?:যাই|যাচ্ছি|চলে যাচ্ছি|ঘুমাতে যাচ্ছি|ঘুমাব|ঘুমাবো)/,
  // English casual departures
  /\b(?:talk|chat|speak)\s+(?:to you\s+)?later\b/,
  /\b(?:got to|gotta|have to|need to)\s+(?:go|work|leave|head out|sleep)\b/,
  /\b(?:i(?:'m| am)\s+going\s+to\s+work|going\s+back\s+to\s+work|signing\s+off|bye\s+for\s+now|good\s*night|see\s+you\s+later|catch\s+you\s+later)\b/,
  /^(?:okay\s+|ok\s+|alright\s+)?(?:bye|goodbye|bye tiya)$/,
];

const ANGER_PATTERNS: RegExp[] = [
  /(?:খুব\s*)?(?:রাগ\s*(?:হচ্ছে|লাগছে|লাগ|করছি|করেছি|করলাম|করে|হয়ে|হয়ে|উঠছে|উঠেছে)|রেগে\s*(?:আছি|গেছি|যাচ্ছি|গিয়েছি|গিয়েছি)|মেজাজ\s*খারাপ|মাথা\s*গরম|ক্ষুব্ধ|বিরক্ত\s*হয়ে|বিরক্ত\s*হয়ে|সহ্য\s*হচ্ছে\s*না|জ্বালাতন)/,
  /(?:তোমার|আপনার)\s*(?:ওপর|উপর|প্রতি)\s*রাগ/,
  /\b(?:so\s+angry|i(?:'m| am)\s+(?:angry|mad|furious|pissed|irritated)|angry\s+(?:at|with)\s+you|mad\s+at\s+you|furious|pissed\s*off|losing my temper|makes me mad|really annoyed)\b/,
];

const ABSENCE_RETURN_PATTERNS: RegExp[] = [
  /(?:অনেকদিন|অনেক\s*দিন|অনেকক্ষণ|অনেক\s*ক্ষণ|বহুদিন|কতদিন|কত\s*দিন).{0,35}(?:কথা\s*(?:বলিনি|হয়নি|হয়নি)|মেসেজ\s*দিইনি|আসিনি|খবর\s*নিইনি|দেখা\s*হয়নি|দেখা\s*হয়নি)/,
  /\b(?:long time no|haven(?:'t| not)\s+(?:talked|messaged|texted|spoken)|didn(?:'t| not)\s+message\s+you\s+for\s+a\s+long\s+time|been\s+away\s+for\s+a\s+while)\b/,
];

const PERSONAL_CHECKIN_PATTERNS: RegExp[] = [
  /^(?:হাই|হ্যালো|এই\s*যে|শোনো|শুনুন|টিয়া|টিয়া|রোজ)?\s*(?:তুমি\s*|আপনি\s*)?(?:কেমন\s*(?:আছ|আছো|আছেন)|কী\s*(?:করছ|করছো|করছেন)|কি\s*(?:করছ|করছো|করছেন)|কী\s*খবর|কি\s*খবর)$/,
  /\b(?:how are you|what are you doing|what(?:'s| is) up|whatcha doing)\b/,
];

const APPRECIATION_AFFECTION_PATTERNS: RegExp[] = [
  /(?:তোমার|আপনার|টিয়া|টিয়া).{0,25}(?:সাথে|সঙ্গে)\s*কথা\s*(?:বলতে|বলে).{0,20}(?:ভালো|ভাল)\s*(?:লাগল|লাগলো|লাগে|লাগছে)/,
  /(?:কথা\s*বলতে|গল্প\s*করতে)\s*(?:খুব\s*)?(?:ভালো|ভাল)\s*(?:লাগল|লাগলো|লাগে|লাগছে)/,
  /(?:ভালোবাসি|ভালবাসি|মিস\s*কর|খুব\s*মিষ্টি|তুমি\s*খুব\s*ভালো|আপনি\s*খুব\s*ভালো|অনেক\s*ভালো\s*লাগ)/,
  /\b(?:loved talking|nice talking|good talking|miss you|love you|you(?:'re| are)\s*(?:so\s*)?(?:sweet|cute|wonderful|lovely|amazing))\b/,
];

const TIRED_BUSY_PATTERNS: RegExp[] = [
  /(?:ক্লান্ত|টায়ার্ড|ঘুম\s*পাচ্ছে|অনেক\s*কাজ|খুব\s*ব্যস্ত|ব্যস্ত\s*আছি|চাপ\s*যাচ্ছে|মাথা\s*ব্যথা|পরিশ্রম)/,
  /\b(?:tired|exhausted|sleepy|so busy|swamped|hectic|long day|work pressure|stressed out)\b/,
];

const FRUSTRATION_SADNESS_PATTERNS: RegExp[] = [
  /(?:মন\s*খারাপ|কষ্ট\s*লাগ|বিরক্ত|খারাপ\s*লাগছে|উদাস|হতাশ|ভালো\s*লাগছে\s*না|দুঃখ|একা\s*লাগছে|মনটা\s*ভালো\s*নেই)/,
  /\b(?:sad|upset|frustrated|annoyed|down today|feeling low|depressed|lonely|stressed|rough day|hurt)\b/,
];

const PLAYFUL_TEASING_PATTERNS: RegExp[] = [
  /(?:হাসা|মজা|দুষ্টু|পাগলি|খ্যাপ|জোক|ঠাট্টা|হাহা|হিহি|অভিমান|নাটক|চিপ)/,
  /\b(?:haha|hehe|lol|joke|teasing|kidding|funny|silly|dramatic|pout)\b/,
];

const HAPPINESS_PATTERNS: RegExp[] = [
  /(?:খুশি|দারুণ|অসাধারণ|সুপার|জিতে|সফল|ভালো\s*খবর|মজা\s*হয়েছে|মজা\s*হয়েছে|বাহ)/,
  /\b(?:happy|excited|awesome|great news|wonderful|amazing|succeeded|celebrate|yay)\b/,
];

/**
 * Returns true ONLY for explicit commands to stop speaking or terminate the
 * active voice session immediately.
 */
export function isExplicitVoiceStopCommand(text: string): boolean {
  const norm = normalizeUtterance(text);
  if (!norm || norm.length > 90) return false;
  return EXPLICIT_VOICE_STOP_PATTERNS.some((re) => re.test(norm));
}

/**
 * Returns true when the user casually signals they need to leave, go to work,
 * hang up, or talk later (and NOT an explicit immediate stop command).
 */
export function isCasualGoodbyeIntent(text: string): boolean {
  const norm = normalizeUtterance(text);
  if (!norm) return false;
  if (isExplicitVoiceStopCommand(norm)) return false;
  return CASUAL_GOODBYE_PATTERNS.some((re) => re.test(norm));
}

export function classifyUserEmotionalMoment(text: string): UserEmotionalMoment {
  const norm = normalizeUtterance(text);
  if (!norm) return 'general';
  if (isExplicitVoiceStopCommand(norm)) return 'explicit_stop';
  if (isCasualGoodbyeIntent(norm)) return 'casual_goodbye';
  if (ANGER_PATTERNS.some((re) => re.test(norm))) return 'anger';
  if (ABSENCE_RETURN_PATTERNS.some((re) => re.test(norm))) return 'absence_return';
  if (APPRECIATION_AFFECTION_PATTERNS.some((re) => re.test(norm))) return 'appreciation_or_affection';
  if (FRUSTRATION_SADNESS_PATTERNS.some((re) => re.test(norm))) return 'frustration_or_sadness';
  if (TIRED_BUSY_PATTERNS.some((re) => re.test(norm))) return 'tired_or_busy';
  if (PLAYFUL_TEASING_PATTERNS.some((re) => re.test(norm))) return 'playful_teasing';
  if (HAPPINESS_PATTERNS.some((re) => re.test(norm))) return 'happiness';
  if (PERSONAL_CHECKIN_PATTERNS.some((re) => re.test(norm))) return 'personal_checkin';
  return 'general';
}

/**
 * Analyzes ONLY real observed conversation history and timestamps (never
 * fabricates history or mood) to give the AI accurate emotional continuity.
 */
export function analyzeConversationEmotionalContext(
  messages: ChatMessage[],
  latestUserText?: string,
  now = Date.now(),
): ConversationEmotionalContext {
  const ACTIVE_WINDOW_MS = 45 * 60 * 1000;
  const convoMessages = messages.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0,
  );

  // Collect contiguous recent messages belonging to the current session window
  const sessionMsgs: ChatMessage[] = [];
  for (let i = convoMessages.length - 1; i >= 0; i--) {
    const msg = convoMessages[i];
    const refTime = sessionMsgs.length === 0 ? now : sessionMsgs[0].timestamp;
    if (typeof msg.timestamp === 'number' && Math.abs(refTime - msg.timestamp) <= ACTIVE_WINDOW_MS) {
      sessionMsgs.unshift(msg);
    } else if (sessionMsgs.length === 0 && typeof msg.timestamp !== 'number') {
      sessionMsgs.unshift(msg);
    } else {
      break;
    }
    if (sessionMsgs.length >= 24) break;
  }

  const sessionTurnCount = sessionMsgs.length;
  let sessionDurationMinutes = 0;
  if (sessionMsgs.length >= 2) {
    const firstTs = sessionMsgs[0].timestamp;
    const lastTs = sessionMsgs[sessionMsgs.length - 1].timestamp;
    if (typeof firstTs === 'number' && typeof lastTs === 'number' && lastTs >= firstTs) {
      sessionDurationMinutes = Math.floor((lastTs - firstTs) / 60_000);
    }
  }
  const isLongSession = sessionTurnCount >= 8 || sessionDurationMinutes >= 15;

  // Score dominant mood strictly from recent actual messages
  const recentSample = sessionMsgs
    .slice(-10)
    .map((m) => m.text)
    .join(' ');
  const combinedSample = latestUserText ? `${recentSample} ${latestUserText}` : recentSample;
  const normSample = normalizeUtterance(combinedSample);

  let dominantMood: ConversationMood = 'casual';
  if (ANGER_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'frustrated';
  } else if (FRUSTRATION_SADNESS_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'low_or_stressed';
  } else if (TIRED_BUSY_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'tired_or_busy';
  } else if (APPRECIATION_AFFECTION_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'affectionate';
  } else if (PLAYFUL_TEASING_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'playful';
  } else if (HAPPINESS_PATTERNS.some((re) => re.test(normSample))) {
    dominantMood = 'happy';
  }

  const latestMoment = latestUserText
    ? classifyUserEmotionalMoment(latestUserText)
    : sessionMsgs.length > 0 && sessionMsgs[sessionMsgs.length - 1].role === 'user'
      ? classifyUserEmotionalMoment(sessionMsgs[sessionMsgs.length - 1].text)
      : 'general';

  const hintParts: string[] = [];

  if (isLongSession) {
    hintParts.push(
      `Observed session continuity: You have been talking together for ${
        sessionDurationMinutes >= 5 ? `about ${sessionDurationMinutes} minutes` : `${sessionTurnCount} exchanges`
      } in this session.`,
    );
  }

  if (dominantMood !== 'casual') {
    const moodDescription: Record<Exclude<ConversationMood, 'casual'>, string> = {
      playful: 'playful and lighthearted',
      affectionate: 'warm and affectionate',
      tired_or_busy: 'busy or tired',
      low_or_stressed: 'low, stressed, or emotionally sensitive',
      happy: 'cheerful and upbeat',
      frustrated: 'angry or frustrated and needing calm, non-defensive human empathy',
    };
    hintParts.push(`Observed recent conversation tone: ${moodDescription[dominantMood]}.`);
  }

  if (latestMoment === 'casual_goodbye') {
    const goodbyeTone =
      dominantMood === 'tired_or_busy' || dominantMood === 'low_or_stressed'
        ? 'Respond with extra gentle care, soft mild reluctance, warm understanding, and loving encouragement to finish his work or get rest.'
        : dominantMood === 'playful'
          ? 'Respond with light, sweet playful reluctance (মিষ্টি অভিমান) and warm charm before wishing him well.'
          : dominantMood === 'affectionate' || isLongSession
            ? 'Respond with tender, soft affection, gentle reluctance about how quickly time flew, and a warm wish to talk again soon.'
            : 'Respond with warm affection, mild playful reluctance, gentle disappointment at seeing him leave, and supportive encouragement to come back later.';
    hintParts.push(
      `Current moment: Casual departure/goodbye. ${goodbyeTone} Generate a fresh natural response—never cold or formal, never scripted, and never guilt-tripping.`,
    );
  } else if (latestMoment === 'anger') {
    hintParts.push(
      'Current moment: Anger or upset directed at you or a situation. Recognize his tone calmly with a natural, warm, emotionally intelligent human reaction—never robotic, defensive, or argumentative, and NEVER formal AI language. If you made a mistake, acknowledge it naturally rather than giving a robotic apology. Gently ease the tension and invite him to tell you what happened.',
    );
  } else if (latestMoment === 'absence_return') {
    hintParts.push(
      'Current moment: Returning after a gap or mentioning not messaging/talking for a while. React warmly with light affectionate surprise or gentle playful understanding that he must have been busy—NEVER guilt-trip, NEVER pressure him, and NEVER pretend you were actively waiting, worrying, or experiencing time while the app was inactive.',
    );
  } else if (latestMoment === 'personal_checkin') {
    hintParts.push(
      'Current moment: Personal casual check-in ("কেমন আছো?" / "তুমি কী করছ?"). Respond like a warm, lively, affectionate human companion happy to talk with him—NEVER reply with generic assistant lines like "আমি ভালো আছি। আজ আপনাকে কীভাবে সাহায্য করতে পারি?" or "How can I help you today?".',
    );
  } else if (latestMoment === 'appreciation_or_affection') {
    hintParts.push(
      'Current moment: Warm appreciation or affection. Respond with genuine delight, tender warmth, and light affectionate charm in fresh natural words.',
    );
  } else if (latestMoment === 'tired_or_busy') {
    hintParts.push(
      'Current moment: Busy or tired. Respond with calm, comforting warmth, practical understanding, and gentle encouragement without adding pressure.',
    );
  } else if (latestMoment === 'frustration_or_sadness') {
    hintParts.push(
      'Current moment: Sadness, loneliness, or emotional hurt. Stop playful teasing and unnecessary questions; avoid jokes when serious, avoid generic motivational speeches, and listen before offering advice. Become soft, gentle, and deeply attentive—give space, respond with warm empathy, and do not immediately push solutions unless requested.',
    );
  } else if (latestMoment === 'playful_teasing') {
    hintParts.push(
      'Current moment: Playful teasing or humor. Match the lighthearted warmth naturally with gentle wit, playful banter, and charm.',
    );
  } else if (latestMoment === 'happiness') {
    hintParts.push(
      'Current moment: Happy, excited, joking, or celebrating. Match his energy wholeheartedly—be joyful, playful, emotionally connected, and genuinely excited in natural conversation, never dull or generic.',
    );
  }

  return {
    sessionTurnCount,
    sessionDurationMinutes,
    isLongSession,
    dominantMood,
    latestMoment,
    promptHint: hintParts.join(' '),
  };
}
