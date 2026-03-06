import OpenAI from 'openai';
import { File, Paths } from 'expo-file-system';
import { OPENAI_API_KEY } from '../config';

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranslationResult {
  translatedText: string;
  romajiText: string;
}

// ─── translateText ─────────────────────────────────────────────────────────────
// Translates between English and Japanese using GPT-4o.
// Always returns romaji for whichever side is Japanese.

export async function translateText(
  text: string,
  direction: 'en-to-jp' | 'jp-to-en',
): Promise<TranslationResult> {
  const systemPrompt =
    direction === 'en-to-jp'
      ? `You are a Japanese translator. Translate the English text to natural, conversational Japanese.
Respond with JSON only: {"translatedText": "<japanese script>", "romajiText": "<romaji pronunciation>"}`
      : `You are a Japanese translator. Translate the Japanese text to natural English.
Respond with JSON only: {"translatedText": "<english translation>", "romajiText": "<romaji of the original Japanese>"}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0].message.content ?? '{}';
  const parsed = JSON.parse(content);

  return {
    translatedText: parsed.translatedText ?? '',
    romajiText: parsed.romajiText ?? '',
  };
}

// ─── generateAudio ─────────────────────────────────────────────────────────────
// Calls OpenAI TTS, writes the mp3 to Expo's cache directory,
// and returns the local file URI for use with expo-av.

export async function generateAudio(
  text: string,
  language: 'en' | 'jp',
): Promise<string> {
  const voice = language === 'jp' ? 'shimmer' : 'alloy';

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS error ${response.status}: ${err}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const file = new File(Paths.cache, `audio_${Date.now()}.mp3`);
  file.write(new Uint8Array(arrayBuffer));

  return file.uri;
}

// ─── transcribeSpeech ──────────────────────────────────────────────────────────
// Sends a local audio file URI to Whisper and returns the transcript.
// language: 'ja' for Japanese-only input, omit for auto-detect (English or Japanese).

export async function transcribeSpeech(
  audioUri: string,
  language?: 'ja' | 'en',
): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: audioUri,
    type: 'audio/m4a',
    name: 'recording.m4a',
  } as unknown as Blob);
  formData.append('model', 'whisper-1');
  if (language) {
    formData.append('language', language);
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Whisper error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.text ?? '';
}
