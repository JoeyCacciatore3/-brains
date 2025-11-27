import type { ConversationMessage, DiscussionRound } from '@/types';
import type { LLMMessage } from './types';
import { DIALOGUE_CONFIG } from '@/lib/config';
import { filterCompleteRounds, isRoundComplete } from '@/lib/discussions/round-utils';
import { logger } from '@/lib/logger';

/**
 * Result of resolution detection
 */
export interface ResolutionResult {
  resolved: boolean;
  solution?: string; // Extracted solution text (max 500 chars)
  confidence: number; // 0-1 normalized confidence score
  reason?: 'keywords' | 'agreement' | 'max_turns' | 'consensus'; // Why it resolved
  roundNumber?: number; // Round where resolution was detected
}

/**
 * Truncate text to a maximum length
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

/**
 * Check if all three personas explicitly agree in a round
 * Enhanced with stricter patterns requiring solution-oriented consensus
 */
function checkThreePersonaAgreement(round: DiscussionRound): boolean {
  if (!isRoundComplete(round)) return false;

  // Stricter consensus patterns - require explicit agreement on a solution
  const consensusPatterns = [
    // Explicit agreement on solution
    /\b(i|we) (agree|concur|accept|endorse|support) (with|on|that) (the )?(solution|approach|recommendation|conclusion|decision)\b/i,
    /\b(i|we) (agree|concur) (that|this) (is|would be) (the )?(solution|answer|way forward|best approach)\b/i,
    // Explicit consensus statements
    /\b(i|we) (are in|have reached) (full )?consensus (on|about|regarding)\b/i,
    /\b(i|we) (all|fully) (agree|concur) (on|with|that)\b/i,
    // Solution-oriented agreement
    /\bthat (is|makes) (the|our|a) (perfect|ideal|best|correct) (solution|approach|answer|way forward)\b/i,
    /\b(i|we) (can|will) (proceed|move forward|go ahead) (with|on) (this|that|the solution)\b/i,
    // Explicit endorsement of solution
    /\b(i|we) (endorse|support|accept) (this|that|the) (solution|approach|recommendation|conclusion)\b/i,
    // Strong agreement with solution language
    /\b(i|we) (think|believe|feel) (this|that) (is|represents) (the|our|a) (solution|answer|resolution)\b/i,
  ];

  // Fallback to basic agreement patterns (less strict, but still require all three)
  const basicAgreementPatterns = [
    /\b(i|we) (agree|concur|accept|endorse|support)\b/i,
    /\bthat makes (perfect )?sense\b/i,
    /\byou'?re (absolutely )?right\b/i,
    /\bexactly\b/i,
    /\bprecisely\b/i,
    /\bthat'?s (absolutely |exactly )?correct\b/i,
  ];

  const analyzerContent = round.analyzerResponse.content.toLowerCase();
  const solverContent = round.solverResponse.content.toLowerCase();
  const moderatorContent = round.moderatorResponse.content.toLowerCase();

  // Check each persona has at least one consensus pattern (preferred) or basic agreement
  const analyzerConsensus = consensusPatterns.some((pattern) => pattern.test(analyzerContent));
  const solverConsensus = consensusPatterns.some((pattern) => pattern.test(solverContent));
  const moderatorConsensus = consensusPatterns.some((pattern) => pattern.test(moderatorContent));

  // If all three have consensus patterns, that's strong agreement
  if (analyzerConsensus && solverConsensus && moderatorConsensus) {
    return true;
  }

  // Fallback: all three must have at least basic agreement
  const analyzerAgrees = basicAgreementPatterns.some((pattern) => pattern.test(analyzerContent));
  const solverAgrees = basicAgreementPatterns.some((pattern) => pattern.test(solverContent));
  const moderatorAgrees = basicAgreementPatterns.some((pattern) => pattern.test(moderatorContent));

  return analyzerAgrees && solverAgrees && moderatorAgrees;
}

/**
 * Check for multi-round consensus - require agreement across multiple consecutive rounds
 * This ensures true consensus, not just a single round of agreement
 */
function checkMultiRoundConsensus(
  rounds: DiscussionRound[],
  minConsensusRounds: number = DIALOGUE_CONFIG.RESOLUTION_CONSENSUS_ROUNDS
): { hasConsensus: boolean; consensusRounds: number[] } {
  if (!rounds || rounds.length < minConsensusRounds) {
    return { hasConsensus: false, consensusRounds: [] };
  }

  const completeRounds = filterCompleteRounds(rounds);
  if (completeRounds.length < minConsensusRounds) {
    return { hasConsensus: false, consensusRounds: [] };
  }

  // Check last N rounds for consensus (where N = minConsensusRounds)
  const roundsToCheck = completeRounds.slice(-minConsensusRounds);
  const consensusRounds: number[] = [];

  for (const round of roundsToCheck) {
    if (checkThreePersonaAgreement(round)) {
      consensusRounds.push(round.roundNumber);
    }
  }

  // Require consensus in all checked rounds
  const hasConsensus = consensusRounds.length >= minConsensusRounds;

  return { hasConsensus, consensusRounds };
}

/**
 * Validate topic relevance of a solution
 */
function validateTopicRelevance(solution: string, topic: string): number {
  if (!topic || !solution) return 0.5; // Default relevance if missing

  const topicLower = topic.toLowerCase();
  const solutionLower = solution.toLowerCase();

  // Extract keywords from topic (simple approach: words longer than 3 chars)
  const topicWords = topicLower
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !['what', 'how', 'why', 'when', 'where', 'which', 'that', 'this', 'with', 'from'].includes(word));

  if (topicWords.length === 0) return 0.5; // Can't determine relevance

  // Count how many topic keywords appear in solution
  const matchingKeywords = topicWords.filter((word) => solutionLower.includes(word));

  // Calculate relevance score (0-1)
  return Math.min(1, matchingKeywords.length / topicWords.length);
}

/**
 * Validate that extracted text actually contains solution-like content
 * Requires explicit solution language, not just agreement or general discussion
 */
function validateSolutionContent(text: string): boolean {
  if (!text || text.trim().length < 20) {
    return false; // Too short to be a real solution
  }

  const textLower = text.toLowerCase();

  // Require explicit solution language - must contain solution-oriented keywords
  const solutionKeywords = [
    'solution',
    'recommend',
    'recommendation',
    'suggest',
    'suggestion',
    'propose',
    'proposal',
    'conclude',
    'conclusion',
    'answer',
    'approach',
    'strategy',
    'method',
    'way forward',
    'next steps',
    'action',
    'implement',
    'implementing',
  ];

  // Must contain at least one solution keyword
  const hasSolutionKeyword = solutionKeywords.some((keyword) => textLower.includes(keyword));
  if (!hasSolutionKeyword) {
    return false;
  }

  // Exclude patterns that indicate NO solution or uncertainty
  const nonSolutionPatterns = [
    /\b(no|not|don't|doesn't|isn't|aren't|won't|wouldn't|can't|couldn't|shouldn't)\b.*\b(solution|answer|recommendation|conclusion)\b/i,
    /\b(we|i) (don't|do not|cannot|can't) (have|provide|offer|give|find|determine|reach)\b.*\b(solution|answer|recommendation|conclusion)\b/i,
    /\b(uncertain|unclear|unresolved|unanswered|unknown|undecided|unclear)\b/i,
    /\b(need|require|must|should) (more|additional|further|better)\b.*\b(information|data|context|clarity|understanding)\b/i,
  ];

  const hasNonSolutionPattern = nonSolutionPatterns.some((pattern) => pattern.test(text));
  if (hasNonSolutionPattern) {
    return false;
  }

  // Must be substantive (not just "I agree" or "that makes sense")
  const agreementOnlyPatterns = [
    /^(i|we) (agree|concur|accept|endorse|support)(\.|,|$)/i,
    /^that makes (perfect )?sense(\.|,|$)/i,
    /^exactly(\.|,|$)/i,
    /^precisely(\.|,|$)/i,
    /^that'?s (absolutely |exactly )?correct(\.|,|$)/i,
  ];

  const isAgreementOnly = agreementOnlyPatterns.some((pattern) => pattern.test(text.trim()));
  if (isAgreementOnly) {
    return false;
  }

  return true;
}

/**
 * Extract solution text from a discussion round
 * CRITICAL: Only returns text that actually contains a solution, not just agreement or general discussion
 */
function extractSolutionText(round: DiscussionRound, topic?: string): string | undefined {
  if (!isRoundComplete(round)) return undefined;

  // Enhanced solution patterns - require explicit solution language
  const solutionPatterns = [
    /\b(the solution is|the answer is|we recommend|we suggest|we propose|the recommendation is|our solution|our recommendation)\b[:\-]?\s*(.+?)(?:\.|$)/i,
    /\b(therefore|in conclusion|to summarize|in summary|we conclude|we can conclude|the conclusion is)\b[:\-]?\s*(.+?)(?:\.|$)/i,
    /\b(based on|considering|taking into account).+?we (recommend|suggest|propose|conclude)\b[:\-]?\s*(.+?)(?:\.|$)/i,
    /\b(our|the) (recommended|suggested|proposed) (approach|solution|strategy|method|way forward)\b[:\-]?\s*(.+?)(?:\.|$)/i,
    /\b(to solve|to address|to resolve|to tackle) (this|the problem|this issue),?\s*(we|i) (recommend|suggest|propose|conclude)\b[:\-]?\s*(.+?)(?:\.|$)/i,
  ];

  // Priority 1: Solver AI response (most likely to contain solution)
  let solution = extractSolutionFromMessage(round.solverResponse.content, solutionPatterns);
  if (solution && validateSolutionContent(solution)) {
    return truncateText(solution, DIALOGUE_CONFIG.RESOLUTION_SOLUTION_MAX_LENGTH);
  }

  // Priority 2: Moderator AI response (often summarizes/synthesizes)
  solution = extractSolutionFromMessage(round.moderatorResponse.content, solutionPatterns);
  if (solution && validateSolutionContent(solution)) {
    return truncateText(solution, DIALOGUE_CONFIG.RESOLUTION_SOLUTION_MAX_LENGTH);
  }

  // Priority 3: Combine relevant sentences from all three personas
  const combinedSolution = extractCombinedSolution(round);
  if (combinedSolution && validateSolutionContent(combinedSolution)) {
    // Validate topic relevance if topic provided
    if (topic) {
      const relevance = validateTopicRelevance(combinedSolution, topic);
      if (relevance < DIALOGUE_CONFIG.RESOLUTION_TOPIC_RELEVANCE_THRESHOLD) {
        // Low relevance - still return if it's a valid solution, but log warning
        logger.warn('Solution extracted but low topic relevance', {
          relevance,
          threshold: DIALOGUE_CONFIG.RESOLUTION_TOPIC_RELEVANCE_THRESHOLD,
          solutionPreview: combinedSolution.substring(0, 100),
        });
      }
    }
    return truncateText(combinedSolution, DIALOGUE_CONFIG.RESOLUTION_SOLUTION_MAX_LENGTH);
  }

  // CRITICAL: No fallback - if no actual solution is found, return undefined
  // This prevents marking discussions as resolved when there's no real solution
  logger.debug('No valid solution found in round', {
    roundNumber: round.roundNumber,
    solverLength: round.solverResponse.content.length,
    moderatorLength: round.moderatorResponse.content.length,
    note: 'Discussion will not be marked as resolved without a valid solution',
  });
  return undefined;
}

/**
 * Extract solution from a single message using patterns
 */
function extractSolutionFromMessage(content: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[2]) {
      return match[2].trim();
    }
  }
  return undefined;
}

/**
 * Extract combined solution from all three personas in a round
 */
function extractCombinedSolution(round: DiscussionRound): string | undefined {
  const resolutionKeywords = ['solution', 'recommendation', 'conclusion', 'recommend', 'suggest', 'propose', 'conclude'];
  const sentences: Array<{ text: string; score: number }> = [];

  // Extract sentences from each persona
  [round.analyzerResponse, round.solverResponse, round.moderatorResponse].forEach((message) => {
    const messageSentences = message.content.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    messageSentences.forEach((sentence) => {
      const sentenceLower = sentence.toLowerCase();
      let score = 0;
      // Score based on resolution keywords
      resolutionKeywords.forEach((keyword) => {
        if (sentenceLower.includes(keyword)) {
          score += 1;
        }
      });
      // Prefer sentences from Solver (highest priority)
      if (message.persona === 'Solver AI') score += 2;
      if (message.persona === 'Moderator AI') score += 1;

      if (score > 0) {
        sentences.push({ text: sentence.trim(), score });
      }
    });
  });

  if (sentences.length === 0) return undefined;

  // Sort by score and take top 2-3 sentences
  sentences.sort((a, b) => b.score - a.score);
  const topSentences = sentences.slice(0, 3).map((s) => s.text);

  return topSentences.join('. ').trim();
}

/**
 * Detects if the conversation has reached a resolution/solution
 * by analyzing keywords, agreement patterns, and conversation flow
 * Uses confidence scoring and requires multiple indicators to reduce false positives
 *
 * @param conversation - Array of conversation messages
 * @param rounds - Optional array of discussion rounds for solution extraction
 * @param topic - Optional topic string for relevance validation
 * @returns ResolutionResult with resolution status, solution, confidence, and reason
 */
export function isResolved(
  conversation: ConversationMessage[],
  rounds?: DiscussionRound[],
  topic?: string
): ResolutionResult {
  // Require minimum rounds before checking resolution (stricter requirement)
  const minRounds = DIALOGUE_CONFIG.RESOLUTION_MIN_ROUNDS;
  const minMessages = minRounds * 3; // Each round = 3 messages (Analyzer, Solver, Moderator)

  if (conversation.length < minMessages) {
    // Need at least minimum rounds (default: 5 rounds = 15 messages) to determine resolution
    return {
      resolved: false,
      confidence: 0,
    };
  }

  // Check for max turns (safety limit) - use configurable value
  const maxTurns = DIALOGUE_CONFIG.MAX_TURNS;
  if (conversation.length >= maxTurns * 3) {
    // Extract solution from last complete round
    // CRITICAL: Even at max turns, require a valid solution to mark as resolved
    let solution: string | undefined;
    let roundNumber: number | undefined;
    if (rounds && rounds.length > 0) {
      const completeRounds = filterCompleteRounds(rounds);
      if (completeRounds.length > 0) {
        const lastRound = completeRounds[completeRounds.length - 1];
        solution = extractSolutionText(lastRound, topic);
        roundNumber = lastRound.roundNumber;
      }
    }

    // CRITICAL: Even at max turns, don't mark as resolved without a valid solution
    // If no valid solution is found, return unresolved (discussion can continue or be manually resolved)
    if (!solution) {
      logger.warn('Max turns reached but no valid solution found - not marking as resolved', {
        maxTurns,
        conversationLength: conversation.length,
        roundsCount: rounds?.length || 0,
        note: 'Discussion reached max turns but no solution was provided',
      });
      return {
        resolved: false,
        confidence: 0.3, // Low confidence - max turns but no solution
        reason: undefined,
        roundNumber: undefined,
      };
    }

    return {
      resolved: true,
      solution,
      confidence: 0.5, // Lower confidence for max turns
      reason: 'max_turns',
      roundNumber,
    };
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

  // Check for multi-round consensus (stricter requirement)
  let hasMultiRoundConsensus = false;
  let consensusRounds: number[] = [];
  let resolvedRound: DiscussionRound | undefined;
  if (rounds && rounds.length > 0) {
    const completeRounds = filterCompleteRounds(rounds);
    if (completeRounds.length >= DIALOGUE_CONFIG.RESOLUTION_CONSENSUS_ROUNDS) {
      const consensusResult = checkMultiRoundConsensus(completeRounds);
      hasMultiRoundConsensus = consensusResult.hasConsensus;
      consensusRounds = consensusResult.consensusRounds;
      if (hasMultiRoundConsensus && completeRounds.length > 0) {
        // Use the last round with consensus as the resolved round
        resolvedRound = completeRounds[completeRounds.length - 1];
        // Add significant bonus for multi-round consensus
        confidenceScore += 5;
      }
    }
  }

  // Also check single-round agreement for scoring (but won't trigger resolution alone)
  let hasThreePersonaAgreement = false;
  if (rounds && rounds.length > 0) {
    const completeRounds = filterCompleteRounds(rounds);
    if (completeRounds.length > 0) {
      const lastCompleteRound = completeRounds[completeRounds.length - 1];
      hasThreePersonaAgreement = checkThreePersonaAgreement(lastCompleteRound);
      if (hasThreePersonaAgreement && !hasMultiRoundConsensus) {
        // Add smaller bonus for single-round agreement (not enough for resolution)
        confidenceScore += 2;
      }
    }
  }

  // Normalize confidence score to 0-1 range
  let normalizedConfidence = Math.min(1, confidenceScore / 10);

  // Determine resolution status
  // STRICT REQUIREMENT: Only resolve if we have multi-round consensus
  let isResolvedValue = false;
  let reason: 'keywords' | 'agreement' | 'max_turns' | 'consensus' | undefined;

  // Require multi-round consensus AND minimum confidence score threshold
  // This ensures true consensus, not just keywords or single-round agreement
  if (hasMultiRoundConsensus && confidenceScore >= DIALOGUE_CONFIG.RESOLUTION_CONFIDENCE_THRESHOLD) {
    isResolvedValue = true;
    reason = 'consensus';
    // High confidence bonus for multi-round consensus
    normalizedConfidence = Math.min(1, normalizedConfidence + 0.3);
  }
  // Note: Removed fallback keyword-only resolution - now requires true consensus

  // Extract solution if resolved
  // CRITICAL: Only mark as resolved if we can actually extract a valid solution
  let solution: string | undefined;
  let roundNumber: number | undefined;
  if (isResolvedValue) {
    if (resolvedRound) {
      solution = extractSolutionText(resolvedRound, topic);
      roundNumber = resolvedRound.roundNumber;
    } else if (rounds && rounds.length > 0) {
      const completeRounds = filterCompleteRounds(rounds);
      if (completeRounds.length > 0) {
        const lastRound = completeRounds[completeRounds.length - 1];
        solution = extractSolutionText(lastRound, topic);
        roundNumber = lastRound.roundNumber;
      }
    }

    // CRITICAL: If no valid solution is extracted, don't mark as resolved
    // This prevents false positives where LLMs agree but haven't provided an actual solution
    if (!solution) {
      logger.warn('Resolution detected but no valid solution extracted - not marking as resolved', {
        hasMultiRoundConsensus,
        confidenceScore,
        resolvedRound: resolvedRound?.roundNumber,
        note: 'Discussion will continue until a valid solution is provided',
      });
      return {
        resolved: false,
        confidence: normalizedConfidence,
        reason: undefined,
        roundNumber: undefined,
      };
    }
  }

  return {
    resolved: isResolvedValue,
    solution,
    confidence: normalizedConfidence,
    reason,
    roundNumber,
  };
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

/**
 * Determine if questions should be automatically generated after round 3
 * Analyzes the discussion to detect if LLMs are unclear or need user clarification
 *
 * @param rounds - Array of discussion rounds (should have 3 rounds)
 * @param topic - The original topic/question
 * @returns boolean indicating if questions should be generated
 */
export function shouldGenerateQuestionsAfterRound3(
  rounds: DiscussionRound[],
  topic: string
): boolean {
  if (!rounds || rounds.length < 3) {
    return false; // Need at least 3 rounds
  }

  const completeRounds = filterCompleteRounds(rounds);
  if (completeRounds.length < 3) {
    return false;
  }

  // Get the last 3 rounds for analysis
  const lastThreeRounds = completeRounds.slice(-3);

  // Indicators that LLMs are unclear or need clarification:
  // 1. Conflicting opinions across rounds
  // 2. Repeated questions or uncertainty
  // 3. Lack of progress toward solution
  // 4. Explicit requests for user input

  let confusionIndicators = 0;

  // Check for conflicting opinions
  const allContent = lastThreeRounds
    .flatMap((r) => [
      r.analyzerResponse.content.toLowerCase(),
      r.solverResponse.content.toLowerCase(),
      r.moderatorResponse.content.toLowerCase(),
    ])
    .join(' ');

  // Patterns indicating confusion or conflicting views
  const confusionPatterns = [
    /\b(but|however|although|yet|on the other hand|conversely)\b.*\b(disagree|different|conflict|contradict|oppose)\b/i,
    /\b(we|i) (are|am) (not|un)clear (about|on|regarding)\b/i,
    /\b(we|i) (need|require) (more|additional|further) (information|context|clarification|details)\b/i,
    /\b(we|i) (don't|do not) (fully|completely) (understand|grasp|comprehend)\b/i,
    /\b(there|this) (is|seems) (unclear|ambiguous|confusing|contradictory)\b/i,
    /\b(we|i) (have|are having) (different|conflicting|opposing) (views|opinions|perspectives)\b/i,
  ];

  confusionPatterns.forEach((pattern) => {
    if (pattern.test(allContent)) {
      confusionIndicators++;
    }
  });

  // Check for explicit user input requests
  const userInputPatterns = [
    /\b(what|how|which) (do|would|should) (you|the user) (think|prefer|want|need)\b/i,
    /\b(we|i) (need|require) (your|user) (input|feedback|clarification|preference)\b/i,
    /\b(could|can|would) (you|the user) (clarify|explain|provide|help)\b/i,
    /\b(to|in order to) (better|fully) (understand|proceed),?\s*(we|i) (need|require)\b/i,
  ];

  userInputPatterns.forEach((pattern) => {
    if (pattern.test(allContent)) {
      confusionIndicators++;
    }
  });

  // Check for lack of progress indicators
  const progressKeywords = ['solution', 'conclusion', 'recommendation', 'decision', 'agreement', 'consensus'];
  const hasProgressKeywords = progressKeywords.some((keyword) => allContent.includes(keyword));

  // If no progress keywords and high confusion, likely need questions
  if (!hasProgressKeywords && confusionIndicators >= 2) {
    return true;
  }

  // Check if any round explicitly asks for user input
  for (const round of lastThreeRounds) {
    const roundContent = [
      round.analyzerResponse.content,
      round.solverResponse.content,
      round.moderatorResponse.content,
    ].join(' ').toLowerCase();

    const needsInput = needsUserInput(
      [
        round.analyzerResponse,
        round.solverResponse,
        round.moderatorResponse,
      ].map((msg) => ({
        ...msg,
        discussion_id: '',
        turn: 0,
        timestamp: '',
        created_at: Date.now(),
      }))
    );

    if (needsInput.needsInput) {
      return true; // Explicit user input request found
    }
  }

  // If we have 3+ confusion indicators, generate questions
  if (confusionIndicators >= 3) {
    return true;
  }

  // Check for topic relevance - if responses seem off-topic, need clarification
  const topicWords = topic
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !['what', 'how', 'why', 'when', 'where', 'which'].includes(word));

  if (topicWords.length > 0) {
    const topicRelevance = topicWords.filter((word) => allContent.includes(word)).length / topicWords.length;
    // If less than 30% topic relevance, likely need clarification
    if (topicRelevance < 0.3) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a finalized summary when discussion reaches consensus
 * This creates a collaborative final answer that synthesizes all three LLMs' perspectives
 *
 * @param rounds - All discussion rounds
 * @param topic - The original topic/question
 * @param resolutionResult - The resolution detection result
 * @returns Finalized summary text (500-1000 chars)
 */
export async function generateFinalizedSummary(
  rounds: DiscussionRound[],
  topic: string,
  resolutionResult: ResolutionResult
): Promise<string> {
  // Import logger at function scope so it's available in catch block
  const { logger } = await import('@/lib/logger');

  try {
    const { getProviderWithFallback, aiPersonas } = await import('./index');

    // Use Moderator AI persona (best for synthesis) or create special prompt
    const moderatorPersona = aiPersonas.moderator;
    const provider = getProviderWithFallback(moderatorPersona.provider);

    // Build comprehensive context from all rounds
    const roundsText = rounds
      .map(
        (round) =>
          `[Round ${round.roundNumber}]
Analyzer AI: ${round.analyzerResponse.content}

Solver AI: ${round.solverResponse.content}

Moderator AI: ${round.moderatorResponse.content}`
      )
      .join('\n\n---\n\n');

    const prompt = `You are synthesizing a collaborative discussion between three AIs (Solver AI, Analyzer AI, and Moderator AI) that has reached consensus on the topic: "${topic}"

All Discussion Rounds:
${roundsText}

Your task is to create a FINALIZED, COMPREHENSIVE SUMMARY that:
1. Synthesizes the key insights from all three AIs
2. Provides a clear, unified answer to the user's original topic/question
3. Incorporates the best ideas from Solver AI (practical solutions), Analyzer AI (deep analysis), and Moderator AI (synthesis)
4. Is written as a single, cohesive response (not a summary of the discussion, but THE ANSWER)
5. Is comprehensive (500-1000 characters) and directly addresses the user's topic
6. Represents the collective knowledge and agreement of all three AIs

The summary should read as if all three AIs collaborated to create this single, definitive answer together. It should be the "official answer" to the user's question.

Write the finalized summary now:`;

    const llmMessages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are synthesizing a collaborative AI discussion that has reached consensus. Your role is to create a single, comprehensive, finalized answer that represents the collective knowledge and agreement of all three AIs (Solver AI, Analyzer AI, and Moderator AI). Write as if you are all three AIs working together to provide the definitive answer to the user's question. The response should be 500-1000 characters and directly answer the user's topic.`,
      },
      { role: 'user', content: prompt },
    ];

    logger.info('Generating finalized summary', {
      topic,
      roundCount: rounds.length,
      confidence: resolutionResult.confidence,
    });

    // Use stream method with no-op callback since we just need the full response
    const response = await provider.stream(llmMessages, () => {
      // No-op: we just need the full response, not streaming chunks
    });

    const finalizedSummary = response.trim();

    // Validate length (500-1000 chars as specified)
    if (finalizedSummary.length < 500) {
      logger.warn('Finalized summary shorter than expected', {
        length: finalizedSummary.length,
        expectedMin: 500,
      });
    }
    if (finalizedSummary.length > 1000) {
      // Truncate if too long
      return finalizedSummary.slice(0, 1000).trim() + '...';
    }

    logger.info('Finalized summary generated', {
      topic,
      summaryLength: finalizedSummary.length,
    });

    return finalizedSummary;
  } catch (error) {
    logger.error('Error generating finalized summary', {
      error: error instanceof Error ? error.message : String(error),
      topic,
    });
    // Fallback: extract solution from resolution result or create basic summary
    if (resolutionResult.solution) {
      return resolutionResult.solution;
    }
    // Last resort: create a simple summary
    const lastRound = rounds[rounds.length - 1];
    if (lastRound) {
      return `Based on our collaborative discussion, we have reached consensus on "${topic}". ${lastRound.moderatorResponse.content.slice(0, 400)}`;
    }
    return `We have reached consensus on "${topic}" through our collaborative discussion.`;
  }
}
