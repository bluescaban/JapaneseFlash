import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Flashcard, getAllCards, getDueCards, deleteCard } from '../db/database';
import ReviewScreen from './ReviewScreen';
import CopyButton from '../components/CopyButton';

export default function DeckScreen() {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [dueCount, setDueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<Flashcard | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [playingAudio, setPlayingAudio] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Reload every time this tab comes into focus (e.g. after saving from Translator)
  useFocusEffect(
    useCallback(() => {
      loadCards();
    }, []),
  );

  async function loadCards() {
    setLoading(true);
    try {
      const [all, due] = await Promise.all([getAllCards(), getDueCards()]);
      setCards(all);
      setDueCount(due.length);
    } catch (e) {
      Alert.alert('Error loading cards', String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(card: Flashcard) {
    Alert.alert(
      'Delete card?',
      `"${card.englishText}" will be permanently removed from your deck.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteCard(card.id);
            if (selectedCard?.id === card.id) setSelectedCard(null);
            loadCards();
          },
        },
      ],
    );
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

  // ─── Card list item ──────────────────────────────────────────────────────────

  function renderCard({ item }: { item: Flashcard }) {
    const isDue = item.nextReview <= Date.now();
    return (
      <TouchableOpacity
        style={styles.cardItem}
        onPress={() => setSelectedCard(item)}
        activeOpacity={0.75}
      >
        <View style={styles.cardBody}>
          <Text style={styles.cardEnglish} numberOfLines={1}>
            {item.englishText}
          </Text>
          <Text style={styles.cardJapanese} numberOfLines={1}>
            {item.japaneseText}
          </Text>
          {item.romajiText ? (
            <Text style={styles.cardRomaji} numberOfLines={1}>
              {item.romajiText}
            </Text>
          ) : null}
        </View>

        <View style={styles.cardRight}>
          {isDue && <View style={styles.dueDot} />}
          <View style={[styles.badge, item.source === 'kintaro' && styles.badgeKintaro]}>
            <Text style={styles.badgeText}>
              {item.source === 'kintaro' ? 'Kintaro' : 'Trans'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => handleDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.deleteHit}
          >
            <Text style={styles.deleteX}>✕</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Stats bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          {dueCount > 0 ? `  ·  ${dueCount} due` : ''}
        </Text>
        <TouchableOpacity
          style={[styles.reviewButton, dueCount === 0 && styles.reviewButtonDisabled]}
          disabled={dueCount === 0}
          onPress={() => setReviewing(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.reviewButtonText}>
            {dueCount > 0 ? `Review (${dueCount})` : 'All caught up'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#4A90D9" style={{ marginTop: 48 }} />
      ) : cards.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No cards yet</Text>
          <Text style={styles.emptySubtitle}>
            Translate something and tap Save Card to add your first flashcard.
          </Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
        />
      )}

      {/* ─── Review session ──────────────────────────────────────────────────── */}
      <ReviewScreen
        visible={reviewing}
        onClose={() => setReviewing(false)}
        onComplete={loadCards}
      />

      {/* ─── Preview modal ─────────────────────────────────────────────────────── */}
      <Modal
        visible={selectedCard !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedCard(null)}
      >
        {selectedCard && (
          <View style={styles.modal}>
            {/* Modal header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Card Preview</Text>
              <TouchableOpacity onPress={() => setSelectedCard(null)}>
                <Text style={styles.modalDone}>Done</Text>
              </TouchableOpacity>
            </View>

            {/* English side */}
            <View style={styles.modalSection}>
              <View style={styles.modalSectionHeader}>
                <Text style={styles.modalLabel}>ENGLISH</Text>
                <CopyButton text={selectedCard.englishText} />
              </View>
              <Text selectable style={styles.modalEnglish}>{selectedCard.englishText}</Text>
              <TouchableOpacity
                style={[styles.playBtn, (!selectedCard.enAudioPath || playingAudio) && styles.playBtnDisabled]}
                onPress={() => playAudio(selectedCard.enAudioPath)}
                disabled={!selectedCard.enAudioPath || playingAudio}
              >
                {playingAudio ? (
                  <ActivityIndicator size="small" color="#4A90D9" />
                ) : (
                  <Text style={styles.playBtnText}>▶ Play English</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Japanese side */}
            <View style={styles.modalSection}>
              <View style={styles.modalSectionHeader}>
                <Text style={styles.modalLabel}>JAPANESE</Text>
                <CopyButton text={selectedCard.romajiText ? `${selectedCard.japaneseText}\n${selectedCard.romajiText}` : selectedCard.japaneseText} />
              </View>
              <Text selectable style={styles.modalJapanese}>{selectedCard.japaneseText}</Text>
              {selectedCard.romajiText ? (
                <Text selectable style={styles.modalRomaji}>{selectedCard.romajiText}</Text>
              ) : null}
              <TouchableOpacity
                style={[styles.playBtn, (!selectedCard.jpAudioPath || playingAudio) && styles.playBtnDisabled]}
                onPress={() => playAudio(selectedCard.jpAudioPath)}
                disabled={!selectedCard.jpAudioPath || playingAudio}
              >
                {playingAudio ? (
                  <ActivityIndicator size="small" color="#4A90D9" />
                ) : (
                  <Text style={styles.playBtnText}>▶ Play Japanese</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Grammar note (Kintaro cards) */}
            {selectedCard.grammarNote ? (
              <View style={styles.modalSection}>
                <View style={styles.modalSectionHeader}>
                  <Text style={styles.modalLabel}>GRAMMAR NOTE</Text>
                  <CopyButton text={selectedCard.grammarNote} />
                </View>
                <Text selectable style={styles.modalGrammar}>{selectedCard.grammarNote}</Text>
              </View>
            ) : null}

            {/* SRS status */}
            <View style={styles.modalSection}>
              <Text style={styles.modalLabel}>SRS STATUS</Text>
              <Text style={styles.modalSrs}>
                Interval: {selectedCard.interval}{' '}
                {selectedCard.interval === 1 ? 'day' : 'days'}
                {'   '}Ease: {selectedCard.easeFactor.toFixed(2)}
                {'   '}Reviews: {selectedCard.repetitions}
              </Text>
              <Text style={[styles.modalSrs, { marginTop: 4 }]}>
                Next review:{' '}
                {selectedCard.nextReview <= Date.now()
                  ? 'Due now'
                  : new Date(selectedCard.nextReview).toLocaleDateString()}
              </Text>
            </View>

            {/* Delete */}
            <TouchableOpacity
              style={styles.modalDeleteBtn}
              onPress={() => handleDelete(selectedCard)}
            >
              <Text style={styles.modalDeleteText}>Delete Card</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E8ECF0',
  },
  statsText: {
    fontSize: 14,
    color: '#7F8C8D',
    fontWeight: '500',
  },
  reviewButton: {
    backgroundColor: '#4A90D9',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  reviewButtonDisabled: {
    backgroundColor: '#C5D9F1',
  },
  reviewButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },

  // Card list
  list: {
    padding: 16,
    gap: 10,
  },
  cardItem: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cardBody: {
    flex: 1,
    marginRight: 10,
  },
  cardEnglish: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 3,
  },
  cardJapanese: {
    fontSize: 16,
    color: '#2C3E50',
    marginBottom: 2,
  },
  cardRomaji: {
    fontSize: 13,
    color: '#7F8C8D',
    fontStyle: 'italic',
  },
  cardRight: {
    alignItems: 'center',
    gap: 8,
  },
  dueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E74C3C',
  },
  badge: {
    backgroundColor: '#EAF3FF',
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  badgeKintaro: {
    backgroundColor: '#FDF3E7',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7F8C8D',
  },
  deleteHit: {
    padding: 2,
  },
  deleteX: {
    fontSize: 14,
    color: '#BDC3C7',
    fontWeight: '600',
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#7F8C8D',
    textAlign: 'center',
    lineHeight: 22,
  },

  // Preview modal
  modal: {
    flex: 1,
    backgroundColor: '#F5F8FF',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
    paddingTop: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2C3E50',
  },
  modalDone: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4A90D9',
  },
  modalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  modalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A0ADB5',
    letterSpacing: 1,
  },
  modalEnglish: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2C3E50',
    marginBottom: 12,
    lineHeight: 28,
  },
  modalJapanese: {
    fontSize: 24,
    color: '#2C3E50',
    marginBottom: 6,
    lineHeight: 34,
  },
  modalRomaji: {
    fontSize: 14,
    color: '#7F8C8D',
    fontStyle: 'italic',
    marginBottom: 12,
  },
  modalGrammar: {
    fontSize: 15,
    color: '#2C3E50',
    lineHeight: 22,
  },
  modalSrs: {
    fontSize: 14,
    color: '#7F8C8D',
  },
  playBtn: {
    backgroundColor: '#EAF3FF',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C5D9F1',
  },
  playBtnDisabled: {
    opacity: 0.45,
  },
  playBtnText: {
    color: '#4A90D9',
    fontWeight: '600',
    fontSize: 14,
  },
  modalDeleteBtn: {
    backgroundColor: '#FDECEA',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  modalDeleteText: {
    color: '#E74C3C',
    fontWeight: '700',
    fontSize: 16,
  },
});
