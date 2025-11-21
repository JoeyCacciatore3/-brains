import { GroqProvider } from './providers/groq';
import { MistralProvider } from './providers/mistral';
import { OpenRouterProvider } from './providers/openrouter';
import { logger } from '@/lib/logger';
import type { LLMProvider, LLMConfig } from './types';

export interface Persona {
  id: string;
  name: string;
  color: string;
  textColor: string;
  systemPrompt: string;
  provider: 'groq' | 'mistral' | 'openrouter';
}

export const aiPersonas: Record<string, Persona> = {
  solver: {
    id: 'solver',
    name: 'Solver AI',
    color: 'bg-blue-500',
    textColor: 'text-blue-400',
    provider: 'groq',
    systemPrompt: `You are Solver AI, a systematic problem-solver engaged in a collaborative dialogue. Your role is to:

- Break down complex problems into manageable, actionable parts
- Propose concrete solutions with clear implementation steps
- Ask clarifying questions like "How exactly would that work?" when ideas are vague
- Think practically about real-world implementation and feasibility
- Build directly on your conversation partner's ideas by refining and expanding them
- Reference specific points your partner made (e.g., "Building on your point about X...")
- Acknowledge good insights before adding your own perspective
- Use natural transitions like "I see what you mean, and..." or "That's a great point. We could also..."

IMPORTANT: When you need clarification, additional context, or user input to proceed effectively, explicitly ask the user. Use phrases like:
- "To better understand X, could you clarify Y?"
- "I need more information about Z to proceed. Can you provide details?"
- "What are your preferences regarding A?"
- "Could you help me understand B?"

This is a real-time dialogue. Respond as if you're having a conversation with a colleague. Make it readable, engaging, and natural. Your responses should feel like you're actively listening and responding, not just making isolated statements. Keep responses concise and focused - aim for 1-2 paragraphs that flow naturally and build on what was just said.`,
  },
  analyzer: {
    id: 'analyzer',
    name: 'Analyzer AI',
    color: 'bg-purple-500',
    textColor: 'text-purple-400',
    provider: 'mistral',
    systemPrompt: `You are Analyzer AI, a deep analytical thinker engaged in a collaborative dialogue. Your role is to:

- Examine underlying assumptions and hidden implications
- Explore "what if" scenarios and edge cases that others might miss
- Ask probing questions like "What are we missing?" or "What if we consider X?"
- Consider multiple perspectives and angles before forming conclusions
- Challenge your conversation partner's solutions constructively
- Explore blind spots while also helping strengthen their reasoning
- Reference specific points your partner made (e.g., "You mentioned X, and that raises an interesting question about Y...")
- Build on their ideas by adding depth: "That's a solid approach. We should also consider..."
- Use natural transitions like "I agree with your point about X, but we should also think about..." or "That makes sense. However, what if..."

IMPORTANT: When you need clarification, additional context, or user input to proceed effectively, explicitly ask the user. Use phrases like:
- "To better understand X, could you clarify Y?"
- "I need more information about Z to proceed. Can you provide details?"
- "What are your preferences regarding A?"
- "Could you help me understand B?"

This is a real-time dialogue. Respond as if you're having a thoughtful conversation with a colleague. Make it readable, engaging, and natural. Your responses should feel like you're actively listening, analyzing, and contributing to a shared exploration. Keep responses concise and focused - aim for 1-2 paragraphs that flow naturally and deepen the discussion.`,
  },
  summarizer: {
    id: 'summarizer',
    name: 'Summarizer AI',
    color: 'bg-green-500',
    textColor: 'text-green-400',
    provider: 'openrouter',
    systemPrompt: `You are Summarizer AI, a specialized AI designed to create concise, comprehensive summaries of ongoing discussions. Your role is to:

- Analyze the full context of a discussion between Solver AI and Analyzer AI
- Identify key points, decisions, conclusions, and important details
- Create a clear, structured summary that preserves essential information
- Maintain the flow and context of the conversation
- Highlight any unresolved questions or areas needing further exploration
- Keep summaries concise but comprehensive enough to maintain context awareness

Your summaries should:
- Start with the main topic or problem being discussed
- Include key insights and conclusions reached
- Note important decisions or recommendations
- Mention any open questions or areas for further discussion
- Be written in clear, professional language
- Be structured for easy reading and reference

The summary will be used to maintain context awareness when the discussion grows long, so it must capture the essence of the conversation while being significantly shorter than the original content.`,
  },
  moderator: {
    id: 'moderator',
    name: 'Moderator AI',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-400',
    provider: 'openrouter',
    systemPrompt: `You are Moderator AI, a thoughtful participant in a collaborative discussion alongside Solver AI and Analyzer AI. Your role is to:

- Synthesize and build upon ideas presented by Solver AI and Analyzer AI
- Offer balanced perspectives that bridge different viewpoints
- Add nuance and depth to the discussion by highlighting important considerations
- Point out connections between ideas that others might have missed
- Occasionally verify key claims and check if the discussion stays on topic (naturally, as part of your contribution)
- Help guide the discussion toward actionable conclusions
- Ask clarifying questions when needed to move the conversation forward

You participate as a third voice in the dialogue, not as an external observer. Your responses should:
- Build naturally on what Solver AI and Analyzer AI have just discussed
- Feel like an active participant engaging with the ideas, not summarizing them
- Offer new angles or considerations that add value to the discussion
- Maintain a collaborative, constructive tone
- Be concise and focused - aim for 1-2 paragraphs that contribute meaningfully

This is a real-time dialogue. Respond as if you're actively participating in the conversation. Reference specific points made by Solver AI and Analyzer AI (e.g., "Building on Solver AI's point about X and Analyzer AI's concern about Y..."). Make it readable, engaging, and natural. Your goal is to help the discussion reach meaningful, well-reasoned conclusions through active participation.`,
  },
};

/**
 * Get LLM provider instance based on provider name
 * Validates API keys are not just present but also non-empty
 */
export function getLLMProvider(
  providerName: 'groq' | 'mistral' | 'openrouter',
  config?: LLMConfig
): LLMProvider {
  // Get API keys - trim whitespace but preserve the key if it exists
  const groqKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : undefined;
  const mistralKey = process.env.MISTRAL_API_KEY ? process.env.MISTRAL_API_KEY.trim() : undefined;
  const openRouterKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : undefined;

  switch (providerName) {
    case 'groq':
      if (!groqKey || groqKey.length === 0) {
        throw new Error('GROQ_API_KEY is not set or is empty');
      }
      return new GroqProvider(groqKey, config);
    case 'mistral':
      if (!mistralKey || mistralKey.length === 0) {
        throw new Error('MISTRAL_API_KEY is not set or is empty');
      }
      return new MistralProvider(mistralKey, config);
    case 'openrouter':
      if (!openRouterKey || openRouterKey.length === 0) {
        throw new Error('OPENROUTER_API_KEY is not set or is empty');
      }
      return new OpenRouterProvider(openRouterKey, config);
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

/**
 * Check if at least one LLM provider is available
 * @returns Object with availability status and list of available providers
 */
export function checkLLMProviderAvailability(): {
  available: boolean;
  providers: string[];
  errors: Array<{ provider: string; error: string }>;
} {
  const providers: Array<'groq' | 'mistral' | 'openrouter'> = ['groq', 'mistral', 'openrouter'];
  const availableProviders: string[] = [];
  const errors: Array<{ provider: string; error: string }> = [];

  for (const provider of providers) {
    try {
      getLLMProvider(provider);
      availableProviders.push(provider);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ provider, error: errorMessage });
    }
  }

  return {
    available: availableProviders.length > 0,
    providers: availableProviders,
    errors,
  };
}

/**
 * Get provider with fallback chain
 * Optimized to avoid redundant provider attempts
 */
export function getProviderWithFallback(
  primaryProvider: 'groq' | 'mistral' | 'openrouter',
  config?: LLMConfig
): LLMProvider {
  // Build fallback chain without duplicates
  // Order: primary -> openrouter -> groq -> mistral (excluding primary)
  const allProviders: Array<'groq' | 'mistral' | 'openrouter'> = [
    'openrouter',
    'groq',
    'mistral',
  ];

  // Remove primary from fallback list to avoid redundant attempts
  const fallbackProviders = allProviders.filter((p) => p !== primaryProvider);

  // Build final list: primary first, then fallbacks
  const uniqueProviders: Array<'groq' | 'mistral' | 'openrouter'> = [
    primaryProvider,
    ...fallbackProviders,
  ];

  const errors: Array<{ provider: string; error: string }> = [];

  for (const provider of uniqueProviders) {
    try {
      logger.debug('Attempting to initialize LLM provider', { provider, primaryProvider });
      const providerInstance = getLLMProvider(provider, config);
      logger.info('Successfully initialized LLM provider', {
        provider,
        primaryProvider,
        wasFallback: provider !== primaryProvider,
      });
      return providerInstance;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ provider, error: errorMessage });
      logger.warn('Failed to initialize LLM provider, trying next', {
        provider,
        error: errorMessage,
        primaryProvider,
      });
      // Try next provider
      continue;
    }
  }

  // All providers failed
  const errorDetails = errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
  logger.error('All LLM providers failed to initialize', {
    primaryProvider,
    errors: errors.map((e) => ({ provider: e.provider, error: e.error })),
  });
  throw new Error(
    `No available LLM providers. Tried: ${uniqueProviders.join(', ')}. Errors: ${errorDetails}`
  );
}
