import React, { useEffect, useRef, useState } from 'react';
import { Home, Mic, Send, Square, Trash2 } from 'lucide-react';
import { ChatMessage, PhoneAction, TiyaSettings } from '../types/tiya';
import { useRealtimeDictation } from '../hooks/useRealtimeDictation';
import { ActionConfirmCard } from './ActionConfirmCard';
import { TiyaNeonNav } from './TiyaNeonNav';

interface ChatScreenProps {
  settings: TiyaSettings;
  messages: ChatMessage[];
  isSending: boolean;
  chatError: string;
  actionLinks: Record<string, string>;
  onSendMessage: (text: string) => Promise<void>;
  onConfirmAction: (msgId: string, action: PhoneAction) => void;
  onCancelAction: (msgId: string) => void;
  onClearChats: () => void;
  onOpenConnections: () => void;
  isVoiceOn: boolean;
  onToggleVoice: () => void;
  onOpenHome: () => void;
  onOpenChatHistory: () => void;
  onOpenTools: () => void;
  onOpenMore: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  settings,
  messages,
  isSending,
  chatError,
  actionLinks,
  onSendMessage,
  onConfirmAction,
  onCancelAction,
  onClearChats,
  onOpenConnections,
  isVoiceOn,
  onToggleVoice,
  onOpenHome,
  onOpenChatHistory,
  onOpenTools,
  onOpenMore,
}) => {
  const [input, setInput] = useState('');

  const {
    isRecordingMic,
    isTranscribing,
    micError,
    toggleMicInput: toggleRealtimeMic,
    stopMicInput,
    syncManualEdit,
  } = useRealtimeDictation({
    settings,
    onTranscriptChange: setInput,
  });

  const listEndRef = useRef<HTMLDivElement | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // scroll only the message list (scrollIntoView also pushed the whole page up)
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: settings.reduceMotion ? 'auto' : 'smooth' });
  }, [messages.length, isSending, settings.reduceMotion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;
    const finalText = isRecordingMic ? await stopMicInput() : input;
    const trimmed = finalText.trim();
    if (!trimmed) return;
    setInput('');
    await onSendMessage(trimmed);
  };

  const toggleMicInput = () => {
    void toggleRealtimeMic(input);
  };

  const assistantTitle = settings.assistantName.trim() || 'TIYA';

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#020714] text-slate-100">
      {/* Same TIYA picture as HOME, blurred and darkened behind the chat */}
      <img
        src="/tiya-home.jpg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover object-top blur-[6px] select-none"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[#020714]/70" />

      {/* Top row: HOME · TIYA · clear */}
      <header className="relative z-20 grid shrink-0 grid-cols-3 items-center px-3 pt-[env(safe-area-inset-top)] [min-height:calc(3.5rem+env(safe-area-inset-top))]">
        <div className="flex justify-start">
          <button
            type="button"
            onClick={onOpenHome}
            aria-label="Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A1428]/70 text-cyan-100 ring-1 ring-cyan-300/40 backdrop-blur-sm active:scale-95"
          >
            <Home className="h-[18px] w-[18px]" />
          </button>
        </div>
        <h1 className="font-display text-center text-lg font-bold tracking-[0.35em] text-white drop-shadow-[0_0_10px_rgba(56,189,248,0.75)]">
          {assistantTitle.toUpperCase()}
        </h1>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleVoice}
            aria-label={isVoiceOn ? 'Stop talking with TIYA' : 'Talk with TIYA'}
            aria-pressed={isVoiceOn}
            className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 backdrop-blur-sm active:scale-95 ${
              isVoiceOn
                ? 'bg-emerald-500/80 text-white ring-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.7)]'
                : 'bg-[#0A1428]/70 text-cyan-100 ring-cyan-300/40'
            }`}
          >
            {isVoiceOn ? <Square className="h-4 w-4" /> : <Mic className="h-[18px] w-[18px]" />}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearChats}
              aria-label="Clear chat history"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0A1428]/70 text-cyan-100 ring-1 ring-cyan-300/40 backdrop-blur-sm hover:text-rose-400 active:scale-95"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={listRef} data-testid="chat-message-list" className="tiya-scroll relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center px-6 text-center">
            <p className="font-display text-sm font-semibold text-white">Start a conversation</p>
            <p className="mt-1.5 text-xs leading-relaxed text-cyan-100/70">
              Type a message or tap the mic.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-cyan-100/60">
                <span>{msg.role === 'user' ? settings.yourName.trim() || 'You' : assistantTitle}</span>
                <span aria-hidden="true">·</span>
                <span>{msg.source === 'voice' ? 'Voice' : 'Text'}</span>
              </div>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed backdrop-blur-sm ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-sky-500/90 to-blue-700/90 text-white'
                    : 'border border-cyan-400/25 bg-[#06122A]/80 text-slate-100'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                {msg.role === 'assistant' &&
                  msg.grounding &&
                  (msg.grounding.sources.length > 0 ||
                    msg.grounding.searchSuggestions.length > 0 ||
                    msg.grounding.searchFailed) && (
                    <div
                      data-testid="grounding-sources"
                      className="mt-2.5 space-y-2 border-t border-cyan-400/20 pt-2 text-[11px]"
                    >
                      {msg.grounding.searchFailed && (
                        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
                          {msg.grounding.quotaExceeded
                            ? 'Live Google Search quota reached (paid tier required for higher quota).'
                            : `Live search unavailable${msg.grounding.failureReason ? `: ${msg.grounding.failureReason}` : '.'}`}
                        </div>
                      )}

                      {msg.grounding.sources.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-cyan-200/70">
                            <span className="font-semibold tracking-wide uppercase">Sources</span>
                            {msg.grounding.retrievedAt && (
                              <span>
                                Live ·{' '}
                                {new Date(msg.grounding.retrievedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.grounding.sources
                              .filter((s) => /^https?:\/\//i.test(s.uri))
                              .slice(0, 6)
                              .map((src, idx) => (
                                <a
                                  key={`${src.uri}-${idx}`}
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex max-w-full items-center gap-1 rounded-lg border border-cyan-300/25 bg-cyan-950/50 px-2 py-1 text-[10px] text-cyan-100 transition hover:border-cyan-300/60 hover:bg-cyan-900/60"
                                >
                                  <span className="truncate max-w-[165px] font-medium">{src.title}</span>
                                  <span className="shrink-0 text-cyan-300/70">· {src.publisher}</span>
                                </a>
                              ))}
                          </div>
                        </div>
                      )}

                      {msg.grounding.searchSuggestions.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-[10px] font-medium text-cyan-200/60">
                            Google Search Suggestions
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.grounding.searchSuggestions
                              .filter((s) => /^https?:\/\//i.test(s.url))
                              .slice(0, 4)
                              .map((sugg, idx) => (
                                <a
                                  key={`${sugg.url}-${idx}`}
                                  href={sugg.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-full border border-sky-300/25 bg-[#0A1A3A]/80 px-2.5 py-0.5 text-[10px] text-sky-200 transition hover:border-sky-300/60 hover:text-white"
                                >
                                  <span className="truncate max-w-[200px]">{sugg.label}</span>
                                </a>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
              </div>
              {msg.pendingAction && (
                <div className="w-full max-w-[85%]">
                  <ActionConfirmCard
                    action={msg.pendingAction}
                    status={msg.actionStatus || 'pending'}
                    note={msg.actionNote}
                    fallbackUrl={actionLinks[msg.id]}
                    onConfirm={() => onConfirmAction(msg.id, msg.pendingAction!)}
                    onCancel={() => onCancelAction(msg.id)}
                  />
                </div>
              )}
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-start">
            <div className="rounded-2xl border border-cyan-400/25 bg-[#06122A]/80 px-3.5 py-2.5 text-xs text-cyan-100/80">
              Thinking...
            </div>
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      {/* Lower deck: error · input · same bottom bar as HOME */}
      <div className="relative z-20 shrink-0 space-y-2 px-3 pb-3 pt-1">
        {(chatError || micError) && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-[#080D1B]/90 px-3 py-1.5 text-[11px] text-rose-300">
            <span className="min-w-0 truncate">{micError || chatError}</span>
            {(chatError.includes('No API key') || micError.includes('No API key')) && (
              <button
                type="button"
                onClick={onOpenConnections}
                className="shrink-0 rounded-lg bg-cyan-500/20 px-2.5 py-1 text-[10px] font-semibold text-cyan-200"
              >
                Connections
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMicInput}
            aria-label={isRecordingMic ? 'Stop voice dictation' : 'Record voice message'}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 transition-colors active:scale-95 ${
              isRecordingMic
                ? 'bg-rose-600 text-white ring-rose-400'
                : 'bg-[#06122A]/90 text-cyan-100 ring-cyan-400/40'
            }`}
          >
            {isRecordingMic ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              syncManualEdit(e.target.value);
            }}
            placeholder={isTranscribing ? 'Transcribing...' : isRecordingMic ? 'Recording... tap stop' : `Message ${assistantTitle}...`}
            aria-label="Chat message input"
            className="h-11 min-w-0 flex-1 rounded-full border border-cyan-400/30 bg-[#06122A]/90 px-4 text-sm text-white placeholder:text-cyan-100/40 focus:border-cyan-300 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-[0_0_14px_rgba(56,189,248,0.5)] disabled:opacity-40 active:scale-95"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>

      {/* Same bottom bar as HOME, fixed to the screen bottom */}
      <TiyaNeonNav
        active="chat"
        isVoiceOn={isVoiceOn}
        onToggleVoice={onToggleVoice}
        onOpenChat={() => undefined}
        onOpenChatHistory={onOpenChatHistory}
        onOpenTools={onOpenTools}
        onOpenMore={onOpenMore}
      />
    </div>
  );
};
