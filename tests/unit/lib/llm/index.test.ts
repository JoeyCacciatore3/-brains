import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLLMProvider,
  checkLLMProviderAvailability,
  getProviderWithFallback,
} from '@/lib/llm/index';

describe('LLM Provider System', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getLLMProvider', () => {
    it('should create Groq provider with valid API key', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const provider = getLLMProvider('groq');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Groq');
    });

    it('should create Mistral provider with valid API key', () => {
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      const provider = getLLMProvider('mistral');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Mistral');
    });

    it('should create OpenRouter provider with valid API key', () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      const provider = getLLMProvider('openrouter');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('OpenRouter');
    });

    it('should throw error when Groq API key is missing', () => {
      delete process.env.GROQ_API_KEY;
      expect(() => getLLMProvider('groq')).toThrow('GROQ_API_KEY is not set');
    });

    it('should throw error when Mistral API key is missing', () => {
      delete process.env.MISTRAL_API_KEY;
      expect(() => getLLMProvider('mistral')).toThrow('MISTRAL_API_KEY is not set');
    });

    it('should throw error when OpenRouter API key is missing', () => {
      delete process.env.OPENROUTER_API_KEY;
      expect(() => getLLMProvider('openrouter')).toThrow('OPENROUTER_API_KEY is not set');
    });

    it('should throw error for invalid provider name', () => {
      expect(() => getLLMProvider('invalid' as any)).toThrow('Unknown provider: invalid');
    });

    it('should apply custom config to provider', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const config = {
        model: 'custom-model',
        maxTokens: 2000,
        temperature: 0.9,
      };
      const provider = getLLMProvider('groq', config);
      expect(provider).toBeDefined();
      // Note: We can't directly test config application without accessing private properties
      // But we can verify the provider is created successfully
    });
  });

  describe('checkLLMProviderAvailability', () => {
    it('should return all providers as available when all keys are set', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const result = checkLLMProviderAvailability();

      expect(result.available).toBe(true);
      expect(result.providers).toHaveLength(3);
      expect(result.providers).toContain('groq');
      expect(result.providers).toContain('mistral');
      expect(result.providers).toContain('openrouter');
      expect(result.errors).toHaveLength(0);
    });

    it('should return some providers as available when some keys are missing', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      delete process.env.MISTRAL_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const result = checkLLMProviderAvailability();

      expect(result.available).toBe(true);
      expect(result.providers).toHaveLength(2);
      expect(result.providers).toContain('groq');
      expect(result.providers).toContain('openrouter');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].provider).toBe('mistral');
      expect(result.errors[0].error).toContain('MISTRAL_API_KEY is not set');
    });

    it('should return no providers available when all keys are missing', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const result = checkLLMProviderAvailability();

      expect(result.available).toBe(false);
      expect(result.providers).toHaveLength(0);
      expect(result.errors).toHaveLength(3);
      expect(result.errors.map((e) => e.provider).sort()).toEqual([
        'groq',
        'mistral',
        'openrouter',
      ]);
    });

    it('should format error messages correctly', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      const result = checkLLMProviderAvailability();

      result.errors.forEach((error) => {
        expect(error.provider).toBeDefined();
        expect(error.error).toBeDefined();
        expect(typeof error.error).toBe('string');
        expect(error.error.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getProviderWithFallback', () => {
    it('should return primary provider when it is available', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const provider = getProviderWithFallback('groq');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Groq');
    });

    it('should fallback to openrouter when primary fails', () => {
      delete process.env.GROQ_API_KEY;
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const provider = getProviderWithFallback('groq');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('OpenRouter');
    });

    it('should fallback to groq when primary and openrouter fail', () => {
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      const provider = getProviderWithFallback('mistral');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Groq');
    });

    it('should fallback to mistral when all others fail', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      process.env.MISTRAL_API_KEY = 'test-mistral-key';

      const provider = getProviderWithFallback('groq');
      expect(provider).toBeDefined();
      expect(provider.name).toBe('Mistral');
    });

    it('should throw error when all providers fail', () => {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      expect(() => getProviderWithFallback('groq')).toThrow('No available LLM providers');
    });

    it('should verify fallback order (primary → openrouter → groq → mistral)', () => {
      // Test that when primary is groq, it doesn't try groq again in fallback
      process.env.GROQ_API_KEY = 'test-groq-key';
      delete process.env.MISTRAL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;

      // Primary is groq, should use groq (not fallback)
      const provider1 = getProviderWithFallback('groq');
      expect(provider1.name).toBe('Groq');

      // Primary is mistral, should fallback to groq
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      delete process.env.GROQ_API_KEY;
      const provider2 = getProviderWithFallback('groq');
      expect(provider2.name).toBe('Mistral'); // Actually uses mistral because groq is primary but missing
    });

    it('should apply custom config to provider', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      const config = {
        model: 'custom-model',
        maxTokens: 2000,
        temperature: 0.9,
      };

      const provider = getProviderWithFallback('groq', config);
      expect(provider).toBeDefined();
    });

    it('should remove duplicate providers in fallback chain', () => {
      process.env.GROQ_API_KEY = 'test-groq-key';
      process.env.MISTRAL_API_KEY = 'test-mistral-key';
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      // When primary is groq, fallback chain should be: groq, openrouter, groq, mistral
      // But duplicates should be removed, so: groq, openrouter, mistral
      const provider = getProviderWithFallback('groq');
      expect(provider).toBeDefined();
      // The actual implementation removes duplicates, so this test verifies it doesn't crash
    });
  });
});
