'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { File, Image, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/lib/components/ui/Button';
import { LoadingSpinner } from '@/lib/components/ui/LoadingSpinner';
import { getFileMediaType, sanitizeFilename } from '@/lib/utils';
import { clientLogger } from '@/lib/client-logger';
import type { FileData } from '@/lib/validation';

interface InputSectionProps {
  onStart: (topic: string, files: FileData[], userId?: string) => void;
  isProcessing: boolean;
  isConnected?: boolean;
  error?: string;
  userId?: string;
}

interface EncodingProgress {
  fileIndex: number;
  totalFiles: number;
  progress: number;
  fileName: string;
}

export function InputSection({
  onStart,
  isProcessing,
  isConnected = true,
  error: externalError,
  userId,
}: InputSectionProps) {
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isEncoding, setIsEncoding] = useState(false);
  const [_encodingProgress, setEncodingProgress] = useState<EncodingProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Calculate if button should be disabled - use useMemo to ensure proper reactivity
  const isButtonDisabled = useMemo(() => {
    const disabled = isProcessing || isEncoding || !topic.trim() || !isConnected;
    // Debug logging in development
    if (process.env.NODE_ENV === 'development') {
      clientLogger.debug('InputSection button disabled check', {
        isProcessing,
        isEncoding,
        topicLength: topic.length,
        topicTrimmed: topic.trim().length,
        topicValue: topic,
        isConnected: isConnected,
        disabled: disabled
      });
    }
    return disabled;
  }, [isProcessing, isEncoding, topic, isConnected]);

  // Combine external and local errors
  const error = externalError || localError;

  // Clear local error when external error changes (new error from parent)
  useEffect(() => {
    if (externalError) {
      setLocalError(null);
    }
  }, [externalError]);

  // Clear local error when topic changes (user is fixing the issue)
  useEffect(() => {
    if (localError && topic.trim()) {
      // Don't auto-clear, let user see the error until they try again
    }
  }, [topic, localError]);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const minHeight = 56; // ~3.5rem (56px) for slim initial height
      const maxHeight = 300; // Max height before scrolling
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [topic]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(e.target.files || []);

    // Validate file types
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const errors: string[] = [];
    const validFiles: File[] = [];

    uploadedFiles.forEach((file) => {
      // Check if file is empty
      if (file.size === 0) {
        errors.push(`File "${file.name}" is empty and cannot be uploaded.`);
        return;
      }

      // Validate file type
      if (!validTypes.includes(file.type)) {
        errors.push(
          `File "${file.name}" has an invalid type (${file.type || 'unknown'}). Only images (JPEG, PNG, WebP, GIF) and PDFs are allowed.`
        );
        return;
      }

      // Validate file size
      if (file.size > 10 * 1024 * 1024) {
        errors.push(
          `File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 10MB.`
        );
        return;
      }

      validFiles.push(file);
    });

    // Show errors if any
    if (errors.length > 0) {
      setLocalError(errors.join(' '));
    }

    // Add valid files, respecting max limit
    setFiles((prev) => {
      const combined = [...prev, ...validFiles];
      if (combined.length > 5) {
        setLocalError(`Maximum 5 files allowed. Only the first 5 files will be used.`);
        return combined.slice(0, 5);
      }
      // Show success toast when files are added
      if (validFiles.length > 0) {
        toast.success(
          `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} added successfully!`,
          {
            icon: '📎',
          }
        );
      }
      return combined;
    });

    // Reset file input to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // @ts-ignore - intentionally unused
  const _removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * Encode a single file using Web Worker
   */
  const encodeFileWithWorker = (
    file: File,
    fileIndex: number,
    totalFiles: number
  ): Promise<{ base64: string; fileName: string; fileSize: number }> => {
    return new Promise((resolve, reject) => {
      // Create worker if it doesn't exist
      if (!workerRef.current) {
        workerRef.current = new Worker('/workers/file-encoder.worker.js');
      }

      const worker = workerRef.current;

      // Set up message handler
      const handleMessage = (event: MessageEvent) => {
        const {
          type,
          fileIndex: msgFileIndex,
          fileName,
          progress,
          base64,
          fileSize,
          error,
        } = event.data;

        // Only process messages for this file
        if (msgFileIndex !== fileIndex) {
          return;
        }

        if (type === 'progress') {
          setEncodingProgress({
            fileIndex: msgFileIndex,
            totalFiles,
            progress,
            fileName,
          });
        } else if (type === 'success') {
          worker.removeEventListener('message', handleMessage);
          resolve({ base64, fileName, fileSize });
        } else if (type === 'error') {
          worker.removeEventListener('message', handleMessage);
          reject(new Error(error || 'Failed to encode file'));
        }
      };

      worker.addEventListener('message', handleMessage);

      // Send file to worker
      worker.postMessage({
        file,
        fileIndex,
        totalFiles,
      });
    });
  };

  const handleStart = async () => {
    // Clear any previous errors
    setLocalError(null);

    if (!topic.trim()) {
      setLocalError('Please enter a topic to start the dialogue.');
      return;
    }

    if (!isConnected) {
      setLocalError('Not connected to server. Please wait for connection or refresh the page.');
      return;
    }

    // If no files, start immediately
    if (files.length === 0) {
      onStart(topic, [], userId);
      setTopic('');
      return;
    }

    try {
      setIsEncoding(true);
      setEncodingProgress(null);

      // Process files to base64 using Web Worker
      const processedFiles: FileData[] = [];
      const MAX_BASE64_SIZE = 15 * 1024 * 1024; // 15MB for base64-encoded files (10MB file becomes ~13.3MB)

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          // Validate file before processing
          if (!file || file.size === 0) {
            setLocalError(`File "${file.name}" is empty and cannot be processed.`);
            setIsEncoding(false);
            setEncodingProgress(null);
            return;
          }

          // Encode file using Web Worker
          const { base64, fileName, fileSize } = await encodeFileWithWorker(file, i, files.length);

          // Validate base64 result
          if (!base64 || base64.length === 0) {
            setLocalError(`Failed to encode file "${fileName}". The file may be corrupted.`);
            setIsEncoding(false);
            setEncodingProgress(null);
            return;
          }

          // Validate base64 size after encoding
          if (base64.length > MAX_BASE64_SIZE) {
            setLocalError(
              `File "${fileName}" exceeds size limit after encoding (${(base64.length / 1024 / 1024).toFixed(2)}MB). Maximum size is 10MB.`
            );
            setIsEncoding(false);
            setEncodingProgress(null);
            return;
          }

          // Validate filename after sanitization
          const sanitizedName = sanitizeFilename(fileName);
          if (!sanitizedName || sanitizedName.length === 0) {
            setLocalError(`File "${fileName}" has an invalid name after sanitization.`);
            setIsEncoding(false);
            setEncodingProgress(null);
            return;
          }

          processedFiles.push({
            name: sanitizedName,
            type: getFileMediaType(file),
            size: fileSize,
            base64,
          });
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : 'Unknown error';
          setLocalError(
            `Failed to process file "${file.name}": ${errorMessage}. Please try a different file.`
          );
          setIsEncoding(false);
          setEncodingProgress(null);
          return;
        }
      }

      setIsEncoding(false);
      setEncodingProgress(null);

      // Clear topic and files after successful start
      onStart(topic, processedFiles, userId);
      setTopic('');
      setFiles([]);
    } catch (error) {
      setIsEncoding(false);
      setEncodingProgress(null);
      setLocalError(
        `Failed to start dialogue: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`
      );
    }
  };

  return (
    <div className="bg-transparent rounded px-6 pt-6 pb-0 mb-0">
      <div className="mb-2">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={topic}
            onChange={(e) => {
              const newValue = e.target.value;
              setTopic(newValue);
              // Debug logging in development
              if (process.env.NODE_ENV === 'development') {
                clientLogger.debug('InputSection topic changed via onChange', {
                  newValue,
                  length: newValue.length,
                });
              }
            }}
            onInput={(e) => {
              // Fallback handler for cases where onChange might not fire (e.g., browser automation)
              const newValue = (e.target as HTMLTextAreaElement).value;
              if (newValue !== topic) {
                setTopic(newValue);
                // Debug logging in development
                if (process.env.NODE_ENV === 'development') {
                  clientLogger.debug('InputSection topic changed via onInput', {
                    newValue,
                    length: newValue.length,
                    oldTopic: topic,
                  });
                }
              }
            }}
            placeholder="Enter a problem to solve, question to analyze, or situation to explore..."
            className="w-full p-4 pr-20 rounded-lg bg-gray-800/50 border border-gray-600/50 text-white placeholder-gray-400 focus:outline-none focus:border-gray-500 focus:bg-gray-800/70 transition-all resize-none overflow-y-auto"
            style={{ minHeight: '56px', maxHeight: '300px' }}
            disabled={isProcessing}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,.pdf"
              disabled={isProcessing}
            />
            <button
              type="button"
              onClick={() => {
                // Create a PDF-only input element
                const pdfInput = document.createElement('input');
                pdfInput.type = 'file';
                pdfInput.accept = '.pdf';
                pdfInput.multiple = true;
                pdfInput.onchange = (e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.files && target.files.length > 0) {
                    const fileList = new DataTransfer();
                    Array.from(target.files).forEach((file) => fileList.items.add(file));
                    if (fileInputRef.current) {
                      fileInputRef.current.files = fileList.files;
                      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }
                };
                pdfInput.click();
              }}
              disabled={isProcessing}
              className="text-green-500 hover:text-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Upload PDFs"
            >
              <File className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                // Create an image-only input element
                const imageInput = document.createElement('input');
                imageInput.type = 'file';
                imageInput.accept = 'image/*';
                imageInput.multiple = true;
                imageInput.onchange = (e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.files && target.files.length > 0) {
                    const fileList = new DataTransfer();
                    Array.from(target.files).forEach((file) => fileList.items.add(file));
                    if (fileInputRef.current) {
                      fileInputRef.current.files = fileList.files;
                      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }
                };
                imageInput.click();
              }}
              disabled={isProcessing}
              className="text-green-500 hover:text-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Upload images"
            >
              <Image className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex justify-end mt-1">
          <Button
            onClick={handleStart}
            disabled={isButtonDisabled}
            className="px-4 py-2 text-sm"
          >
            {isEncoding ? (
              <>
                <LoadingSpinner className="w-4 h-4" />
                Encoding...
              </>
            ) : isProcessing ? (
              <>
                <LoadingSpinner className="w-4 h-4" />
                Processing...
              </>
            ) : (
              'Start Discussion'
            )}
          </Button>
        </div>
        {files.length > 0 && (
          <div className="mt-2 text-xs text-green-500">
            {files.length} file{files.length !== 1 ? 's' : ''} attached
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-black border-2 border-green-500 rounded flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-white text-sm block mb-2">{error}</span>
            <div className="flex gap-2">
              {localError && (
                <button
                  onClick={() => setLocalError(null)}
                  className="text-green-500 hover:text-green-400 text-xs underline"
                  type="button"
                >
                  Dismiss
                </button>
              )}
              {error.includes('connection') ||
              error.includes('network') ||
              error.includes('server') ? (
                <button
                  onClick={() => window.location.reload()}
                  className="text-green-500 hover:text-green-400 text-xs underline"
                  type="button"
                >
                  Reload Page
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
