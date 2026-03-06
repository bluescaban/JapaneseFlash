import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import OpenAI from 'openai';
import { OPENAI_API_KEY } from '../config';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { transcribeSpeech, generateAudio, translateText } from '../services/openai';
import { saveCard } from '../db/database';
import CopyButton from '../components/CopyButton';

// ─── Kintaro system prompt ────────────────────────────────────────────────────

const KINTARO_SYSTEM_PROMPT = `You are Kintaro, a warm and encouraging Japanese language tutor.
Your primary goal is to help the user practice conversational Japanese.

DEFAULT BEHAVIOR:
- Speak in natural Japanese, calibrated to beginner/intermediate level
- Keep responses short and speakable — 2 to 4 sentences maximum
- Always show the Japanese text followed by romaji in parentheses
- End each response with one gentle conversation prompt or question

ENGLISH DETECTION — switch to English when user:
- Asks 'what does that mean' / 'explain' / 'I don't understand'
- Asks about a specific grammar form e.g. 'why did you use て form'
- Seems confused or frustrated
- Explicitly asks for English

GRAMMAR BREAKDOWNS — when explaining grammar, always include:
- The form name and structure
- What it means / when to use it
- The example you just used
- One alternative example sentence
- End with: [GRAMMAR_CARD] so the app can offer to save it

TONE: Patient, encouraging, never condescending.
Celebrate when the user uses Japanese correctly.`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConvMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;      // display text, [GRAMMAR_CARD] tag already stripped
  audioUri?: string;
  hasGrammarCard: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResponse(raw: string): { text: string; hasGrammarCard: boolean } {
  const hasGrammarCard = raw.includes('[GRAMMAR_CARD]');
  const text = raw.replace('[GRAMMAR_CARD]', '').trim();
  return { text, hasGrammarCard };
}

// Returns true if the string contains hiragana, katakana, or CJK characters
function containsJapanese(text: string): boolean {
  return /[\u3040-\u9fff\uff00-\uffef]/.test(text);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function KintaroScreen() {
  const [history, setHistory] = useState<ConvMessage[]>([
    { role: 'system', content: KINTARO_SYSTEM_PROMPT },
  ]);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const { isRecording, startRecording, stopRecording } = useVoiceRecorder();
  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Stable OpenAI client ref — avoids recreating on every render
  const openai = useRef(
    new OpenAI({ apiKey: OPENAI_API_KEY, dangerouslyAllowBrowser: true }),
  ).current;

  // Mirror history into a ref so async callbacks always see the latest value
  const historyRef = useRef(history);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Trigger Kintaro's opening greeting on first mount
  useEffect(() => {
    const initialMessages: ConvMessage[] = [
      { role: 'system', content: KINTARO_SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          '(Begin the session. Greet the student warmly in Japanese and invite them to start speaking.)',
      },
    ];
    sendToKintaro(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scrollToBottom() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }

  // ─── Mic ─────────────────────────────────────────────────────────────────────

  async function handleMicPress() {
    if (isProcessing) return;

    if (isRecording) {
      const uri = await stopRecording();
      if (uri) await processUserAudio(uri);
    } else {
      await startRecording();
    }
  }

  async function processUserAudio(audioUri: string) {
    setIsProcessing(true);
    try {
      const userText = await transcribeSpeech(audioUri);
      if (!userText.trim()) {
        setIsProcessing(false);
        return;
      }

      const userEntry: TranscriptEntry = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: userText,
        hasGrammarCard: false,
      };
      setTranscript((prev) => [...prev, userEntry]);
      scrollToBottom();

      const nextHistory: ConvMessage[] = [
        ...historyRef.current,
        { role: 'user', content: userText },
      ];
      await sendToKintaro(nextHistory);
    } catch (e) {
      Alert.alert('Error processing audio', String(e));
      setIsProcessing(false);
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────────

  async function sendToKintaro(messages: ConvMessage[]) {
    setIsProcessing(true);
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        temperature: 0.8,
        max_tokens: 400,
      });

      const raw = response.choices[0].message.content ?? '';
      const { text, hasGrammarCard } = parseResponse(raw);

      // Grammar breakdowns are often in English — use English TTS voice for those
      const ttsLang = hasGrammarCard && !containsJapanese(text) ? 'en' : 'jp';
      const audioUri = await generateAudio(text, ttsLang);

      const entry: TranscriptEntry = {
        id: `k-${Date.now()}`,
        role: 'assistant',
        text,
        audioUri,
        hasGrammarCard,
      };

      setHistory([...messages, { role: 'assistant', content: raw }]);
      setTranscript((prev) => [...prev, entry]);
      scrollToBottom();

      await playAudio(audioUri);
    } catch (e) {
      Alert.alert('Kintaro error', String(e));
    } finally {
      setIsProcessing(false);
    }
  }

  // ─── Playback ─────────────────────────────────────────────────────────────────

  async function playAudio(uri: string) {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      await sound.playAsync();
      // Resolve when playback finishes so callers can await it
      await new Promise<void>((resolve) => {
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
            soundRef.current = null;
            resolve();
          }
        });
      });
    } catch {
      // Non-fatal — transcript still visible even if audio fails
    }
  }

  // ─── Save card ────────────────────────────────────────────────────────────────

  async function handleSave(entry: TranscriptEntry) {
    setSavingId(entry.id);
    try {
      let englishText: string;
      let japaneseText: string;
      let romajiText: string;
      let grammarNote = '';

      if (entry.hasGrammarCard) {
        // Grammar card: response is an English explanation with Japanese examples embedded
        englishText = entry.text.split('\n')[0]?.trim() ?? 'Grammar note';
        japaneseText = entry.text.match(/[\u3040-\u9fff][\s\S]*?(?=\n|$)/)?.[0] ?? entry.text;
        romajiText = '';
        grammarNote = entry.text;
      } else {
        // Regular exchange: translate Kintaro's Japanese to get the English side
        const result = await translateText(entry.text, 'jp-to-en');
        englishText = result.translatedText;
        japaneseText = entry.text;
        romajiText = result.romajiText;
      }

      // Reuse cached audio if available, otherwise generate
      const jpAudioPath = entry.audioUri ?? (await generateAudio(japaneseText, 'jp'));
      const enAudioPath = await generateAudio(englishText, 'en');

      await saveCard({
        id: `kintaro-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        englishText,
        japaneseText,
        romajiText,
        enAudioPath,
        jpAudioPath,
        source: 'kintaro',
        grammarNote,
      });

      Alert.alert('Saved!', 'Flashcard added to your deck.');
    } catch (e) {
      Alert.alert('Save error', String(e));
    } finally {
      setSavingId(null);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const micLabel = isRecording ? 'Tap to send' : isProcessing ? 'Thinking…' : 'Tap to speak';

  return (
    <View style={styles.container}>
      {/* ─── Transcript ────────────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {transcript.length === 0 && !isProcessing && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Kintaro is warming up…</Text>
          </View>
        )}

        {transcript.map((entry) => (
          <View key={entry.id} style={styles.entryWrapper}>

            {entry.role === 'user' ? (
              // ── User bubble ──────────────────────────────────────────────
              <View style={styles.userRow}>
                <View style={styles.userBubble}>
                  <Text selectable style={styles.userText}>{entry.text}</Text>
                </View>
                <CopyButton text={entry.text} />
              </View>

            ) : entry.hasGrammarCard ? (
              // ── Grammar card ─────────────────────────────────────────────
              <View style={styles.grammarCard}>
                <View style={styles.grammarCardHeader}>
                  <Text style={styles.grammarCardIcon}>📖</Text>
                  <Text style={styles.grammarCardTitle}>Grammar Breakdown</Text>
                  <CopyButton text={entry.text} style={styles.grammarCopyBtn} />
                </View>
                <Text selectable style={styles.grammarCardText}>{entry.text}</Text>
                <TouchableOpacity
                  style={[styles.saveBtn, savingId === entry.id && styles.btnDisabled]}
                  onPress={() => handleSave(entry)}
                  disabled={savingId !== null}
                >
                  {savingId === entry.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Grammar Card</Text>
                  )}
                </TouchableOpacity>
              </View>

            ) : (
              // ── Kintaro bubble ───────────────────────────────────────────
              <View style={styles.kintaroRow}>
                <View style={styles.kintaroBubble}>
                  <Text style={styles.kintaroLabel}>Kintaro</Text>
                  <Text selectable style={styles.kintaroText}>{entry.text}</Text>
                </View>
                <View style={styles.bubbleActions}>
                  {entry.audioUri && (
                    <TouchableOpacity
                      style={styles.playBtn}
                      onPress={() => playAudio(entry.audioUri!)}
                    >
                      <Text style={styles.playBtnText}>▶ Play</Text>
                    </TouchableOpacity>
                  )}
                  <CopyButton text={entry.text} />
                  <TouchableOpacity
                    style={[styles.saveBtn, savingId === entry.id && styles.btnDisabled]}
                    onPress={() => handleSave(entry)}
                    disabled={savingId !== null}
                  >
                    {savingId === entry.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>Save as Flashcard</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ))}

        {/* Processing indicator */}
        {isProcessing && (
          <View style={styles.thinkingRow}>
            <ActivityIndicator color="#4A90D9" size="small" />
            <Text style={styles.thinkingText}>Kintaro is thinking…</Text>
          </View>
        )}
      </ScrollView>

      {/* ─── Mic control ───────────────────────────────────────────────────── */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[
            styles.micButton,
            isRecording && styles.micButtonRecording,
            isProcessing && styles.micButtonDisabled,
          ]}
          onPress={handleMicPress}
          disabled={isProcessing}
          activeOpacity={0.85}
        >
          <Text style={styles.micIcon}>{isRecording ? '⏹' : '🎤'}</Text>
        </TouchableOpacity>
        <Text style={styles.micLabel}>{micLabel}</Text>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },

  // Transcript scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 8,
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#A0ADB5',
    fontSize: 15,
    fontStyle: 'italic',
  },
  entryWrapper: {
    gap: 6,
  },

  // User bubble (right-aligned)
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#4A90D9',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '80%',
  },
  userText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },

  // Kintaro bubble (left-aligned)
  kintaroRow: {
    alignItems: 'flex-start',
    gap: 8,
  },
  kintaroBubble: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  kintaroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4A90D9',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kintaroText: {
    fontSize: 17,
    color: '#2C3E50',
    lineHeight: 26,
  },
  bubbleActions: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 4,
  },

  // Grammar card
  grammarCard: {
    backgroundColor: '#FDF8EE',
    borderRadius: 14,
    borderLeftWidth: 3,
    borderLeftColor: '#F39C12',
    padding: 16,
    gap: 10,
  },
  grammarCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  grammarCopyBtn: {
    marginLeft: 'auto',
  },
  grammarCardIcon: {
    fontSize: 16,
  },
  grammarCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D68910',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  grammarCardText: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 24,
  },

  // Action buttons
  playBtn: {
    backgroundColor: '#EAF3FF',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#C5D9F1',
  },
  playBtnText: {
    color: '#4A90D9',
    fontWeight: '600',
    fontSize: 13,
  },
  saveBtn: {
    backgroundColor: '#27AE60',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  // Thinking indicator
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
    paddingVertical: 4,
  },
  thinkingText: {
    color: '#A0ADB5',
    fontSize: 14,
    fontStyle: 'italic',
  },

  // Mic controls
  controls: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingBottom: 32,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E8ECF0',
    gap: 8,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#4A90D9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A90D9',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 5,
  },
  micButtonRecording: {
    backgroundColor: '#E74C3C',
    shadowColor: '#E74C3C',
  },
  micButtonDisabled: {
    backgroundColor: '#BDC3C7',
    shadowOpacity: 0,
    elevation: 0,
  },
  micIcon: {
    fontSize: 28,
  },
  micLabel: {
    fontSize: 13,
    color: '#7F8C8D',
    fontWeight: '500',
  },
});
