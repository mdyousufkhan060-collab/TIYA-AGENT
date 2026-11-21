/**
 * TIYA client-side "server".
 *
 * TIYA used to send every AI request through server.ts (Express + WebSocket). That
 * server only runs inside the AI Studio preview, NOT on Vercel or inside the Android
 * app — so on tiya-ai.vercel.app key tests, chat, mic and live voice all failed.
 *
 * This file does the same work directly from the phone/browser (like ROSE):
 *  - installClientApi(): answers the old "/api/..." fetch calls locally
 *  - LocalLiveSocket: drop-in replacement for the "/ws/live" WebSocket
 * The API keys never leave the device except to Google / Groq themselves.
 */
import {
  ApiError,
  generateContent,
  getGroqKey,
  groqChat,
  groqTranscribe,
  isBadKey,
  listGeminiModels,
  pickChatModels,
  pickLiveModels,
  pickTtsModels,
  responseAudio,
  responseCalls,
  responseText,
} from './geminiRest';
import { classifyGeminiError } from '../utils/errorClassifier';
import {
  analyzeConversationEmotionalContext,
  classifyUserEmotionalMoment,
  isExplicitVoiceStopCommand,
  UserEmotionalMoment,
} from '../utils/emotionalConversation';
import { getConfirmationPromptText, validatePhoneAction } from '../utils/phoneActions';
import { detectEmotionalVoiceStyle, enforceAdminAddressingText } from '../utils/prompts';
import { validateNavigateToolArgs } from '../utils/tiyaNavigation';
import {
  computeNaturalPlaybackRate,
  DEFAULT_LOCKED_FEMALE_VOICE,
  resolveCanonicalFemaleVoice,
} from '../utils/voiceAudioPipeline';
import {
  buildLiveIntelToolSchemas,
  executeIntelTool,
  extractGroundingMetadata,
  GroundedSearchRunner,
  isLiveIntelToolName,
  mergeGroundingMetadata,
} from '../utils/liveIntelRouter';
import { decideSearchStrategy } from '../utils/searchDecisionEngine';
import { BENGALI_DIALECTS, DEFAULT_LIVE_MODELS, LiveModelInfo, LiveSearchMetadata, languageCode } from '../types/tiya';

function createRestGroundedSearchRunner(
  apiKey: string,
  preferredModel?: string,
): GroundedSearchRunner {
  return async ({ prompt, systemInstruction }) => {
    const models = await pickChatModels(apiKey, preferredModel);
    let lastMsg = 'Google Search Grounding could not complete.';
    let quotaHit = false;

    for (const model of models) {
      try {
        const res = await generateContent(
          apiKey,
          model,
          {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools: [{ google_search: {} }],
          },
          28000,
        );
        const rawMeta = res?.candidates?.[0]?.groundingMetadata;
        const grounding = extractGroundingMetadata(rawMeta, ['google_search']) || {
          usedTools: ['google_search'],
          sources: [],
          searchQueries: [],
          searchSuggestions: [],
          retrievedAt: new Date().toISOString(),
        };
        const summary = responseText(res);
        if (summary || grounding.sources.length > 0) {
          return { ok: true, summary, grounding };
        }
      } catch (err: unknown) {
        const msg = errMsg(err);
        lastMsg = msg;
        if (/429|resource_exhausted|quota/i.test(msg)) {
          quotaHit = true;
          continue;
        }
        if (isBadKey(err)) break;
      }
    }

    return {
      ok: false,
      error: lastMsg,
      quotaExceeded: quotaHit,
      unavailable: true,
      service: 'Gemini Google Search Grounding',
      ...(quotaHit
        ? {
            paidTierNote:
              'Gemini API free-tier search grounding quota was reached. Higher search grounding limits require a billing-enabled Gemini API key.',
          }
        : {}),
    };
  };
}


const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function buildPhoneActionTool(nonBlocking: boolean): Record<string, unknown> {
  return {
    name: 'trigger_phone_action',
    description:
      'Requests a structured phone action (open_app, call, whatsapp_call, whatsapp_message, messenger_message, messenger_call). Always call this when the user wants to open an app, call someone, or send a WhatsApp/Messenger message.',
    ...(nonBlocking ? { behavior: 'NON_BLOCKING' } : {}),
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'One of: open_app, call, whatsapp_call, whatsapp_message, messenger_message, messenger_call',
        },
        app: { type: 'STRING', description: 'App name when action is open_app (e.g. YouTube)' },
        contact: { type: 'STRING', description: 'Contact name or phone number for call/message actions' },
        text: { type: 'STRING', description: 'Message text for whatsapp_message or messenger_message' },
      },
      required: ['action'],
    },
  };
}

function buildNavigateAppTool(nonBlocking: boolean): Record<string, unknown> {
  return {
    name: 'navigate_app',
    description:
      'Opens a TIYA screen or settings page/subpage, or navigates back. Use whenever the user asks to open Settings, a numbered Settings bar, Home, Chat, Mic Test, Privacy Controls, etc.',
    ...(nonBlocking ? { behavior: 'NON_BLOCKING' } : {}),
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'open or back' },
        tab: { type: 'STRING', description: 'home, chat, or settings' },
        page: {
          type: 'STRING',
          description:
            'Settings page ID: hub, about, connections, live_model, voice_language, chats_memory, look_feel, phone_control, developer_tools, privacy_controls, my_account, premium',
        },
        subpage: { type: 'STRING', description: 'Optional subpage ID inside a Settings page (e.g. mic_test, health_check)' },
      },
      required: ['action'],
    },
  };
}

function buildGetLatestMotivationTool(nonBlocking: boolean): Record<string, unknown> {
  return {
    name: 'get_latest_motivation',
    description:
      'Fetches the latest published motivation post so TIYA can read it to the user in Bengali. Call this whenever the user asks for daily or today’s motivation.',
    ...(nonBlocking ? { behavior: 'NON_BLOCKING' } : {}),
    parameters: { type: 'OBJECT', properties: {} },
  };
}

type ApiResult = { status: number; json: Record<string, unknown> };
const ok = (json: Record<string, unknown>): ApiResult => ({ status: 200, json });
const fail = (status: number, label: string, detail: string): ApiResult => ({
  status,
  json: { ok: false, label, detail },
});
const failFromError = (err: unknown): ApiResult => {
  const c = classifyGeminiError(errMsg(err));
  return fail(400, c.label, c.detail);
};

// Chat models tried in order when the chosen one is not available on this key


async function handle(path: string, key: string, body: any): Promise<ApiResult> {
  switch (path) {
    case '/api/health':
      return ok({ ok: true, backend: 'client', serverGeminiReady: false });

    case '/api/intel/tool': {
      const toolName = String(body?.tool || '').trim();
      if (!toolName || !isLiveIntelToolName(toolName)) {
        return fail(400, 'Invalid tool', 'Unsupported or missing intelligence tool.');
      }
      const runGroundedSearch = key
        ? createRestGroundedSearchRunner(key, body?.model)
        : undefined;
      const outcome = await executeIntelTool(toolName, (body?.args || {}) as Record<string, unknown>, {
        defaultTimezone: typeof body?.defaultTimezone === 'string' ? body.defaultTimezone : undefined,
        runGroundedSearch,
        fetchFn: nativeFetch,
      });
      return ok({
        ok: true,
        tool: outcome.toolName,
        result: outcome.result,
        grounding: outcome.grounding || null,
      });
    }

    case '/api/gemini/test-key': {
      if (!key) return fail(401, 'No API key', 'Enter your Gemini API key first.');
      try {
        const models = await listGeminiModels(key, true);
        return ok({ ok: true, label: 'READY', detail: `API key verified (${models.length} models).` });
      } catch (err) {
        return failFromError(err);
      }
    }
    case '/api/gemini/models': {
      if (!key) return fail(401, 'No API key', 'Add your Gemini API key in Connections.');
      try {
        const models = await listGeminiModels(key, true);
        const live = models
          .filter((m) => m.methods.some((x) => /bidigeneratecontent/i.test(x)))
          .map((m) => ({ id: m.id, displayName: m.displayName || m.id, description: m.description || 'Gemini Live voice model' }));
        return ok({ ok: true, models: live.length ? live : DEFAULT_LIVE_MODELS });
      } catch (err) {
        return failFromError(err);
      }
    }
    case '/api/providers/test-key': {
      const provider = String(body?.provider || '');
      const cleanKey = String(body?.apiKey || '').trim();
      if (!cleanKey) return fail(401, 'ERROR', 'No API key entered.');
      const endpoints: Record<string, { url: string; headers: Record<string, string> }> = {
        groq: { url: 'https://api.groq.com/openai/v1/models', headers: { Authorization: `Bearer ${cleanKey}` } },
        openrouter: { url: 'https://openrouter.ai/api/v1/models', headers: { Authorization: `Bearer ${cleanKey}` } },
        github: {
          url: 'https://api.github.com/user',
          headers: { Authorization: `Bearer ${cleanKey}`, Accept: 'application/vnd.github+json' },
        },
        openai: { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${cleanKey}` } },
      };
      const target = endpoints[provider];
      if (!target) return fail(400, 'ERROR', 'Unsupported provider.');
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 10000);
        const r = await nativeFetch(target.url, { method: 'GET', headers: target.headers, signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) return ok({ ok: true, label: 'READY', detail: `${provider.toUpperCase()} key verified and ready.` });
        if (r.status === 401 || r.status === 403) return fail(400, 'ERROR', 'Invalid key — please copy it again.');
        return fail(400, 'ERROR', `Key check failed (HTTP ${r.status}).`);
      } catch {
        return fail(400, 'ERROR', 'Network error while testing key.');
      }
    }

    case '/api/gemini/chat-models': {
      if (!key) return fail(401, 'No API key', 'Add your Gemini API key first.');
      try {
        const models = await listGeminiModels(key, true);
        const list = models
          .filter(
            (m) =>
              m.methods.some((x) => x === 'generateContent') &&
              !/tts|live|native-audio|image|embedding|aqa|veo|imagen/i.test(m.id),
          )
          .map((m) => ({ id: m.id, displayName: m.displayName || m.id, description: m.description || 'Gemini text model' }));
        return ok({ ok: true, models: list.slice(0, 30) });
      } catch (err) {
        return failFromError(err);
      }
    }
    case '/api/gemini/chat': {
      const message = String(body?.message || '');
      if (!message.trim()) return fail(400, 'Invalid request', 'Message cannot be empty.');
      const history: Array<{ role: 'user' | 'assistant'; text: string }> = (Array.isArray(body?.history) ? body.history : [])
        .slice(-16)
        .map((h: any) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', text: String(h.text || '') }))
        .filter((h: any) => h.text.trim());
      const baseSystem = String(body?.systemInstruction || 'You are TIYA, a helpful Bengali-default AI assistant.');
      const decision = decideSearchStrategy(message);
      const decisionHint =
        decision.category === 'general_conversation'
          ? ''
          : `\n\n[Live Search Decision Engine — Do NOT mention these brackets]: Category=${decision.category}. Recommended tools=${decision.recommendedTools.join(', ') || 'none'}.${
              decision.detectedCountry ? ` Focus region=${decision.detectedCountry}.` : ''
            } Recency=${decision.recency}. Always call the appropriate live tool or Google Search Grounding before answering—never guess live facts.`;
      const system = `${baseSystem}${decisionHint}`;
      let lastErr: unknown = null;

      if (key) {
        const groundedRunner = createRestGroundedSearchRunner(key, body?.model);
        const allFunctionDecls = [
          buildPhoneActionTool(false),
          buildNavigateAppTool(false),
          buildGetLatestMotivationTool(false),
          ...buildLiveIntelToolSchemas(false),
        ];

        for (const model of await pickChatModels(key, body?.model)) {
          try {
            const contents: Array<Record<string, unknown>> = [
              ...history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
              { role: 'user', parts: [{ text: message }] },
            ];
            const collectedGrounding: Array<LiveSearchMetadata | null | undefined> = [];
            let action = null;
            let navigate = null;
            let needsMotivation = false;
            let text = '';

            for (let step = 0; step < 3; step++) {
              const enableNativeSearch = decision.shouldEnableGoogleSearch && step === 0;
              let res: any;
              if (enableNativeSearch) {
                try {
                  res = await generateContent(key, model, {
                    contents,
                    systemInstruction: { parts: [{ text: system }] },
                    tools: [{ google_search: {} }, { functionDeclarations: allFunctionDecls }],
                    toolConfig: { includeServerSideToolInvocations: true },
                  });
                } catch (hybridErr) {
                  if (isBadKey(hybridErr)) throw hybridErr;
                  res = await generateContent(key, model, {
                    contents,
                    systemInstruction: { parts: [{ text: system }] },
                    tools: [{ functionDeclarations: allFunctionDecls }],
                  });
                }
              } else {
                res = await generateContent(key, model, {
                  contents,
                  systemInstruction: { parts: [{ text: system }] },
                  tools: [{ functionDeclarations: allFunctionDecls }],
                });
              }

              const candGrounding = extractGroundingMetadata(
                res?.candidates?.[0]?.groundingMetadata,
                res?.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ? ['google_search'] : [],
              );
              if (candGrounding) collectedGrounding.push(candGrounding);

              const calls = responseCalls(res);
              if (calls.length === 0) {
                text = responseText(res);
                break;
              }

              const intelParts: Array<Record<string, unknown>> = [];
              for (const call of calls) {
                if (call.name === 'trigger_phone_action' && !action) action = validatePhoneAction(call.args);
                else if (call.name === 'navigate_app' && !navigate) navigate = validateNavigateToolArgs(call.args);
                else if (call.name === 'get_latest_motivation') needsMotivation = true;
                else if (isLiveIntelToolName(call.name)) {
                  const outcome = await executeIntelTool(call.name, call.args || {}, {
                    defaultTimezone: typeof body?.defaultTimezone === 'string' ? body.defaultTimezone : undefined,
                    runGroundedSearch: groundedRunner,
                    fetchFn: nativeFetch,
                  });
                  if (outcome.grounding) collectedGrounding.push(outcome.grounding);
                  intelParts.push({
                    functionResponse: {
                      name: call.name,
                      response: outcome.result,
                    },
                  });
                }
              }

              if (intelParts.length === 0) {
                text = responseText(res);
                break;
              }

              const prevContent = res?.candidates?.[0]?.content;
              if (prevContent) contents.push(prevContent);
              contents.push({ role: 'user', parts: intelParts });
            }

            if (action && !text) text = getConfirmationPromptText(action);
            else if (navigate && !text) text = (navigate as any).confirmBn || '';
            const grounding = mergeGroundingMetadata(collectedGrounding);
            return ok({
              ok: true,
              text: text || 'বলুন, কীভাবে সাহায্য করতে পারি?',
              action,
              navigate,
              needsMotivation,
              grounding: grounding || null,
              searchDecision: decision.category,
              model,
            });
          } catch (err) {
            lastErr = err;
            if (isBadKey(err)) break;
          }
        }
      }

      // Gemini not working → Groq answers instead
      const groqKey = getGroqKey();
      if (groqKey) {
        try {
          const text = await groqChat(groqKey, system, history, message);
          return ok({ ok: true, text, action: null, navigate: null, needsMotivation: false, grounding: null, model: 'groq' });
        } catch (err) {
          lastErr = lastErr || err;
        }
      }
      if (!key && !groqKey) return fail(401, 'No API key', 'Add your Gemini or Groq API key in Settings > Connections.');
      return failFromError(lastErr);
    }
    case '/api/gemini/transcribe': {
      if (!body?.audioBase64) return fail(400, 'Invalid audio', 'No audio data received.');
      const groqKey = getGroqKey();
      let lastErr: unknown = null;
      if (groqKey) {
        try {
          const bin = atob(String(body.audioBase64));
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const type = String(body.mimeType || 'audio/webm');
          const blob = new Blob([bytes], { type });
          const form = new FormData();
          const text = await groqTranscribe(groqKey, new File([blob], type.includes('wav') ? 'a.wav' : 'a.webm', { type }), languageCode(body.language));
          void form;
          if (text) return ok({ ok: true, text });
        } catch (err) {
          lastErr = err;
        }
      }
      if (key) {
        for (const model of await pickChatModels(key)) {
          try {
            const res = await generateContent(key, model, {
              contents: [
                {
                  role: 'user',
                  parts: [
                    { inlineData: { mimeType: body.mimeType || 'audio/webm', data: body.audioBase64 } },
                    {
                      text: `Transcribe the spoken audio accurately in its original language (expected: ${
                        body.language || 'Bengali'
                      }), in that language's own script. Output only the words.`,
                    },
                  ],
                },
              ],
            });
            return ok({ ok: true, text: responseText(res) });
          } catch (err) {
            lastErr = err;
            if (isBadKey(err)) break;
          }
        }
      }
      if (!key && !groqKey) return fail(401, 'No API key', 'Add your Gemini or Groq API key in Settings > Connections.');
      return failFromError(lastErr);
    }
    case '/api/gemini/voice-check': {
      if (!key) return fail(401, 'No API key', 'Add your Gemini API key in Settings > Connections.');
      const lockedVoice = resolveCanonicalFemaleVoice(body?.voiceName);
      const name = String(body?.assistantName || '').trim() || 'তিয়া';
      const userPart = body?.isOwner
        ? ' স্যার,'
        : String(body?.yourName || '').trim()
          ? ` ${String(body.yourName).trim()},`
          : '';
      const samples: Record<string, string> = {
        Bengali: `হ্যালো${userPart} আমি ${name}। আপনার ভয়েস সেটআপ একদম ঠিক আছে!`,
        English: `Hello${userPart} I am ${name}. Your voice check is working clearly.`,
        Urdu: `السلام علیکم${userPart} میں ${name} ہوں۔ آپ کی آواز بالکل ٹھیک کام کر رہی ہے۔`,
        Hindi: `नमस्ते${userPart} मैं ${name} हूँ। आपकी आवाज़ बिल्कुल सही काम कर रही है।`,
        Arabic: `مرحباً${userPart} أنا ${name}. تم ضبط الصوت بنجاح.`,
        Nepali: `नमस्ते${userPart} म ${name} हुँ। तपाईंको आवाज ठीकसँग काम गरिरहेको छ।`,
        Tamil: `வணக்கம்${userPart} நான் ${name}. உங்கள் குரல் சரியாக வேலை செய்கிறது.`,
        Malay: `Helo${userPart} saya ${name}. Suara anda berfungsi dengan baik.`,
        Indonesian: `Halo${userPart} aku ${name}. Suaramu sudah berfungsi dengan baik.`,
        Turkish: `Merhaba${userPart} ben ${name}. Ses ayarın gayet iyi çalışıyor.`,
        Persian: `سلام${userPart} من ${name} هستم. صدای شما به خوبی کار می‌کند.`,
        Spanish: `Hola${userPart} soy ${name}. Tu voz funciona perfectamente.`,
        French: `Bonjour${userPart} je suis ${name}. Ta voix fonctionne parfaitement.`,
        German: `Hallo${userPart} ich bin ${name}. Deine Stimme funktioniert einwandfrei.`,
        Italian: `Ciao${userPart} sono ${name}. La tua voce funziona perfettamente.`,
        Portuguese: `Olá${userPart} eu sou a ${name}. Sua voz está funcionando muito bem.`,
        Russian: `Привет${userPart} я ${name}. Твой голос работает отлично.`,
        Chinese: `你好${userPart}我是${name}。你的语音设置一切正常。`,
        Japanese: `こんにちは${userPart}私は${name}です。音声はばっちり動いています。`,
        Korean: `안녕하세요${userPart} 저는 ${name}예요. 음성이 잘 작동하고 있어요.`,
        Thai: `สวัสดีค่ะ${userPart} ฉันชื่อ${name} เสียงของคุณใช้งานได้ดีค่ะ`,
        Vietnamese: `Xin chào${userPart} mình là ${name}. Giọng nói của bạn hoạt động rất tốt.`,
      };
      const dialect = BENGALI_DIALECTS.find((d) => d.id === body?.bengaliDialect);
      const text =
        (body?.language || 'Bengali') === 'Bengali' && dialect && dialect.id !== 'Standard'
          ? dialect.sample
          : samples[body?.language || 'Bengali'] || samples.Bengali;
      let lastErr: unknown = null;
      for (const model of await pickTtsModels(key, body?.ttsModel)) {
        try {
          const res = await generateContent(key, model, {
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: lockedVoice } } },
            },
          });
          const audio = responseAudio(res);
          if (audio) return ok({ ok: true, audioBase64: audio.data, mimeType: audio.mimeType, text });
        } catch (err) {
          lastErr = err;
          if (isBadKey(err)) break;
        }
      }
      void lastErr;
      return fail(
        502,
        'Voice not available',
        `Google voice is not available on this key right now. ${String((lastErr as any)?.message || '').slice(0, 140)}`,
      );
    }

    default:
      return fail(404, 'Not found', `Unknown endpoint ${path}`);
  }
}

// ---------------------------------------------------------------------------
// fetch interceptor for "/api/..." calls
// Uses real Express backend (server.ts) for /api/intel/tool when available,
// and seamlessly handles all "/api/..." routes on static/Vercel/Android builds.
// ---------------------------------------------------------------------------
let nativeFetch: typeof fetch = (...args) => fetch(...args);
let serverBackendProbe: Promise<boolean> | null = null;

function probeServerBackend(): Promise<boolean> {
  if (!serverBackendProbe) {
    serverBackendProbe = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1800);
        const r = await nativeFetch('/api/health', { method: 'GET', signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return false;
        const j = (await r.json().catch(() => ({}))) as { backend?: string };
        return j?.backend === 'server';
      } catch {
        return false;
      }
    })();
  }
  return serverBackendProbe;
}

export function installClientApi(): void {
  if (typeof window === 'undefined' || (window as any).__tiyaClientApi) return;
  (window as any).__tiyaClientApi = true;
  const original = window.fetch.bind(window);
  nativeFetch = original;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = '';
    try {
      url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    } catch {
      url = '';
    }
    let path = '';
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) path = u.pathname;
    } catch {
      path = '';
    }
    if (!path) return original(input as any, init);

    // Prefer the real server.ts backend for /api/intel/tool (server clock, Open-Meteo, server-side grounding)
    if (path === '/api/intel/tool' && (await probeServerBackend())) {
      try {
        const serverRes = await original(input as any, init);
        if (serverRes.status !== 404) return serverRes;
      } catch {
        // Fall through to client-side handler if server becomes unreachable
      }
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    let body: any = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      body = {};
    }
    const key = (headers.get('x-gemini-api-key') || body?.apiKey || '').trim();
    let result: ApiResult;
    try {
      result = await handle(path, path === '/api/providers/test-key' ? '' : key, body);
    } catch (err) {
      result = failFromError(err);
    }
    return new Response(JSON.stringify(result.json), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// ---------------------------------------------------------------------------
// LocalLiveSocket — same messages as the old /ws/live server, but runs on the device
// ---------------------------------------------------------------------------
function pcmToWavBase64(chunks: Int16Array[], rate: number): string {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const w = (o: number, str: string) => {
    for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + total * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, total * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, off += 2) v.setInt16(off, c[i], true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(bin);
}

/** Direct WebSocket to Gemini Live (Google's documented protocol, no SDK). */
class RawLiveSession {
  private ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
  }
  private send(obj: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
  sendRealtimeInput(input: Record<string, unknown>) {
    this.send({ realtimeInput: input });
  }
  sendClientContent(turns: unknown[], turnComplete = true) {
    this.send({ clientContent: { turns, turnComplete } });
  }
  sendToolResponse(resp: Record<string, unknown>) {
    this.send({ toolResponse: resp });
  }
  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

function openRawLive(
  key: string,
  setup: Record<string, unknown>,
  handlers: { onMessage: (msg: any) => void; onClose: (reason: string) => void },
  timeoutMs = 9000,
): Promise<RawLiveSession> {
  return new Promise((resolve, reject) => {
    const url =
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' +
      encodeURIComponent(key);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    const session = new RawLiveSession(ws);
    let ready = false;
    let done = false;
    const timer = setTimeout(() => {
      if (!ready) {
        done = true;
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error('Live setup timeout'));
      }
    }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ setup }));
    ws.onmessage = async (ev) => {
      let text = '';
      try {
        text = typeof ev.data === 'string' ? ev.data : ev.data instanceof Blob ? await ev.data.text() : new TextDecoder().decode(ev.data);
      } catch {
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.setupComplete !== undefined && !ready) {
        ready = true;
        clearTimeout(timer);
        resolve(session);
        return;
      }
      if (ready) handlers.onMessage(msg);
    };
    ws.onerror = () => {
      // the close event carries the reason
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (!ready) {
        if (!done) reject(new Error(ev.reason || `Live closed (${ev.code})`));
      } else {
        handlers.onClose(ev.reason || '');
      }
    };
  });
}

type LiveSession = RawLiveSession;

export class LocalLiveSocket {
  readyState = 0; // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private session: LiveSession | null = null;
  private closedByClient = false;
  private extended = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMotivation = new Map<string, { callId?: string; name: string; timer: ReturnType<typeof setTimeout> }>();

  // Turn mode: used when Gemini Live (WebSocket) cannot connect on this key/network.
  // Mic audio → transcribe → chat → TTS, all over normal HTTPS.
  private turnMode = false;
  private liveAttempt = 0;

  /**
   * Live voice dropped unexpectedly: NEVER silently switch to a different voice
   * engine or browser SpeechSynthesis (which causes abrupt voice switching).
   * Instead attempt one clean reconnect with the EXACT same locked model & female voice;
   * if that fails, surface a clear error so voice identity stays 100% consistent.
   */
  private liveBroke(label: string, detail: string) {
    if (this.closedByClient || this.turnMode) return;
    this.liveAttempt++;
    const s = this.session;
    this.session = null;
    try {
      s?.close();
    } catch {
      // ignore
    }
    this.emit({ type: 'interrupted' });

    if (
      label === 'Invalid API key' ||
      label === 'No API key' ||
      label === 'Quota finished' ||
      !this.lockedLiveModel ||
      this.reconnectAttempts >= 1
    ) {
      this.emit({
        type: 'error',
        label: label || 'Voice connection paused',
        detail: detail || 'Gemini Live voice disconnected. Tap the orb to reconnect with the same TIYA voice.',
      });
      return;
    }

    this.reconnectAttempts++;
    void this.reconnectLockedLive();
  }

  private async reconnectLockedLive() {
    if (this.closedByClient || !this.apiKey || !this.lockedLiveModel) return;
    const attempt = ++this.liveAttempt;
    const tools = [
      {
        functionDeclarations: [
          buildPhoneActionTool(false),
          buildNavigateAppTool(false),
          buildGetLatestMotivationTool(false),
          ...buildLiveIntelToolSchemas(false),
        ],
      },
    ];
    try {
      const session = await openRawLive(
        this.apiKey,
        {
          model: `models/${this.lockedLiveModel}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.7,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
          },
          systemInstruction: { parts: [{ text: this.systemInstruction }] },
          tools,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        {
          onMessage: (msg) => {
            if (attempt === this.liveAttempt) this.onLiveMessage(msg);
          },
          onClose: (reason) => {
            if (this.closedByClient || attempt !== this.liveAttempt) return;
            const c = classifyGeminiError(reason || 'Live session closed');
            this.liveBroke(c.label, c.detail);
          },
        },
      );
      if (this.closedByClient || attempt !== this.liveAttempt) {
        session.close();
        return;
      }
      this.session = session;
      this.reconnectAttempts = 0;
      this.emit({ type: 'ready', model: this.lockedLiveModel });
    } catch (err) {
      if (this.closedByClient) return;
      const c = classifyGeminiError(errMsg(err));
      this.emit({ type: 'error', label: c.label, detail: c.detail });
    }
  }

  private apiKey = '';
  private voiceName = DEFAULT_LOCKED_FEMALE_VOICE;
  private lockedLiveModel = '';
  private lockedTtsModel = '';
  private reconnectAttempts = 0;
  private speakGen = 0;
  private isOwner = false;
  private language = 'Bengali';
  private speechSpeed = 1.0;
  private systemInstruction = 'You are TIYA.';
  private turnHistory: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  private turnChunks: Int16Array[] = [];
  private turnSpeech = false;
  private turnSilenceMs = 0;
  private turnSpeechMs = 0;
  private turnNoise = 0.006;
  private turnBusy = false;
  private turnMuteUntil = 0;

  constructor() {
    setTimeout(() => {
      if (this.closedByClient) return;
      this.readyState = 1; // OPEN
      this.onopen?.(new Event('open'));
    }, 0);
  }

  private emit(payload: Record<string, unknown>) {
    if (this.readyState !== 1) return;
    try {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
    } catch {
      // ignore listener errors
    }
  }

  private closeSession() {
    this.speakGen++;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    for (const p of this.pendingMotivation.values()) clearTimeout(p.timer);
    this.pendingMotivation.clear();
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // ignore
      }
      this.session = null;
    }
  }

  private sendTool(id: string | undefined, name: string, response: Record<string, unknown>) {
    this.session?.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response,
        },
      ],
    });
  }

  private startTurnMode() {
    this.turnMode = true;
    this.emit({ type: 'ready', model: this.lockedTtsModel || 'TIYA Voice (Gemini TTS)' });
  }

  private async connect(apiKey: string, models: string[], voiceName: string, systemInstruction: string) {
    this.apiKey = apiKey;
    // Lock strictly to one verified female voice ID for the entire session
    this.voiceName = resolveCanonicalFemaleVoice(voiceName);
    this.systemInstruction = systemInstruction;
    this.lockedLiveModel = '';
    this.lockedTtsModel = '';
    this.reconnectAttempts = 0;

    if (!apiKey) {
      this.emit({
        type: 'error',
        label: 'No API key',
        detail: 'Add your Gemini API key in Settings > Connections to use TIYA’s consistent female voice.',
      });
      return;
    }

    // Check the key first
    try {
      await listGeminiModels(apiKey);
    } catch (err) {
      if (this.closedByClient) return;
      if (isBadKey(err) || (err as ApiError)?.status === 400 || (err as ApiError)?.status === 403) {
        const c = classifyGeminiError(errMsg(err));
        this.emit({ type: 'error', label: 'Invalid API key', detail: c.detail });
        return;
      }
    }
    if (this.closedByClient) return;

    const candidates = await pickLiveModels(apiKey, models);
    const tools = [
      {
        functionDeclarations: [
          buildPhoneActionTool(false),
          buildNavigateAppTool(false),
          buildGetLatestMotivationTool(false),
          ...buildLiveIntelToolSchemas(false),
        ],
      },
    ];

    for (const modelId of candidates) {
      if (this.closedByClient) return;
      const attempt = ++this.liveAttempt;
      this.extended = false;
      try {
        const session = await openRawLive(
          apiKey,
          {
            model: `models/${modelId}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              temperature: 0.7,
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
            },
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          {
            onMessage: (msg) => {
              if (attempt === this.liveAttempt) this.onLiveMessage(msg);
            },
            onClose: (reason) => {
              if (this.closedByClient || attempt !== this.liveAttempt) return;
              const c = classifyGeminiError(reason || 'Live session closed');
              this.liveBroke(c.label, c.detail);
            },
          },
        );
        if (this.closedByClient) {
          session.close();
          return;
        }
        this.session = session;
        this.lockedLiveModel = modelId;
        this.emit({ type: 'ready', model: modelId });
        return;
      } catch (err) {
        const c = classifyGeminiError(errMsg(err));
        if (c.label === 'Invalid API key') break;
      }
    }
    if (this.closedByClient) return;
    // Live WebSocket model unavailable on this key -> lock ONE Gemini TTS model (never browser SpeechSynthesis)
    const ttsCandidates = await pickTtsModels(apiKey);
    if (ttsCandidates.length > 0) {
      this.lockedTtsModel = ttsCandidates[0];
      this.startTurnMode();
      return;
    }
    this.emit({
      type: 'error',
      label: 'Voice model not available',
      detail: 'No Gemini voice model is available on this API key right now.',
    });
  }

  // ----------------------------- turn mode -----------------------------
  private onTurnAudio(b64: string) {
    if (this.turnBusy || Date.now() < this.turnMuteUntil) return;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length >> 1);
    for (let i = 0; i < pcm.length; i++) {
      const lo = bin.charCodeAt(i * 2);
      const hi = bin.charCodeAt(i * 2 + 1);
      let v = (hi << 8) | lo;
      if (v >= 0x8000) v -= 0x10000;
      pcm[i] = v;
    }
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      const f = pcm[i] / 32768;
      sum += f * f;
    }
    const rms = Math.sqrt(sum / Math.max(1, pcm.length));
    const ms = (pcm.length / 16000) * 1000;
    const startLevel = Math.max(this.turnNoise * 3, 0.02);

    if (!this.turnSpeech) {
      this.turnNoise = this.turnNoise * 0.95 + Math.min(rms, 0.05) * 0.05;
      // keep ~0.5 s of audio before speech starts
      this.turnChunks.push(pcm);
      while (this.turnChunks.length > 2) this.turnChunks.shift();
      if (rms > startLevel) {
        this.turnSpeech = true;
        this.turnSilenceMs = 0;
        this.turnSpeechMs = ms;
      }
      return;
    }

    this.turnChunks.push(pcm);
    this.turnSpeechMs += ms;
    if (rms < startLevel * 0.6) this.turnSilenceMs += ms;
    else this.turnSilenceMs = 0;

    if (this.turnSilenceMs >= 900 || this.turnSpeechMs >= 15000) {
      const chunks = this.turnChunks;
      const spoke = this.turnSpeechMs - this.turnSilenceMs;
      this.turnChunks = [];
      this.turnSpeech = false;
      this.turnSilenceMs = 0;
      this.turnSpeechMs = 0;
      if (spoke >= 350) void this.runTurn(chunks);
    }
  }

  private async runTurn(chunks: Int16Array[]) {
    this.turnBusy = true;
    try {
      const wav = pcmToWavBase64(chunks, 16000);
      const heard = await this.turnTranscribe(wav);
      if (this.closedByClient) return;
      if (!heard) return;
      this.emit({ type: 'input_transcript', text: heard });

      // Respect explicit voice-stop commands immediately without forcing a reply or guilt
      if (isExplicitVoiceStopCommand(heard)) {
        this.closedByClient = true;
        this.closeSession();
        this.emit({ type: 'closed' });
        return;
      }

      const moment = classifyUserEmotionalMoment(heard);
      let turnSystemInstruction =
        this.systemInstruction +
        '\n\nThis is a spoken conversation: reply in 1-3 short natural sentences, no lists, no emojis, no markdown.';
      if (this.isOwner) {
        const turnHistoryMsgs = this.turnHistory.map((h, idx) => ({
          id: `turn-${idx}`,
          role: h.role,
          text: h.text,
          timestamp: Date.now() - (this.turnHistory.length - idx) * 20_000,
          source: 'voice' as const,
        }));
        const emoCtx = analyzeConversationEmotionalContext(turnHistoryMsgs, heard);
        if (emoCtx.promptHint) {
          turnSystemInstruction += `\n\nLive Turn Emotional Context: ${emoCtx.promptHint}`;
        }
      }

      const res = await handle('/api/gemini/chat', this.apiKey, {
        message: heard,
        history: this.turnHistory.slice(-12),
        systemInstruction: turnSystemInstruction,
      });
      if (this.closedByClient) return;
      const data = res.json as any;
      if (res.status !== 200 || !data?.ok) {
        this.emit({ type: 'error', label: data?.label || 'Connection failed', detail: data?.detail || 'Could not get a reply.' });
        return;
      }
      if (data.action) this.emit({ type: 'phone_action', action: data.action });
      if (data.navigate) this.emit({ type: 'navigate', command: data.navigate });
      if (data.grounding) this.emit({ type: 'grounding', grounding: data.grounding });
      const rawReply = String(data.text || '').trim();
      const reply = this.isOwner ? enforceAdminAddressingText(rawReply) : rawReply;
      this.turnHistory.push({ role: 'user', text: heard }, { role: 'assistant', text: reply });
      if (this.turnHistory.length > 24) this.turnHistory.splice(0, this.turnHistory.length - 24);
      if (reply) {
        await this.turnSpeak(reply, moment);
      }
      this.emit({ type: 'turn_complete' });
    } catch (err) {
      const c = classifyGeminiError(errMsg(err));
      this.emit({ type: 'error', label: c.label, detail: c.detail });
    } finally {
      this.turnBusy = false;
    }
  }

  private async turnTranscribe(wavB64: string): Promise<string> {
    const clean = (t: string) => {
      const x = t.trim().replace(/^["'“]|["'”]$/g, '');
      return x.length < 2 ? '' : x;
    };
    const groqKey = getGroqKey();
    let lastErr: unknown = null;
    if (groqKey) {
      try {
        const bin = atob(wavB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const t = await groqTranscribe(groqKey, new Blob([bytes], { type: 'audio/wav' }), languageCode(this.language));
        return clean(t);
      } catch (err) {
        lastErr = err;
      }
    }
    if (this.apiKey) {
      for (const model of await pickChatModels(this.apiKey)) {
        try {
          const r = await generateContent(this.apiKey, model, {
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: 'audio/wav', data: wavB64 } },
                  {
                    text:
                      "Transcribe exactly what the person says, in the language they speak, written in that language's own script (Bengali speech in Bengali script). " +
                      'Output only the words. If there is no clear speech, output nothing.',
                  },
                ],
              },
            ],
          });
          return clean(responseText(r));
        } catch (err) {
          lastErr = err;
          if (isBadKey(err)) break;
        }
      }
    }
    throw lastErr || new Error('Transcription failed');
  }

  private async turnSpeak(text: string, moment?: UserEmotionalMoment) {
    const mySpeakGen = ++this.speakGen;
    if (!this.apiKey) {
      this.emit({ type: 'output_transcript', text });
      this.emit({
        type: 'error',
        label: 'Voice unavailable',
        detail: 'Gemini API key is required for TIYA’s consistent female voice.',
      });
      return;
    }

    // Lock ONE Gemini TTS model for the entire session so voice identity never switches
    const modelList = this.lockedTtsModel
      ? [this.lockedTtsModel]
      : await pickTtsModels(this.apiKey);
    const styleCue = detectEmotionalVoiceStyle(text, this.isOwner, moment);
    let lastErr: unknown = null;

    for (const model of modelList) {
      if (this.closedByClient || mySpeakGen !== this.speakGen) return;
      const isGemini38Tts = /3\.8/i.test(model);
      const requestBody = (withMetadata: boolean) => ({
        contents: [
          {
            role: 'user',
            parts: [
              withMetadata
                ? { text, speechMetadata: { style: styleCue } }
                : { text },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voiceName } } },
        },
      });

      try {
        let r: any;
        try {
          r = await generateContent(this.apiKey, model, requestBody(isGemini38Tts));
        } catch (metaErr) {
          if (isGemini38Tts && !isBadKey(metaErr)) {
            r = await generateContent(this.apiKey, model, requestBody(false));
          } else {
            throw metaErr;
          }
        }
        const audio = responseAudio(r);
        if (audio) {
          if (this.closedByClient || mySpeakGen !== this.speakGen) return;
          if (!this.lockedTtsModel) this.lockedTtsModel = model;
          const samples = Math.floor(atob(audio.data).length / 2);
          const rate = computeNaturalPlaybackRate(this.speechSpeed);
          this.turnMuteUntil = Date.now() + (samples / (24000 * rate)) * 1000 + 600;
          // Emit audio (with exact mimeType) + transcript together so text and audio stay aligned
          this.emit({ type: 'audio', data: audio.data, mimeType: audio.mimeType });
          this.emit({ type: 'output_transcript', text });
          return;
        }
      } catch (err) {
        lastErr = err;
        if (isBadKey(err)) break;
        if (this.lockedTtsModel) break; // Never hop to a second TTS model once locked
      }
    }

    // NEVER silently fall back to window.speechSynthesis (prevents random male/OS voice switching)
    if (this.closedByClient || mySpeakGen !== this.speakGen) return;
    this.emit({ type: 'output_transcript', text });
    const c = classifyGeminiError(errMsg(lastErr || 'Gemini TTS failed'));
    this.emit({
      type: 'error',
      label: c.label || 'Voice unavailable',
      detail: 'Gemini voice could not play right now. Browser voice fallback is disabled to preserve TIYA’s single female voice.',
    });
  }

  private onLiveMessage(message: any) {
    const content = message.serverContent;
    if (content?.interimInputTranscription?.text) {
      this.emit({ type: 'input_interim', text: content.interimInputTranscription.text });
    }
    if (content?.inputTranscription?.text) {
      const isPartial = content.inputTranscription.finished === false;
      this.emit({
        type: isPartial ? 'input_interim' : 'input_transcript',
        text: content.inputTranscription.text,
      });
    }
    for (const part of content?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.emit({
          type: 'audio',
          data: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
        });
      }
    }
    if (content?.outputTranscription?.text) {
      this.emit({ type: 'output_transcript', text: content.outputTranscription.text });
    }
    if (content?.interrupted) this.emit({ type: 'interrupted' });
    if (content?.turnComplete) this.emit({ type: 'turn_complete' });

    for (const call of message.toolCall?.functionCalls ?? []) {
      if (call.name === 'trigger_phone_action' && call.args) {
        const valid = validatePhoneAction(call.args);
        if (valid) {
          this.emit({ type: 'phone_action', action: valid });
          this.sendTool(call.id, call.name, { status: 'awaiting_user_confirmation', prompt: getConfirmationPromptText(valid) });
        } else {
          this.sendTool(call.id, call.name, { status: 'invalid_action' });
        }
      } else if (call.name === 'navigate_app' && call.args) {
        const nav = validateNavigateToolArgs(call.args);
        if (nav) {
          this.emit({ type: 'navigate', command: nav });
          this.sendTool(call.id, call.name, { status: 'navigated', message: (nav as any).confirmBn });
        }
      } else if (call.name === 'get_latest_motivation') {
        const token = call.id || `mot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const timer = setTimeout(() => {
          const entry = this.pendingMotivation.get(token);
          if (!entry) return;
          this.pendingMotivation.delete(token);
          this.sendTool(entry.callId, entry.name, { found: false, message: 'এখনো কোনো প্রকাশিত মোটিভেশন পাওয়া যায়নি।' });
        }, 3500);
        this.pendingMotivation.set(token, { callId: call.id, name: call.name || 'get_latest_motivation', timer });
        this.emit({ type: 'request_latest_motivation', callId: token, name: call.name });
      } else if (call.name && isLiveIntelToolName(call.name)) {
        const callId = call.id;
        const callName = call.name;
        const callArgs = (call.args || {}) as Record<string, unknown>;
        void (async () => {
          try {
            // Prefer real backend /api/intel/tool when server.ts is reachable; otherwise execute shared router locally
            const res = await fetch('/api/intel/tool', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(this.apiKey ? { 'x-gemini-api-key': this.apiKey } : {}),
              },
              body: JSON.stringify({
                tool: callName,
                args: callArgs,
              }),
            });
            const data = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              result?: Record<string, unknown>;
              grounding?: LiveSearchMetadata | null;
              error?: string;
            };
            if (this.closedByClient) return;
            if (data.grounding) {
              this.emit({ type: 'grounding', grounding: data.grounding });
            }
            this.sendTool(
              callId,
              callName,
              data.ok && data.result
                ? data.result
                : {
                    ok: false,
                    unavailable: true,
                    error: data.error || 'Live information tool failed.',
                    instruction:
                      'Tell the user honestly that live information could not be retrieved right now. Do NOT invent an answer.',
                  },
            );
          } catch (err) {
            if (this.closedByClient) return;
            this.sendTool(callId, callName, {
              ok: false,
              unavailable: true,
              error: errMsg(err),
              instruction:
                'Tell the user honestly that live information could not be retrieved right now. Do NOT invent an answer.',
            });
          }
        })();
      }
    }
  }

  send(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'start') {
      const primary = msg.model || DEFAULT_LIVE_MODELS[0].id;
      const candidates =
        msg.autoFallback && Array.isArray(msg.fallbackModels)
          ? [primary, ...msg.fallbackModels.filter((m: string) => m !== primary)]
          : [primary];
      this.language = String(msg.language || 'Bengali');
      this.speechSpeed = typeof msg.speechSpeed === 'number' && Number.isFinite(msg.speechSpeed) ? msg.speechSpeed : 1.0;
      this.isOwner = Boolean(msg.isOwner);
      void this.connect(
        String(msg.apiKey || '').trim(),
        candidates,
        resolveCanonicalFemaleVoice(msg.voiceName),
        msg.systemInstruction || 'You are TIYA.',
      );
    } else if (msg.type === 'motivation_response' && msg.callId && this.session) {
      const pending = this.pendingMotivation.get(msg.callId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingMotivation.delete(msg.callId);
        const post = msg.post;
        this.sendTool(
          pending.callId,
          pending.name,
          post && String(post.body || '').trim()
            ? {
                found: true,
                title: String(post.title || '').trim() || 'Motivation',
                body: String(post.body).trim(),
                instruction: 'Read this published motivation post warmly to the user in Bengali.',
              }
            : { found: false, message: 'এখনো কোনো প্রকাশিত মোটিভেশন পাওয়া যায়নি।' },
        );
      }
    } else if (msg.type === 'audio' && msg.data && this.turnMode) {
      this.onTurnAudio(String(msg.data));
    } else if (msg.type === 'text' && msg.text && this.turnMode) {
      void (async () => {
        this.turnBusy = true;
        try {
          const res = await handle('/api/gemini/chat', this.apiKey, {
            message: String(msg.text),
            history: this.turnHistory.slice(-12),
            systemInstruction: this.systemInstruction,
          });
          const data = res.json as any;
          if (data?.ok && data.text) {
            await this.turnSpeak(String(data.text));
            this.emit({ type: 'turn_complete' });
          }
        } finally {
          this.turnBusy = false;
        }
      })();
    } else if (msg.type === 'proactive_prompt' && msg.text && this.turnMode) {
      if (this.turnBusy) return;
      void (async () => {
        this.turnBusy = true;
        try {
          const res = await handle('/api/gemini/chat', this.apiKey, {
            message: String(msg.text),
            history: this.turnHistory.slice(-12),
            systemInstruction: this.systemInstruction,
          });
          const data = res.json as any;
          if (data?.ok && data.text) {
            await this.turnSpeak(String(data.text));
            this.emit({ type: 'turn_complete' });
          }
        } finally {
          this.turnBusy = false;
        }
      })();
    } else if (msg.type === 'proactive_prompt' && msg.text && this.session) {
      this.session.sendClientContent(
        [{ role: 'user', parts: [{ text: String(msg.text) }] }],
        true,
      );
    } else if (msg.type === 'video' && msg.data && this.session) {
      this.session.sendRealtimeInput({
        video: {
          data: String(msg.data),
          mimeType: String(msg.mimeType || 'image/jpeg'),
        },
      });
    } else if (msg.type === 'audio' && msg.data && this.session) {
      this.session.sendRealtimeInput({ audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } });
    } else if (msg.type === 'text' && msg.text && this.session) {
      this.session.sendRealtimeInput({ text: msg.text });
    } else if (msg.type === 'stop') {
      this.closedByClient = true;
      this.closeSession();
    }
  }

  close() {
    if (this.readyState === 3) return;
    this.closedByClient = true;
    this.closeSession();
    this.readyState = 3; // CLOSED
    try {
      this.onclose?.(new CloseEvent('close'));
    } catch {
      // ignore
    }
  }
}

/** Live voice connection that works everywhere (Vercel, Android app, PC). */
export function createLiveSocket(): WebSocket {
  return new LocalLiveSocket() as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// LocalTranscribeSocket — direct client-side Gemini Live streaming STT
// Works everywhere (AI Studio preview, Vercel, mobile Chrome, Android APK).
// ---------------------------------------------------------------------------
export class LocalTranscribeSocket {
  readyState = 0; // CONNECTING
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  private session: RawLiveSession | null = null;
  private closedByClient = false;
  private attemptId = 0;

  constructor() {
    setTimeout(() => {
      if (this.closedByClient) return;
      this.readyState = 1; // OPEN
      this.onopen?.(new Event('open'));
    }, 0);
  }

  private emit(payload: Record<string, unknown>) {
    if (this.readyState !== 1) return;
    try {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
    } catch {
      // ignore listener errors
    }
  }

  private closeSession() {
    if (this.session) {
      try {
        this.session.close();
      } catch {
        // ignore
      }
      this.session = null;
    }
  }

  private async connect(apiKey: string, languageCodes?: string[]) {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      this.emit({
        type: 'error',
        label: 'No API key',
        detail: 'Add your Gemini API key in Settings > Connections.',
      });
      return;
    }

    const requestedCodes = Array.isArray(languageCodes)
      ? languageCodes.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : [];

    const attempts: Array<string[] | undefined> =
      requestedCodes.length > 0 ? [requestedCodes, undefined] : [undefined];

    let lastErr = { label: 'Model not available', detail: 'Real-time transcription model is unavailable on this key.' };

    for (const codes of attempts) {
      if (this.closedByClient) return;
      const attempt = ++this.attemptId;

      try {
        const session = await openRawLive(
          trimmedKey,
          {
            model: 'models/gemini-3.5-transcribe-live',
            generationConfig: {
              responseModalities: ['TEXT'],
            },
            inputAudioTranscription: codes ? { languageCodes: codes } : {},
          },
          {
            onMessage: (msg) => {
              if (attempt !== this.attemptId || this.closedByClient) return;
              const sc = msg?.serverContent;
              if (!sc) return;

              if (sc.interimInputTranscription?.text) {
                this.emit({ type: 'interim', text: String(sc.interimInputTranscription.text) });
              }
              if (sc.inputTranscription?.text) {
                const isPartial = sc.inputTranscription.finished === false;
                this.emit({
                  type: isPartial ? 'interim' : 'final',
                  text: String(sc.inputTranscription.text),
                });
              }
              if (sc.turnComplete) {
                this.emit({ type: 'turn_complete' });
              }
            },
            onClose: (reason) => {
              if (attempt !== this.attemptId || this.closedByClient) return;
              this.session = null;
              this.emit({ type: 'closed', reason: reason || '' });
            },
          },
          4500,
        );

        if (this.closedByClient) {
          session.close();
          return;
        }
        this.session = session;
        this.emit({ type: 'ready', model: 'gemini-3.5-transcribe-live' });
        return;
      } catch (err) {
        const c = classifyGeminiError(errMsg(err));
        lastErr = c;
        if (c.label === 'Invalid API key' || c.label === 'Quota finished') {
          break;
        }
      }
    }

    if (!this.closedByClient) {
      this.emit({ type: 'error', label: lastErr.label, detail: lastErr.detail });
    }
  }

  send(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'start') {
      this.closeSession();
      this.closedByClient = false;
      void this.connect(String(msg.apiKey || ''), msg.languageCodes);
    } else if (msg.type === 'audio' && msg.data && this.session) {
      this.session.sendRealtimeInput({
        audio: {
          data: msg.data,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
    } else if (msg.type === 'audio_end' && this.session) {
      this.session.sendRealtimeInput({ audioStreamEnd: true });
    } else if (msg.type === 'stop') {
      this.closedByClient = true;
      this.closeSession();
    }
  }

  close() {
    if (this.readyState === 3) return;
    this.closedByClient = true;
    this.closeSession();
    this.readyState = 3; // CLOSED
    try {
      this.onclose?.(new CloseEvent('close'));
    } catch {
      // ignore
    }
  }
}

/** Real-time streaming transcription socket that works everywhere (Vercel, Android app, PC). */
export function createTranscribeSocket(): WebSocket {
  return new LocalTranscribeSocket() as unknown as WebSocket;
}

