import { getProviderWithFallback, aiPersonas } from './index';
import { logger } from '@/lib/logger';
import type { LLMMessage } from './types';
import type { QuestionSet, Question, QuestionOption, DiscussionRound, SummaryEntry } from '@/types';
import { randomUUID } from 'crypto';

/**
 * Generate multiple choice questions based on discussion round and summary
 * Returns 2-5 questions (enforced min 2, max 5)
 */
export async function generateQuestions(
  discussionId: string,
  userId: string,
  topic: string,
  currentRound: DiscussionRound,
  summary?: SummaryEntry,
  previousRounds: DiscussionRound[] = []
): Promise<QuestionSet> {
  const summarizerPersona = aiPersonas.summarizer; // Use summarizer persona for question generation

  try {
    const provider = getProviderWithFallback(summarizerPersona.provider);

    // Build context for question generation
    // Order: Analyzer → Solver → Moderator
    const currentRoundText = `[Round ${currentRound.roundNumber}]
${currentRound.analyzerResponse.persona}: ${currentRound.analyzerResponse.content}

${currentRound.solverResponse.persona}: ${currentRound.solverResponse.content}

${currentRound.moderatorResponse.persona}: ${currentRound.moderatorResponse.content}`;

    // Order: Analyzer → Solver → Moderator
    const previousRoundsText =
      previousRounds.length > 0
        ? `\n\nPrevious Rounds:\n${previousRounds
            .map(
              (round) =>
                `[Round ${round.roundNumber}]\n${round.analyzerResponse.persona}: ${round.analyzerResponse.content}\n\n${round.solverResponse.persona}: ${round.solverResponse.content}\n\n${round.moderatorResponse.persona}: ${round.moderatorResponse.content}`
            )
            .join('\n\n---\n\n')}`
        : '';

    const summaryText = summary ? `\n\nSummary of Previous Discussion:\n${summary.summary}` : '';

    const prompt = `You are analyzing a collaborative discussion between three AIs (Solver AI, Analyzer AI, and Moderator AI) about: "${topic}"

Current Round:
${currentRoundText}${previousRoundsText}${summaryText}

Your task is to generate 2-5 multiple choice questions that will help direct the discussion forward. These questions should:
1. Help clarify important points or decisions
2. Guide the discussion toward resolution or deeper exploration
3. Address areas where user input would be valuable
4. Be relevant to the current state of the discussion
5. Have clear, distinct answer options

CRITICAL REQUIREMENTS:
- Generate between 2 and 5 questions (inclusive)
- Each question must have at least 2 answer options
- Each question must have a unique ID
- Questions should be actionable and help move the discussion forward
- Format your response as a JSON array of question objects

Return ONLY valid JSON in this exact format:
[
  {
    "id": "unique-question-id-1",
    "text": "Question text here?",
    "options": [
      {"id": "option-1", "text": "Option 1 text"},
      {"id": "option-2", "text": "Option 2 text"},
      {"id": "option-3", "text": "Option 3 text"}
    ]
  },
  {
    "id": "unique-question-id-2",
    "text": "Another question text?",
    "options": [
      {"id": "option-1", "text": "Option 1 text"},
      {"id": "option-2", "text": "Option 2 text"}
    ]
  }
]

Generate questions that will help the user guide the discussion effectively.`;

    const llmMessages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are a question generator for collaborative AI discussions. Your role is to analyze discussions and generate helpful multiple choice questions that guide the conversation forward. Always return valid JSON arrays with 2-5 questions.`,
      },
      { role: 'user', content: prompt },
    ];

    logger.info('Generating questions for discussion', {
      discussionId,
      userId,
      roundNumber: currentRound.roundNumber,
    });

    let response = '';
    await provider.stream(llmMessages, (chunk: string) => {
      if (typeof chunk === 'string') {
        response += chunk;
      }
    });

    if (!response || response.trim().length === 0) {
      throw new Error('Question generator returned empty response');
    }

    // Parse JSON response
    let questions: Array<{
      id: string;
      text: string;
      options: Array<{ id: string; text: string }>;
    }>;
    try {
      // Try to extract JSON from response (in case LLM adds extra text)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      } else {
        questions = JSON.parse(response.trim());
      }
    } catch (parseError) {
      logger.error('Failed to parse question generator response', {
        error: parseError,
        response: response.substring(0, 500),
      });
      throw new Error('Question generator returned invalid JSON format');
    }

    // Validate and enforce constraints
    if (!Array.isArray(questions)) {
      throw new Error('Question generator did not return an array');
    }

    // Enforce min 2, max 5 questions
    if (questions.length < 2) {
      logger.warn('Question generator returned less than 2 questions, adding default questions', {
        received: questions.length,
      });
      // Add a default question if we have less than 2
      questions.push({
        id: randomUUID(),
        text: 'Would you like the AIs to continue exploring this topic?',
        options: [
          { id: randomUUID(), text: 'Yes, continue the discussion' },
          { id: randomUUID(), text: 'No, move to a different aspect' },
        ],
      });
    }

    if (questions.length > 5) {
      logger.warn('Question generator returned more than 5 questions, truncating to 5', {
        received: questions.length,
      });
      questions = questions.slice(0, 5);
    }

    // Validate each question
    const validatedQuestions: Question[] = questions.map((q, index) => {
      if (!q.id || !q.text || !Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Invalid question format at index ${index}`);
      }

      // Ensure unique IDs
      const questionId = q.id || randomUUID();
      const options: QuestionOption[] = q.options.map((opt, optIndex) => ({
        id: opt.id || randomUUID(),
        text: opt.text || `Option ${optIndex + 1}`,
      }));

      return {
        id: questionId,
        text: q.text,
        options,
      };
    });

    const questionSet: QuestionSet = {
      roundNumber: currentRound.roundNumber,
      questions: validatedQuestions,
      generatedAt: new Date().toISOString(),
    };

    logger.info('Questions generated successfully', {
      discussionId,
      userId,
      roundNumber: currentRound.roundNumber,
      questionCount: validatedQuestions.length,
    });

    return questionSet;
  } catch (error) {
    logger.error('Error generating questions', { error, discussionId, userId });
    throw error;
  }
}
