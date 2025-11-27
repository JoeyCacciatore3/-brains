/**
 * Provider Health Monitoring
 * Tracks health metrics for LLM providers
 */


export interface ProviderHealthMetrics {
  provider: string;
  successRate: number; // 0-1
  averageLatency: number; // milliseconds
  errorRate: number; // 0-1
  availability: number; // 0-1
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastSuccess?: number;
  lastFailure?: number;
}

// Note: PROVIDER_HEALTH_CHECK_INTERVAL_MS parsed but not used (kept for potential future use)
const _PROVIDER_HEALTH_CHECK_INTERVAL_MS = parseInt(
  process.env.PROVIDER_HEALTH_CHECK_INTERVAL_MS || '30000',
  10
);
const PROVIDER_MIN_SUCCESS_RATE = parseFloat(process.env.PROVIDER_MIN_SUCCESS_RATE || '0.95');
const PROVIDER_MAX_LATENCY_MS = parseInt(process.env.PROVIDER_MAX_LATENCY_MS || '10000', 10);

// Health metrics store
const healthMetrics = new Map<string, ProviderHealthMetrics>();
const requestHistory = new Map<string, Array<{ success: boolean; latency: number; timestamp: number }>>();
const MAX_HISTORY = 100; // Keep last 100 requests per provider

/**
 * Record a provider request
 */
export function recordProviderRequest(
  provider: string,
  success: boolean,
  latency: number
): void {
  const history = requestHistory.get(provider) || [];
  history.push({
    success,
    latency,
    timestamp: Date.now(),
  });

  // Keep only last MAX_HISTORY requests
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  requestHistory.set(provider, history);

  // Update metrics
  updateProviderMetrics(provider);
}

/**
 * Update provider health metrics
 */
function updateProviderMetrics(provider: string): void {
  const history = requestHistory.get(provider) || [];
  if (history.length === 0) {
    return;
  }

  const successful = history.filter((r) => r.success);
  const failed = history.filter((r) => !r.success);
  const total = history.length;

  const successRate = successful.length / total;
  const errorRate = failed.length / total;
  const averageLatency =
    history.reduce((sum, r) => sum + r.latency, 0) / total;

  const lastSuccess = successful.length > 0
    ? Math.max(...successful.map((r) => r.timestamp))
    : undefined;
  const lastFailure = failed.length > 0
    ? Math.max(...failed.map((r) => r.timestamp))
    : undefined;

  // Availability is based on recent requests (last 5 minutes)
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const recentHistory = history.filter((r) => r.timestamp > fiveMinutesAgo);
  const availability = recentHistory.length > 0
    ? recentHistory.filter((r) => r.success).length / recentHistory.length
    : 1.0;

  const metrics: ProviderHealthMetrics = {
    provider,
    successRate,
    averageLatency,
    errorRate,
    availability,
    totalRequests: total,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    lastSuccess,
    lastFailure,
  };

  healthMetrics.set(provider, metrics);
}

/**
 * Get provider health metrics
 */
export function getProviderHealth(provider: string): ProviderHealthMetrics | null {
  updateProviderMetrics(provider);
  return healthMetrics.get(provider) || null;
}

/**
 * Get all provider health metrics
 */
export function getAllProviderHealth(): Record<string, ProviderHealthMetrics> {
  // Update all metrics
  for (const provider of requestHistory.keys()) {
    updateProviderMetrics(provider);
  }

  const result: Record<string, ProviderHealthMetrics> = {};
  for (const [provider, metrics] of healthMetrics.entries()) {
    result[provider] = metrics;
  }
  return result;
}

/**
 * Check if provider is healthy
 */
export function isProviderHealthy(provider: string): boolean {
  const metrics = getProviderHealth(provider);
  if (!metrics) {
    return true; // No data, assume healthy
  }

  return (
    metrics.successRate >= PROVIDER_MIN_SUCCESS_RATE &&
    metrics.averageLatency <= PROVIDER_MAX_LATENCY_MS
  );
}

/**
 * Select healthiest provider from available providers
 */
export function selectHealthiestProvider(availableProviders: string[]): string | null {
  if (availableProviders.length === 0) {
    return null;
  }

  if (availableProviders.length === 1) {
    return availableProviders[0];
  }

  // Score providers based on health metrics
  const scored = availableProviders
    .map((provider) => {
      const metrics = getProviderHealth(provider);
      if (!metrics) {
        return { provider, score: 1.0 }; // No data, give default score
      }

      // Score based on success rate and latency
      const successScore = metrics.successRate;
      const latencyScore = Math.max(0, 1 - metrics.averageLatency / PROVIDER_MAX_LATENCY_MS);
      const availabilityScore = metrics.availability;

      const score = (successScore * 0.5 + latencyScore * 0.3 + availabilityScore * 0.2);

      return { provider, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.provider || availableProviders[0];
}

/**
 * Cleanup old request history
 */
function cleanupRequestHistory(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  for (const [provider, history] of requestHistory.entries()) {
    const filtered = history.filter((r) => r.timestamp > oneHourAgo);
    if (filtered.length === 0) {
      requestHistory.delete(provider);
      healthMetrics.delete(provider);
    } else {
      requestHistory.set(provider, filtered);
    }
  }
}

// Cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRequestHistory, 5 * 60 * 1000);
}
