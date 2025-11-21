import type { ConversationMessage } from '@/types';
import { DIALOGUE_CONFIG } from '@/lib/config';

/**
 * Detects if the conversation has reached a resolution/solution
 * by analyzing keywords, agreement patterns, and conversation flow
 * Uses confidence scoring and requires multiple indicators to reduce false positives
 */
export function isResolved(conversation: ConversationMessage[]): boolean {
  if (conversation.length < 6) {
    // Need at least 2 complete rounds (6 messages: 3 AIs × 2 rounds) to determine resolution
    return false;
  }

  // Check for max turns (safety limit) - use configurable value
  const maxTurns = DIALOGUE_CONFIG.MAX_TURNS;
  if (conversation.length >= maxTurns * 3) {
    return true;
  }

  // Get last 4 messages for analysis
  const recentMessages = conversation.slice(-4);
  const lastTwoMessages = conversation.slice(-2);

  // Combine content of recent messages for analysis
  const recentContent = recentMessages.map((m) => m.content.toLowerCase()).join(' ');

  // Resolution keywords with context awareness (check for negation)
  const resolutionKeywords = [
    'solution',
    'conclusion',
    'recommendation',
    'agreement',
    'agreed',
    'consensus',
    'resolved',
    'final',
    'summary',
    'therefore',
    'in conclusion',
    'to summarize',
    'we can conclude',
    'the answer is',
    'the solution is',
  ];

  // Negation patterns that indicate the keyword is NOT indicating resolution
  const negationPatterns = [
    /\b(not|no|isn't|aren't|don't|doesn't|didn't|won't|wouldn't|can't|couldn't|shouldn't|haven't|hasn't|hadn't)\b.*?(solution|conclusion|recommendation|agreement|consensus|resolved|final)/i,
    /\b(solution|conclusion|recommendation|agreement|consensus|resolved|final).*?\b(not|no|isn't|aren't|don't|doesn't|didn't|won't|wouldn't|can't|couldn't|shouldn't|haven't|hasn't|hadn't)\b/i,
    /\b(without|lack of|missing|insufficient).*?(solution|conclusion|recommendation|agreement|consensus|resolved|final)/i,
  ];

  // Check for resolution keywords with negation awareness
  let resolutionKeywordCount = 0;
  for (const keyword of resolutionKeywords) {
    const keywordIndex = recentContent.indexOf(keyword);
    if (keywordIndex !== -1) {
      // Check if this keyword is negated
      const contextStart = Math.max(0, keywordIndex - 50);
      const contextEnd = Math.min(recentContent.length, keywordIndex + keyword.length + 50);
      const context = recentContent.substring(contextStart, contextEnd);

      const isNegated = negationPatterns.some((pattern) => pattern.test(context));
      if (!isNegated) {
        resolutionKeywordCount++;
      }
    }
  }

  const hasResolutionKeywords = resolutionKeywordCount > 0;

  // Improved agreement patterns
  const agreementPatterns = [
    /\b(i|we) (agree|concur|accept|endorse|support)\b/i,
    /\bthat makes (perfect )?sense\b/i,
    /\byou'?re (absolutely )?right\b/i,
    /\bexactly\b/i,
    /\bprecisely\b/i,
    /\bthat'?s (absolutely |exactly )?correct\b/i,
    /\b(i|we) (think|believe|feel) (the )?same (way|thing)\b/i,
    /\b(i|we) (see|understand) (your )?point\b/i,
    /\b(i|we) (can|will) (go|proceed) (with|on) (that|this)\b/i,
  ];

  let agreementCount = 0;
  for (const pattern of agreementPatterns) {
    if (pattern.test(recentContent)) {
      agreementCount++;
    }
  }

  const hasAgreement = agreementCount > 0;

  // Confidence scoring based on multiple indicators
  let confidenceScore = 0;

  // Resolution keywords (weight: 2 points each, max 4 points)
  if (hasResolutionKeywords) {
    confidenceScore += Math.min(4, resolutionKeywordCount * 2);
  }

  // Agreement patterns (weight: 1 point each, max 3 points)
  if (hasAgreement) {
    confidenceScore += Math.min(3, agreementCount);
  }

  // Check if last two messages are from different personas and show convergence
  if (lastTwoMessages.length === 2) {
    const [first, second] = lastTwoMessages;
    const differentPersonas = first.persona !== second.persona;

    if (differentPersonas) {
      // Check if messages are getting shorter (converging) - weight: 2 points
      const avgLength =
        recentMessages.reduce((sum, m) => sum + m.content.length, 0) / recentMessages.length;
      const isConverging = avgLength < DIALOGUE_CONFIG.RESOLUTION_CONVERGENCE_THRESHOLD; // Shorter messages might indicate resolution

      if (isConverging) {
        confidenceScore += 2;
      }

      // All three AIs have spoken in recent messages - weight: 1 point
      const hasAllPersonas =
        recentMessages.some((m) => m.persona === 'Solver AI') &&
        recentMessages.some((m) => m.persona === 'Analyzer AI') &&
        recentMessages.some((m) => m.persona === 'Moderator AI');
      if (hasAllPersonas) {
        confidenceScore += 1;
      }
    }
  }

  // Require multiple indicators: minimum confidence score threshold
  // This reduces false positives from single keyword matches
  if (confidenceScore >= DIALOGUE_CONFIG.RESOLUTION_CONFIDENCE_THRESHOLD) {
    return true;
  }

  // Fallback: if we have strong resolution keywords (3+) and at least 9 messages (3 complete rounds)
  // This handles cases where keywords are very clear
  if (conversation.length >= 9 && resolutionKeywordCount >= 3) {
    return true;
  }

  return false;
}

/**
 * Detects if the AI needs user input (questions, clarifications)
 * by analyzing the last message for question patterns and explicit requests
 * Improved to reduce false positives from rhetorical questions and AI-to-AI questions
 */
export function needsUserInput(conversation: ConversationMessage[]): {
  needsInput: boolean;
  question?: string;
} {
  if (conversation.length === 0) {
    return { needsInput: false };
  }

  const lastMessage = conversation[conversation.length - 1];
  const content = lastMessage.content.toLowerCase();

  // Skip if last message is from user
  if (lastMessage.persona === 'User') {
    return { needsInput: false };
  }

  // Filter out rhetorical questions and AI-to-AI questions
  const rhetoricalPatterns = [
    /\b(what if|how about|why not|shouldn't we|couldn't we|wouldn't it|isn't it|don't you think|wouldn't you agree)\b/i,
    /\b(i wonder|i'm curious|i'm wondering)\b.*\?/i,
    /\b(what|how|why|which).*\?.*\b(if|when|where|should|would|could)\b/i, // Questions followed by conditional
  ];

  // Check if this is a rhetorical question (AI to AI, not user)
  const isRhetorical = rhetoricalPatterns.some((pattern) => pattern.test(content));

  // Patterns that indicate AI-to-AI questions (not user questions)
  const aiToAiPatterns = [
    /\b(what do you think|what's your take|what's your view|how do you see|how would you)\b/i,
    /\b(do you think|do you believe|do you agree|do you see)\b/i,
    /\b(what if we|how about we|should we|could we|would we)\b/i,
  ];

  // If the previous message is from another AI, this is likely AI-to-AI
  const previousMessage = conversation.length > 1 ? conversation[conversation.length - 2] : null;
  const isAiToAi =
    previousMessage &&
    previousMessage.persona !== 'User' &&
    aiToAiPatterns.some((pattern) => pattern.test(content));

  // Skip rhetorical and AI-to-AI questions
  if (isRhetorical || isAiToAi) {
    return { needsInput: false };
  }

  // Explicit user-directed question patterns
  const userQuestionPatterns = [
    /\b(can you|could you|would you|will you) (clarify|explain|provide|tell|help|share|give)\b/i,
    /\b(please|i'd appreciate|i'd like) (you to )?(clarify|explain|provide|tell|help|share|give)\b/i,
    /\bwhat (do you|would you|is your|are your)\b/i,
    /\bhow (do you|would you|should you)\b/i,
    /\bwhich (do you|would you|should you)\b/i,
    /\bto better understand.*\b(your|you)\b/i,
    /\bi need (more|additional|further) (information|details|context|clarification) (from you|about)\b/i,
    /\bcould you help (me|us) understand\b/i,
    /\bi'?d like to know (your|about your|from you)\b/i,
  ];

  // Explicit user-directed request patterns
  const userRequestPatterns = [
    /\b(i|we) need (your|from you) (input|feedback|clarification|information|thoughts|opinions|preferences|requirements)\b/i,
    /\b(please|can you|could you) (provide|give|share) (me|us) (more|additional|further|your)\b/i,
    /\bwhat are your (thoughts|opinions|preferences|requirements|thoughts on|views on)\b/i,
    /\bwhat (is|are) your (preference|preferences|requirement|requirements|thought|thoughts|opinion|opinions)\b/i,
    /\b(please|i'd appreciate) (your|if you could provide) (input|feedback|clarification|information)\b/i,
  ];

  // Check for user-directed questions (must contain "you" or "your" to be user-directed)
  const hasUserQuestion = userQuestionPatterns.some((pattern) => pattern.test(content));

  // Check for user-directed requests
  const hasUserRequest = userRequestPatterns.some((pattern) => pattern.test(content));

  // Also check for question marks with user-directed context
  const hasQuestionMark = content.includes('?');
  const hasUserContext = /\b(you|your|from you|to you)\b/i.test(content);
  const hasQuestionMarkWithUserContext = hasQuestionMark && hasUserContext;

  if (hasUserQuestion || hasUserRequest || hasQuestionMarkWithUserContext) {
    // Extract the question with better context capture
    // Try to find the full question sentence(s)
    const sentences = lastMessage.content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const questionSentences = sentences.filter((s) => {
      const lower = s.toLowerCase();
      return (
        lower.includes('?') ||
        userQuestionPatterns.some((p) => p.test(lower)) ||
        userRequestPatterns.some((p) => p.test(lower))
      );
    });

    let question: string | undefined;
    if (questionSentences.length > 0) {
      // Extract question sentences with some context
      const questionText = questionSentences.join('. ').trim();
      const questionIndex = lastMessage.content.indexOf(questionText);

      if (questionIndex !== -1) {
        // Include up to 100 chars before and after for context
        const start = Math.max(0, questionIndex - 100);
        const end = Math.min(lastMessage.content.length, questionIndex + questionText.length + 100);
        question = lastMessage.content.substring(start, end).trim();
      } else {
        question = questionText;
      }
    } else {
      // Fallback: extract last 300 chars if no specific question found
      question = lastMessage.content.slice(-300).trim();
    }

    return {
      needsInput: true,
      question: question || lastMessage.content.slice(-200),
    };
  }

  return { needsInput: false };
}
