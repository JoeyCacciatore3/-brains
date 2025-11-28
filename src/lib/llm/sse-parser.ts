/**
 * SSE (Server-Sent Events) parser with buffer for incomplete JSON chunks
 * Handles cases where JSON objects are split across multiple chunks
 */

import { logger } from '@/lib/logger';

interface SSELine {
  type: 'data' | 'event' | 'id' | 'retry' | 'comment';
  data: string;
}

/**
 * Parse SSE line into structured format
 */
function parseSSELine(line: string): SSELine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data: ')) {
    return { type: 'data', data: trimmed.slice(6) };
  }
  if (trimmed.startsWith('event: ')) {
    return { type: 'event', data: trimmed.slice(7) };
  }
  if (trimmed.startsWith('id: ')) {
    return { type: 'id', data: trimmed.slice(4) };
  }
  if (trimmed.startsWith('retry: ')) {
    return { type: 'retry', data: trimmed.slice(7) };
  }
  if (trimmed.startsWith(':')) {
    return { type: 'comment', data: trimmed.slice(1) };
  }

  // Default to data if no prefix
  return { type: 'data', data: trimmed };
}

/**
 * SSE Parser with buffer for incomplete JSON
 */
export class SSEParser {
  private buffer = '';
  private readonly provider: string;
  private readonly maxBufferSize: number;

  constructor(provider: string, maxBufferSize = 1024 * 1024) {
    // 1MB max buffer to prevent memory issues
    this.provider = provider;
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Process chunk and extract complete data lines
   * Returns array of complete data strings (may be empty if JSON is incomplete)
   */
  processChunk(chunk: string): string[] {
    // Add chunk to buffer
    this.buffer += chunk;

    // Warn if buffer is getting large (80% of max)
    const warningThreshold = this.maxBufferSize * 0.8;
    if (this.buffer.length > warningThreshold && this.buffer.length <= this.maxBufferSize) {
      logger.warn('SSE buffer approaching max size', {
        provider: this.provider,
        bufferSize: this.buffer.length,
        maxSize: this.maxBufferSize,
        percentage: Math.round((this.buffer.length / this.maxBufferSize) * 100),
      });
    }

    // Check buffer size to prevent memory issues
    if (this.buffer.length > this.maxBufferSize) {
      logger.error('SSE buffer exceeded max size, attempting to process available data', {
        provider: this.provider,
        bufferSize: this.buffer.length,
        maxSize: this.maxBufferSize,
      });
      // Instead of clearing, try to process what we have
      // Find the last complete line and process up to that point
      const lastNewlineIndex = this.buffer.lastIndexOf('\n');
      if (lastNewlineIndex > 0) {
        const processable = this.buffer.substring(0, lastNewlineIndex + 1);
        this.buffer = this.buffer.substring(lastNewlineIndex + 1);
        // Recursively process the processable portion
        return this.processChunk(processable);
      } else {
        // No newlines found, clear buffer to prevent memory issues
        logger.error('SSE buffer exceeded max size with no newlines, clearing buffer', {
          provider: this.provider,
          bufferSize: this.buffer.length,
        });
        this.buffer = '';
        return [];
      }
    }

    // Split by newlines, but keep incomplete line in buffer
    const lines: string[] = [];
    let lastNewlineIndex = -1;

    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === '\n') {
        const line = this.buffer.substring(lastNewlineIndex + 1, i);
        if (line.trim()) {
          lines.push(line);
        }
        lastNewlineIndex = i;
      }
    }

    // Keep incomplete line in buffer
    if (lastNewlineIndex < this.buffer.length - 1) {
      this.buffer = this.buffer.substring(lastNewlineIndex + 1);
    } else {
      this.buffer = '';
    }

    // Parse lines and extract data
    const dataLines: string[] = [];
    for (const line of lines) {
      const parsed = parseSSELine(line);
      if (parsed && parsed.type === 'data') {
        dataLines.push(parsed.data);
      }
    }

    return dataLines;
  }

  /**
   * Try to parse JSON from data line, handling incomplete JSON
   * Returns parsed object or null if JSON is incomplete
   */
  tryParseJSON(data: string): { success: boolean; data?: unknown; isComplete?: boolean } {
    // Check if data is [DONE] marker
    if (data === '[DONE]') {
      return { success: true, data: null, isComplete: true };
    }

    // Try to parse JSON
    try {
      const parsed = JSON.parse(data);
      return { success: true, data: parsed, isComplete: true };
    } catch (error) {
      // Check if error is due to incomplete JSON
      if (error instanceof SyntaxError) {
        const trimmed = data.trim();

        // Common incomplete JSON patterns:
        // - Missing closing brace/bracket
        // - Incomplete string
        // - Incomplete number
        // - Truncated in middle of token

        // Check for incomplete string (odd number of unescaped quotes)
        // This is a strong indicator of incomplete JSON
        const unescapedQuotes = trimmed.match(/(?<!\\)"/g);
        if (unescapedQuotes && unescapedQuotes.length % 2 !== 0) {
          return { success: false, isComplete: false };
        }

        // Check for unmatched braces/brackets
        const openBraces = (trimmed.match(/{/g) || []).length;
        const closeBraces = (trimmed.match(/}/g) || []).length;
        const openBrackets = (trimmed.match(/\[/g) || []).length;
        const closeBrackets = (trimmed.match(/\]/g) || []).length;

        // If we have more open than close, it might be incomplete
        if (openBraces > closeBraces || openBrackets > closeBrackets) {
          return { success: false, isComplete: false };
        }

        // Check for common incomplete patterns at the end
        const incompleteEndPatterns = [
          /:\s*$/, // Ends with colon (expecting value)
          /,\s*$/, // Ends with comma (expecting next item)
          /"\s*$/, // Ends with quote (might be incomplete string, but we already checked quotes)
          /[0-9]\s*$/, // Ends with digit (might be incomplete number)
          /[a-zA-Z]\s*$/, // Ends with letter (might be incomplete keyword)
        ];

        for (const pattern of incompleteEndPatterns) {
          if (pattern.test(trimmed)) {
            // Additional check: if it ends with a colon or comma, it's likely incomplete
            if (pattern === /:\s*$/ || pattern === /,\s*$/) {
              return { success: false, isComplete: false };
            }
          }
        }

        // Check for truncated number (ends with digit but no closing)
        if (/^\d+\.?\d*[eE]?[+-]?\d*$/.test(trimmed) && !trimmed.includes('}') && !trimmed.includes(']')) {
          // Might be incomplete number, but hard to tell without context
          // If it's part of a larger structure, the brace check above will catch it
        }
      }

      // If it's not incomplete, it's just invalid JSON
      logger.warn('Failed to parse JSON chunk (invalid JSON, not incomplete)', {
        provider: this.provider,
        error: error instanceof Error ? error.message : String(error),
        data: data.substring(0, 200),
      });
      return { success: false, isComplete: true }; // Mark as complete so we don't wait for more
    }
  }

  /**
   * Get remaining buffer (for debugging)
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Clear buffer
   */
  clearBuffer(): void {
    this.buffer = '';
  }
}
