/**
 * Tests for Socket.IO acknowledgments
 */

import { describe, it, expect, vi } from 'vitest';

describe('Socket.IO Acknowledgments', () => {
  it('should handle acknowledgment timeout', async () => {
    // Mock socket with delayed acknowledgment
    const mockSocket = {
      emit: vi.fn((_event: string, _data: unknown, _ack?: (response: unknown) => void) => {
        // Simulate timeout by not calling ack
        return mockSocket;
      }),
    };

    // Test timeout handling
    const emitWithAck = <T = unknown>(
      event: string,
      data: unknown,
      timeoutMs: number = 100
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Acknowledgment timeout for event: ${event}`));
        }, timeoutMs);

        mockSocket.emit(event, data, (response: unknown) => {
          clearTimeout(timeout);
          const resp = response as { error?: string; data?: T } | T;
          if (typeof resp === 'object' && resp !== null && 'error' in resp) {
            reject(new Error(resp.error || 'Unknown error'));
          } else {
            resolve((typeof resp === 'object' && resp !== null && 'data' in resp ? resp.data : resp) as T);
          }
        });
      });
    };

    // Test that timeout is handled (with shorter timeout for faster test)
    await expect(emitWithAck('test-event', {}, 100)).rejects.toThrow('Acknowledgment timeout');
  }, 1000);

  it('should handle successful acknowledgment', async () => {
    const mockSocket = {
      emit: vi.fn((_event: string, _data: unknown, ack?: (response: unknown) => void) => {
        // Simulate immediate acknowledgment
        if (ack) {
          setTimeout(() => ack({ data: { success: true } }), 10);
        }
        return mockSocket;
      }),
    };

    const emitWithAck = <T = unknown>(
      event: string,
      data: unknown,
      timeoutMs: number = 5000
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Acknowledgment timeout for event: ${event}`));
        }, timeoutMs);

        mockSocket.emit(event, data, (response: unknown) => {
          clearTimeout(timeout);
          const resp = response as { error?: string; data?: T } | T;
          if (typeof resp === 'object' && resp !== null && 'error' in resp) {
            reject(new Error(resp.error || 'Unknown error'));
          } else {
            resolve((typeof resp === 'object' && resp !== null && 'data' in resp ? resp.data : resp) as T);
          }
        });
      });
    };

    const result = await emitWithAck('test-event', {});
    expect(result).toEqual({ success: true });
  });

  it('should handle error acknowledgment', async () => {
    const mockSocket = {
      emit: vi.fn((_event: string, _data: unknown, ack?: (response: unknown) => void) => {
        // Simulate error acknowledgment
        if (ack) {
          setTimeout(() => ack({ error: 'Validation failed' }), 10);
        }
        return mockSocket;
      }),
    };

    const emitWithAck = <T = unknown>(
      event: string,
      data: unknown,
      timeoutMs: number = 5000
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Acknowledgment timeout for event: ${event}`));
        }, timeoutMs);

        mockSocket.emit(event, data, (response: unknown) => {
          clearTimeout(timeout);
          const resp = response as { error?: string; data?: T } | T;
          if (typeof resp === 'object' && resp !== null && 'error' in resp) {
            reject(new Error(resp.error || 'Unknown error'));
          } else {
            resolve((typeof resp === 'object' && resp !== null && 'data' in resp ? resp.data : resp) as T);
          }
        });
      });
    };

    await expect(emitWithAck('test-event', {})).rejects.toThrow('Validation failed');
  });
});
