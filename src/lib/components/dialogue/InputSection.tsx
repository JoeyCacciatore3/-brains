'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Upload, X, AlertCircle } from 'lucide-react';
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
  const [encodingProgress, setEncodingProgress] = useState<EncodingProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

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

  const removeFile = (index: number) => {
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
    <div className="bg-black rounded p-6 mb-6 border-2 border-green-500">
      <div className="mb-4">
        <label className="block text-white font-semibold mb-2">Topic or Problem</label>
        <textarea
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
          className="w-full p-4 rounded bg-black border-2 border-green-500 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 min-h-[100px] resize-none"
          disabled={isProcessing}
        />
      </div>

      <div className="mb-4">
        <label className="block text-white font-semibold mb-2">Attach Files (Optional)</label>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileUpload}
          className="hidden"
          accept="image/*,.pdf"
          disabled={isProcessing}
        />
        <Button
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Upload className="w-4 h-4 inline mr-2" />
          Upload Images or PDFs
        </Button>

        {files.length > 0 && (
          <div className="mt-3 space-y-2">
            {files.map((file, index) => (
              <div key={index} className="flex items-center justify-between bg-black p-2 rounded border-2 border-green-500">
                <span className="text-white text-sm truncate flex-1">
                  {sanitizeFilename(file.name)}
                </span>
                <button
                  onClick={() => removeFile(index)}
                  className="text-green-500 hover:text-green-400 text-sm ml-2"
                  disabled={isProcessing}
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* File Encoding Progress */}
      {isEncoding && encodingProgress && (
        <div className="mb-4 p-3 bg-black border-2 border-green-500 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white text-sm">
              Encoding file {encodingProgress.fileIndex + 1} of {encodingProgress.totalFiles}:{' '}
              {encodingProgress.fileName}
            </span>
            <span className="text-green-500 text-sm font-semibold">
              {encodingProgress.progress}%
            </span>
          </div>
          <div className="w-full bg-black rounded-full h-2 overflow-hidden border border-green-500">
            <div
              className="bg-green-500 h-full rounded-full transition-all duration-300"
              style={{ width: `${encodingProgress.progress}%` }}
            />
          </div>
        </div>
      )}

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

      <Button
        onClick={handleStart}
        disabled={isButtonDisabled}
        className="w-full py-3 flex items-center justify-center gap-2"
      >
        {isEncoding ? (
          <>
            <LoadingSpinner />
            Encoding Files...
          </>
        ) : isProcessing ? (
          <>
            <LoadingSpinner />
            AIs in Conversation...
          </>
        ) : (
          <>Start AI Dialogue</>
        )}
      </Button>
    </div>
  );
}
