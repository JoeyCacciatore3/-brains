import { logger } from './logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

/**
 * Interface for pdf-parse module
 * Handles both default and named exports
 */
interface PDFParseModule {
  default?: (buffer: Buffer) => Promise<{ text: string }>;
  (buffer: Buffer): Promise<{ text: string }>;
}

/**
 * Check if error is transient (can be retried)
 */
function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  // Transient errors: network issues, timeouts, temporary I/O errors
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    message.includes('temporary')
  );
}

/**
 * Extract text from a PDF file (base64 encoded)
 * Server-side only function - pdf-parse requires Node.js environment
 * Includes retry logic for transient failures
 * @param base64Data - Base64-encoded PDF data (with or without data URI prefix)
 * @returns Extracted text content
 * @throws Error if extraction fails after retries
 */
export async function extractTextFromPDF(base64Data: string): Promise<string> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Dynamic import to ensure pdf-parse is only loaded server-side
      // This prevents Next.js from trying to bundle it for the client
      const pdfParseModule = (await import('pdf-parse')) as unknown as PDFParseModule;
      // Handle both default and named exports - pdf-parse ESM doesn't have default
      const pdfParse = pdfParseModule.default || pdfParseModule;

      // Remove data URI prefix if present
      const base64 = base64Data.replace(/^data:application\/pdf;base64,/, '');

      // Validate base64 data
      if (!base64 || base64.length === 0) {
        throw new Error('Empty or invalid base64 PDF data');
      }

      // Convert base64 to Buffer
      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch (bufferError) {
        throw new Error(
          `Invalid base64 encoding: ${bufferError instanceof Error ? bufferError.message : 'Unknown error'}`
        );
      }

      // Validate buffer size
      if (buffer.length === 0) {
        throw new Error('PDF buffer is empty after base64 decoding');
      }

      // Extract text using pdf-parse
      const data = await pdfParse(buffer);

      if (!data || !data.text) {
        throw new Error('PDF parsing returned no text data');
      }

      if (data.text.trim().length === 0) {
        throw new Error('PDF appears to be empty or contains no extractable text');
      }

      return data.text.trim();
    } catch (error) {
      lastError = error;

      // Check if error is transient and we should retry
      const isTransient = isTransientError(error);
      const isLastAttempt = attempt === MAX_RETRIES;

      if (!isTransient || isLastAttempt) {
        // Permanent error or last attempt - provide specific error message
        let errorMessage = 'Failed to extract text from PDF';
        if (error instanceof Error) {
          if (error.message.includes('empty') || error.message.includes('no extractable text')) {
            errorMessage = 'PDF appears to be empty or contains no extractable text';
          } else if (error.message.includes('corrupted') || error.message.includes('invalid')) {
            errorMessage = 'PDF file appears to be corrupted or invalid';
          } else if (error.message.includes('base64')) {
            errorMessage = 'Invalid PDF data encoding';
          } else {
            errorMessage = `PDF extraction failed: ${error.message}`;
          }
        }

        logger.error('Failed to extract text from PDF (permanent error or max retries)', {
          error: error instanceof Error ? error.message : String(error),
          attempt,
          maxRetries: MAX_RETRIES,
          isTransient,
        });
        throw new Error(errorMessage);
      }

      // Transient error - retry with exponential backoff
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn('PDF extraction failed (transient error), retrying', {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        maxRetries: MAX_RETRIES,
        retryDelay: delay,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error(
    `PDF extraction failed after ${MAX_RETRIES} attempts: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`
  );
}
