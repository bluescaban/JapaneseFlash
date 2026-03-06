import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Modal,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { Audio } from 'expo-av';
import { Flashcard, getDueCards, updateCardSRS, CardRating } from '../db/database';

interface Props {
  visible: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export default function ReviewScreen({ visible, onClose, onComplete }: Props) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  async function load() {
    setLoading(true);
    setIndex(0);
    setDone(false);
    resetFlip();
    try {
      const due = await getDueCards();
      setCards(due);
    } catch (e) {
      Alert.alert('Error loading cards', String(e));
    } finally {
      setLoading(false);
    }
  }

  function resetFlip() {
    flipAnim.setValue(0);
    setIsFlipped(false);
  }

  function handleFlip() {
    if (isFlipped) return;
    Animated.spring(flipAnim, {
      toValue: 1,
      friction: 8,
      tension: 10,
      useNativeDriver: true,
    }).start(() => setIsFlipped(true));
  }

  async function handleRating(rating: CardRating) {
    const card = cards[index];
    if (!card) return;

    try {
      await updateCardSRS(card.id, rating);
    } catch (e) {
      Alert.alert('Error saving rating', String(e));
    }

    const nextIndex = index + 1;
    if (nextIndex >= cards.length) {
      setDone(true);
    } else {
      resetFlip();
      setIndex(nextIndex);
    }
  }

  async function playAudio(uri: string) {
    if (!uri || playingAudio) return;
    setPlayingAudio(true);
    try {
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
          setPlayingAudio(false);
        }
      });
    } catch {
      setPlayingAudio(false);
    }
  }

  // ─── Flip animation interpolations ──────────────────────────────────────────

  const frontRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backRotate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const currentCard = cards[index];
  const progress = cards.length > 0 ? (index / cards.length) * 100 : 0;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator color="#4A90D9" style={{ flex: 1 }} />

        ) : done || cards.length === 0 ? (
          // ─── Completion screen ───────────────────────────────────────────────
          <View style={styles.doneContainer}>
            <Text style={styles.doneEmoji}>🎉</Text>
            <Text style={styles.doneTitle}>
              {cards.length === 0 ? 'Nothing due!' : 'Session complete!'}
            </Text>
            <Text style={styles.doneSubtitle}>
              {cards.length === 0
                ? 'All cards are up to date. Check back later.'
                : `You reviewed ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}.`}
            </Text>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => { onComplete(); onClose(); }}
              activeOpacity={0.8}
            >
              <Text style={styles.doneButtonText}>Back to Deck</Text>
            </TouchableOpacity>
          </View>

        ) : (
          <>
            {/* ─── Header ──────────────────────────────────────────────────── */}
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.progressLabel}>
                {index + 1} / {cards.length}
              </Text>
            </View>

            {/* ─── Progress bar ─────────────────────────────────────────────── */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>

            {/* ─── Flip card ───────────────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.cardWrapper}
              onPress={handleFlip}
              activeOpacity={0.95}
              disabled={isFlipped}
            >
              {/* Front face — English */}
              <Animated.View
                style={[
                  styles.face,
                  { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] },
                ]}
              >
                <Text style={styles.faceLabel}>ENGLISH</Text>
                <Text style={styles.frontText}>{currentCard.englishText}</Text>
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() => playAudio(currentCard.enAudioPath)}
                  disabled={!currentCard.enAudioPath || playingAudio}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {playingAudio ? (
                    <ActivityIndicator size="small" color="#4A90D9" />
                  ) : (
                    <Text style={styles.playBtnText}>▶ Play</Text>
                  )}
                </TouchableOpacity>
                {!isFlipped && (
                  <Text style={styles.tapHint}>Tap to reveal</Text>
                )}
              </Animated.View>

              {/* Back face — Japanese */}
              <Animated.View
                style={[
                  styles.face,
                  styles.faceBack,
                  { transform: [{ perspective: 1200 }, { rotateY: backRotate }] },
                ]}
              >
                <Text style={styles.faceLabel}>JAPANESE</Text>
                <Text style={styles.backJapanese}>{currentCard.japaneseText}</Text>
                {currentCard.romajiText ? (
                  <Text style={styles.backRomaji}>{currentCard.romajiText}</Text>
                ) : null}
                <TouchableOpacity
                  style={styles.playBtn}
                  onPress={() => playAudio(currentCard.jpAudioPath)}
                  disabled={!currentCard.jpAudioPath || playingAudio}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {playingAudio ? (
                    <ActivityIndicator size="small" color="#4A90D9" />
                  ) : (
                    <Text style={styles.playBtnText}>▶ Play</Text>
                  )}
                </TouchableOpacity>
              </Animated.View>
            </TouchableOpacity>

            {/* ─── Rating buttons ───────────────────────────────────────────── */}
            <View style={[styles.ratingRow, !isFlipped && styles.ratingHidden]} pointerEvents={isFlipped ? 'auto' : 'none'}>
              <RatingButton label="Again" sublabel="<1d" color="#E74C3C" onPress={() => handleRating('again')} />
              <RatingButton label="Hard"  sublabel="~2d" color="#E67E22" onPress={() => handleRating('hard')} />
              <RatingButton label="Good"  sublabel="~4d" color="#27AE60" onPress={() => handleRating('good')} />
              <RatingButton label="Easy"  sublabel="~7d" color="#4A90D9" onPress={() => handleRating('easy')} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── Rating button ────────────────────────────────────────────────────────────

function RatingButton({
  label,
  sublabel,
  color,
  onPress,
}: {
  label: string;
  sublabel: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.ratingBtn, { backgroundColor: color }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={styles.ratingLabel}>{label}</Text>
      <Text style={styles.ratingSublabel}>{sublabel}</Text>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FF',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 32,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4A90D9',
  },
  progressLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#7F8C8D',
  },

  // Progress bar
  progressTrack: {
    height: 4,
    backgroundColor: '#E0E7EF',
    borderRadius: 2,
    marginBottom: 32,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4A90D9',
    borderRadius: 2,
  },

  // Flip card
  cardWrapper: {
    flex: 1,
    marginBottom: 28,
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  faceBack: {
    backgroundColor: '#F0F7FF',
  },
  faceLabel: {
    position: 'absolute',
    top: 20,
    left: 24,
    fontSize: 11,
    fontWeight: '700',
    color: '#A0ADB5',
    letterSpacing: 1,
  },
  frontText: {
    fontSize: 28,
    fontWeight: '600',
    color: '#2C3E50',
    textAlign: 'center',
    lineHeight: 38,
    marginBottom: 24,
  },
  backJapanese: {
    fontSize: 34,
    color: '#2C3E50',
    textAlign: 'center',
    lineHeight: 46,
    marginBottom: 10,
  },
  backRomaji: {
    fontSize: 17,
    color: '#7F8C8D',
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 24,
  },
  playBtn: {
    backgroundColor: '#EAF3FF',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: '#C5D9F1',
  },
  playBtnText: {
    color: '#4A90D9',
    fontWeight: '600',
    fontSize: 15,
  },
  tapHint: {
    position: 'absolute',
    bottom: 20,
    fontSize: 13,
    color: '#BDC3C7',
    fontWeight: '500',
  },

  // Rating row
  ratingRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ratingHidden: {
    opacity: 0,
  },
  ratingBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  ratingLabel: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  ratingSublabel: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: 2,
  },

  // Completion screen
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  doneEmoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 12,
    textAlign: 'center',
  },
  doneSubtitle: {
    fontSize: 16,
    color: '#7F8C8D',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 36,
  },
  doneButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    shadowColor: '#4A90D9',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
