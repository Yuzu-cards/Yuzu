// Yuzu data model. One note = one fact (its fields), one or more cards per note.
// A card's deck path lives in `source` (the Decks view). Systems / Specialties / Exams are views over the note's auto:: tags.
// A card imported from Anki deck "Medicine::Emergency Medicine::EKG" gets the tag
// "Medicine::Emergency Medicine::EKG" (hierarchical with ::) plus any Anki tags it had.

export type CardState = "new" | "learning" | "review" | "relearning";
export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export interface Template { name: string; qfmt: string; afmt: string }

export interface Notetype {
  id: string;
  name: string;
  kind: "standard" | "cloze";
  css: string;
  fields: string[];
  templates: Template[];
}

export interface Note {
  id: string;
  ntid: string;
  guid: string;
  fields: string[];
  tags: string[];        // lowercase-insensitive, hierarchical with ::
  created: number;       // ms
  modified: number;      // ms
  /** Anki's own modification time of the version last imported (ms). */
  ankiMod?: number;
  /** Last time the user edited the fields in Yuzu (ms). */
  edited?: number;
  /** Set on a note tagged needs-review::similar when it was added: the existing note it resembles. */
  similarTo?: string;
}

export interface Card {
  id: string;
  nid: string;
  ord: number;           // template index, or cloze number - 1
  state: CardState;
  suspended: boolean;
  flag: number;
  due: number;           // ms timestamp when it should be shown (for new: creation order)
  stability: number;     // FSRS S (days)
  difficulty: number;    // FSRS D (1..10)
  reps: number;
  lapses: number;
  lastReview: number;    // ms, 0 if never
  step: number;          // position in learning/relearning steps
  created: number;
  mod: number;           // ms, last change of any kind (review, suspend, flag); used by sync
  source: string;        // original deck path, kept for reference ("Medicine::EKG")
}

export interface Review {
  id: string;            // `${cid}-${ts}`
  cid: string;
  ts: number;            // ms
  rating: Rating;
  state: CardState;      // state before the review
  elapsedDays: number;
  scheduledDays: number;
  durationMs: number;
}


export interface ImportSummary {
  notetypes: number; notes: number; cards: number; reviews: number;
  tags: number; media: number; skippedNotes: number;
  format: "anki21b" | "anki21" | "anki2";
}

