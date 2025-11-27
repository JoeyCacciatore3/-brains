import type { FileData } from '@/lib/validation';

/**
 * Message interface for discussions
 * Primary message type used throughout the application
 *
 * Single source of truth: All messages use discussion_id only.
 * Legacy conversation_id has been removed.
 */
export interface ConversationMessage {
  id?: number;
  /** Primary identifier for discussion-based system. Use this for all code. */
  discussion_id?: string;
  persona: 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User';
  content: string;
  turn: number;
  /** ISO 8601 timestamp string - used for display and client-side operations */
  timestamp: string;
  /** Unix timestamp in milliseconds - used for sorting and database queries (more precise than timestamp) */
  created_at: number;
}

// Socket.IO Event Types
export interface StartDialogueEvent {
  topic: string;
  files?: FileData[];
  userId?: string; // Optional for backward compatibility, but recommended for discussions
}


export interface DiscussionStartedEvent {
  discussionId: string | null; // null if hasActiveDiscussion is true
  hasActiveDiscussion: boolean;
}

export interface MessageStartEvent {
  discussionId: string; // Standardized: always discussionId
  persona: string;
  turn: number;
}

export interface MessageChunkEvent {
  discussionId: string; // Standardized: always discussionId
  chunk: string;
}

export interface MessageCompleteEvent {
  discussionId: string; // Standardized: always discussionId
  message: ConversationMessage;
}


/**
 * Event emitted when a discussion reaches resolution
 *
 * Note: Event name uses "conversation-resolved" for backward compatibility,
 * but payload uses discussionId to match current terminology.
 */
export interface ConversationResolvedEvent {
  discussionId: string; // Standardized: always discussionId
  solution?: string; // NEW: Extracted solution text
  confidence: number; // NEW: Confidence score 0-1
  reason?: string; // NEW: Resolution reason
  finalizedSummary?: string; // NEW: Collaborative finalized summary when consensus reached
}

export interface SocketErrorEvent {
  discussionId?: string; // Standardized: always discussionId
  message: string;
  code?: string; // Error code from ErrorCode enum
}

// Streaming display modes
export type StreamingMode = 'word-by-word' | 'message-by-message';

// Round-based discussion types
export interface DiscussionRound {
  roundNumber: number;
  analyzerResponse: ConversationMessage;
  solverResponse: ConversationMessage;
  moderatorResponse: ConversationMessage; // Required: Moderator AI now participates in discussion
  timestamp: string;
  questions?: QuestionSet;
  userAnswers?: string[]; // Selected option IDs
}

export interface SummaryEntry {
  summary: string;
  createdAt: number;
  roundNumber: number; // Round when summary was created
  tokenCountBefore: number;
  tokenCountAfter: number;
  replacesRounds: number[]; // Which rounds this summary replaces
}

export interface QuestionSet {
  roundNumber: number;
  questions: Question[];
  generatedAt: string;
}

export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
  userAnswers?: string[]; // Selected option IDs
}

export interface QuestionOption {
  id: string;
  text: string;
}

// Socket.IO Event Types for Round-Based System
export interface RoundCompleteEvent {
  discussionId: string; // Standardized: always discussionId
  round: DiscussionRound;
  currentRoundNumber?: number; // Round number for client state management
}

export interface QuestionsGeneratedEvent {
  discussionId: string; // Standardized: always discussionId
  questionSet: QuestionSet;
  roundNumber: number;
}

export interface SummaryCreatedEvent {
  discussionId: string; // Standardized: always discussionId
  summary: SummaryEntry;
}

export interface SubmitAnswersEvent {
  /** Primary identifier for discussion-based system. */
  discussionId: string;
  roundNumber: number;
  answers: Record<string, string[]>; // questionId -> selected option IDs
}

export interface ProceedDialogueEvent {
  discussionId: string;
}


export interface GenerateQuestionsEvent {
  discussionId: string;
  roundNumber?: number;
}

/**
 * Socket.IO socket.data interface
 * Extends Socket.IO's socket.data with custom properties
 * Note: Socket.IO's Socket.data is typed as 'any' by default, so we define our structure here
 * and use type assertions when accessing socket.data: (socket.data as SocketData)
 */
export interface SocketData {
  previousDiscussionId?: string;
  userId?: string;
  [key: string]: unknown;
}
