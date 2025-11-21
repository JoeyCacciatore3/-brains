import type { LLMMessage, LLMProvider, LLMConfig } from '../types';
import { logger } from '@/lib/logger';
import { LLM_CONFIG } from '@/lib/config';
import { SSEParser } from '../sse-parser';
import { ErrorCode } from '@/lib/errors';

interface ErrorWithCode extends Error {
  code?: ErrorCode;
}

export class MistralProvider implements LLMProvider {
  name = 'Mistral';
  private apiKey: string;
  private config: LLMConfig;

  constructor(apiKey: string, config: LLMConfig = {}) {
    this.apiKey = apiKey;
    this.config = {
      model: config.model || 'mistral-large-latest',
      maxTokens: config.maxTokens || LLM_CONFIG.DEFAULT_MAX_TOKENS,
      temperature: config.temperature || 0.7,
    };
  }

  async stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<string> {
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
              const parsed = parseResult.data as { choices?: Array<{ delta?: { content?: string } }> };
              const content = parsed.choices?.[0]?.delta?.content || '';
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } else if (!parseResult.isComplete) {
              // Incomplete JSON - will be handled in next chunk
              // Buffer is maintained by parser
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

      return fullContent;
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
}
