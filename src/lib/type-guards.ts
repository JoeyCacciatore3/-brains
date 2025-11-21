/**
 * Type guard functions for runtime type checking
 * Replaces type assertions with proper type guards
 */

import type { ConversationMessage } from '@/types';

/**
 * Type guard for persona strings
 */
export function isPersona(value: string): value is 'Solver AI' | 'Analyzer AI' | 'Moderator AI' | 'User' {
  return value === 'Solver AI' || value === 'Analyzer AI' || value === 'Moderator AI' || value === 'User';
}

/**
 * Type guard for ConversationMessage persona
 */
export function isValidConversationMessagePersona(
  persona: string
): persona is ConversationMessage['persona'] {
  return isPersona(persona);
}

/**
 * Type guard to check if a value is a valid UUID
 */
export function isUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Type guard to check if a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type guard to check if a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
