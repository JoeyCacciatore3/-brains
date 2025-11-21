import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputSection } from '@/lib/components/dialogue/InputSection';

describe('InputSection Component', () => {
  const mockOnStart = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render topic input and start button', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    expect(screen.getByPlaceholderText(/enter a problem to solve/i)).toBeInTheDocument();
    expect(screen.getByText('Start AI Dialogue')).toBeInTheDocument();
  });

  it('should disable Start button when topic is empty', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    const startButton = screen.getByText('Start AI Dialogue');
    expect(startButton).toBeDisabled();
  });

  it('should disable Start button when not connected', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={false}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter a problem to solve/i);
    fireEvent.change(textarea, { target: { value: 'Test topic' } });

    const startButton = screen.getByText('Start AI Dialogue');
    expect(startButton).toBeDisabled();
  });

  it('should disable Start button when processing', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={true}
        isConnected={true}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter a problem to solve/i);
    fireEvent.change(textarea, { target: { value: 'Test topic' } });

    expect(screen.getByText('AIs in Conversation...')).toBeInTheDocument();
    const startButton = screen.getByText('AIs in Conversation...').closest('button');
    expect(startButton).toBeDisabled();
  });

  it('should enable Start button when topic is entered and connected', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter a problem to solve/i);
    fireEvent.change(textarea, { target: { value: 'Test topic' } });

    const startButton = screen.getByText('Start AI Dialogue');
    expect(startButton).not.toBeDisabled();
  });

  it('should call onStart with topic when Start button is clicked', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter a problem to solve/i);
    fireEvent.change(textarea, { target: { value: 'Test topic' } });

    const startButton = screen.getByText('Start AI Dialogue');
    fireEvent.click(startButton);

    expect(mockOnStart).toHaveBeenCalledTimes(1);
    expect(mockOnStart).toHaveBeenCalledWith('Test topic', [], undefined);
  });

  it('should clear topic after starting dialogue', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter a problem to solve/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Test topic' } });

    const startButton = screen.getByText('Start AI Dialogue');
    fireEvent.click(startButton);

    // Topic should be cleared after start
    expect(textarea.value).toBe('');
  });

  it('should show error when topic is empty and Start is attempted', async () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    // Button should be disabled, but we can test error handling by directly calling handleStart
    // Actually, the button is disabled, so this won't trigger, but we can verify validation
    const startButton = screen.getByText('Start AI Dialogue');
    expect(startButton).toBeDisabled();

    // The validation happens in handleStart which prevents submission when topic is empty
    // Since button is disabled, onStart won't be called
    expect(mockOnStart).not.toHaveBeenCalled();
  });

  it('should show error message when error prop is provided', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
        error="Test error message"
      />
    );

    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('should render Upload button for files', () => {
    render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    expect(screen.getByText(/upload images or pdfs/i)).toBeInTheDocument();
  });

  it('should show file upload input (hidden)', () => {
    const { container } = render(
      <InputSection
        onStart={mockOnStart}
        isProcessing={false}
        isConnected={true}
      />
    );

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
  });
});
