'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { clientLogger } from '@/lib/client-logger';
import type {
  DiscussionStartedEvent,
  MessageStartEvent,
  MessageChunkEvent,
  MessageCompleteEvent,
  SocketErrorEvent,
  RoundCompleteEvent,
  QuestionsGeneratedEvent,
  SummaryCreatedEvent,
  // Moderator summary events removed - Moderator AI now participates in discussion
  DiscussionRound,
  QuestionSet,
  SummaryEntry,
  ConversationMessage,
} from '@/types';
import type { FileData } from '@/lib/validation';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  connectionState: ConnectionState;
  // Standardized: discussionId is the primary identifier
  discussionId: string | null;
  currentMessage: {
    persona: string;
    turn: number;
    content: string;
  } | null;
  rounds: DiscussionRound[]; // Primary source of truth for discussion data
  currentRound: DiscussionRound | null; // New: current round being displayed
  currentQuestionSet: QuestionSet | null; // New: current question set
  currentSummary: SummaryEntry | null; // New: current summary
  summaries: SummaryEntry[]; // All summaries created during the discussion
  waitingForAction: boolean; // Whether waiting for user action after round
  isResolved: boolean;
  error: string | null;
  startDialogue: (topic: string, files?: FileData[], userId?: string) => void;
  sendUserInput: (input: string) => void;
  submitAnswers: (roundNumber: number, answers: Record<string, string[]>) => void; // New
  proceedDialogue: () => void; // New
  generateSummary: () => void; // New
  generateQuestions: () => void; // New
  reset: () => void;
  reconnect: () => void;
}

/**
 * Socket client hook for managing real-time communication
 *
 * State Update Strategy:
 * - Uses multiple useState hooks for clarity and maintainability
 * - React 18's automatic batching handles most state update scenarios
 * - Separate updates are intentional for code clarity
 * - For complex updates, consider using useReducer in the future if needed
 *
 * Note: React 18 automatically batches state updates in event handlers,
 * so multiple setState calls are typically batched together.
 */
export function useSocket(): UseSocketReturn {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  // Standardized: discussionId is the primary identifier
  const [discussionId, setDiscussionId] = useState<string | null>(null);
  const [currentMessage, setCurrentMessage] = useState<{
    persona: string;
    turn: number;
    content: string;
  } | null>(null);
  const [rounds, setRounds] = useState<DiscussionRound[]>([]); // Primary source of truth
  const [currentRound, setCurrentRound] = useState<DiscussionRound | null>(null); // New
  const [currentQuestionSet, setCurrentQuestionSet] = useState<QuestionSet | null>(null); // New
  const [currentSummary, setCurrentSummary] = useState<SummaryEntry | null>(null); // New
  const [summaries, setSummaries] = useState<SummaryEntry[]>([]); // All summaries created during the discussion
  const [waitingForAction, setWaitingForAction] = useState(false); // Waiting for user action after round
  const [isResolved, setIsResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // localStorage key for state persistence
  // Note: Key name uses "dialogue" instead of "discussion" for backward compatibility
  // with existing stored data. The key name doesn't affect functionality.
  const STORAGE_KEY = 'ai-dialogue-state';

  // Validation helpers for localStorage data
  const isValidMessage = (message: unknown): message is ConversationMessage => {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const msg = message as Record<string, unknown>;
    return (
      typeof msg.content === 'string' &&
      msg.content.length > 0 &&
      typeof msg.persona === 'string' &&
      typeof msg.turn === 'number' &&
      typeof msg.timestamp === 'string'
    );
  };

  const isValidRound = (round: any): round is DiscussionRound => {
    if (!round || typeof round !== 'object') return false;
    if (typeof round.roundNumber !== 'number') return false;
    if (typeof round.timestamp !== 'string') return false;
    if (!isValidMessage(round.solverResponse)) return false;
    if (!isValidMessage(round.analyzerResponse)) return false;
    if (!isValidMessage(round.moderatorResponse)) return false;
    return true;
  };

  // Save state to localStorage
  const saveStateToStorage = (state: {
    discussionId: string | null;
    rounds: DiscussionRound[];
    currentRound: DiscussionRound | null;
    currentQuestionSet: QuestionSet | null;
    currentSummary: SummaryEntry | null;
    summaries: SummaryEntry[];
    waitingForAction: boolean;
    isResolved: boolean;
  }) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      clientLogger.warn('Failed to save state to localStorage', { error: err });
    }
  };

  // Load state from localStorage with validation
  const loadStateFromStorage = (): {
    discussionId: string | null;
    rounds: DiscussionRound[];
    currentRound: DiscussionRound | null;
    currentQuestionSet: QuestionSet | null;
    currentSummary: SummaryEntry | null;
    summaries?: SummaryEntry[]; // Optional for backward compatibility
    waitingForAction: boolean;
    isResolved: boolean;
  } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);

        // Validate and filter rounds
        const validRounds = Array.isArray(parsed.rounds)
          ? parsed.rounds.filter(isValidRound)
          : [];

        // Validate currentRound
        const validCurrentRound = parsed.currentRound && isValidRound(parsed.currentRound)
          ? parsed.currentRound
          : null;

        // If we filtered out invalid rounds, log a warning
        if (Array.isArray(parsed.rounds) && validRounds.length < parsed.rounds.length) {
          clientLogger.warn('Filtered out invalid rounds from localStorage', {
            originalCount: parsed.rounds.length,
            validCount: validRounds.length,
          });
        }

        // If currentRound was invalid, clear it
        if (parsed.currentRound && !validCurrentRound) {
          clientLogger.warn('Current round from localStorage was invalid, clearing it');
        }

        return {
          ...parsed,
          rounds: validRounds,
          currentRound: validCurrentRound,
          summaries: Array.isArray(parsed.summaries) ? parsed.summaries : [],
        };
      }
    } catch (err) {
      clientLogger.warn('Failed to load state from localStorage', { error: err });
      // Clear corrupted data
      try {
        localStorage.removeItem(STORAGE_KEY);
        clientLogger.info('Cleared corrupted localStorage data');
      } catch (clearErr) {
        clientLogger.warn('Failed to clear corrupted localStorage', { error: clearErr });
      }
    }
    return null;
  };

  // Clear state from localStorage
  const clearStateFromStorage = () => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      clientLogger.warn('Failed to clear state from localStorage', { error: err });
    }
  };

  // Restore state from localStorage on mount
  useEffect(() => {
    const storedState = loadStateFromStorage();
    if (storedState) {
      clientLogger.info('Restoring state from localStorage', {
        discussionId: storedState.discussionId,
        roundsCount: storedState.rounds?.length || 0,
        hasCurrentRound: !!storedState.currentRound,
      });

      // Only restore if we have valid data
      if (storedState.discussionId) {
        setDiscussionId(storedState.discussionId);
      }
      if (Array.isArray(storedState.rounds)) {
        setRounds(storedState.rounds);
      }
      if (storedState.currentRound) {
        setCurrentRound(storedState.currentRound);
      }
      if (storedState.currentQuestionSet) {
        setCurrentQuestionSet(storedState.currentQuestionSet);
      }
      if (storedState.currentSummary) {
        setCurrentSummary(storedState.currentSummary);
      }
      if (Array.isArray(storedState.summaries)) {
        setSummaries(storedState.summaries);
      }
      if (typeof storedState.waitingForAction === 'boolean') {
        setWaitingForAction(storedState.waitingForAction);
      }
      if (typeof storedState.isResolved === 'boolean') {
        setIsResolved(storedState.isResolved);
      }
    }
  }, []); // Only run on mount

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (discussionId) {
      saveStateToStorage({
        discussionId,
        rounds,
        currentRound,
        currentQuestionSet,
        currentSummary,
        summaries,
        waitingForAction,
        isResolved,
      });
    }
  }, [
    discussionId,
    rounds,
    currentRound,
    currentQuestionSet,
    currentSummary,
    summaries,
    waitingForAction,
    isResolved,
  ]);

  useEffect(() => {
    // Initialize socket connection
    const socketUrl =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');

    setConnectionState('connecting');

    const socketInstance = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      timeout: 20000,
      forceNew: false,
    });

    // Track reconnection attempts
    let reconnectAttemptCount = 0;

    // Check if socket is already connected (might connect synchronously)
    // Also check after a brief delay in case connection happens very quickly
    if (socketInstance.connected) {
      clientLogger.info('Socket already connected', { socketId: socketInstance.id });
      setIsConnected(true);
      setConnectionState('connected');
      setError(null);
    } else {
      // Check again after a short delay in case connection happens very quickly
      setTimeout(() => {
        if (socketInstance.connected) {
          clientLogger.info('Socket connected (detected via timeout check)', {
            socketId: socketInstance.id,
          });
          setIsConnected(true);
          setConnectionState('connected');
          setError(null);
        }
      }, 100);
    }

    socketInstance.on('connect', () => {
      clientLogger.info('Socket connected', { socketId: socketInstance.id });
      setIsConnected(true);
      setConnectionState('connected');
      setError(null);
      reconnectAttemptCount = 0;

      // If we have an active conversation, we might need to rejoin the room
      // The server will handle this, but we log it for debugging
      if (discussionId) {
        clientLogger.info('Reconnected during active conversation', { discussionId });
      }
    });

    socketInstance.on('disconnect', (reason) => {
      clientLogger.info('Socket disconnected', { reason, socketId: socketInstance.id });
      setIsConnected(false);

      // Determine connection state based on disconnect reason
      if (reason === 'io server disconnect') {
        // Server initiated disconnect - don't reconnect automatically
        setConnectionState('disconnected');
        setError('Server disconnected. Please refresh the page.');
      } else if (reason === 'io client disconnect') {
        // Client initiated disconnect - normal
        setConnectionState('disconnected');
      } else {
        // Network issues - will attempt to reconnect
        setConnectionState('reconnecting');
        setError(`Connection lost: ${reason}. Attempting to reconnect...`);
      }
    });

    socketInstance.on('reconnect_attempt', (attemptNumber) => {
      reconnectAttemptCount = attemptNumber;
      setConnectionState('reconnecting');
      clientLogger.info('Socket reconnection attempt', {
        attempt: attemptNumber,
        socketId: socketInstance.id,
      });
    });

    socketInstance.on('reconnect', (attemptNumber) => {
      clientLogger.info('Socket reconnected', {
        attempt: attemptNumber,
        socketId: socketInstance.id,
      });
      setConnectionState('connected');
      setIsConnected(true);
      setError(null);
    });

    socketInstance.on('reconnect_error', (error) => {
      clientLogger.error('Socket reconnection error', {
        error: error.message || 'Unknown error',
        attempt: reconnectAttemptCount,
        socketId: socketInstance.id,
      });
      setConnectionState('reconnecting');
    });

    socketInstance.on('reconnect_failed', () => {
      clientLogger.error('Socket reconnection failed after all attempts', {
        socketId: socketInstance.id,
      });
      setConnectionState('error');
      setIsConnected(false);
      setError('Failed to reconnect. Please refresh the page.');
    });

    socketInstance.on('connect_error', (err) => {
      clientLogger.error('Socket connection error', {
        error: err.message || 'Unknown error',
        socketId: socketInstance.id,
      });
      setConnectionState('error');
      const errorMessage = err.message || 'Failed to connect to server';
      setError(
        `Connection error: ${errorMessage}. Please check your network connection and try again.`
      );
    });

    // Discussion events
    /**
     * Handler for 'discussion-started' event
     * Emitted when a new discussion is created
     * This is the primary event for starting a discussion (replaces deprecated 'conversation-started')
     */
    socketInstance.on('discussion-started', (data: DiscussionStartedEvent) => {
      clientLogger.info('Discussion started event received', {
        discussionId: data.discussionId,
        hasActiveDiscussion: data.hasActiveDiscussion,
        socketId: socketInstance.id,
      });
      if (data.discussionId) {
        setDiscussionId((prevId) => {
          clientLogger.debug('Setting discussion ID', {
            previous: prevId,
            new: data.discussionId,
          });
          return data.discussionId;
        });
        setRounds([]);
        setCurrentRound(null); // New
        setCurrentQuestionSet(null);
        setCurrentSummary(null);
        setSummaries([]);
        setWaitingForAction(false);
        setCurrentMessage(null);
        setIsResolved(false);
        setError(null);
      }
      // If hasActiveDiscussion is true, the UI should show a warning
      // This is handled by the InputSection component
    });

    /**
     * Handler for 'message-start' event
     * Emitted when an AI starts generating a response
     * Sets currentMessage for streaming display
     */
    socketInstance.on('message-start', (data: MessageStartEvent) => {
      // Use functional update to get the latest discussionId state
      setDiscussionId((currentDiscussionId) => {
        // Strict validation: ignore if no active discussion or discussionId mismatch
        if (!currentDiscussionId) {
          clientLogger.warn('Received message-start but no active discussion', {
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        if (data.discussionId !== currentDiscussionId) {
          clientLogger.warn('Received message-start for different discussion', {
            expected: currentDiscussionId,
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        clientLogger.debug('Message start event received', {
          discussionId: data.discussionId,
          persona: data.persona,
          turn: data.turn,
        });
        setCurrentMessage({
          persona: data.persona,
          turn: data.turn,
          content: '',
        });
        setWaitingForAction(false); // Clear waiting state when new message starts
        setCurrentRound(null); // Clear current round when new round starts
        setError(null);
        return currentDiscussionId; // Keep same discussionId
      });
    });

    /**
     * Handler for 'message-chunk' event
     * Emitted during streaming as chunks of AI response are generated
     * Updates currentMessage.content for real-time display
     */
    socketInstance.on('message-chunk', (data: MessageChunkEvent) => {
      // Use functional update to get the latest discussionId state
      setDiscussionId((currentDiscussionId) => {
        // Strict validation: ignore if no active conversation or discussionId mismatch
        if (!currentDiscussionId) {
          clientLogger.warn('Received message-chunk but no active conversation', {
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        if (data.discussionId !== currentDiscussionId) {
          clientLogger.warn('Received message-chunk for different conversation', {
            expected: currentDiscussionId,
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        setCurrentMessage((prev) => {
          if (!prev) {
            // If we receive a chunk but don't have a current message, create one
            // This handles cases where message-start was missed or arrived out of order
            clientLogger.warn('Received message-chunk without current message, creating one', {
              discussionId: data.discussionId,
            });
            // We don't know the persona or turn, so we'll create a minimal message
            // The message-complete event will have the full details
            return {
              persona: 'Unknown',
              turn: 0,
              content: data.chunk,
            };
          }
          return {
            ...prev,
            content: prev.content + data.chunk,
          };
        });
        return currentDiscussionId; // Keep same discussionId
      });
    });

    /**
     * Handler for 'message-complete' event
     * Emitted when a single AI message is complete
     * Clears currentMessage (streaming state)
     * Note: Does NOT add to messages array - rounds array is the source of truth
     */
    socketInstance.on('message-complete', (data: MessageCompleteEvent) => {
      // Use functional update to get the latest discussionId state
      setDiscussionId((currentDiscussionId) => {
        // Strict validation: ignore if no active conversation or discussionId mismatch
        if (!currentDiscussionId) {
          clientLogger.warn('Received message-complete but no active conversation', {
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        if (data.discussionId !== currentDiscussionId) {
          clientLogger.warn('Received message-complete for different conversation', {
            expected: currentDiscussionId,
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        // Note: We don't add to messages array here because rounds array is the source of truth.
        // The message-complete event is only used to clear the streaming state.
        // The actual message data will be included in the round-complete event.
        clientLogger.debug('Message complete event received (clearing streaming state)', {
          discussionId: data.discussionId,
          messageId: data.message.id,
          persona: data.message.persona,
          turn: data.message.turn,
        });
        setCurrentMessage(null);
        return currentDiscussionId; // Keep same discussionId
      });
    });

    // Note: 'needs-user-input' event handler removed - server never emits this event.
    // The system uses 'waitingForAction' state from 'round-complete' event instead.

    socketInstance.on('conversation-resolved', (data: { discussionId: string }) => {
      // Use functional update to get the latest discussionId state
      setDiscussionId((currentDiscussionId) => {
        // Strict validation: ignore if no active conversation or discussionId mismatch
        if (!currentDiscussionId) {
          clientLogger.warn('Received conversation-resolved but no active conversation', {
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        if (data.discussionId !== currentDiscussionId) {
          clientLogger.warn('Received conversation-resolved for different conversation', {
            expected: currentDiscussionId,
            received: data.discussionId,
          });
          return currentDiscussionId; // Don't change state
        }

        clientLogger.info('Conversation resolved event received', {
          discussionId: data.discussionId,
        });
        setIsResolved(true);
        return currentDiscussionId; // Keep same discussionId
      });
    });

    // Round-based events
    /**
     * Handler for 'round-complete' event
     * Emitted when all three AIs in a round have finished responding
     * This is the PRIMARY SOURCE OF TRUTH for round data
     * Updates rounds array, sets currentRound, clears streaming state, sets waitingForAction
     */
    socketInstance.on('round-complete', (data: RoundCompleteEvent) => {
      setDiscussionId((currentDiscussionId) => {
        if (!currentDiscussionId || data.discussionId !== currentDiscussionId) {
          return currentDiscussionId;
        }

        clientLogger.info('Round complete event received', {
          discussionId: data.discussionId,
          roundNumber: data.round.roundNumber,
        });

        setRounds((prev) => {
          // Check if round already exists
          const existingIndex = prev.findIndex((r) => r.roundNumber === data.round.roundNumber);
          if (existingIndex >= 0) {
            // Update existing round
            const updated = [...prev];
            updated[existingIndex] = data.round;
            return updated;
          }
          // Add new round
          return [...prev, data.round].sort((a, b) => a.roundNumber - b.roundNumber);
        });

        setCurrentRound(data.round);
        setCurrentMessage(null); // Clear streaming message
        // Always set waitingForAction to true when round completes
        setWaitingForAction(true);
        clientLogger.debug('Set waitingForAction to true after round complete', {
          discussionId: data.discussionId,
          roundNumber: data.round.roundNumber,
        });
        return currentDiscussionId;
      });
    });

    socketInstance.on('questions-generated', (data: QuestionsGeneratedEvent) => {
      setDiscussionId((currentDiscussionId) => {
        if (!currentDiscussionId || data.discussionId !== currentDiscussionId) {
          return currentDiscussionId;
        }

        clientLogger.info('Questions generated event received', {
          discussionId: data.discussionId,
          roundNumber: data.roundNumber,
          questionCount: data.questionSet.questions.length,
        });

        setCurrentQuestionSet(data.questionSet);

        // Also update the round with questions
        setRounds((prev) => {
          return prev.map((round) =>
            round.roundNumber === data.roundNumber
              ? { ...round, questions: data.questionSet }
              : round
          );
        });

        return currentDiscussionId;
      });
    });

    socketInstance.on('summary-created', (data: SummaryCreatedEvent) => {
      setDiscussionId((currentDiscussionId) => {
        if (!currentDiscussionId || data.discussionId !== currentDiscussionId) {
          return currentDiscussionId;
        }

        clientLogger.info('Summary created event received', {
          discussionId: data.discussionId,
          roundNumber: data.summary.roundNumber,
        });

        setCurrentSummary(data.summary);
        // Append to summaries array (don't replace - track all summaries)
        setSummaries((prev) => {
          // Check if this summary already exists (avoid duplicates)
          const exists = prev.some((s) => s.roundNumber === data.summary.roundNumber);
          if (exists) {
            // Update existing summary
            return prev.map((s) =>
              s.roundNumber === data.summary.roundNumber ? data.summary : s
            );
          }
          // Add new summary, sorted by roundNumber
          return [...prev, data.summary].sort((a, b) => a.roundNumber - b.roundNumber);
        });
        return currentDiscussionId;
      });
    });

    // Moderator summary events removed - Moderator AI now participates in discussion

    socketInstance.on('error', (data: SocketErrorEvent) => {
      clientLogger.error('Socket error event received', {
        message: data.message,
        socketId: socketInstance.id,
        discussionId: data.discussionId || discussionId,
      });

      // Clear error if message is empty (error cleared)
      if (data.message === '') {
        setError(null);
        return;
      }

      // Strict validation: only set error if it's for the current conversation
      // If no discussionId in error, it's a general error and should be shown
      if (!data.discussionId) {
        // General error (no discussionId) - show it
        setError(data.message || 'An error occurred. Please try again.');
        return;
      }

      // Error has discussionId - only show if it matches active conversation
      if (!discussionId) {
        clientLogger.warn('Received error for conversation but no active conversation', {
          received: data.discussionId,
        });
        return;
      }

      if (data.discussionId !== discussionId) {
        clientLogger.warn('Received error for different conversation', {
          expected: discussionId,
          received: data.discussionId,
        });
        return;
      }

      setError(data.message || 'An error occurred. Please try again.');
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Helper to emit with acknowledgment and timeout
   */
  const emitWithAck = <T = unknown>(
    event: string,
    data: unknown,
    timeoutMs: number = 5000
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!socket) {
        reject(new Error('Socket not initialized'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error(`Acknowledgment timeout for event: ${event}`));
      }, timeoutMs);

      socket.emit(event, data, (response: { error?: string; data?: T } | T) => {
        clearTimeout(timeout);
        if (typeof response === 'object' && response !== null && 'error' in response) {
          reject(new Error(response.error || 'Unknown error'));
        } else {
          resolve((typeof response === 'object' && response !== null && 'data' in response ? response.data : response) as T);
        }
      });
    });
  };

  const startDialogue = (topic: string, files: FileData[] = [], userId?: string) => {
    if (!socket) {
      const errorMsg = 'Socket not initialized. Please refresh the page.';
      clientLogger.error('Failed to start dialogue: socket not initialized');
      setError(errorMsg);
      return;
    }

    if (!isConnected) {
      const errorMsg = 'Not connected to server. Please wait for connection or refresh the page.';
      clientLogger.warn('Failed to start dialogue: not connected', { socketId: socket.id });
      setError(errorMsg);
      return;
    }

    if (!topic || !topic.trim()) {
      const errorMsg = 'Please enter a topic to start the dialogue.';
      clientLogger.warn('Failed to start dialogue: empty topic');
      setError(errorMsg);
      return;
    }

    try {
      clientLogger.info('Starting dialogue', {
        topicLength: topic.length,
        topicPreview: topic.substring(0, 50) + '...',
        fileCount: files.length,
        userId,
        socketId: socket.id,
      });

      // Emit with acknowledgment
      emitWithAck('start-dialogue', { topic, files, userId })
        .then(() => {
          clientLogger.debug('Start-dialogue acknowledged by server');
          setError(null);
        })
        .catch((ackError) => {
          clientLogger.warn('Start-dialogue acknowledgment failed or timed out', {
            error: ackError instanceof Error ? ackError.message : String(ackError),
          });
          // Don't set error here - let the error event handle it
          // The server will still process the request even if ack fails
        });

      // Also emit without ack for backward compatibility (server will handle both)
      socket.emit('start-dialogue', { topic, files, userId });
    } catch (error) {
      const errorMsg = `Failed to start dialogue: ${error instanceof Error ? error.message : 'Unknown error'}`;
      clientLogger.error('Error starting dialogue', {
        error: error instanceof Error ? error.message : String(error),
        socketId: socket.id,
      });
      setError(errorMsg);
    }
  };

  const sendUserInput = (input: string) => {
    if (!socket || !isConnected) {
      const errorMsg = 'Not connected to server. Please refresh the page.';
      clientLogger.warn('Failed to send user input: not connected', { socketId: socket?.id });
      setError(errorMsg);
      return;
    }

    if (!discussionId) {
      const errorMsg = 'No active discussion. Please start a new dialogue.';
      clientLogger.warn('Failed to send user input: no discussion ID', { socketId: socket.id });
      setError(errorMsg);
      return;
    }

    if (!input || !input.trim()) {
      clientLogger.warn('Failed to send user input: empty input', { discussionId });
      setError('Please enter your input.');
      return;
    }

    try {
      clientLogger.info('Sending user input', {
        discussionId,
        inputLength: input.length,
        socketId: socket.id,
      });

      emitWithAck('user-input', { discussionId, input })
        .then(() => {
          clientLogger.debug('User-input acknowledged by server');
          setError(null);
        })
        .catch((ackError) => {
          clientLogger.warn('User-input acknowledgment failed or timed out', {
            error: ackError instanceof Error ? ackError.message : String(ackError),
          });
        });

      socket.emit('user-input', { discussionId, input });
    } catch (error) {
      const errorMsg = `Failed to send user input: ${error instanceof Error ? error.message : 'Unknown error'}`;
      clientLogger.error('Error sending user input', {
        error: error instanceof Error ? error.message : String(error),
        discussionId,
        socketId: socket.id,
      });
      setError(errorMsg);
    }
  };

  /**
   * Manually trigger reconnection
   */
  const reconnect = () => {
    if (socket) {
      clientLogger.info('Manually reconnecting socket', { socketId: socket.id });
      socket.disconnect();
      socket.connect();
      setConnectionState('connecting');
      setError(null);
    }
  };

  const submitAnswers = (roundNumber: number, answers: Record<string, string[]>) => {
    if (!socket || !isConnected) {
      const errorMsg = 'Not connected to server. Please refresh the page.';
      clientLogger.warn('Failed to submit answers: not connected', { socketId: socket?.id });
      setError(errorMsg);
      return;
    }

    if (!discussionId) {
      const errorMsg = 'No active discussion. Please start a new dialogue.';
      clientLogger.warn('Failed to submit answers: no discussion ID', { socketId: socket.id });
      setError(errorMsg);
      return;
    }

    if (!answers || Object.keys(answers).length === 0) {
      clientLogger.warn('Failed to submit answers: empty answers', { discussionId });
      setError('Please select at least one answer.');
      return;
    }

    try {
      clientLogger.info('Submitting answers', {
        discussionId,
        roundNumber,
        answerCount: Object.keys(answers).length,
        socketId: socket.id,
      });

      emitWithAck('submit-answers', { discussionId, roundNumber, answers })
        .then(() => {
          clientLogger.debug('Submit-answers acknowledged by server');
          setCurrentQuestionSet(null);
          setError(null);
        })
        .catch((ackError) => {
          clientLogger.warn('Submit-answers acknowledgment failed or timed out', {
            error: ackError instanceof Error ? ackError.message : String(ackError),
          });
        });

      socket.emit('submit-answers', { discussionId, roundNumber, answers });
    } catch (error) {
      const errorMsg = `Failed to submit answers: ${error instanceof Error ? error.message : 'Unknown error'}`;
      clientLogger.error('Error submitting answers', {
        error: error instanceof Error ? error.message : String(error),
        discussionId,
        socketId: socket.id,
      });
      setError(errorMsg);
    }
  };

  const proceedDialogue = () => {
    if (!socket || !discussionId) {
      clientLogger.warn('Cannot proceed dialogue: socket or discussionId missing');
      return;
    }

    emitWithAck('proceed-dialogue', { discussionId })
      .then(() => {
        clientLogger.debug('Proceed-dialogue acknowledged by server');
      })
      .catch((ackError) => {
        clientLogger.warn('Proceed-dialogue acknowledgment failed or timed out', {
          error: ackError instanceof Error ? ackError.message : String(ackError),
        });
      });

    // Don't clear waitingForAction here - let message-start event handle it
    // This ensures buttons remain visible until the next round actually starts processing
    socket.emit('proceed-dialogue', { discussionId });
  };

  const generateSummary = () => {
    if (!socket || !discussionId) {
      clientLogger.warn('Cannot generate summary: socket or discussionId missing');
      return;
    }
    const roundNumber = currentRound?.roundNumber;

    emitWithAck('generate-summary', { discussionId, roundNumber })
      .then(() => {
        clientLogger.debug('Generate-summary acknowledged by server');
      })
      .catch((ackError) => {
        clientLogger.warn('Generate-summary acknowledgment failed or timed out', {
          error: ackError instanceof Error ? ackError.message : String(ackError),
        });
      });

    socket.emit('generate-summary', { discussionId, roundNumber });
  };

  const generateQuestions = () => {
    if (!socket || !discussionId) {
      clientLogger.warn('Cannot generate questions: socket or discussionId missing');
      return;
    }
    const roundNumber = currentRound?.roundNumber;

    emitWithAck('generate-questions', { discussionId, roundNumber })
      .then(() => {
        clientLogger.debug('Generate-questions acknowledged by server');
      })
      .catch((ackError) => {
        clientLogger.warn('Generate-questions acknowledgment failed or timed out', {
          error: ackError instanceof Error ? ackError.message : String(ackError),
        });
      });

    socket.emit('generate-questions', { discussionId, roundNumber });
  };

  const reset = () => {
    setDiscussionId(null);
    setRounds([]); // New
    setCurrentRound(null); // New
    setCurrentQuestionSet(null);
    setCurrentSummary(null);
    setWaitingForAction(false);
    setCurrentMessage(null);
    setIsResolved(false);
    setError(null);
    clearStateFromStorage(); // Clear localStorage on reset
  };

  return {
    socket,
    isConnected,
    connectionState,
    discussionId,
    currentMessage,
    rounds,
    currentRound, // New
    currentQuestionSet,
    currentSummary,
    summaries,
    waitingForAction,
    isResolved,
    error,
    startDialogue,
    sendUserInput,
    submitAnswers, // New
    proceedDialogue, // New
    generateSummary, // New
    generateQuestions, // New
    reset,
    reconnect,
  };
}
