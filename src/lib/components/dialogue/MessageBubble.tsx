'use client';

import type { ConversationMessage, StreamingMode } from '@/types';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: ConversationMessage;
  streamingContent?: string;
  streamingMode?: StreamingMode;
  isStreaming?: boolean;
}

export function MessageBubble({
  message,
  streamingContent,
  streamingMode = 'message-by-message',
  isStreaming = false,
}: MessageBubbleProps) {
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
  // React automatically escapes all text content, providing XSS protection by default
  // No additional sanitization needed since we're not using dangerouslySetInnerHTML
  const displayContent = isStreaming && streamingContent ? streamingContent : message.content || '';

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
        'rounded border-2 border-green-500 mb-3 transition-all duration-300 bg-black/50',
        isStreaming ? 'animate-fade-in' : 'animate-fade-in',
        'max-h-[250px] flex flex-col'
      )}
    >
      <div className="flex items-center gap-2 p-2 border-b border-green-500 flex-shrink-0">
        <div
          className={cn('w-2 h-2 rounded-full bg-green-500', isStreaming && 'animate-pulse-slow')}
        ></div>
        <span className="font-bold text-white text-sm">{persona}</span>
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
      <div className="relative flex-1 overflow-y-auto p-3">
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
        </p>
        {isStreaming && streamingMode === 'message-by-message' && displayContent.length > 0 && (
          <div className="mt-2 h-1 bg-black/50 rounded-full overflow-hidden border border-green-500/50">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-300"
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
