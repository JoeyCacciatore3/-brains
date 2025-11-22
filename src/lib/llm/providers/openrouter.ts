import type { LLMMessage, LLMProvider, LLMConfig } from '../types';
import { logger } from '@/lib/logger';
import { extractTextFromPDF } from '@/lib/pdf-extraction';
import { LLM_CONFIG } from '@/lib/config';
import { SSEParser } from '../sse-parser';
import { ErrorCode } from '@/lib/errors';

interface ErrorWithCode extends Error {
  code?: ErrorCode;
}

// Default fallback models for OpenRouter (ordered by preference: cost, speed, quality)
const DEFAULT_FALLBACK_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-3.5-turbo',
  'anthropic/claude-3-haiku',
  'google/gemini-flash-1.5',
  'meta-llama/llama-3.2-3b-instruct:free',
];

// Get fallback models from environment variable or use defaults
function getFallbackModels(): string[] {
  const envModels = process.env.OPENROUTER_FALLBACK_MODELS;
  if (envModels) {
    try {
      return JSON.parse(envModels);
    } catch {
      // If JSON parsing fails, try comma-separated
      return envModels.split(',').map((m) => m.trim()).filter(Boolean);
    }
  }
  return DEFAULT_FALLBACK_MODELS;
}

/**
 * Check if an error indicates a model is unavailable
 */
function isModelUnavailableError(responseStatus: number, errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase();
  return (
    responseStatus === 404 ||
    lowerMessage.includes('model not found') ||
    lowerMessage.includes('model unavailable') ||
    lowerMessage.includes('does not exist') ||
    lowerMessage.includes('invalid model') ||
    lowerMessage.includes('model is not available') ||
    lowerMessage.includes('model does not exist')
  );
}

export class OpenRouterProvider implements LLMProvider {
  name = 'OpenRouter';
  private apiKey: string;
  private config: LLMConfig;
  private fallbackModels: string[];

  constructor(apiKey: string, config: LLMConfig = {}) {
    this.apiKey = apiKey;
    this.config = {
      model: config.model || 'openai/gpt-4o-mini',
      maxTokens: config.maxTokens || LLM_CONFIG.DEFAULT_MAX_TOKENS,
      temperature: config.temperature || 0.7,
    };
    this.fallbackModels = getFallbackModels();
  }

  async stream(messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<string> {
    // Track attempted models for this request to prevent infinite loops
    const attemptedModels: string[] = [];

    // Build list of models to try: primary model first, then fallbacks (excluding already attempted)
    const modelsToTry = [
      this.config.model!,
      ...this.fallbackModels.filter((m) => m !== this.config.model && !attemptedModels.includes(m)),
    ].filter(Boolean);

    // Limit retry attempts to prevent infinite loops (max 5 models)
    const maxAttempts = 5;
    const modelsToAttempt = modelsToTry.slice(0, maxAttempts);

    // Try each model in order
    for (let i = 0; i < modelsToAttempt.length; i++) {
      const model = modelsToAttempt[i];
      const isRetry = i > 0;

      if (isRetry) {
        logger.info('Retrying OpenRouter request with fallback model', {
          provider: 'OpenRouter',
          previousModel: modelsToAttempt[i - 1],
          newModel: model,
          attemptNumber: i + 1,
          totalAttempts: modelsToAttempt.length,
        });
      }

      try {
        return await this.streamWithModel(messages, onChunk, model);
      } catch (error) {
        // Check if this is a model unavailable error
        if (error instanceof Error && (error as ErrorWithCode).code === ErrorCode.MODEL_UNAVAILABLE) {
          attemptedModels.push(model);
          logger.warn('Model unavailable, trying next fallback model', {
            provider: 'OpenRouter',
            failedModel: model,
            remainingModels: modelsToAttempt.slice(i + 1),
            attemptedModels: attemptedModels,
          });
          // Continue to next model
          continue;
        }
        // For other errors, don't retry with different models
        throw error;
      }
    }

    // All models failed - include all attempted models in error
    const allAttemptedModels = attemptedModels.length > 0
      ? attemptedModels
      : modelsToAttempt; // If somehow no models were tracked, use the list we tried
    const errorDetails = allAttemptedModels.map((m) => `"${m}"`).join(', ');
    const error = new Error(
      `All OpenRouter models are unavailable. Tried: ${errorDetails}. Please check model availability or try a different provider.`
    );
    (error as ErrorWithCode).code = ErrorCode.MODEL_UNAVAILABLE;
    logger.error('All OpenRouter models unavailable', {
      provider: 'OpenRouter',
      attemptedModels: allAttemptedModels,
      totalAttempts: allAttemptedModels.length,
    });
    throw error;
  }

  /**
   * Stream with a specific model (internal method)
   */
  private async streamWithModel(
    messages: LLMMessage[],
    onChunk: (chunk: string) => void,
    model: string
  ): Promise<string> {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_CONFIG.DEFAULT_TIMEOUT_MS);

    try {
      // Get app URL for HTTP-Referer header
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': appUrl,
        'X-Title': 'AI Dialogue Platform',
      };

      // Process messages and extract PDF text for OpenRouter
      const processedMessages = await Promise.all(
        messages.map(async (msg) => {
          let content = msg.content;

          // Handle files: extract PDF text and append to content
          if (msg.files && msg.files.length > 0) {
            const pdfTexts: string[] = [];
            const fileInfo: string[] = [];

            for (const file of msg.files) {
              if (file.type === 'application/pdf' && file.base64) {
                try {
                  const pdfText = await extractTextFromPDF(file.base64);
                  pdfTexts.push(`\n\n[PDF Content from ${file.name}]:\n${pdfText}`);
                  logger.debug('Extracted PDF text for OpenRouter', {
                    fileName: file.name,
                    textLength: pdfText.length,
                  });
                } catch (pdfError) {
                  logger.warn('Failed to extract PDF text, including file info only', {
                    fileName: file.name,
                    error: pdfError instanceof Error ? pdfError.message : String(pdfError),
                  });
                  fileInfo.push(
                    `\n[File: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) - PDF text extraction failed]`
                  );
                }
              } else {
                // For images and other files, include file info
                fileInfo.push(
                  `\n[File: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(1)}KB)]`
                );
              }
            }

            // Append PDF text and file info to content
            if (pdfTexts.length > 0) {
              content += pdfTexts.join('\n');
            }
            if (fileInfo.length > 0) {
              content += fileInfo.join('\n');
            }
          }

          return {
            role: msg.role,
            content,
          };
        })
      );

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model,
          messages: processedMessages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stream: true,
          stop: ['\n\n', '. ', '! ', '? '], // Stop sequences to encourage natural sentence endings
        }),
        signal: controller.signal,
      });

      // Clear timeout after response received
      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `OpenRouter API error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error?.message || errorData.message || errorMessage;
        } catch {
          const errorText = await response.text();
          if (errorText) {
            errorMessage = errorText.substring(0, 200);
          }
        }

        // Check if this is a model unavailable error
        if (isModelUnavailableError(response.status, errorMessage)) {
          const error = new Error(`Model "${model}" is unavailable: ${errorMessage}`);
          (error as ErrorWithCode).code = ErrorCode.MODEL_UNAVAILABLE;
          logger.warn('OpenRouter model unavailable', {
            provider: 'OpenRouter',
            model,
            status: response.status,
            errorMessage,
          });
          throw error;
        }

        // Provide user-friendly error messages with error codes for other errors
        if (response.status === 401) {
          const error = new Error('Invalid API key. Please check your OpenRouter API key configuration.');
          (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
          throw error;
        } else if (response.status === 429) {
          const error = new Error('Rate limit exceeded. Please try again in a moment.');
          (error as ErrorWithCode).code = ErrorCode.RATE_LIMIT_EXCEEDED;
          throw error;
        } else if (response.status === 500 || response.status === 503) {
          const error = new Error('OpenRouter service is temporarily unavailable. Please try again later.');
          (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
          throw error;
        } else {
          const error = new Error(`OpenRouter API error: ${errorMessage}`);
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
      const parser = new SSEParser('OpenRouter');
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
              // Buffer is maintained by parser
              logger.debug('Incomplete JSON chunk, buffering for next chunk', {
                provider: 'OpenRouter',
                bufferSize: parser.getBuffer().length,
              });
            } else {
              // Invalid JSON (not incomplete) - log and continue
              logger.warn('Failed to parse JSON chunk from OpenRouter API (invalid JSON)', {
                provider: 'OpenRouter',
                data: data.substring(0, 200),
              });
            }
          }
        }

        // Process any remaining buffer
        const remainingBuffer = parser.getBuffer();
        if (remainingBuffer.trim()) {
          logger.warn('Unprocessed data remaining in SSE buffer', {
            provider: 'OpenRouter',
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
        const error = new Error('Empty response received from OpenRouter API. Please try again.');
        (error as ErrorWithCode).code = ErrorCode.LLM_PROVIDER_ERROR;
        logger.error('Empty response from OpenRouter API', {
          provider: 'OpenRouter',
          messageCount: messages.length,
        });
        throw error;
      }

      // Log warning for suspiciously short content
      if (fullContent.trim().length < 10) {
        logger.warn('Suspiciously short response from OpenRouter API', {
          provider: 'OpenRouter',
          contentLength: fullContent.length,
          content: fullContent.substring(0, 100),
        });
      }

      // Log finish_reason for monitoring
      logger.debug('OpenRouter API response completed', {
        provider: 'OpenRouter',
        finishReason,
        contentLength: fullContent.length,
        model,
      });

      // If response was cut off due to length, complete the thought
      if (finishReason === 'length') {
        logger.info('Response was truncated, completing thought', {
          provider: 'OpenRouter',
          initialLength: fullContent.length,
          model,
        });
        const continuation = await this.completeThought(messages, fullContent, model);
        return fullContent + continuation;
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
            'Network error: Unable to connect to OpenRouter API. Please check your internet connection.'
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
   */
  private async completeThought(
    originalMessages: LLMMessage[],
    truncatedContent: string,
    model: string
  ): Promise<string> {
    // Limit continuation to 20% of original max_tokens (rounded up, minimum 50)
    const continuationTokens = Math.max(50, Math.ceil(this.config.maxTokens! * 0.2));

    // Process messages for continuation (similar to streamWithModel)
    const processedMessages = await Promise.all(
      originalMessages.map(async (msg) => {
        let content = msg.content;
        if (msg.files && msg.files.length > 0) {
          // For continuation, we can skip file processing to save tokens
          // Just include a note that files were previously provided
          content += '\n[Files were provided in previous context]';
        }
        return {
          role: msg.role,
          content,
        };
      })
    );

    const continuationMessages = [
      ...processedMessages,
      {
        role: 'assistant' as const,
        content: truncatedContent,
      },
      {
        role: 'user' as const,
        content: `Complete your previous thought. You were cut off. Finish your statement naturally in ${continuationTokens} tokens or less.`,
      },
    ];

    let continuation = '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LLM_CONFIG.DEFAULT_TIMEOUT_MS);

      try {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.APP_URL ||
          (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': appUrl,
          'X-Title': 'AI Dialogue Platform',
        };

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model,
            messages: continuationMessages,
            max_tokens: continuationTokens,
            temperature: this.config.temperature,
            stream: true,
            stop: ['\n\n', '. ', '! ', '? '],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          logger.warn('Failed to get continuation from OpenRouter API', {
            provider: 'OpenRouter',
            status: response.status,
            model,
          });
          return ''; // Return empty if continuation fails
        }

        const reader = response.body?.getReader();
        if (!reader) {
          return '';
        }

        const decoder = new TextDecoder();
        const parser = new SSEParser('OpenRouter');

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
        provider: 'OpenRouter',
        continuationLength: continuation.length,
        model,
      });

      return continuation.trim();
    } catch (error) {
      logger.warn('Failed to complete thought', {
        provider: 'OpenRouter',
        error: error instanceof Error ? error.message : String(error),
        model,
      });
      return ''; // Return empty if continuation fails
    }
  }
}
