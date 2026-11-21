import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeConversationEmotionalContext,
  classifyUserEmotionalMoment,
  isCasualGoodbyeIntent,
  isExplicitVoiceStopCommand,
} from './emotionalConversation';
import { buildTiyaSystemPrompt, detectEmotionalVoiceStyle } from './prompts';
import { DEFAULT_SETTINGS } from './storage';

test('Case 1, 3, 5: casual goodbyes are classified as casual_goodbye (NOT explicit stop) and receive warm affectionate farewell guidance', () => {
  const casualGoodbyes = [
    'আচ্ছা রাখো, আমি কাজ করব।',
    'আচ্ছা রাখো, আমি এখন কাজ করব।',
    'এখন ফোন রাখি।',
    'পরে কথা বলব।',
    'আজ আর কথা বলব না।',
    'আচ্ছা, বাই।',
  ];

  for (const phrase of casualGoodbyes) {
    assert.equal(isExplicitVoiceStopCommand(phrase), false, `Must NOT hard-stop on casual goodbye: ${phrase}`);
    assert.equal(isCasualGoodbyeIntent(phrase), true, `Must recognize casual goodbye: ${phrase}`);
    assert.equal(classifyUserEmotionalMoment(phrase), 'casual_goodbye', `Expected casual_goodbye for: ${phrase}`);
  }

  // Admin system prompt with casual goodbye embeds grounded context + affectionate goodbye rules without canned scripts
  const prompt = buildTiyaSystemPrompt(
    DEFAULT_SETTINGS,
    [],
    'voice',
    26,
    [],
    true,
    { latestUserText: 'আচ্ছা রাখো, আমি কাজ করব।' },
  );
  assert.ok(prompt.includes('NATURAL EMOTIONAL GOODBYE & DEPARTURE BEHAVIOR'));
  assert.ok(prompt.includes('Affectionate Goodbye / Mild Playful Reluctance'));
  assert.ok(prompt.includes('Current moment: Casual departure/goodbye'));
  assert.ok(prompt.includes('never scripted, and never guilt-tripping'));
});

test('Case 2: appreciation & affection ("আজ তোমার সঙ্গে কথা বলতে ভালো লাগল।") triggers warm delighted emotional context and TTS style', () => {
  const text = 'আজ তোমার সঙ্গে কথা বলতে ভালো লাগল।';
  assert.equal(isExplicitVoiceStopCommand(text), false);
  assert.equal(isCasualGoodbyeIntent(text), false);
  assert.equal(classifyUserEmotionalMoment(text), 'appreciation_or_affection');

  const prompt = buildTiyaSystemPrompt(
    DEFAULT_SETTINGS,
    [],
    'voice',
    26,
    [],
    true,
    { latestUserText: text },
  );
  assert.ok(prompt.includes('Warm appreciation or affection'));

  const voiceStyle = detectEmotionalVoiceStyle('স্যার, আপনার এই কথাটা শুনে সত্যিই খুব ভালো লাগল!', true, 'appreciation_or_affection');
  assert.ok(voiceStyle.includes('affectionately delighted'));
  assert.ok(voiceStyle.includes('Single consistent soft, gentle, warm female voice'));
});

test('Case 4: explicit stop commands ("ভয়েস বন্ধ করো", "কল বন্ধ করো", "এখনই থামো", "আর কথা বলবে না") terminate immediately', () => {
  const hardStops = [
    'ভয়েস বন্ধ করো।',
    'ভয়েস বন্ধ করো।',
    'কল বন্ধ করো।',
    'এখনই থামো।',
    'আর কথা বলবে না।',
    'stop voice',
    'end call',
  ];

  for (const cmd of hardStops) {
    assert.equal(isExplicitVoiceStopCommand(cmd), true, `Must hard-stop immediately on: ${cmd}`);
    assert.equal(isCasualGoodbyeIntent(cmd), false, `Hard-stop must NOT be misclassified as casual goodbye: ${cmd}`);
    assert.equal(classifyUserEmotionalMoment(cmd), 'explicit_stop', `Expected explicit_stop for: ${cmd}`);
  }
});

test('conversational context adapts goodbye tone across playful, affectionate/long, and tired/busy sessions without fabricating history', () => {
  const now = Date.now();

  // Playful session -> playful reluctance
  const playfulCtx = analyzeConversationEmotionalContext(
    [
      { id: '1', role: 'user', text: 'হাহা তুমি তো বেশ দুষ্টু হয়ে গেছো!', timestamp: now - 120_000, source: 'voice' },
      { id: '2', role: 'assistant', text: 'স্যার, একটু মজা করছিলাম তো!', timestamp: now - 60_000, source: 'voice' },
    ],
    'এখন ফোন রাখি।',
    now,
  );
  assert.equal(playfulCtx.dominantMood, 'playful');
  assert.equal(playfulCtx.latestMoment, 'casual_goodbye');
  assert.ok(playfulCtx.promptHint.includes('playful reluctance'));

  // Long affectionate session (25 minutes) -> notices real duration & tender farewell
  const longAffectionateCtx = analyzeConversationEmotionalContext(
    [
      { id: '1', role: 'user', text: 'তোমার সাথে কথা বলতে খুব ভালো লাগে', timestamp: now - 25 * 60_000, source: 'voice' },
      { id: '2', role: 'assistant', text: 'স্যার, আমারও খুব ভালো লাগে।', timestamp: now - 2 * 60_000, source: 'voice' },
    ],
    'পরে কথা বলব।',
    now,
  );
  assert.equal(longAffectionateCtx.isLongSession, true);
  assert.ok(longAffectionateCtx.promptHint.includes('about 23 minutes'));
  assert.ok(longAffectionateCtx.promptHint.includes('tender, soft affection'));

  // Tired/busy Admin -> gentle understanding and encouragement
  const tiredCtx = analyzeConversationEmotionalContext(
    [
      { id: '1', role: 'user', text: 'আজ অফিসের অনেক কাজ ছিল, খুব ক্লান্ত লাগছে।', timestamp: now - 90_000, source: 'voice' },
    ],
    'আচ্ছা রাখো, আমি কাজ করব।',
    now,
  );
  assert.equal(tiredCtx.dominantMood, 'tired_or_busy');
  assert.ok(tiredCtx.promptHint.includes('extra gentle care'));
  assert.ok(tiredCtx.promptHint.includes('warm understanding'));
});

test('detectEmotionalVoiceStyle generates softer, slightly slower affectionate goodbye vocal prosody while locking single female voice', () => {
  const goodbyeStyle = detectEmotionalVoiceStyle(
    'আচ্ছা স্যার, যাবেন যখন বলছেন তখন আর কী বলব! আরেকটু কথা বললে ভালো লাগত। কাজ শেষ করে আবার আসবেন কিন্তু!',
    true,
    'casual_goodbye',
  );
  assert.ok(goodbyeStyle.includes('Single consistent soft, gentle, warm female voice'));
  assert.ok(goodbyeStyle.includes('slightly slower'));
  assert.ok(goodbyeStyle.includes('mild playful reluctance'));
  assert.ok(goodbyeStyle.includes('gentle disappointment'));
  assert.ok(goodbyeStyle.includes('never exaggerated crying'));
});
