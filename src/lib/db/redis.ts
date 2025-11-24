import Redis from 'ioredis';
import { logger } from '@/lib/logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis | null {
  // Only create Redis client if REDIS_URL is set
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    return null;
  }

  if (!redisClient) {
    try {
      if (process.env.REDIS_URL) {
        redisClient = new Redis(process.env.REDIS_URL);
      } else {
        redisClient = new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
        });
      }

      redisClient.on('error', (err) => {
        logger.error('Redis connection error', { error: err });
        redisClient = null;
      });

      redisClient.on('connect', () => {
        logger.info('Redis connected successfully');
      });
    } catch (error) {
      logger.error('Failed to create Redis client', { error });
      return null;
    }
  }

  return redisClient;
}

export function closeRedisClient(): void {
  if (redisClient) {
    redisClient.disconnect();
    redisClient = null;
  }
}
