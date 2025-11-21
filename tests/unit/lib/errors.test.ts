import { describe, it, expect } from 'vitest';
import { ErrorCode, createError, createErrorFromCode, ErrorMessages } from '@/lib/errors';

describe('Error Handling', () => {
  describe('createError', () => {
    it('should create an error object with all fields', () => {
      const error = createError(ErrorCode.VALIDATION_ERROR, 'Test error', { field: 'test' });

      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.details).toEqual({ field: 'test' });
      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should create error without details', () => {
      const error = createError(ErrorCode.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded');

      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.details).toBeUndefined();
    });
  });

  describe('createErrorFromCode', () => {
    it('should create error using predefined message', () => {
      const error = createErrorFromCode(ErrorCode.RATE_LIMIT_EXCEEDED);

      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.message).toBe(ErrorMessages.RATE_LIMIT_EXCEEDED);
    });

    it('should include details when provided', () => {
      const error = createErrorFromCode(ErrorCode.VALIDATION_ERROR, { field: 'test' });

      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.details).toEqual({ field: 'test' });
    });

    it('should use UNKNOWN_ERROR for invalid codes', () => {
      const error = createErrorFromCode('INVALID_CODE' as ErrorCode);

      expect(error.message).toBe(ErrorMessages.UNKNOWN_ERROR);
    });
  });

  describe('ErrorCode enum', () => {
    it('should have all expected error codes', () => {
      expect(ErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
      expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ErrorCode.DISCUSSION_NOT_FOUND).toBe('DISCUSSION_NOT_FOUND');
      expect(ErrorCode.LLM_PROVIDER_ERROR).toBe('LLM_PROVIDER_ERROR');
    });
  });
});
