/**
 * Cost Optimization Strategies
 * Optimizes LLM usage to reduce costs
 */

import { logger } from '@/lib/logger';
import { getProviderPricing } from './provider-costs';
import { getCostByProvider } from './cost-calculator';

const COST_OPTIMIZATION_ENABLED = process.env.COST_OPTIMIZATION_ENABLED !== 'false';
const DAILY_COST_BUDGET = parseFloat(process.env.DAILY_COST_BUDGET || '10.00');
const COST_ALERT_THRESHOLD = parseFloat(process.env.COST_ALERT_THRESHOLD || '0.8');

/**
 * Select provider based on cost (when multiple available)
 */
export function selectProviderByCost(availableProviders: string[]): string | null {
  if (!COST_OPTIMIZATION_ENABLED || availableProviders.length === 0) {
    return availableProviders[0] || null;
  }

  if (availableProviders.length === 1) {
    return availableProviders[0];
  }

  const pricing = getProviderPricing();
  let cheapestProvider: string | null = null;
  let cheapestCost = Infinity;

  for (const provider of availableProviders) {
    const providerKey = provider.toLowerCase() as keyof typeof pricing;
    if (providerKey in pricing) {
      // Use average of input and output costs for comparison
      const avgCost =
        (pricing[providerKey].inputCostPer1M + pricing[providerKey].outputCostPer1M) / 2;
      if (avgCost < cheapestCost) {
        cheapestCost = avgCost;
        cheapestProvider = provider;
      }
    }
  }

  return cheapestProvider || availableProviders[0];
}

/**
 * Check if daily cost budget is exceeded
 */
export async function checkDailyCostBudget(): Promise<{
  exceeded: boolean;
  currentCost: number;
  budget: number;
  percentage: number;
}> {
  if (!COST_OPTIMIZATION_ENABLED) {
    return {
      exceeded: false,
      currentCost: 0,
      budget: DAILY_COST_BUDGET,
      percentage: 0,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const costs = getCostByProvider(today, tomorrow);
  const currentCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
  const percentage = currentCost / DAILY_COST_BUDGET;
  const exceeded = currentCost >= DAILY_COST_BUDGET;

  return {
    exceeded,
    currentCost,
    budget: DAILY_COST_BUDGET,
    percentage,
  };
}

/**
 * Check if cost alert threshold is reached
 */
export async function checkCostAlert(): Promise<{
  alert: boolean;
  currentCost: number;
  budget: number;
  percentage: number;
}> {
  const budgetCheck = await checkDailyCostBudget();
  const alert = budgetCheck.percentage >= COST_ALERT_THRESHOLD;

  if (alert) {
    logger.warn('Cost alert threshold reached', {
      currentCost: budgetCheck.currentCost,
      budget: budgetCheck.budget,
      percentage: budgetCheck.percentage,
    });
  }

  return {
    alert,
    currentCost: budgetCheck.currentCost,
    budget: budgetCheck.budget,
    percentage: budgetCheck.percentage,
  };
}

/**
 * Get cost optimization recommendations
 */
export function getCostOptimizationRecommendations(): string[] {
  const recommendations: string[] = [];

  if (!COST_OPTIMIZATION_ENABLED) {
    return recommendations;
  }

  const pricing = getProviderPricing();

  // Find cheapest provider
  const providers = Object.entries(pricing).map(([name, p]) => ({
    name,
    avgCost: (p.inputCostPer1M + p.outputCostPer1M) / 2,
  }));

  providers.sort((a, b) => a.avgCost - b.avgCost);

  if (providers.length > 0) {
    recommendations.push(
      `Consider using ${providers[0].name} as primary provider (lowest cost: $${providers[0].avgCost.toFixed(2)}/1M tokens avg)`
    );
  }

  return recommendations;
}
