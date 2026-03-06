import * as SQLite from 'expo-sqlite';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Flashcard {
  id: string;
  englishText: string;
  japaneseText: string;
  romajiText: string;
  enAudioPath: string;
  jpAudioPath: string;
  source: 'translator' | 'kintaro';
  grammarNote: string;
  createdAt: number;
  nextReview: number;
  interval: number;
  easeFactor: number;
  repetitions: number;
}

// Fields required when saving a new card — SRS fields are set to defaults
export type NewCard = Pick<
  Flashcard,
  'id' | 'englishText' | 'japaneseText' | 'romajiText' | 'enAudioPath' | 'jpAudioPath' | 'source' | 'grammarNote'
>;

export type CardRating = 'again' | 'hard' | 'good' | 'easy';

// ─── DB instance ──────────────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;

function getDB(): SQLite.SQLiteDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDB() first.');
  return _db;
}

// ─── initDB ───────────────────────────────────────────────────────────────────
// Opens the database and creates the flashcards table if it doesn't exist.
// Call once at app startup (in App.tsx useEffect).

export async function initDB(): Promise<void> {
  _db = await SQLite.openDatabaseAsync('japaneseflash.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS flashcards (
      id           TEXT PRIMARY KEY,
      englishText  TEXT NOT NULL,
      japaneseText TEXT NOT NULL,
      romajiText   TEXT NOT NULL,
      enAudioPath  TEXT NOT NULL DEFAULT '',
      jpAudioPath  TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL DEFAULT 'translator',
      grammarNote  TEXT NOT NULL DEFAULT '',
      createdAt    INTEGER NOT NULL,
      nextReview   INTEGER NOT NULL,
      interval     INTEGER NOT NULL DEFAULT 1,
      easeFactor   REAL    NOT NULL DEFAULT 2.5,
      repetitions  INTEGER NOT NULL DEFAULT 0
    );
  `);
}

// ─── saveCard ─────────────────────────────────────────────────────────────────
// Inserts a new card. SRS fields default to fresh state.
// Uses INSERT OR REPLACE so calling again with the same id updates it.

export async function saveCard(card: NewCard): Promise<void> {
  const db = getDB();
  const now = Date.now();
  await db.runAsync(
    `INSERT OR REPLACE INTO flashcards
      (id, englishText, japaneseText, romajiText, enAudioPath, jpAudioPath, source, grammarNote,
       createdAt, nextReview, interval, easeFactor, repetitions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2.5, 0)`,
    card.id,
    card.englishText,
    card.japaneseText,
    card.romajiText,
    card.enAudioPath,
    card.jpAudioPath,
    card.source,
    card.grammarNote,
    now,
    now, // nextReview = now so the card is immediately due for review
  );
}

// ─── getAllCards ──────────────────────────────────────────────────────────────
// Returns all cards ordered by creation date (newest first).

export async function getAllCards(): Promise<Flashcard[]> {
  return getDB().getAllAsync<Flashcard>(
    'SELECT * FROM flashcards ORDER BY createdAt DESC',
  );
}

// ─── getDueCards ──────────────────────────────────────────────────────────────
// Returns only cards whose nextReview timestamp is in the past, ordered by
// most overdue first. Used by the deck review screen.

export async function getDueCards(): Promise<Flashcard[]> {
  return getDB().getAllAsync<Flashcard>(
    'SELECT * FROM flashcards WHERE nextReview <= ? ORDER BY nextReview ASC',
    Date.now(),
  );
}

// ─── updateCardSRS ────────────────────────────────────────────────────────────
// Applies the SM-2 algorithm based on the user's rating and persists the result.
//
// Rating → SM-2 quality score:
//   again = 1  (failed, reset)
//   hard  = 3  (passed with difficulty)
//   good  = 4  (passed after a hesitation)
//   easy  = 5  (perfect recall)

export async function updateCardSRS(id: string, rating: CardRating): Promise<void> {
  const db = getDB();
  const card = await db.getFirstAsync<Flashcard>(
    'SELECT * FROM flashcards WHERE id = ?',
    id,
  );
  if (!card) return;

  const quality = ratingToQuality(rating);
  let { interval, easeFactor, repetitions } = card;

  if (quality < 3) {
    // Failed — reset streak, review again tomorrow
    repetitions = 0;
    interval = 1;
  } else {
    // Passed — advance the interval
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Adjust ease factor (SM-2 formula), never let it drop below 1.3
  easeFactor += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  easeFactor = Math.max(1.3, easeFactor);

  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

  await db.runAsync(
    `UPDATE flashcards
     SET interval = ?, easeFactor = ?, repetitions = ?, nextReview = ?
     WHERE id = ?`,
    interval,
    easeFactor,
    repetitions,
    nextReview,
    id,
  );
}

// ─── deleteCard ───────────────────────────────────────────────────────────────

export async function deleteCard(id: string): Promise<void> {
  await getDB().runAsync('DELETE FROM flashcards WHERE id = ?', id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ratingToQuality(rating: CardRating): number {
  switch (rating) {
    case 'again': return 1;
    case 'hard':  return 3;
    case 'good':  return 4;
    case 'easy':  return 5;
  }
}
