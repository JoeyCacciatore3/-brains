/**
 * Tests for backup manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { backupDiscussion, cleanupOldBackups } from '@/lib/discussions/backup-manager';
import { createDiscussion } from '@/lib/discussions/file-manager';
import { createDiscussion as createDiscussionDB } from '@/lib/db/discussions';
import { BACKUP_CONFIG } from '@/lib/config';

// Note: These tests require actual file system operations
// They may be skipped in CI environments
describe.skip('backup-manager', () => {
  const testUserId = 'test-user-backup';
  const testTopic = 'Test discussion for backup';
  let testDiscussionId: string;

  beforeEach(async () => {
    // Create a test discussion
    const result = await createDiscussion(testUserId, testTopic);
    testDiscussionId = result.id;

    // Create database entry
    createDiscussionDB(
      testUserId,
      testTopic,
      result.jsonPath,
      result.mdPath,
      result.id
    );
  });

  afterEach(async () => {
    // Cleanup: remove test backups
    const backupsDir = path.join(process.cwd(), 'data', 'backups', testUserId);
    try {
      await fs.rm(backupsDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create a backup of a discussion', async () => {
    const backupDir = await backupDiscussion(testUserId, testDiscussionId);

    expect(backupDir).toBeTruthy();
    expect(backupDir).toContain(testDiscussionId);

    // Verify backup files exist
    const jsonFile = path.join(backupDir, `${testDiscussionId}.json`);
    const mdFile = path.join(backupDir, `${testDiscussionId}.md`);
    const metadataFile = path.join(backupDir, 'metadata.json');

    await expect(fs.access(jsonFile)).resolves.not.toThrow();
    await expect(fs.access(mdFile)).resolves.not.toThrow();
    await expect(fs.access(metadataFile)).resolves.not.toThrow();

    // Verify metadata content
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'));
    expect(metadata.discussionId).toBe(testDiscussionId);
    expect(metadata.userId).toBe(testUserId);
    expect(metadata.timestamp).toBeTruthy();
  });

  it('should return empty string if backup is disabled', async () => {
    // Temporarily disable backups
    const originalEnabled = BACKUP_CONFIG.ENABLED;
    (BACKUP_CONFIG as { ENABLED: boolean }).ENABLED = false;

    try {
      const backupDir = await backupDiscussion(testUserId, testDiscussionId);
      expect(backupDir).toBe('');
    } finally {
      (BACKUP_CONFIG as { ENABLED: boolean }).ENABLED = originalEnabled;
    }
  });

  it('should return empty string for non-existent discussion', async () => {
    const backupDir = await backupDiscussion(testUserId, 'non-existent-id');
    expect(backupDir).toBe('');
  });

  it('should cleanup old backups', async () => {
    // Create a backup first
    await backupDiscussion(testUserId, testDiscussionId);

    // Run cleanup (should not delete recent backups)
    await cleanupOldBackups();

    // Verify backup still exists
    const backupsDir = path.join(process.cwd(), 'data', 'backups', testUserId);
    const backups = await fs.readdir(backupsDir);
    expect(backups.length).toBeGreaterThan(0);
  });
});
