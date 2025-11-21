import type { LLMProvider, LLMMessage } from '@/lib/llm/types';

/**
 * Mock LLM Provider for testing
 * Simulates streaming behavior with configurable responses
 */
export class MockLLMProvider implements LLMProvider {
  name: string;
  private responseText: string;
  private chunkDelay: number;
  private shouldError: boolean;
  private errorMessage: string;
  private chunks: string[];

  constructor(
    name: string = 'Mock Provider',
    options: {
      responseText?: string;
      chunkDelay?: number;
      shouldError?: boolean;
      errorMessage?: string;
      chunks?: string[];
    } = {}
  ) {
    this.name = name;
    this.responseText = options.responseText || 'Mock response';
    this.chunkDelay = options.chunkDelay || 0;
    this.shouldError = options.shouldError || false;
    this.errorMessage = options.errorMessage || 'Mock error';
    this.chunks = options.chunks || this.splitIntoChunks(this.responseText);
  }

  private splitIntoChunks(text: string): string[] {
    // Split text into chunks of ~10 characters
    const chunkSize = 10;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks.length > 0 ? chunks : [text];
  }

  async stream(_messages: LLMMessage[], onChunk: (chunk: string) => void): Promise<string> {
    if (this.shouldError) {
      throw new Error(this.errorMessage);
    }

    let fullContent = '';

    for (const chunk of this.chunks) {
      if (this.chunkDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.chunkDelay));
      }
      fullContent += chunk;
      onChunk(chunk);
    }

    return fullContent;
  }

  /**
   * Create a mock provider that simulates a specific API error
   */
  static createErrorProvider(name: string, errorMessage: string): MockLLMProvider {
    return new MockLLMProvider(name, {
      shouldError: true,
      errorMessage,
    });
  }

  /**
   * Create a mock provider that returns empty response
   */
  static createEmptyProvider(name: string = 'Mock Provider'): MockLLMProvider {
    return new MockLLMProvider(name, {
      responseText: '',
      chunks: [],
    });
  }

  /**
   * Create a mock provider with custom chunks
   */
  static createChunkedProvider(name: string, chunks: string[]): MockLLMProvider {
    return new MockLLMProvider(name, {
      responseText: chunks.join(''),
      chunks,
    });
  }
}
