import type { LLMMessage, LLMProvider, LLMConfig } from '@/lib/llm/types';
import { logger } from '@/lib/logger';
import { LLM_CONFIG } from '@/lib/config';
import { SSEParser } from '@/lib/llm/sse-parser';
import { ErrorCode } from '@/lib/errors';
import { BaseProvider, type StreamResult } from './base-provider';
import { estimateTokensFromChars } from '@/lib/discussions/token-counter';

interface ErrorWithCode extends Error {
  code?: ErrorCode;
}

export class MistralProvider extends BaseProvider implements LLMProvider {
  name = 'Mistral';
  private apiKey: string;

  constructor(apiKey: string, config: LLMConfig = {}) {
    super({
      model: config.model || 'mistral-large-latest',
      maxTokens: config.maxTokens || LLM_CONFIG.DEFAULT_MAX_TOKENS,
      temperature: config.temperature || 0.7,
    });
    this.apiKey = apiKey;
  }

  /**
   * Internal streaming implementation for Mistral
   * Returns StreamResult with content and finishReason
   */
  protected async streamInternal(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void
  ): Promise<StreamResult> {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_CONFIG.DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stream: true,
          // No stop sequences - rely on max_tokens and completion logic to handle completion
        }),
        signal: controller.signal,
      });

      // Clear timeout after response received
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `Mistral API error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch {
          const errorText = await response.text();
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }

        // Provide user-friendly error messages with error codes
        if (response.status === 401) {
          const error = new Error('Invalid API key. Please check your Mistral API key configuration.');
          (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
          throw error;
        } else if (response.status === 429) {
          const error = new Error('Rate limit exceeded. Please try again in a moment.');
          (error as ErrorWithCode).code = ErrorCode.RATE_LIMIT_EXCEEDED;
          throw error;
        } else if (response.status === 500 || response.status === 503) {
          const error = new Error('Mistral service is temporarily unavailable. Please try again later.');
          (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
          throw error;
        } else {
          const error = new Error(`Mistral API error: ${errorMessage}`);
          (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
          throw error;
        }
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const error = new Error('No response body');
        (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
        throw error;
      }

      const decoder = new TextDecoder();
      const parser = new SSEParser('Mistral');
      let fullContent = '';
      let finishReason: string | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const dataLines = parser.processChunk(chunk);

          for (const data of dataLines) {
            if (data === '[DONE]') continue;

            const parseResult = parser.tryParseJSON(data);
            if (parseResult.success && parseResult.data) {
              const parsed = parseResult.data as {
                choices?: Array<{
                  delta?: { content?: string };
                  finish_reason?: string;
                }>;
              };
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                onChunk(content);
              }
              // Extract finish_reason from the final chunk
              if (parsed.choices?.[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason;
              }
            } else if (!parseResult.isComplete) {
              // Incomplete JSON - will be handled in next chunk
              logger.debug('Incomplete JSON chunk, buffering for next chunk', {
                provider: 'Mistral',
                bufferSize: parser.getBuffer().length,
              });
            } else {
              // Invalid JSON (not incomplete) - log and continue
              logger.warn('Failed to parse JSON chunk from Mistral API (invalid JSON)', {
                provider: 'Mistral',
                data: data.substring(0, 200),
              });
            }
          }
        }

        // Process any remaining buffer
        const remainingBuffer = parser.getBuffer();
        if (remainingBuffer.trim()) {
          logger.warn('Unprocessed data remaining in SSE buffer', {
            provider: 'Mistral',
            bufferSize: remainingBuffer.length,
            buffer: remainingBuffer.substring(0, 200),
          });
        }
      } finally {
        reader.releaseLock();
        parser.clearBuffer();
      }

      // Validate response is not empty
      if (!fullContent || fullContent.trim().length === 0) {
        const error = new Error('Empty response received from Mistral API. Please try again.');
        (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
        logger.error('Empty response from Mistral API', {
          provider: 'Mistral',
          messageCount: messages.length,
        });
        throw error;
      }

      // Log warning for suspiciously short content
      if (fullContent.trim().length < 10) {
        logger.warn('Suspiciously short response from Mistral API', {
          provider: 'Mistral',
          contentLength: fullContent.length,
          content: fullContent.substring(0, 100),
        });
      }

      // CRITICAL: Log finish_reason with full context for debugging
      const estimatedTokens = estimateTokensFromChars(fullContent.trim().length);
      logger.info('🔍 MISTRAL RESPONSE COMPLETE: API streaming finished', {
        provider: 'Mistral',
        finishReason,
        contentLength: fullContent.length,
        trimmedLength: fullContent.trim().length,
        estimatedTokens,
        maxTokens: this.config.maxTokens,
        tokenUtilization: this.config.maxTokens ? `${((estimatedTokens / this.config.maxTokens) * 100).toFixed(1)}%` : 'N/A',
        endsWithPunctuation: /[.!?]\s*$/.test(fullContent.trim()),
        lastChars: fullContent.trim().slice(-100),
        timestamp: new Date().toISOString(),
      });

      return {
        content: fullContent,
        finishReason,
        hadCompletion: false,
      };
    } catch (error) {
      // Ensure timeout is always cleared
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          const timeoutError = new Error('Request timeout: The AI took too long to respond. Please try again.');
          (timeoutError as ErrorWithCode).code = ErrorCode.LLM_TIMEOUT;
          throw timeoutError;
        }
        // Re-throw with original message if it's already user-friendly
        if (
          error.message.includes('API key') ||
          error.message.includes('Rate limit') ||
          error.message.includes('unavailable') ||
          error.message.includes('Empty response')
        ) {
          throw error;
        }
        // Network errors
        if (
          error.message.includes('fetch') ||
          error.message.includes('network') ||
          error.message.includes('Failed to fetch')
        ) {
          const networkError = new Error(
            'Network error: Unable to connect to Mistral API. Please check your internet connection.'
          );
          (networkError as ErrorWithCode).code = ErrorCode.NETWORK_ERROR;
          throw networkError;
        }
      }
      throw error;
    }
  }

  /**
   * Complete a thought that was cut off due to token limit
   * CRITICAL: onChunk must be provided to emit continuation chunks
   */
  protected async completeThoughtInternal(
    truncatedContent: string,
    originalMessages: LLMMessage[],
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    // Calculate continuation tokens using base class method
    const continuationTokens = this.calculateContinuationTokens(truncatedContent.trim().length);

    logger.info('Completing thought', {
      provider: 'Mistral',
      originalLength: truncatedContent.trim().length,
      continuationTokens,
      maxTokens: this.config.maxTokens,
    });

    const completionPrompt = `Complete your previous thought. You were cut off. Finish your statement naturally in ${continuationTokens} tokens or less.`;

    const continuationMessages: LLMMessage[] = [
      ...originalMessages,
      {
        role: 'assistant',
        content: truncatedContent,
      },
      {
        role: 'user',
        content: completionPrompt,
      },
    ];

    let continuation = '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_CONFIG.DEFAULT_TIMEOUT_MS);

      try {
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: continuationMessages.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
            max_tokens: continuationTokens,
            temperature: this.config.temperature,
            stream: true,
            // No stop sequences - rely on max_tokens to handle completion
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn('Failed to get continuation from Mistral API', {
            provider: 'Mistral',
            status: response.status,
          });
          return ''; // Return empty if continuation fails
        }

        const reader = response.body?.getReader();
        if (!reader) {
          return '';
        }

        const decoder = new TextDecoder();
        const parser = new SSEParser('Mistral');

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const dataLines = parser.processChunk(chunk);

            for (const data of dataLines) {
              if (data === '[DONE]') continue;

              const parseResult = parser.tryParseJSON(data);
              if (parseResult.success && parseResult.data) {
                const parsed = parseResult.data as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const content = parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  continuation += content;
                  // CRITICAL: Always emit continuation chunks if callback provided
                  if (onChunk) {
                    logger.debug('Emitting continuation chunk', {
                      provider: 'Mistral',
                      chunkLength: content.length,
                      accumulatedContinuationLength: continuation.length,
                    });
                    onChunk(content);
                  } else {
                    logger.warn('⚠️ Continuation chunk generated but onChunk callback not provided', {
                      provider: 'Mistral',
                      chunkLength: content.length,
                      note: 'This chunk will be lost if not emitted via callback',
                    });
                  }
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
          parser.clearBuffer();
        }
      } finally {
        clearTimeout(timeoutId);
      }

      logger.info('Thought completion successful', {
        provider: 'Mistral',
        continuationLength: continuation.length,
      });

      return continuation.trim();
    } catch (error) {
      logger.warn('Failed to complete thought', {
        provider: 'Mistral',
        error: error instanceof Error ? error.message : String(error),
      });
      return ''; // Return empty if continuation fails
    }
  }
}
