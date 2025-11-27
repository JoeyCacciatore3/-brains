/**
 * Cost Calculator
 * Tracks and calculates LLM API costs
 */

import { logger } from '@/lib/logger';
import { calculateProviderCost } from './provider-costs';
import { getDatabase } from '@/lib/db';

const COST_TRACKING_ENABLED = process.env.COST_TRACKING_ENABLED !== 'false';

export interface CostRecord {
  id?: number;
  discussionId: string;
  userId?: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
}

/**
 * Record cost for an LLM API call
 */
export async function recordCost(
  discussionId: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  userId?: string
): Promise<number> {
  if (!COST_TRACKING_ENABLED) {
    return 0;
  }

  try {
    const cost = calculateProviderCost(
      provider as 'groq' | 'mistral' | 'openrouter',
      inputTokens,
      outputTokens
    );

    // Store in database
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO cost_tracking (discussion_id, user_id, provider, input_tokens, output_tokens, cost, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(discussionId, userId || null, provider, inputTokens, outputTokens, cost, Date.now());

    logger.debug('Cost recorded', {
      discussionId,
      provider,
      inputTokens,
      outputTokens,
      cost,
    });

    return cost;
  } catch (error) {
    logger.error('Failed to record cost', {
      error: error instanceof Error ? error.message : String(error),
      discussionId,
      provider,
    });
    return 0;
  }
}

/**
 * Get total cost for a discussion
 */
export function getDiscussionCost(discussionId: string): number {
  if (!COST_TRACKING_ENABLED) {
    return 0;
  }

  try {
    const db = getDatabase();
    const result = db
      .prepare('SELECT SUM(cost) as total FROM cost_tracking WHERE discussion_id = ?')
      .get(discussionId) as { total: number | null };

    return result.total || 0;
  } catch (error) {
    logger.error('Failed to get discussion cost', {
      error: error instanceof Error ? error.message : String(error),
      discussionId,
    });
    return 0;
  }
}

/**
 * Get total cost for a user
 */
export function getUserCost(userId: string, startDate?: Date, endDate?: Date): number {
  if (!COST_TRACKING_ENABLED) {
    return 0;
  }

  try {
    const db = getDatabase();
    let query = 'SELECT SUM(cost) as total FROM cost_tracking WHERE user_id = ?';
    const params: (string | number)[] = [userId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate.getTime());
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate.getTime());
    }

    const result = db.prepare(query).get(...params) as { total: number | null };

    return result.total || 0;
  } catch (error) {
    logger.error('Failed to get user cost', {
      error: error instanceof Error ? error.message : String(error),
      userId,
    });
    return 0;
  }
}

/**
 * Get daily cost totals
 */
export function getDailyCosts(startDate: Date, endDate: Date): Array<{ date: string; cost: number }> {
  if (!COST_TRACKING_ENABLED) {
    return [];
  }

  try {
    const db = getDatabase();
    const results = db
      .prepare(
        `
      SELECT
        DATE(timestamp / 1000, 'unixepoch') as date,
        SUM(cost) as cost
      FROM cost_tracking
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY date
      ORDER BY date
    `
      )
      .all(startDate.getTime(), endDate.getTime()) as Array<{ date: string; cost: number }>;

    return results;
  } catch (error) {
    logger.error('Failed to get daily costs', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get cost breakdown by provider
 */
export function getCostByProvider(startDate?: Date, endDate?: Date): Record<string, number> {
  if (!COST_TRACKING_ENABLED) {
    return {};
  }

  try {
    const db = getDatabase();
    let query = 'SELECT provider, SUM(cost) as total FROM cost_tracking WHERE 1=1';
    const params: (number | string)[] = [];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate.getTime());
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate.getTime());
    }

    query += ' GROUP BY provider';

    const results = db.prepare(query).all(...params) as Array<{ provider: string; total: number }>;

    const breakdown: Record<string, number> = {};
    for (const row of results) {
      breakdown[row.provider] = row.total || 0;
    }

    return breakdown;
  } catch (error) {
    logger.error('Failed to get cost by provider', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}
