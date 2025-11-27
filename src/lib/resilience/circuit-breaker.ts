/**
 * Circuit Breaker Implementation
 * Prevents cascading failures by temporarily blocking calls to failing services
 */

import { logger } from '@/lib/logger';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  windowMs: number; // Time window for failure counting
  cooldownMs: number; // Time before attempting half-open
  successThreshold: number; // Number of successes to close from half-open
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: number;
  lastSuccess?: number;
  openedAt?: number;
}

const CIRCUIT_BREAKER_ENABLED = process.env.CIRCUIT_BREAKER_ENABLED !== 'false';
const DEFAULT_FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10);
const DEFAULT_WINDOW_MS = parseInt(process.env.CIRCUIT_BREAKER_WINDOW_MS || '60000', 10);
const DEFAULT_COOLDOWN_MS = parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '30000', 10);
const DEFAULT_SUCCESS_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '2', 10);

/**
 * Circuit Breaker class
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailure?: number;
  private lastSuccess?: number;
  private openedAt?: number;
  private failureWindow: number[] = []; // Timestamps of recent failures

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: DEFAULT_FAILURE_THRESHOLD,
      windowMs: DEFAULT_WINDOW_MS,
      cooldownMs: DEFAULT_COOLDOWN_MS,
      successThreshold: DEFAULT_SUCCESS_THRESHOLD,
    }
  ) {}

  /**
   * Get current state
   */
  getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): CircuitBreakerStats {
    this.updateState();
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
    };
  }

  /**
   * Update state based on time and thresholds
   */
  private updateState(): void {
    if (!CIRCUIT_BREAKER_ENABLED) {
      return;
    }

    const now = Date.now();

    // Clean up old failures outside the window
    const cutoff = now - this.config.windowMs;
    this.failureWindow = this.failureWindow.filter((timestamp) => timestamp > cutoff);
    this.failures = this.failureWindow.length;

    // State machine transitions
    if (this.state === 'open') {
      // Check if cooldown period has passed
      if (this.openedAt && now - this.openedAt >= this.config.cooldownMs) {
        this.state = 'half-open';
        this.successes = 0;
        logger.info('Circuit breaker transitioning to half-open', {
          name: this.name,
        });
      }
    } else if (this.state === 'half-open') {
      // Stay in half-open until success threshold or failure
      // (handled in recordSuccess/recordFailure)
    } else if (this.state === 'closed') {
      // Check if failure threshold exceeded
      if (this.failures >= this.config.failureThreshold) {
        this.state = 'open';
        this.openedAt = now;
        logger.warn('Circuit breaker opened', {
          name: this.name,
          failures: this.failures,
          threshold: this.config.failureThreshold,
        });
      }
    }
  }

  /**
   * Record a successful call
   */
  recordSuccess(): void {
    if (!CIRCUIT_BREAKER_ENABLED) {
      return;
    }

    this.lastSuccess = Date.now();

    if (this.state === 'half-open') {
      this.successes += 1;
      if (this.successes >= this.config.successThreshold) {
        this.state = 'closed';
        this.failures = 0;
        this.failureWindow = [];
        logger.info('Circuit breaker closed after successful recovery', {
          name: this.name,
          successes: this.successes,
        });
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success (successful calls indicate recovery)
      if (this.failures > 0) {
        this.failures = 0;
        this.failureWindow = [];
      }
    }
  }

  /**
   * Record a failed call
   */
  recordFailure(): void {
    if (!CIRCUIT_BREAKER_ENABLED) {
      return;
    }

    const now = Date.now();
    this.lastFailure = now;
    this.failureWindow.push(now);
    this.failures = this.failureWindow.length;

    if (this.state === 'half-open') {
      // Any failure in half-open state immediately opens the circuit
      this.state = 'open';
      this.openedAt = now;
      this.successes = 0;
      logger.warn('Circuit breaker opened from half-open after failure', {
        name: this.name,
      });
    } else {
      this.updateState();
    }
  }

  /**
   * Check if call is allowed
   */
  isOpen(): boolean {
    this.updateState();
    return this.state === 'open';
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new Error(`Circuit breaker is open for ${this.name}`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.failureWindow = [];
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
    this.openedAt = undefined;
    logger.info('Circuit breaker reset', { name: this.name });
  }
}

/**
 * Circuit breaker registry
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker
 */
export function getCircuitBreaker(
  name: string,
  config?: CircuitBreakerConfig
): CircuitBreaker {
  let breaker = circuitBreakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    circuitBreakers.set(name, breaker);
  }
  return breaker;
}

/**
 * Get all circuit breaker stats
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [name, breaker] of circuitBreakers.entries()) {
    stats[name] = breaker.getStats();
  }
  return stats;
}
