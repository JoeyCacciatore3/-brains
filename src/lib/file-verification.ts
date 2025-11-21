/**
 * File Content Verification
 *
 * Verifies file content using magic numbers (file signatures) to prevent MIME type spoofing.
 * This ensures that the actual file content matches the declared MIME type.
 */

// Magic numbers (file signatures) for supported file types
const MAGIC_NUMBERS: Record<string, Array<number[]>> = {
  'image/jpeg': [
    [0xff, 0xd8, 0xff], // JPEG standard signature
  ],
  'image/png': [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG signature
  ],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
  ],
  'application/pdf': [
    [0x25, 0x50, 0x44, 0x46], // %PDF
  ],
  'image/webp': [
    // WebP files start with RIFF header, then WEBP
    // First 4 bytes: RIFF (0x52, 0x49, 0x46, 0x46)
    // Bytes 8-11: WEBP (0x57, 0x45, 0x42, 0x50)
    [0x52, 0x49, 0x46, 0x46], // RIFF header (we'll check for WEBP at offset 8)
  ],
};

/**
 * Check if buffer starts with a specific magic number sequence
 */
function bufferStartsWith(buffer: Buffer, magic: number[]): boolean {
  if (buffer.length < magic.length) {
    return false;
  }
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Verify WebP file by checking RIFF header and WEBP identifier
 */
function verifyWebP(buffer: Buffer): boolean {
  // WebP files: RIFF header (bytes 0-3), file size (bytes 4-7), WEBP (bytes 8-11)
  if (buffer.length < 12) {
    return false;
  }

  // Check RIFF header
  const riffMagic = [0x52, 0x49, 0x46, 0x46];
  if (!bufferStartsWith(buffer, riffMagic)) {
    return false;
  }

  // Check WEBP identifier at offset 8
  const webpMagic = [0x57, 0x45, 0x42, 0x50];
  for (let i = 0; i < webpMagic.length; i++) {
    if (buffer[8 + i] !== webpMagic[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Verify file content matches declared MIME type using magic numbers
 * @param buffer - File content as Buffer
 * @param declaredMimeType - MIME type declared by client
 * @returns true if file content matches declared MIME type, false otherwise
 */
export function verifyFileContent(buffer: Buffer, declaredMimeType: string): boolean {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  // Special handling for WebP (requires checking multiple positions)
  if (declaredMimeType === 'image/webp') {
    return verifyWebP(buffer);
  }

  // Get magic numbers for declared MIME type
  const magicNumbers = MAGIC_NUMBERS[declaredMimeType];
  if (!magicNumbers) {
    // If we don't have magic numbers for this type, we can't verify it
    // This is a security risk - we should only allow types we can verify
    return false;
  }

  // Check if buffer starts with any of the valid magic numbers for this type
  for (const magic of magicNumbers) {
    if (bufferStartsWith(buffer, magic)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert base64 string to Buffer for verification
 * @param base64Data - Base64 encoded file data (with or without data URI prefix)
 * @returns Buffer containing file data
 * @throws Error if base64 data is invalid
 */
export function base64ToBuffer(base64Data: string): Buffer {
  // Remove data URI prefix if present
  const base64 = base64Data.replace(/^data:[^;]*;base64,/, '');

  // Validate base64 format
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error('Invalid base64 format');
  }

  try {
    return Buffer.from(base64, 'base64');
  } catch (error) {
    throw new Error(`Failed to decode base64: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verify file from base64 data
 * @param base64Data - Base64 encoded file data
 * @param declaredMimeType - MIME type declared by client
 * @returns true if file content matches declared MIME type
 * @throws Error if base64 data is invalid
 */
export function verifyFileFromBase64(base64Data: string, declaredMimeType: string): boolean {
  const buffer = base64ToBuffer(base64Data);
  return verifyFileContent(buffer, declaredMimeType);
}
