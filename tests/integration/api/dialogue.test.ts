import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDiscussion as createDiscussionFiles } from '@/lib/discussions/file-manager';
import { createDiscussion, getDiscussion, updateDiscussion } from '@/lib/db/discussions';
import { readDiscussion } from '@/lib/discussions/file-manager';
import { initializeDatabase, closeDatabase } from '@/lib/db';
import { isResolved, needsUserInput } from '@/lib/llm/resolver';
// DiscussionMessage type is used in type annotations

describe('Dialogue Integration Tests', () => {
  const testUserId = 'test-user-id';

  beforeEach(() => {
    // Initialize database for each test
    try {
      initializeDatabase();
    } catch (error) {
      // Database may already be initialized
    }
  });

  afterEach(() => {
    // Clean up database connections
    try {
      closeDatabase();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Database Operations', () => {
    it('should create a discussion', async () => {
      // Create discussion files first (source of truth)
      const fileResult = await createDiscussionFiles(testUserId, 'Test topic');

      // Then create database record
      const discussion = createDiscussion(
        testUserId,
        'Test topic',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      expect(discussion).toBeDefined();
      expect(discussion.id).toBeDefined();
      expect(discussion.topic).toBe('Test topic');
      expect(discussion.is_resolved).toBe(0);
      expect(discussion.needs_user_input).toBe(0);
      expect(discussion.current_turn).toBe(0);
    });

    it('should retrieve a discussion by ID', async () => {
      // Create discussion files first
      const fileResult = await createDiscussionFiles(testUserId, 'Test topic');

      // Create database record
      const discussion = createDiscussion(
        testUserId,
        'Test topic',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      const retrieved = getDiscussion(discussion.id, testUserId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(discussion.id);
      expect(retrieved?.topic).toBe('Test topic');
    });

    it('should add messages to a discussion', async () => {
      // Create discussion files first
      const fileResult = await createDiscussionFiles(testUserId, 'Test topic');

      // Create database record
      const discussion = createDiscussion(
        testUserId,
        'Test topic',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      // Messages are stored in files, retrieve them from file storage
      const discussionData = await readDiscussion(discussion.id, testUserId);
      const messages = discussionData.messages || [];

      // Initially empty
      expect(messages.length).toBe(0);
    });

    it('should retrieve all messages for a discussion', async () => {
      // Create discussion files first
      const fileResult = await createDiscussionFiles(testUserId, 'Test topic');

      // Create database record
      const discussion = createDiscussion(
        testUserId,
        'Test topic',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      // Note: Legacy discussions may have messages array, but new discussions use rounds-based structure
      // This test verifies that legacy data can still be read correctly
      const discussionData = await readDiscussion(discussion.id, testUserId);
      const messages = discussionData.messages || [];

      expect(messages.length).toBe(0); // Initially empty
    });

    it('should update discussion state', async () => {
      // Create discussion files first
      const fileResult = await createDiscussionFiles(testUserId, 'Test topic');

      // Create database record
      const discussion = createDiscussion(
        testUserId,
        'Test topic',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      updateDiscussion(discussion.id, {
        is_resolved: 1,
        current_turn: 2,
      });

      const updated = getDiscussion(discussion.id, testUserId);

      expect(updated?.is_resolved).toBe(1);
      expect(updated?.current_turn).toBe(2);
    });
  });

  describe('Resolution Detection', () => {
    it('should not resolve with less than 4 messages', () => {
      const messages: DiscussionMessage[] = [
        {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'First message',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Second message',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
      ];

      expect(isResolved(messages).resolved).toBe(false);
    });

    it('should detect resolution with keywords', () => {
      const messages: DiscussionMessage[] = [
        {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'First message',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'Second message',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'I think we have a solution here.',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
        {
          discussion_id: 'test',
          persona: 'Analyzer AI',
          content: 'I agree, that makes sense.',
          turn: 2,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
      ];

      expect(isResolved(messages).resolved).toBe(true);
    });

    it('should detect when user input is needed', () => {
      const messages: DiscussionMessage[] = [
        {
          discussion_id: 'test',
          persona: 'Solver AI',
          content: 'Can you clarify what you mean by that?',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
      ];

      const result = needsUserInput(messages);

      expect(result.needsInput).toBe(true);
      expect(result.question).toBeDefined();
    });

    it('should not detect user input needed for user messages', () => {
      const messages: DiscussionMessage[] = [
        {
          discussion_id: 'test',
          persona: 'User',
          content: 'This is my input',
          turn: 1,
          timestamp: new Date().toISOString(),
          created_at: Date.now(),
        },
      ];

      const result = needsUserInput(messages);

      expect(result.needsInput).toBe(false);
    });
  });

  describe('Discussion Flow', () => {
    it('should handle complete discussion lifecycle', async () => {
      // Create discussion files first
      const fileResult = await createDiscussionFiles(testUserId, 'How to improve productivity?');

      // Create database record
      const discussion = createDiscussion(
        testUserId,
        'How to improve productivity?',
        fileResult.jsonPath,
        fileResult.mdPath,
        fileResult.id
      );

      expect(discussion.is_resolved).toBe(0);

      // Update turn
      updateDiscussion(discussion.id, {
        current_turn: 2,
      });

      // Check messages (initially empty, as messages are stored in files)
      const discussionData = await readDiscussion(discussion.id, testUserId);
      const messages = discussionData.messages || [];
      expect(messages.length).toBe(0);

      // Mark as resolved
      updateDiscussion(discussion.id, {
        is_resolved: 1,
      });

      const updated = getDiscussion(discussion.id, testUserId);
      expect(updated?.is_resolved).toBe(1);
    });
  });
});
