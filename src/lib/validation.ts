import { z } from 'zod';

// UUID validation regex (RFC 4122)
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// File size limits (in bytes)
export const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
export const BASE64_SIZE_LIMIT = 15 * 1024 * 1024; // 15MB (base64 encoding increases size by ~33%)

// Valid file types
export const VALID_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

/**
 * Validate file size
 * @param size - File size in bytes
 * @param isBase64 - Whether this is base64-encoded size (uses larger limit)
 * @returns Object with isValid flag and error message if invalid
 */
export function validateFileSize(size: number, isBase64 = false): {
  isValid: boolean;
  error?: string;
} {
  const limit = isBase64 ? BASE64_SIZE_LIMIT : FILE_SIZE_LIMIT;
  const limitMB = limit / (1024 * 1024);

  if (size > limit) {
    return {
      isValid: false,
      error: `File size exceeds the ${limitMB}MB limit. Please use a smaller file.`,
    };
  }

  return { isValid: true };
}

/**
 * Validate file type
 * @param type - MIME type
 * @returns Object with isValid flag and error message if invalid
 */
export function validateFileType(type: string): { isValid: boolean; error?: string } {
  if (!VALID_FILE_TYPES.includes(type)) {
    return {
      isValid: false,
      error: `Invalid file type. Only images (JPEG, PNG, WebP, GIF) and PDFs are allowed.`,
    };
  }

  return { isValid: true };
}

/**
 * Validate file (size and type)
 * @param file - File data
 * @param isBase64 - Whether to check base64 size limit
 * @returns Object with isValid flag and error message if invalid
 */
export function validateFile(
  file: { name: string; type: string; size: number },
  isBase64 = false
): { isValid: boolean; error?: string } {
  // Validate file type
  const typeValidation = validateFileType(file.type);
  if (!typeValidation.isValid) {
    return typeValidation;
  }

  // Validate file size
  const sizeValidation = validateFileSize(file.size, isBase64);
  if (!sizeValidation.isValid) {
    return sizeValidation;
  }

  return { isValid: true };
}

// UUID validation schema
export const discussionIdSchema = z.string().regex(uuidRegex, 'Invalid discussion ID format');

// Base64 validation regex (strict format)
const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate base64 string format
 * @param base64 - Base64 string to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validateBase64Format(base64: string): { isValid: boolean; error?: string } {
  // Remove data URI prefix if present for validation
  const cleanBase64 = base64.replace(/^data:[^;]*;base64,/, '');

  if (!base64Regex.test(cleanBase64)) {
    return {
      isValid: false,
      error: 'Invalid base64 format. Base64 strings must contain only A-Z, a-z, 0-9, +, /, and = padding characters.',
    };
  }

  // Check length is multiple of 4 (base64 requirement)
  if (cleanBase64.length % 4 !== 0) {
    return {
      isValid: false,
      error: 'Invalid base64 format. Length must be a multiple of 4.',
    };
  }

  return { isValid: true };
}

export const fileDataSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string(),
  size: z.number().max(FILE_SIZE_LIMIT), // 10MB max
  base64: z
    .string()
    .optional()
    .refine(
      (val) => !val || validateBase64Format(val).isValid,
      {
        message: 'Invalid base64 format',
      }
    ),
});

export const dialogueRequestSchema = z.object({
  topic: z
    .string()
    .min(10, 'Topic must be at least 10 characters')
    .max(1000, 'Topic must be less than 1000 characters'),
  files: z.array(fileDataSchema).max(5, 'Maximum 5 files allowed').optional(),
  userId: z.string().regex(uuidRegex, 'Invalid user ID format').optional(),
});

export const userInputSchema = z.object({
  discussionId: discussionIdSchema, // Required: discussionId is the primary identifier
  input: z.string().min(1, 'Input is required'),
});

/**
 * Sanitize file name to prevent path traversal attacks
 * @param fileName - Original file name
 * @returns Sanitized file name safe for use in file system
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') {
    return 'file';
  }

  // Remove path traversal sequences
  let sanitized = fileName
    .replace(/\.\./g, '') // Remove .. sequences
    .replace(/\.\.\\/g, '') // Remove ..\ sequences
    .replace(/\.\.\//g, '') // Remove ../ sequences
    .replace(/[/\\]/g, '_'); // Replace path separators with underscore

  // Remove or escape special characters that could be dangerous
  // Keep alphanumeric, dots, hyphens, underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  // Enforce max length (255 chars is typical filesystem limit)
  if (sanitized.length > 255) {
    const ext = sanitized.substring(sanitized.lastIndexOf('.'));
    const name = sanitized.substring(0, sanitized.lastIndexOf('.'));
    sanitized = name.substring(0, 255 - ext.length) + ext;
  }

  // Ensure we have a valid name
  if (!sanitized || sanitized.length === 0) {
    sanitized = 'file';
  }

  return sanitized;
}

export type DialogueRequest = z.infer<typeof dialogueRequestSchema>;
export type FileData = z.infer<typeof fileDataSchema>;
export type UserInputRequest = z.infer<typeof userInputSchema>;
