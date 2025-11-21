import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { personaDefinitions } from './personas';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate file
    if (!file) {
      reject(new Error('File is null or undefined'));
      return;
    }

    if (file.size === 0) {
      reject(new Error('File is empty'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const result = reader.result;
        if (!result || typeof result !== 'string') {
          reject(new Error('Failed to read file: invalid result'));
          return;
        }

        const parts = result.split(',');
        if (parts.length < 2) {
          reject(new Error('Failed to parse file data'));
          return;
        }

        const base64 = parts[1];
        if (!base64 || base64.length === 0) {
          reject(new Error('Empty base64 data'));
          return;
        }

        resolve(base64);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to process file data'));
      }
    };

    reader.onerror = () => {
      reject(new Error(`File read error: ${reader.error?.message || 'Unknown error'}`));
    };

    reader.onabort = () => {
      reject(new Error('File read was aborted'));
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Failed to start file read'));
    }
  });
}

export function getFileMediaType(file: File): string {
  if (file.type.startsWith('image/')) {
    return file.type;
  }
  if (file.type === 'application/pdf') {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}

/**
 * Get persona styles (color, textColor, bgColor) based on persona name
 * Uses the aiPersonas definitions for consistency
 */
export function getPersonaStyles(persona: string): {
  color: string;
  textColor: string;
  bgColor: string;
} {
  // Find persona by name
  const personaDef = Object.values(personaDefinitions).find((p) => p.name === persona);

  if (personaDef) {
    // Extract color class (e.g., 'bg-blue-500' -> 'blue-500')
    const colorBase = personaDef.color.replace('bg-', '');
    // Construct bgColor with opacity and border (e.g., 'bg-blue-500/10 border-blue-500')
    return {
      color: personaDef.color,
      textColor: personaDef.textColor,
      bgColor: `bg-${colorBase}/10 border-${colorBase}` as string,
    };
  }

  // Default styles for User or unknown personas
  return {
    color: 'bg-gray-500',
    textColor: 'text-gray-400',
    bgColor: 'bg-gray-500/10 border-gray-500',
  };
}
