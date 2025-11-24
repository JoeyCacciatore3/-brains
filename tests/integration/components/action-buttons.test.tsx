import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActionButtons } from '@/lib/components/dialogue/ActionButtons';

describe('ActionButtons Component', () => {
  const mockOnProceed = vi.fn();
  const mockOnGenerateQuestions = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render all buttons when discussionId is provided', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
      />
    );

    expect(screen.getByText('Proceed')).toBeInTheDocument();
    expect(screen.getByText('Generate Questions')).toBeInTheDocument();
  });

  it('should not render buttons when discussionId is null', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId={null}
        isResolved={false}
        disabled={false}
      />
    );

    expect(screen.queryByText('Proceed')).not.toBeInTheDocument();
  });

  it('should not render buttons when isResolved is true', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={true}
        disabled={false}
      />
    );

    expect(screen.queryByText('Proceed')).not.toBeInTheDocument();
  });

  it('should call onProceed when Proceed button is clicked', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
      />
    );

    const proceedButton = screen.getByText('Proceed');
    fireEvent.click(proceedButton);

    expect(mockOnProceed).toHaveBeenCalledTimes(1);
  });

  it('should call onGenerateQuestions when Generate Questions button is clicked', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
      />
    );

    const generateQuestionsButton = screen.getByText('Generate Questions');
    fireEvent.click(generateQuestionsButton);

    expect(mockOnGenerateQuestions).toHaveBeenCalledTimes(1);
  });

  it('should disable all buttons when isProcessing is true', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
        isProcessing={true}
      />
    );

    const proceedButton = screen.getByText('Processing...').closest('button');
    expect(proceedButton).toBeDisabled();
  });

  it('should show loading state for Generate Questions when isGeneratingQuestions is true', () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
        isGeneratingQuestions={true}
      />
    );

    expect(screen.getByText('Generating...')).toBeInTheDocument();
    const generateQuestionsButton = screen.getByText('Generating...').closest('button');
    expect(generateQuestionsButton).toBeDisabled();
  });

  it('should show tooltip on hover', async () => {
    render(
      <ActionButtons
        onProceed={mockOnProceed}
        onGenerateQuestions={mockOnGenerateQuestions}
        discussionId="test-discussion-id"
        isResolved={false}
        disabled={false}
      />
    );

    const proceedButton = screen.getByText('Proceed');
    fireEvent.mouseEnter(proceedButton);

    await waitFor(() => {
      expect(screen.getByText('Continue to the next round of dialogue between the AIs')).toBeInTheDocument();
    });
  });
});
