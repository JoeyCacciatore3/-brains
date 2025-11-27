/**
 * Feature Flags
 * Enable/disable features without code changes
 */

import { logger } from '@/lib/logger';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
}

const featureFlags = new Map<string, boolean>();

/**
 * Initialize feature flags from environment variables
 */
function initializeFeatureFlags(): void {
  // Default feature flags
  const defaults: Record<string, boolean> = {
    METRICS: process.env.FEATURE_METRICS_ENABLED !== 'false',
    COST_TRACKING: process.env.FEATURE_COST_TRACKING_ENABLED !== 'false',
    CIRCUIT_BREAKER: process.env.FEATURE_CIRCUIT_BREAKER_ENABLED !== 'false',
    CACHING: process.env.FEATURE_CACHING_ENABLED !== 'false',
    ALERTING: process.env.FEATURE_ALERTING_ENABLED !== 'false',
    PERFORMANCE_MONITORING: process.env.FEATURE_PERFORMANCE_MONITORING_ENABLED !== 'false',
  };

  for (const [name, enabled] of Object.entries(defaults)) {
    featureFlags.set(name, enabled);
  }
}

// Initialize on module load
initializeFeatureFlags();

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(name: string): boolean {
  return featureFlags.get(name) ?? false;
}

/**
 * Set feature flag
 */
export function setFeatureFlag(name: string, enabled: boolean): void {
  featureFlags.set(name, enabled);
  logger.info('Feature flag updated', { name, enabled });
}

/**
 * Get all feature flags
 */
export function getAllFeatureFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [name, enabled] of featureFlags.entries()) {
    result[name] = enabled;
  }
  return result;
}

/**
 * Reset feature flags to defaults
 */
export function resetFeatureFlags(): void {
  initializeFeatureFlags();
  logger.info('Feature flags reset to defaults');
}
