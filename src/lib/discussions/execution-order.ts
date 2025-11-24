/**
 * Single Source of Truth for AI Persona Execution Order
 *
 * This module defines the canonical execution order for AI personas in discussion rounds.
 * All code that references execution order should use constants and functions from this module.
 *
 * EXECUTION ORDER: Analyzer AI → Solver AI → Moderator AI
 *
 * This order is CRITICAL and must be maintained throughout the codebase.
 * Any deviation from this order is a critical bug.
 */

import { logger } from '@/lib/logger';

/**
 * The canonical execution order for AI personas in a discussion round
 * This is the SINGLE SOURCE OF TRUTH for execution order
 */
export const EXECUTION_ORDER: readonly ['Analyzer AI', 'Solver AI', 'Moderator AI'] = [
  'Analyzer AI',
  'Solver AI',
  'Moderator AI',
] as const;

/**
 * Type for persona names in execution order
 */
export type PersonaInOrder = typeof EXECUTION_ORDER[number];

/**
 * Get the position (1-based) of a persona in the execution order
 * @param persona - The persona name
 * @returns Position in execution order (1, 2, or 3), or 0 if not found
 */
export function getPersonaPosition(persona: string): number {
  const index = EXECUTION_ORDER.indexOf(persona as PersonaInOrder);
  return index >= 0 ? index + 1 : 0;
}

/**
 * Get the next persona in execution order
 * @param currentPersona - Current persona name
 * @returns Next persona in order, or null if current is last
 */
export function getNextPersona(
  currentPersona: PersonaInOrder
): PersonaInOrder | null {
  const currentIndex = EXECUTION_ORDER.indexOf(currentPersona);
  if (currentIndex < 0 || currentIndex >= EXECUTION_ORDER.length - 1) {
    return null;
  }
  return EXECUTION_ORDER[currentIndex + 1];
}

/**
 * Get the previous persona in execution order
 * @param currentPersona - Current persona name
 * @returns Previous persona in order, or null if current is first
 */
export function getPreviousPersona(
  currentPersona: PersonaInOrder
): PersonaInOrder | null {
  const currentIndex = EXECUTION_ORDER.indexOf(currentPersona);
  if (currentIndex <= 0) {
    return null;
  }
  return EXECUTION_ORDER[currentIndex - 1];
}

/**
 * Get the first persona in execution order
 */
export function getFirstPersona(): PersonaInOrder {
  return EXECUTION_ORDER[0];
}

/**
 * Get the last persona in execution order
 */
export function getLastPersona(): PersonaInOrder {
  return EXECUTION_ORDER[EXECUTION_ORDER.length - 1];
}

/**
 * Validate that a sequence of personas follows the correct execution order
 * @param personas - Array of persona names to validate (can be readonly)
 * @returns Object with isValid flag and error message if invalid
 */
export function validateExecutionOrder(
  personas: readonly string[] | string[]
): { isValid: boolean; error?: string } {
  if (personas.length === 0) {
    return { isValid: true };
  }

  // Check if all personas are valid
  const invalidPersonas = personas.filter(
    (p) => !EXECUTION_ORDER.includes(p as PersonaInOrder)
  );
  if (invalidPersonas.length > 0) {
    return {
      isValid: false,
      error: `Invalid personas found: ${invalidPersonas.join(', ')}`,
    };
  }

  // Check if order is correct
  for (let i = 0; i < personas.length; i++) {
    const currentPersona = personas[i] as PersonaInOrder;
    const currentPosition = getPersonaPosition(currentPersona);

    // Check if this persona should come after the previous one
    if (i > 0) {
      const previousPersona = personas[i - 1] as PersonaInOrder;
      const previousPosition = getPersonaPosition(previousPersona);

      if (currentPosition <= previousPosition) {
        return {
          isValid: false,
          error: `Execution order violation: ${currentPersona} (position ${currentPosition}) cannot come after ${previousPersona} (position ${previousPosition})`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * Validate that a persona can execute at a given point in the sequence
 * @param persona - Persona attempting to execute
 * @param previousPersonas - Array of personas that have already executed
 * @returns Object with isValid flag and error message if invalid
 */
export function validatePersonaCanExecute(
  persona: string,
  previousPersonas: string[]
): { isValid: boolean; error?: string } {
  const personaPosition = getPersonaPosition(persona);

  if (personaPosition === 0) {
    return {
      isValid: false,
      error: `Invalid persona: ${persona} is not in execution order`,
    };
  }

  // If this is the first persona, it can always execute
  if (personaPosition === 1) {
    if (previousPersonas.length > 0) {
      return {
        isValid: false,
        error: `Execution order violation: ${persona} should be first, but previous personas exist: ${previousPersonas.join(', ')}`,
      };
    }
    return { isValid: true };
  }

  // Check that all previous personas in order have executed
  const requiredPreviousPersonas = EXECUTION_ORDER.slice(0, personaPosition - 1);
  const missingPersonas = requiredPreviousPersonas.filter(
    (p) => !previousPersonas.includes(p)
  );

  if (missingPersonas.length > 0) {
    return {
      isValid: false,
      error: `Execution order violation: ${persona} cannot execute. Missing required previous personas: ${missingPersonas.join(', ')}`,
    };
  }

  return { isValid: true };
}

/**
 * Get all personas that should execute before a given persona
 * @param persona - Target persona
 * @returns Array of personas that must execute before this persona
 */
export function getRequiredPreviousPersonas(
  persona: PersonaInOrder
): PersonaInOrder[] {
  const personaPosition = getPersonaPosition(persona);
  if (personaPosition <= 1) {
    return [];
  }
  return EXECUTION_ORDER.slice(0, personaPosition - 1);
}

/**
 * Check if a persona is the first in execution order
 */
export function isFirstPersona(persona: string): boolean {
  return persona === getFirstPersona();
}

/**
 * Check if a persona is the last in execution order
 */
export function isLastPersona(persona: string): boolean {
  return persona === getLastPersona();
}

/**
 * Log execution order validation with detailed information
 * @param context - Context information for logging
 * @param personas - Array of personas to validate
 */
export function logExecutionOrderValidation(
  context: {
    discussionId?: string;
    roundNumber?: number;
    operation?: string;
  },
  personas: string[]
): void {
  const validation = validateExecutionOrder(personas);
  if (!validation.isValid) {
    logger.error('🚨 EXECUTION ORDER VALIDATION FAILED', {
      ...context,
      personas,
      error: validation.error,
      expectedOrder: EXECUTION_ORDER,
      timestamp: new Date().toISOString(),
    });
  } else {
    logger.debug('✅ EXECUTION ORDER VALIDATION PASSED', {
      ...context,
      personas,
      expectedOrder: EXECUTION_ORDER,
      timestamp: new Date().toISOString(),
    });
  }
}
