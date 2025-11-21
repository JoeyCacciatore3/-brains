import { getDatabase } from './index';
import { logger } from '@/lib/logger';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  provider: string;
  provider_id: string;
  created_at: number;
  updated_at: number;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  provider: string;
  provider_id: string;
  created_at: number;
  updated_at: number;
}

/**
 * Get user by email
 */
export function getUserByEmail(email: string): User | null {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      provider: row.provider,
      provider_id: row.provider_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error('Error getting user by email', { error, email });
    return null;
  }
}

/**
 * Get user by ID
 */
export function getUserById(id: string): User | null {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      provider: row.provider,
      provider_id: row.provider_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error('Error getting user by ID', { error, id });
    return null;
  }
}

/**
 * Get user by provider and provider ID
 */
export function getUserByProvider(provider: string, providerId: string): User | null {
  try {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
      .get(provider, providerId) as UserRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      provider: row.provider,
      provider_id: row.provider_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  } catch (error) {
    logger.error('Error getting user by provider', { error, provider, providerId });
    return null;
  }
}
