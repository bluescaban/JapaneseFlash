import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import { translateText, generateAudio, TranslationResult } from '../services/openai';
import { saveCard } from '../db/database';
import CopyButton from '../components/CopyButton';

type Direction = 'en-to-jp' | 'jp-to-en';

export default function TranslatorScreen() {
  const [inputText, setInputText] = useState('');
  const [direction, setDirection] = useState<Direction>('en-to-jp');
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [inputAudioUri, setInputAudioUri] = useState<string | null>(null);
  const [outputAudioUri, setOutputAudioUri] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState<'input' | 'output' | null>(null);
  const [saving, setSaving] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const inputLang: 'en' | 'jp' = direction === 'en-to-jp' ? 'en' : 'jp';
  const outputLang: 'en' | 'jp' = direction === 'en-to-jp' ? 'jp' : 'en';
  const inputLabel = direction === 'en-to-jp' ? 'English' : 'Japanese';
  const outputLabel = direction === 'en-to-jp' ? 'Japanese' : 'English';

  function resetOutput() {
    setResult(null);
    setInputAudioUri(null);
    setOutputAudioUri(null);
  }

  async function handleTranslate() {
    const text = inputText.trim();
    if (!text) return;
    setTranslating(true);
    resetOutput();
    try {
      const res = await translateText(text, direction);
      setResult(res);
    } catch (e) {
      Alert.alert('Translation error', String(e));
    } finally {
      setTranslating(false);
    }
  }

  async function playAudio(text: string, lang: 'en' | 'jp', side: 'input' | 'output') {
    // Use cached URI if available
    let uri = side === 'input' ? inputAudioUri : outputAudioUri;

    if (!uri) {
      setGeneratingAudio(side);
      try {
        uri = await generateAudio(text, lang);
        if (side === 'input') setInputAudioUri(uri);
        else setOutputAudioUri(uri);
      } catch (e) {
        Alert.alert('Audio error', String(e));
        setGeneratingAudio(null);
        return;
      }
      setGeneratingAudio(null);
    }

    try {
      // Unload any currently playing sound
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri });
      soundRef.current = sound;
      await sound.playAsync();
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          soundRef.current = null;
        }
      });
    } catch (e) {
      Alert.alert('Playback error', String(e));
    }
  }

  async function handleSave() {
    if (!result || !inputText.trim()) return;
    setSaving(true);
    try {
      const enText = direction === 'en-to-jp' ? inputText.trim() : result.translatedText;
      const jpText = direction === 'en-to-jp' ? result.translatedText : inputText.trim();

      // Generate any audio that hasn't been fetched yet
      let enUri = direction === 'en-to-jp' ? inputAudioUri : outputAudioUri;
      let jpUri = direction === 'en-to-jp' ? outputAudioUri : inputAudioUri;
      if (!enUri) enUri = await generateAudio(enText, 'en');
      if (!jpUri) jpUri = await generateAudio(jpText, 'jp');

      await saveCard({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        englishText: enText,
        japaneseText: jpText,
        romajiText: result.romajiText,
        enAudioPath: enUri,
        jpAudioPath: jpUri,
        source: 'translator',
        grammarNote: '',
      });
      Alert.alert('Saved!', 'Flashcard added to your deck.');
    } catch (e) {
      Alert.alert('Save error', String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleToggleDirection() {
    setDirection((d) => (d === 'en-to-jp' ? 'jp-to-en' : 'en-to-jp'));
    setInputText('');
    resetOutput();
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Direction toggle */}
      <TouchableOpacity style={styles.toggleRow} onPress={handleToggleDirection} activeOpacity={0.7}>
        <Text style={[styles.toggleLabel, direction === 'en-to-jp' && styles.toggleLabelActive]}>
          English
        </Text>
        <Text style={styles.toggleArrow}>⇄</Text>
        <Text style={[styles.toggleLabel, direction === 'jp-to-en' && styles.toggleLabelActive]}>
          Japanese
        </Text>
      </TouchableOpacity>

      {/* Input */}
      <Text style={styles.sectionLabel}>{inputLabel}</Text>
      <TextInput
        style={styles.input}
        multiline
        placeholder={`Type ${inputLabel.toLowerCase()} here…`}
        placeholderTextColor="#A0ADB5"
        value={inputText}
        onChangeText={(text) => {
          setInputText(text);
          resetOutput();
        }}
      />

      <TouchableOpacity
        style={[styles.translateButton, (!inputText.trim() || translating) && styles.buttonDisabled]}
        onPress={handleTranslate}
        disabled={!inputText.trim() || translating}
        activeOpacity={0.8}
      >
        {translating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.translateButtonText}>Translate</Text>
        )}
      </TouchableOpacity>

      {/* Output */}
      {result && (
        <>
          <Text style={styles.sectionLabel}>{outputLabel}</Text>
          <View style={styles.outputCard}>
            <Text selectable style={styles.outputMain}>{result.translatedText}</Text>
            {result.romajiText ? (
              <Text selectable style={styles.outputRomaji}>{result.romajiText}</Text>
            ) : null}
            <CopyButton
              text={result.romajiText ? `${result.translatedText}\n${result.romajiText}` : result.translatedText}
              style={styles.copyButton}
            />
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.audioButton}
              onPress={() => playAudio(inputText.trim(), inputLang, 'input')}
              disabled={generatingAudio !== null}
              activeOpacity={0.7}
            >
              {generatingAudio === 'input' ? (
                <ActivityIndicator size="small" color="#4A90D9" />
              ) : (
                <Text style={styles.audioButtonText}>▶ {inputLabel}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.audioButton}
              onPress={() => playAudio(result.translatedText, outputLang, 'output')}
              disabled={generatingAudio !== null}
              activeOpacity={0.7}
            >
              {generatingAudio === 'output' ? (
                <ActivityIndicator size="small" color="#4A90D9" />
              ) : (
                <Text style={styles.audioButtonText}>▶ {outputLabel}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save Card</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#A0ADB5',
  },
  toggleLabelActive: {
    color: '#2C3E50',
  },
  toggleArrow: {
    fontSize: 22,
    color: '#4A90D9',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A0ADB5',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    minHeight: 130,
    fontSize: 17,
    color: '#2C3E50',
    textAlignVertical: 'top',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
    marginBottom: 16,
  },
  translateButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  translateButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  outputCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  outputMain: {
    fontSize: 24,
    color: '#2C3E50',
    lineHeight: 34,
    marginBottom: 10,
  },
  outputRomaji: {
    fontSize: 15,
    color: '#7F8C8D',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  copyButton: {
    alignSelf: 'flex-start',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  audioButton: {
    flex: 1,
    backgroundColor: '#EAF3FF',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C5D9F1',
  },
  audioButtonText: {
    color: '#4A90D9',
    fontWeight: '600',
    fontSize: 14,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#27AE60',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    shadowColor: '#27AE60',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
