import { useState, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';

export interface UseVoiceRecorderResult {
  isRecording: boolean;
  permissionGranted: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>;
}

// useVoiceRecorder
//
// Wraps expo-av Audio.Recording into a simple hook.
// Usage:
//   const { isRecording, startRecording, stopRecording } = useVoiceRecorder();
//   await startRecording();
//   const uri = await stopRecording(); // pass to transcribeSpeech()

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    // Guard: don't start a second recording while one is active
    if (recordingRef.current) return;

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Microphone access required',
          'Please enable microphone access in Settings to use voice input.',
        );
        return;
      }
      setPermissionGranted(true);

      // iOS requires this mode to be set before recording starts.
      // playsInSilentModeIOS ensures TTS playback still works with the ringer off.
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        // HIGH_QUALITY records as m4a on iOS — accepted directly by Whisper
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (e) {
      Alert.alert('Could not start recording', String(e));
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    if (!recordingRef.current) return null;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI() ?? null;
      recordingRef.current = null;
      setIsRecording(false);

      // Reset audio session so expo-av playback (TTS) works normally afterward
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      return uri;
    } catch (e) {
      Alert.alert('Could not stop recording', String(e));
      recordingRef.current = null;
      setIsRecording(false);
      return null;
    }
  }, []);

  return { isRecording, permissionGranted, startRecording, stopRecording };
}
