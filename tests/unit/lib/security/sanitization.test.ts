/**
 * Tests for log sanitization
 */

import { describe, it, expect } from 'vitest';
import { sanitizeLogData } from '@/lib/logger';

describe('sanitizeLogData', () => {
  it('should sanitize API keys in strings', () => {
    // Test with format that matches the pattern: "apikey: value" or "api_key=value"
    const input = 'apikey: sk1234567890abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeLogData(input) as string;
    expect(result).toContain('[SECRET_REDACTED]');
    expect(result).not.toContain('sk1234567890abcdefghijklmnopqrstuvwxyz');
  });

  it('should sanitize email addresses', () => {
    const input = 'User email: user@example.com';
    const result = sanitizeLogData(input) as string;
    expect(result).toContain('[EMAIL_REDACTED]');
    expect(result).not.toContain('user@example.com');
  });

  it('should sanitize passwords in objects', () => {
    const input = {
      username: 'testuser',
      password: 'secret123',
      apiKey: 'sk-test123',
    };
    const result = sanitizeLogData(input) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.username).toBe('testuser');
  });

  it('should sanitize file contents but keep metadata', () => {
    const input = {
      files: [
        {
          name: 'test.pdf',
          type: 'application/pdf',
          size: 1024,
          base64: 'base64encodedcontenthere',
          content: 'sensitive file content',
        },
      ],
    };
    const result = sanitizeLogData(input) as Record<string, unknown>;
    const files = result.files as Array<Record<string, unknown>>;
    expect(files[0].name).toBe('test.pdf');
    expect(files[0].type).toBe('application/pdf');
    expect(files[0].size).toBe(1024);
    expect(files[0].base64).toBeUndefined();
    expect(files[0].content).toBeUndefined();
  });

  it('should handle arrays', () => {
    const input = ['user@example.com', 'another@test.com'];
    const result = sanitizeLogData(input) as string[];
    expect(result[0]).toContain('[EMAIL_REDACTED]');
    expect(result[1]).toContain('[EMAIL_REDACTED]');
  });

  it('should handle nested objects', () => {
    const input = {
      user: {
        email: 'user@example.com',
        apiKey: 'sk-test123',
      },
      data: 'normal data',
    };
    const result = sanitizeLogData(input) as Record<string, unknown>;
    expect((result.user as Record<string, unknown>).email).toBe('[EMAIL_REDACTED]');
    expect((result.user as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect(result.data).toBe('normal data');
  });

  it('should preserve non-sensitive data', () => {
    const input = {
      discussionId: '123e4567-e89b-12d3-a456-426614174000',
      topic: 'Test topic',
      roundNumber: 1,
    };
    const result = sanitizeLogData(input) as Record<string, unknown>;
    expect(result.discussionId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result.topic).toBe('Test topic');
    expect(result.roundNumber).toBe(1);
  });

  it('should handle null and undefined', () => {
    expect(sanitizeLogData(null)).toBeNull();
    expect(sanitizeLogData(undefined)).toBeUndefined();
  });

  it('should handle primitive values', () => {
    expect(sanitizeLogData(123)).toBe(123);
    expect(sanitizeLogData('normal string')).toBe('normal string');
    expect(sanitizeLogData(true)).toBe(true);
  });
});
