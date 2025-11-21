import type {
  ConversationMessage,
  DiscussionRound,
  SummaryEntry,
  QuestionSet,
} from '@/types';

/**
 * Test fixtures for LLM workflow testing
 */

export const createMockMessage = (
  persona: string = 'Solver AI',
  content: string = 'Test message',
  turn: number = 1
): ConversationMessage => ({
  persona: persona as 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User',
  content,
  turn,
  timestamp: new Date().toISOString(),
  created_at: Date.now(),
});

export const createMockConversationMessage = (
  persona: string = 'Solver AI',
  content: string = 'Test message',
  turn: number = 1,
  discussionId: string = 'test-discussion'
): ConversationMessage => ({
  discussion_id: discussionId,
  persona: persona as 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User',
  content,
  turn,
  timestamp: new Date().toISOString(),
  created_at: Date.now(),
});

export const createMockDiscussionRound = (
  roundNumber: number = 1,
  solverContent: string = 'Solver response',
  analyzerContent: string = 'Analyzer response',
  moderatorContent: string = 'Moderator response'
): DiscussionRound => {
  // Calculate turns: Solver = (round-1)*3+1, Analyzer = (round-1)*3+2, Moderator = (round-1)*3+3
  const baseTurn = (roundNumber - 1) * 3;
  return {
    roundNumber,
    solverResponse: createMockConversationMessage('Solver AI', solverContent, baseTurn + 1),
    analyzerResponse: createMockConversationMessage('Analyzer AI', analyzerContent, baseTurn + 2),
    moderatorResponse: createMockConversationMessage('Moderator AI', moderatorContent, baseTurn + 3),
    timestamp: new Date().toISOString(),
  };
};

export const createMockSummaryEntry = (
  summary: string = 'Test summary',
  roundNumber: number = 1,
  replacesRounds: number[] = [1]
): SummaryEntry => ({
  summary,
  createdAt: Date.now(),
  roundNumber,
  tokenCountBefore: 1000,
  tokenCountAfter: 500,
  replacesRounds,
});

export const createMockQuestionSet = (
  roundNumber: number = 1,
  questionCount: number = 2
): QuestionSet => {
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    id: `question-${i + 1}`,
    text: `Question ${i + 1}?`,
    options: [
      { id: `option-${i + 1}-1`, text: `Option 1 for Q${i + 1}` },
      { id: `option-${i + 1}-2`, text: `Option 2 for Q${i + 1}` },
    ],
  }));

  return {
    roundNumber,
    questions,
    generatedAt: new Date().toISOString(),
  };
};

export const createResolvedConversation = (): ConversationMessage[] => [
  createMockConversationMessage('Solver AI', 'Let me think about this problem.', 1),
  createMockConversationMessage('Analyzer AI', 'I see what you mean.', 1),
  createMockConversationMessage('Solver AI', 'The solution is to implement a caching layer.', 2),
  createMockConversationMessage('Analyzer AI', 'I agree, that makes perfect sense.', 2),
];

export const createUnresolvedConversation = (): ConversationMessage[] => [
  createMockConversationMessage('Solver AI', 'Let me think about this problem.', 1),
  createMockConversationMessage('Analyzer AI', 'I see what you mean.', 1),
];

export const createUserInputNeededConversation = (): ConversationMessage[] => [
  createMockConversationMessage('Solver AI', 'Can you clarify what you mean by scalability?', 1),
];

export const createMultipleRounds = (
  count: number = 3,
  moderatorContent?: string | ((roundNumber: number) => string)
): DiscussionRound[] => {
  return Array.from({ length: count }, (_, i) => {
    const roundNumber = i + 1;
    const moderator =
      moderatorContent === undefined
        ? `Moderator response for round ${roundNumber}`
        : typeof moderatorContent === 'function'
          ? moderatorContent(roundNumber)
          : moderatorContent;
    return createMockDiscussionRound(
      roundNumber,
      `Solver response for round ${roundNumber}`,
      `Analyzer response for round ${roundNumber}`,
      moderator
    );
  });
};

export const createLongConversation = (messageCount: number = 50): ConversationMessage[] => {
  return Array.from({ length: messageCount }, (_, i) =>
    createMockConversationMessage(
      i % 2 === 0 ? 'Solver AI' : 'Analyzer AI',
      `Message ${i + 1} with some content`,
      Math.floor(i / 2) + 1
    )
  );
};
