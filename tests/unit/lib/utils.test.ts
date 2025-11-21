import { describe, it, expect } from 'vitest';
import { sanitizeFilename, getFileMediaType, cn } from '@/lib/utils';

describe('Utils', () => {
  describe('sanitizeFilename', () => {
    it('should sanitize filenames with special characters', () => {
      expect(sanitizeFilename('file name (1).pdf')).toBe('file_name__1_.pdf');
      expect(sanitizeFilename('test@file#name$.txt')).toBe('test_file_name_.txt');
      expect(sanitizeFilename('normal-file.pdf')).toBe('normal-file.pdf');
    });

    it('should preserve alphanumeric characters, dots, and dashes', () => {
      expect(sanitizeFilename('my-file_v2.0.pdf')).toBe('my-file_v2.0.pdf');
      expect(sanitizeFilename('123-test.456')).toBe('123-test.456');
    });
  });

  describe('getFileMediaType', () => {
    it('should return image type for images', () => {
      const imageFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
      expect(getFileMediaType(imageFile)).toBe('image/jpeg');

      const pngFile = new File([''], 'test.png', { type: 'image/png' });
      expect(getFileMediaType(pngFile)).toBe('image/png');
    });

    it('should return PDF type for PDFs', () => {
      const pdfFile = new File([''], 'test.pdf', { type: 'application/pdf' });
      expect(getFileMediaType(pdfFile)).toBe('application/pdf');
    });

    it('should return octet-stream for unknown types', () => {
      const unknownFile = new File([''], 'test.xyz', { type: 'application/unknown' });
      expect(getFileMediaType(unknownFile)).toBe('application/octet-stream');
    });
  });

  describe('cn (className utility)', () => {
    it('should merge class names', () => {
      const result = cn('base-class', 'additional-class');
      expect(result).toContain('base-class');
      expect(result).toContain('additional-class');
    });

    it('should handle conditional classes', () => {
      const result = cn('base', true && 'conditional', false && 'not-included');
      expect(result).toContain('base');
      expect(result).toContain('conditional');
      expect(result).not.toContain('not-included');
    });
  });
});
