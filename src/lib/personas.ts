/**
 * Persona definitions - client-safe (no server dependencies)
 * This file can be safely imported in client components
 */

export interface Persona {
  id: string;
  name: string;
  color: string;
  textColor: string;
  provider: 'groq' | 'mistral' | 'openrouter';
}

export const personaDefinitions: Record<string, Persona> = {
  solver: {
    id: 'solver',
    name: 'Solver AI',
    color: 'bg-blue-500',
    textColor: 'text-blue-400',
    provider: 'groq',
  },
  analyzer: {
    id: 'analyzer',
    name: 'Analyzer AI',
    color: 'bg-purple-500',
    textColor: 'text-purple-400',
    provider: 'mistral',
  },
};
