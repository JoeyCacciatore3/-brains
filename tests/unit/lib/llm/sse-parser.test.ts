import { describe, it, expect } from 'vitest';
import { SSEParser } from '@/lib/llm/sse-parser';

describe('SSEParser', () => {
  it('should parse complete JSON chunks', () => {
    const parser = new SSEParser('test');
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n';
    const dataLines = parser.processChunk(chunk);

    expect(dataLines).toHaveLength(1);
    const result = parser.tryParseJSON(dataLines[0]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ choices: [{ delta: { content: 'Hello' } }] });
  });

  it('should buffer incomplete JSON chunks', () => {
    const parser = new SSEParser('test');
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Hello';
    const chunk2 = ' world"}}]}\n';

    const dataLines1 = parser.processChunk(chunk1);
    expect(dataLines1).toHaveLength(0); // Incomplete, buffered

    const dataLines2 = parser.processChunk(chunk2);
    expect(dataLines2).toHaveLength(1); // Complete now
    const result = parser.tryParseJSON(dataLines2[0]);
    expect(result.success).toBe(true);
  });

  it('should handle JSON split across multiple chunks', () => {
    const parser = new SSEParser('test');
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Test';
    const chunk2 = ' message"}}]}\n';

    parser.processChunk(chunk1);
    const dataLines = parser.processChunk(chunk2);

    expect(dataLines).toHaveLength(1);
    const result = parser.tryParseJSON(dataLines[0]);
    expect(result.success).toBe(true);
    expect((result.data as any).choices[0].delta.content).toBe('Test message');
  });

  it('should handle [DONE] marker', () => {
    const parser = new SSEParser('test');
    const chunk = 'data: [DONE]\n';
    const dataLines = parser.processChunk(chunk);

    expect(dataLines).toHaveLength(1);
    const result = parser.tryParseJSON(dataLines[0]);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('should clear buffer', () => {
    const parser = new SSEParser('test');
    parser.processChunk('data: {"incomplete":');
    expect(parser.getBuffer().length).toBeGreaterThan(0);

    parser.clearBuffer();
    expect(parser.getBuffer()).toBe('');
  });
});
