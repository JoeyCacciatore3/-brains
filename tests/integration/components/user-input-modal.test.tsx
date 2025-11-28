import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// UserInputModal component no longer exists - test disabled
// import { UserInputModal } from '@/lib/components/dialogue/UserInputModal';

describe.skip('UserInputModal Component', () => {
  const mockOnSubmit = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when isOpen is false', () => {
    render(
      <UserInputModal
        isOpen={false}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.queryByText('Add Your Input')).not.toBeInTheDocument();
  });

  it('should render when isOpen is true', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByText('Add Your Input')).toBeInTheDocument();
  });

  it('should call onClose when Cancel button is clicked', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when X button is clicked', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when Escape key is pressed', async () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('should not call onClose when Escape key is pressed while processing', async () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        isProcessing={true}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    // Wait a bit to ensure the handler doesn't fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should disable Submit button when input is empty', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const submitButton = screen.getByRole('button', { name: /submit input/i });
    expect(submitButton).toBeDisabled();
  });

  it('should disable Submit button when input is less than 10 characters', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: 'short' } });

    const submitButton = screen.getByRole('button', { name: /submit input/i });
    expect(submitButton).toBeDisabled();
  });

  it('should enable Submit button when input is at least 10 characters', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: 'This is a valid input that is long enough' } });

    const submitButton = screen.getByRole('button', { name: /submit input/i });
    expect(submitButton).not.toBeDisabled();
  });

  it('should call onSubmit with trimmed input when form is submitted', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: '  This is valid input with spaces  ' } });

    const form = screen.getByRole('button', { name: /submit input/i }).closest('form');
    if (form) {
      fireEvent.submit(form);
    }

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).toHaveBeenCalledWith('This is valid input with spaces');
  });

  it('should show error message when input is less than 10 characters on submit', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: 'short' } });

    // The button should be disabled, preventing submission
    const submitButton = screen.getByRole('button', { name: /submit input/i });
    expect(submitButton).toBeDisabled();
  });

  it('should show error message when external error prop is provided', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        error="External error message"
      />
    );

    expect(screen.getByText('External error message')).toBeInTheDocument();
  });

  it('should display character count', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: 'Test input' } });

    expect(screen.getByText(/10 \/ 1000 characters/i)).toBeInTheDocument();
  });

  it('should show loading state when isProcessing is true', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        isProcessing={true}
      />
    );

    expect(screen.getByText('Submitting...')).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: /submitting/i });
    expect(submitButton).toBeDisabled();
  });

  it('should disable inputs when isProcessing is true', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
        isProcessing={true}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    const closeButton = screen.getByRole('button', { name: /close/i });

    expect(textarea).toBeDisabled();
    expect(cancelButton).toBeDisabled();
    expect(closeButton).toBeDisabled();
  });

  it('should reset input when modal opens', () => {
    const { rerender } = render(
      <UserInputModal
        isOpen={false}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    rerender(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('should submit on Ctrl+Enter or Cmd+Enter', () => {
    render(
      <UserInputModal
        isOpen={true}
        onClose={mockOnClose}
        onSubmit={mockOnSubmit}
      />
    );

    const textarea = screen.getByPlaceholderText(/enter your input here/i);
    fireEvent.change(textarea, { target: { value: 'This is a valid input' } });

    // Simulate Ctrl+Enter
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    expect(mockOnSubmit).toHaveBeenCalledWith('This is a valid input');
  });
});
