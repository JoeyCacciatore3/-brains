/**
 * LLM Provider Cost Configuration
 * Pricing information for different LLM providers
 */

export interface ProviderPricing {
  inputCostPer1M: number; // Cost per 1 million input tokens
  outputCostPer1M: number; // Cost per 1 million output tokens
}

export interface ProviderCosts {
  groq: ProviderPricing;
  mistral: ProviderPricing;
  openrouter: ProviderPricing; // Base pricing, actual varies by model
}

/**
 * Get provider pricing configuration
 */
export function getProviderPricing(): ProviderCosts {
  return {
    groq: {
      inputCostPer1M: parseFloat(process.env.GROQ_INPUT_COST_PER_1M || '0.27'),
      outputCostPer1M: parseFloat(process.env.GROQ_OUTPUT_COST_PER_1M || '0.27'),
    },
    mistral: {
      inputCostPer1M: parseFloat(process.env.MISTRAL_INPUT_COST_PER_1M || '2.50'),
      outputCostPer1M: parseFloat(process.env.MISTRAL_OUTPUT_COST_PER_1M || '7.50'),
    },
    openrouter: {
      // OpenRouter pricing varies by model, using average
      inputCostPer1M: parseFloat(process.env.OPENROUTER_INPUT_COST_PER_1M || '1.00'),
      outputCostPer1M: parseFloat(process.env.OPENROUTER_OUTPUT_COST_PER_1M || '3.00'),
    },
  };
}

/**
 * Calculate cost for a provider
 */
export function calculateProviderCost(
  provider: keyof ProviderCosts,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = getProviderPricing();
  const providerPricing = pricing[provider];

  const inputCost = (inputTokens / 1_000_000) * providerPricing.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * providerPricing.outputCostPer1M;

  return inputCost + outputCost;
}
