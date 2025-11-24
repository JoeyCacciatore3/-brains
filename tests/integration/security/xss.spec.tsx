/**
 * Security Integration Tests: XSS Protection with DOMPurify
 *
 * Tests XSS sanitization in MessageBubble component
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { MessageBubble } from '@/lib/components/dialogue/MessageBubble';
import type { ConversationMessage } from '@/types';

describe('XSS Protection in MessageBubble', () => {
  const baseMessage: ConversationMessage = {
    persona: 'Solver AI',
    content: '',
    turn: 1,
    timestamp: new Date().toISOString(),
    created_at: Date.now(),
  };

  it('should sanitize script tags', () => {
    const maliciousContent = 'Hello <script>alert("XSS")</script> World';
    const message: ConversationMessage = {
      ...baseMessage,
      content: maliciousContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // Script tags should be removed
    expect(textContent).not.toContain('<script>');
    expect(textContent).not.toContain('alert("XSS")');
    // Text content should be preserved
    expect(textContent).toContain('Hello');
    expect(textContent).toContain('World');
  });

  it('should sanitize event handlers', () => {
    const maliciousContent = 'Click <img src="x" onerror="alert(\'XSS\')" /> me';
    const message: ConversationMessage = {
      ...baseMessage,
      content: maliciousContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // Event handlers should be removed
    expect(textContent).not.toContain('onerror');
    expect(textContent).not.toContain('alert');
  });

  it('should sanitize javascript: URLs', () => {
    const maliciousContent = 'Link <a href="javascript:alert(\'XSS\')">click</a>';
    const message: ConversationMessage = {
      ...baseMessage,
      content: maliciousContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // JavaScript URLs should be removed
    expect(textContent).not.toContain('javascript:');
  });

  it('should preserve normal text content', () => {
    const normalContent = 'This is normal text with no malicious content.';
    const message: ConversationMessage = {
      ...baseMessage,
      content: normalContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // Normal content should be preserved
    expect(textContent).toContain('This is normal text');
    expect(textContent).toContain('no malicious content');
  });

  it('should preserve whitespace and formatting', () => {
    const formattedContent = 'Line 1\nLine 2\n\nLine 3';
    const message: ConversationMessage = {
      ...baseMessage,
      content: formattedContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // Whitespace should be preserved (DOMPurify with KEEP_CONTENT)
    expect(textContent).toContain('Line 1');
    expect(textContent).toContain('Line 2');
    expect(textContent).toContain('Line 3');
  });

  it('should sanitize streaming content', () => {
    const maliciousContent = 'Streaming <script>alert("XSS")</script> content';
    const message: ConversationMessage = {
      ...baseMessage,
      content: 'Original content',
    };

    const { container } = render(
      <MessageBubble message={message} streamingContent={maliciousContent} isStreaming={true} />
    );
    const textContent = container.textContent || '';

    // Script tags should be removed from streaming content
    expect(textContent).not.toContain('<script>');
    expect(textContent).not.toContain('alert("XSS")');
  });

  it('should handle empty content', () => {
    const message: ConversationMessage = {
      ...baseMessage,
      content: '',
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // Should not crash and should handle empty content gracefully
    expect(textContent).toBeDefined();
  });

  it('should sanitize multiple XSS vectors in one message', () => {
    const maliciousContent = `
      <script>alert('XSS1')</script>
      <img src="x" onerror="alert('XSS2')" />
      <a href="javascript:alert('XSS3')">link</a>
      Normal text here
    `;
    const message: ConversationMessage = {
      ...baseMessage,
      content: maliciousContent,
    };

    const { container } = render(<MessageBubble message={message} />);
    const textContent = container.textContent || '';

    // All XSS vectors should be removed
    expect(textContent).not.toContain('<script>');
    expect(textContent).not.toContain('onerror');
    expect(textContent).not.toContain('javascript:');
    expect(textContent).not.toContain('alert');
    // Normal text should be preserved
    expect(textContent).toContain('Normal text here');
  });
});
