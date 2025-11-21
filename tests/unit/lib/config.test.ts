import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  RATE_LIMIT_CONFIG,
  DIALOGUE_CONFIG,
  FILE_CONFIG,
  LLM_CONFIG,
  DATABASE_CONFIG,
} from '@/lib/config';

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('RATE_LIMIT_CONFIG', () => {
    it('should use default values when env vars not set', () => {
      delete process.env.RATE_LIMIT_MAX_REQUESTS;
      delete process.env.RATE_LIMIT_WINDOW_MS;
      // Note: Config is evaluated at module load, so we test the defaults
      expect(RATE_LIMIT_CONFIG.MAX_REQUESTS).toBeGreaterThan(0);
      expect(RATE_LIMIT_CONFIG.WINDOW_MS).toBeGreaterThan(0);
    });

    it('should have valid default values', () => {
      expect(RATE_LIMIT_CONFIG.MAX_REQUESTS).toBe(10);
      expect(RATE_LIMIT_CONFIG.WINDOW_MS).toBe(60000);
    });
  });

  describe('DIALOGUE_CONFIG', () => {
    it('should have valid default values', () => {
      expect(DIALOGUE_CONFIG.MAX_TURNS).toBeGreaterThan(0);
      expect(DIALOGUE_CONFIG.MIN_MESSAGE_LENGTH).toBe(10);
      expect(DIALOGUE_CONFIG.MAX_MESSAGE_LENGTH).toBe(1000);
      expect(DIALOGUE_CONFIG.RESOLUTION_CONVERGENCE_THRESHOLD).toBe(300);
      expect(DIALOGUE_CONFIG.MIN_MESSAGES_FOR_RESOLUTION).toBe(4);
    });
  });

  describe('FILE_CONFIG', () => {
    it('should have valid file size limits', () => {
      expect(FILE_CONFIG.MAX_FILE_SIZE).toBe(10 * 1024 * 1024); // 10MB
      expect(FILE_CONFIG.MAX_BASE64_SIZE).toBe(15 * 1024 * 1024); // 15MB
      expect(FILE_CONFIG.MAX_FILES).toBe(5);
    });

    it('should have allowed file types', () => {
      expect(FILE_CONFIG.ALLOWED_IMAGE_TYPES).toContain('image/jpeg');
      expect(FILE_CONFIG.ALLOWED_IMAGE_TYPES).toContain('image/png');
      expect(FILE_CONFIG.ALLOWED_PDF_TYPE).toBe('application/pdf');
    });
  });

  describe('LLM_CONFIG', () => {
    it('should have valid timeout and token settings', () => {
      expect(LLM_CONFIG.DEFAULT_TIMEOUT_MS).toBe(60000); // 60 seconds
      expect(LLM_CONFIG.DEFAULT_MAX_TOKENS).toBe(1000);
      expect(LLM_CONFIG.DEFAULT_TEMPERATURE).toBe(0.7);
    });
  });

  describe('DATABASE_CONFIG', () => {
    it('should have valid database path', () => {
      expect(DATABASE_CONFIG.PATH).toBeDefined();
      expect(typeof DATABASE_CONFIG.PATH).toBe('string');
    });

    it('should have valid cache size', () => {
      expect(DATABASE_CONFIG.STATEMENT_CACHE_SIZE).toBe(100);
    });
  });
});
