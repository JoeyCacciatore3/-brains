#!/usr/bin/env tsx
/**
 * Test script to verify LLM provider initialization
 * Run with: npx tsx tests/scripts/test-llm-init.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import {
  getLLMProvider,
  checkLLMProviderAvailability,
  getProviderWithFallback,
} from '../../src/lib/llm';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          results.push({ name, passed: true });
        })
        .catch((error) => {
          results.push({
            name,
            passed: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else {
      results.push({ name, passed: true });
    }
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runTests() {
  console.log('🧪 Testing LLM Provider Initialization\n');

  // Test 1: Check environment variables are loaded
  test('Environment variables are loaded', () => {
    const hasGroq = !!process.env.GROQ_API_KEY;
    const hasMistral = !!process.env.MISTRAL_API_KEY;
    const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
    console.log(`  GROQ_API_KEY: ${hasGroq ? '✅ Set' : '❌ Not set'}`);
    console.log(`  MISTRAL_API_KEY: ${hasMistral ? '✅ Set' : '❌ Not set'}`);
    console.log(`  OPENROUTER_API_KEY: ${hasOpenRouter ? '✅ Set' : '❌ Not set'}`);
  });

  // Test 2: Test getLLMProvider with each provider
  test('getLLMProvider - Groq (if key exists)', () => {
    if (process.env.GROQ_API_KEY) {
      const provider = getLLMProvider('groq');
      if (!provider) throw new Error('Provider is null');
      if (provider.name !== 'Groq') throw new Error(`Expected 'Groq', got '${provider.name}'`);
      console.log('  ✅ Groq provider initialized');
    } else {
      console.log('  ⏭️  Groq key not set, skipping');
    }
  });

  test('getLLMProvider - Mistral (if key exists)', () => {
    if (process.env.MISTRAL_API_KEY) {
      const provider = getLLMProvider('mistral');
      if (!provider) throw new Error('Provider is null');
      if (provider.name !== 'Mistral') throw new Error(`Expected 'Mistral', got '${provider.name}'`);
      console.log('  ✅ Mistral provider initialized');
    } else {
      console.log('  ⏭️  Mistral key not set, skipping');
    }
  });

  test('getLLMProvider - OpenRouter (if key exists)', () => {
    if (process.env.OPENROUTER_API_KEY) {
      const provider = getLLMProvider('openrouter');
      if (!provider) throw new Error('Provider is null');
      if (provider.name !== 'OpenRouter') throw new Error(`Expected 'OpenRouter', got '${provider.name}'`);
      console.log('  ✅ OpenRouter provider initialized');
    } else {
      console.log('  ⏭️  OpenRouter key not set, skipping');
    }
  });

  // Test 3: Test getLLMProvider throws error for missing keys
  test('getLLMProvider - Groq throws error when key missing', () => {
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    try {
      getLLMProvider('groq');
      throw new Error('Should have thrown error for missing key');
    } catch (error) {
      if (error instanceof Error && error.message.includes('GROQ_API_KEY is not set')) {
        console.log('  ✅ Groq correctly throws error for missing key');
      } else {
        throw error;
      }
    } finally {
      if (originalKey) process.env.GROQ_API_KEY = originalKey;
    }
  });

  test('getLLMProvider - Mistral throws error when key missing', () => {
    const originalKey = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      getLLMProvider('mistral');
      throw new Error('Should have thrown error for missing key');
    } catch (error) {
      if (error instanceof Error && error.message.includes('MISTRAL_API_KEY is not set')) {
        console.log('  ✅ Mistral correctly throws error for missing key');
      } else {
        throw error;
      }
    } finally {
      if (originalKey) process.env.MISTRAL_API_KEY = originalKey;
    }
  });

  test('getLLMProvider - OpenRouter throws error when key missing', () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      getLLMProvider('openrouter');
      throw new Error('Should have thrown error for missing key');
    } catch (error) {
      if (error instanceof Error && error.message.includes('OPENROUTER_API_KEY is not set')) {
        console.log('  ✅ OpenRouter correctly throws error for missing key');
      } else {
        throw error;
      }
    } finally {
      if (originalKey) process.env.OPENROUTER_API_KEY = originalKey;
    }
  });

  // Test 4: Test checkLLMProviderAvailability
  test('checkLLMProviderAvailability returns correct status', () => {
    const availability = checkLLMProviderAvailability();
    console.log(`  Available: ${availability.available}`);
    console.log(`  Providers: ${availability.providers.join(', ') || 'none'}`);
    console.log(`  Errors: ${availability.errors.length}`);
    if (availability.errors.length > 0) {
      availability.errors.forEach((err) => {
        console.log(`    - ${err.provider}: ${err.error}`);
      });
    }
    // Should have at least one provider available or show appropriate errors
    if (!availability.available && availability.providers.length === 0) {
      console.log('  ⚠️  No providers available - ensure at least one API key is set');
    }
  });

  // Test 5: Test getProviderWithFallback
  test('getProviderWithFallback - Groq primary', () => {
    if (process.env.GROQ_API_KEY) {
      const provider = getProviderWithFallback('groq');
      if (!provider) throw new Error('Provider is null');
      console.log(`  ✅ Fallback chain works for Groq primary (got: ${provider.name})`);
    } else {
      console.log('  ⏭️  Groq key not set, skipping');
    }
  });

  test('getProviderWithFallback - Mistral primary', () => {
    if (process.env.MISTRAL_API_KEY) {
      const provider = getProviderWithFallback('mistral');
      if (!provider) throw new Error('Provider is null');
      console.log(`  ✅ Fallback chain works for Mistral primary (got: ${provider.name})`);
    } else {
      console.log('  ⏭️  Mistral key not set, skipping');
    }
  });

  test('getProviderWithFallback - OpenRouter primary', () => {
    if (process.env.OPENROUTER_API_KEY) {
      const provider = getProviderWithFallback('openrouter');
      if (!provider) throw new Error('Provider is null');
      console.log(`  ✅ Fallback chain works for OpenRouter primary (got: ${provider.name})`);
    } else {
      console.log('  ⏭️  OpenRouter key not set, skipping');
    }
  });

  // Test 6: Test fallback when primary fails
  test('getProviderWithFallback - Falls back when primary unavailable', () => {
    // Temporarily remove all keys except one
    const groqKey = process.env.GROQ_API_KEY;
    const mistralKey = process.env.MISTRAL_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;

    // Set only one key
    if (openRouterKey) {
      delete process.env.GROQ_API_KEY;
      delete process.env.MISTRAL_API_KEY;
      process.env.OPENROUTER_API_KEY = openRouterKey;

      try {
        // Try to get Groq (should fallback to OpenRouter)
        const provider = getProviderWithFallback('groq');
        if (provider.name === 'OpenRouter') {
          console.log('  ✅ Fallback works: Groq -> OpenRouter');
        } else {
          throw new Error(`Expected OpenRouter, got ${provider.name}`);
        }
      } finally {
        // Restore keys
        if (groqKey) process.env.GROQ_API_KEY = groqKey;
        if (mistralKey) process.env.MISTRAL_API_KEY = mistralKey;
        if (openRouterKey) process.env.OPENROUTER_API_KEY = openRouterKey;
      }
    } else {
      console.log('  ⏭️  Need at least one API key to test fallback');
    }
  });

  // Wait for async tests
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Print summary
  console.log('\n📊 Test Summary:');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

