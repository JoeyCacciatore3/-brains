/**
 * Response Accumulator
 * Centralizes chunk accumulation logic with validation
 * Prevents double-counting and ensures accurate length tracking
 */

import { logger } from '@/lib/logger';

export interface AccumulatorMetrics {
  chunkCount: number;
  continuationChunkCount: number;
  accumulatedLength: number;
  finalLength: number;
  lengthDifference: number;
  percentageMatch: number;
}

export interface ValidationResult {
  isValid: boolean;
  message: string;
  metrics: AccumulatorMetrics;
}

/**
 * Response Accumulator Class
 * Tracks chunks during streaming and validates against final response
 */
export class ResponseAccumulator {
  private chunks: string[] = [];
  private accumulatedLength: number = 0;
  private chunkCount: number = 0;
  private continuationChunkCount: number = 0;
  private initialStreamingComplete: boolean = false;

  /**
   * Add a chunk to the accumulator
   * @param chunk - The chunk to add
   * @param isContinuation - Whether this is a continuation chunk (after initial streaming)
   */
  addChunk(chunk: string, isContinuation?: boolean): void {
    if (typeof chunk !== 'string') {
      logger.warn('ResponseAccumulator: Received non-string chunk', { chunkType: typeof chunk });
      return;
    }

    this.chunks.push(chunk);
    this.accumulatedLength += chunk.length;
    this.chunkCount++;

    if (isContinuation || this.initialStreamingComplete) {
      this.continuationChunkCount++;
    }
  }

  /**
   * Mark initial streaming as complete
   * Subsequent chunks will be counted as continuation chunks
   */
  markInitialStreamingComplete(): void {
    this.initialStreamingComplete = true;
  }

  /**
   * Get accumulated content
   */
  getAccumulated(): string {
    return this.chunks.join('');
  }

  /**
   * Get accumulated length
   */
  getAccumulatedLength(): number {
    return this.accumulatedLength;
  }

  /**
   * Validate accumulated chunks against final response
   * @param finalResponse - The final response from the provider
   * @param tolerance - Tolerance for length differences (default: 10% or 10 chars, whichever is larger)
   * @returns Validation result with metrics
   */
  validateAgainstFinal(finalResponse: string, tolerance?: number): ValidationResult {
    const finalLength = finalResponse.length;
    const lengthDifference = Math.abs(finalLength - this.accumulatedLength);

    // Default tolerance: 10% or 10 chars, whichever is larger
    const defaultTolerance = Math.max(10, Math.floor(finalLength * 0.1));
    const actualTolerance = tolerance ?? defaultTolerance;

    const percentageMatch = finalLength > 0
      ? ((this.accumulatedLength / finalLength) * 100)
      : 0;

    const metrics: AccumulatorMetrics = {
      chunkCount: this.chunkCount,
      continuationChunkCount: this.continuationChunkCount,
      accumulatedLength: this.accumulatedLength,
      finalLength,
      lengthDifference,
      percentageMatch,
    };

    const isValid = lengthDifference <= actualTolerance;
    const message = isValid
      ? `Lengths match within tolerance (difference: ${lengthDifference}, tolerance: ${actualTolerance})`
      : `Length mismatch detected (difference: ${lengthDifference}, tolerance: ${actualTolerance}, ${percentageMatch.toFixed(1)}% match)`;

    return {
      isValid,
      message,
      metrics,
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): AccumulatorMetrics {
    return {
      chunkCount: this.chunkCount,
      continuationChunkCount: this.continuationChunkCount,
      accumulatedLength: this.accumulatedLength,
      finalLength: 0, // Will be set when validating
      lengthDifference: 0,
      percentageMatch: 0,
    };
  }

  /**
   * Reset accumulator (for reuse)
   */
  reset(): void {
    this.chunks = [];
    this.accumulatedLength = 0;
    this.chunkCount = 0;
    this.continuationChunkCount = 0;
    this.initialStreamingComplete = false;
  }

  /**
   * Get chunk count
   */
  getChunkCount(): number {
    return this.chunkCount;
  }

  /**
   * Get continuation chunk count
   */
  getContinuationChunkCount(): number {
    return this.continuationChunkCount;
  }
}
