'use client';

import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import type { ConversationMessage, StreamingMode } from '@/types';
import { cn } from '@/lib/utils';
import { clientLogger } from '@/lib/client-logger';

interface MessageBubbleProps {
  message: ConversationMessage;
  streamingContent?: string;
  streamingMode?: StreamingMode;
  isStreaming?: boolean;
}

  // DOMPurify type definitions (moved inside component to avoid duplicate declaration)

export function MessageBubble({
  message,
  streamingContent,
  streamingMode = 'message-by-message',
  isStreaming = false,
}: MessageBubbleProps) {
  // DOMPurify config type
  interface DOMPurifyConfig {
    KEEP_CONTENT?: boolean;
    ALLOWED_TAGS?: string[];
    ALLOW_DATA_ATTR?: boolean;
  }

  // DOMPurify instance type
  interface DOMPurifyInstance {
    sanitize: (dirty: string, config?: DOMPurifyConfig) => string;
  }

  // Type guard for DOMPurify instance
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function // eslint-disable-next-line @typescript-eslint/no-unused-vars
_isDOMPurifyInstance(obj: unknown): obj is DOMPurifyInstance {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'sanitize' in obj &&
      typeof (obj as { sanitize: unknown }).sanitize === 'function'
    );
  }

  // Store DOMPurify instance in state (loaded dynamically on client side only)
  const [domPurify, setDomPurify] = useState<DOMPurifyInstance | null>(null);

  // Load DOMPurify dynamically on client side only
  useEffect(() => {
    // Only run on client side
    if (typeof window !== 'undefined') {
      import('isomorphic-dompurify')
        .then((module) => {
          try {
            // isomorphic-dompurify exports DOMPurify directly as a function with sanitize method
            // The module itself IS the DOMPurify instance (not module.default)
            const domPurify = module.default || module;

            // DOMPurify is a function that also has a sanitize method
            if (domPurify && typeof domPurify.sanitize === 'function') {
              setDomPurify(domPurify as DOMPurifyInstance);
            } else {
              clientLogger.error('DOMPurify does not have sanitize method', {
                moduleType: typeof domPurify,
                hasDefault: !!module.default,
                hasSanitize: typeof domPurify?.sanitize,
                moduleKeys: Object.keys(module || {}).slice(0, 5),
              });
            }
          } catch (error) {
            clientLogger.error('Error initializing DOMPurify', {
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue without DOMPurify - React's default escaping will still protect
          }
        })
        .catch((error) => {
          clientLogger.error('Failed to load DOMPurify', {
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue without DOMPurify - React's default escaping will still protect
        });
    }
  }, []);

  // Defensive checks: handle undefined/null message or missing properties
  if (!message) {
    return (
      <div className="rounded border-2 border-red-500 mb-3 p-3 bg-black/50">
        <p className="text-red-400 text-sm">Error: Message data is missing</p>
      </div>
    );
  }

  // Validate message structure
  if (typeof message.content !== 'string') {
    return (
      <div className="rounded border-2 border-yellow-500 mb-3 p-3 bg-black/50">
        <p className="text-yellow-400 text-sm">
          Warning: Message content is invalid (persona: {message.persona || 'unknown'})
        </p>
      </div>
    );
  }

  // Handle streaming display
  // Sanitize content with DOMPurify for XSS protection
  // DOMPurify provides additional protection beyond React's default escaping
  const rawContent = isStreaming && streamingContent ? streamingContent : message.content || '';

  // Sanitize content with DOMPurify if available, otherwise use raw content
  // During SSR/hydration, DOMPurify may not be loaded yet, so we fallback to raw content
  // React's default escaping still provides protection
  let displayContent: string;
  if (domPurify && typeof domPurify.sanitize === 'function') {
    try {
      // DOMPurify preserves text content while removing XSS vectors
      displayContent = domPurify.sanitize(rawContent, {
        // Preserve whitespace and formatting
        KEEP_CONTENT: true,
        // Allow text nodes but strip HTML tags
        ALLOWED_TAGS: [],
        // Preserve text formatting characters
        ALLOW_DATA_ATTR: false,
      });
    } catch (error) {
      // If sanitization fails, fallback to raw content
      clientLogger.error('DOMPurify sanitization failed', {
        error: error instanceof Error ? error.message : String(error),
        contentLength: rawContent.length,
      });
      displayContent = rawContent;
    }
  } else {
    // Fallback during SSR or before DOMPurify loads
    // React's default escaping will still protect against XSS
    displayContent = rawContent;
  }

  // Check if message appears incomplete (doesn't end with sentence-ending punctuation)
  // Only show incomplete indicator if content is very short or ends with incomplete patterns
  const trimmedContent = displayContent.trim();
  const endsWithPunctuation = /[.!?]\s*$/.test(trimmedContent);
  // More lenient check: only flag as incomplete if it's very short or ends with incomplete patterns
  const endsWithIncompletePattern = /(and|or|but|so|because|since|when|where|while|if|that|which|who|what|how|why|is|are|was|were|has|have|had|will|would|should|could|can|may|might|to|for|with|from|by|at|in|on|of|about|into|onto|upon|,|:|;|-)\s*$/i.test(trimmedContent);
  const appearsIncomplete = !isStreaming && !endsWithPunctuation && (trimmedContent.length < 20 || endsWithIncompletePattern);

  const persona = message.persona || 'Unknown';
  const turn = message.turn || 0;
  // Note: getPersonaStyles returns color, textColor, bgColor but we're using a custom design
  // const { color, textColor, bgColor } = getPersonaStyles(persona);

  // Note: Reading time calculation available for future use
  // const wordCount = displayContent.split(/\s+/).filter(Boolean).length;
  // const estimatedReadingTime = Math.ceil(wordCount / 200); // Average reading speed

  return (
    <div
      className={cn(
        'rounded-lg border border-gray-600/50 mb-3 transition-all duration-300 bg-gray-800/50',
        isStreaming ? 'animate-fade-in' : 'animate-fade-in',
        'h-[250px] min-h-[250px] flex flex-col'
      )}
    >
      <div className="flex items-center gap-2 p-2 border-b border-gray-600/50 flex-shrink-0">
        <div
          className={cn('w-2 h-2 rounded-full bg-green-500', isStreaming && 'animate-pulse-slow')}
        ></div>
        <span className="font-bold text-white text-sm">{persona}</span>
        {persona === 'Analyzer AI' && (
          <div className="relative group">
            <HelpCircle className="w-3.5 h-3.5 text-green-500 cursor-help" />
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800/95 text-white text-xs rounded-lg shadow-lg z-50 border border-gray-600/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none max-w-xs text-center">
              Examines assumptions, explores implications, and challenges ideas to deepen understanding
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800/95"></div>
            </div>
          </div>
        )}
        {persona === 'Solver AI' && (
          <div className="relative group">
            <HelpCircle className="w-3.5 h-3.5 text-green-500 cursor-help" />
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800/95 text-white text-xs rounded-lg shadow-lg z-50 border border-gray-600/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none max-w-xs text-center">
              Focuses on practical solutions, implementation, and breaking down problems systematically
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800/95"></div>
            </div>
          </div>
        )}
        {persona === 'Moderator AI' && (
          <div className="relative group">
            <HelpCircle className="w-3.5 h-3.5 text-green-500 cursor-help" />
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800/95 text-white text-xs rounded-lg shadow-lg z-50 border border-gray-600/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none max-w-xs text-center">
              Synthesizes ideas, bridges viewpoints, and guides the discussion toward actionable conclusions
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-800/95"></div>
            </div>
          </div>
        )}
        {persona !== 'User' && <span className="text-gray-400 text-xs">• Exchange {turn}</span>}
        {isStreaming && (
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs">•</span>
            <span className="text-gray-400 text-xs animate-pulse-slow">Typing</span>
            <span className="flex gap-0.5">
              <span
                className="w-1 h-1 bg-green-500 rounded-full animate-pulse"
                style={{ animationDelay: '0ms' }}
              ></span>
              <span
                className="w-1 h-1 bg-green-500 rounded-full animate-pulse"
                style={{ animationDelay: '150ms' }}
              ></span>
              <span
                className="w-1 h-1 bg-green-500 rounded-full animate-pulse"
                style={{ animationDelay: '300ms' }}
              ></span>
            </span>
          </div>
        )}
      </div>
      <div className="relative flex-1 overflow-y-auto p-3 min-h-0" style={{ scrollbarWidth: 'thin', scrollbarColor: '#22c55e #000' }}>
        <p
          className={cn(
            'text-white text-sm leading-relaxed whitespace-pre-wrap transition-opacity duration-200',
            isStreaming && streamingMode === 'word-by-word' && 'animate-shimmer'
          )}
        >
          {displayContent}
          {isStreaming && streamingMode === 'word-by-word' && (
            <span className="inline-block w-0.5 h-4 bg-green-500 ml-1 align-middle animate-typing-cursor"></span>
          )}
          {appearsIncomplete && (
            <span className="inline-block ml-1 text-yellow-400 text-xs" title="Message may be incomplete">
              ...
            </span>
          )}
        </p>
        {isStreaming && streamingMode === 'message-by-message' && displayContent.length > 0 && (
          <div className="mt-2 h-1 bg-gray-700/50 rounded-full overflow-hidden border border-gray-600/50">
            <div
              className="h-full bg-gray-500 rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, (displayContent.length / 400) * 100)}%`,
              }}
            ></div>
          </div>
        )}
      </div>
    </div>
  );
}
