/**
 * Cost Reporting Endpoint
 * Provides cost tracking and reporting data
 */

import { NextResponse } from 'next/server';
import {
  getCostByProvider,
  getDailyCosts,
  getUserCost,
} from '@/lib/cost-tracking/cost-calculator';
import { checkDailyCostBudget } from '@/lib/cost-tracking/optimizer';
import { logger } from '@/lib/logger';

/**
 * GET /api/costs
 * Returns cost tracking data
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Get cost by provider
    const costByProvider = getCostByProvider(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );

    // Get daily costs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const last30Days = new Date(today);
    last30Days.setDate(last30Days.getDate() - 30);
    const dailyCosts = getDailyCosts(last30Days, today);

    // Get budget status
    const budgetStatus = await checkDailyCostBudget();

    // Get user cost if userId provided
    let userCost = 0;
    if (userId) {
      userCost = getUserCost(
        userId,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );
    }

    const response = {
      timestamp: new Date().toISOString(),
      costByProvider,
      dailyCosts,
      budget: {
        current: budgetStatus.currentCost,
        limit: budgetStatus.budget,
        percentage: budgetStatus.percentage,
        exceeded: budgetStatus.exceeded,
      },
      ...(userId && { userCost }),
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Failed to get cost data', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to get cost data',
      },
      { status: 500 }
    );
  }
}
