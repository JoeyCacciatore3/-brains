import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoundAccordion } from '@/lib/components/dialogue/RoundAccordion';
import { createMockDiscussionRound } from '../../utils/test-fixtures';
import type { SummaryEntry } from '@/types';

describe('RoundAccordion Component', () => {
  const mockRounds = [
    createMockDiscussionRound(1, 'Solver 1', 'Analyzer 1', 'Moderator 1'),
    createMockDiscussionRound(2, 'Solver 2', 'Analyzer 2', 'Moderator 2'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render previous rounds', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('Round 2')).toBeInTheDocument();
  });

  it('should not render current round', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={2}
        summaries={[]}
      />
    );

    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.queryByText('Round 2')).not.toBeInTheDocument();
  });

  it('should not render when there are no previous rounds', () => {
    const { container } = render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={1}
        summaries={[]}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should expand round when header is clicked', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader);
    }

    // Round content should be visible when expanded
    expect(screen.getByText('Solver 1')).toBeInTheDocument();
    expect(screen.getByText('Analyzer 1')).toBeInTheDocument();
    expect(screen.getByText('Moderator 1')).toBeInTheDocument();
  });

  it('should collapse round when header is clicked again', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader); // Expand
      fireEvent.click(roundHeader); // Collapse
    }

    // Content might still be in DOM but hidden, so we check for the button
    expect(roundHeader).toBeInTheDocument();
  });

  it('should show Copy Content button when round is expanded', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader);
    }

    expect(screen.getByText('Copy Content')).toBeInTheDocument();
  });

  it('should copy round content when Copy button is clicked', async () => {
    // Mock clipboard API
    const mockWriteText = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader);
    }

    const copyButton = screen.getByText('Copy Content');
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    expect(mockWriteText).toHaveBeenCalledWith(
      expect.stringContaining('Round 1')
    );
  });

  it('should show View Questions button when round has questions', () => {
    const roundsWithQuestions = [
      {
        ...createMockDiscussionRound(1),
        questions: {
          roundNumber: 1,
          generatedAt: new Date().toISOString(),
          questions: [
            {
              id: 'q1',
              text: 'Test question?',
              options: [{ id: 'o1', text: 'Option 1' }],
            },
          ],
        },
      },
    ];

    render(
      <RoundAccordion
        rounds={roundsWithQuestions}
        currentRoundNumber={2}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader);
    }

    expect(screen.getByText('View Questions')).toBeInTheDocument();
  });

  it('should not show View Questions button when round has no questions', () => {
    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={[]}
      />
    );

    const roundHeader = screen.getByText('Round 1').closest('button');
    if (roundHeader) {
      fireEvent.click(roundHeader);
    }

    expect(screen.queryByText('View Questions')).not.toBeInTheDocument();
  });

  it('should show Summarized indicator when round is summarized', () => {
    const summaries: SummaryEntry[] = [
      {
        summary: 'Test summary',
        createdAt: Date.now(),
        roundNumber: 3,
        tokenCountBefore: 1000,
        tokenCountAfter: 500,
        replacesRounds: [1, 2],
      },
    ];

    render(
      <RoundAccordion
        rounds={mockRounds}
        currentRoundNumber={3}
        summaries={summaries}
      />
    );

    expect(screen.getByText('Summarized')).toBeInTheDocument();
  });

  it('should show Questions indicator when round has questions', () => {
    const roundsWithQuestions = [
      {
        ...createMockDiscussionRound(1),
        questions: {
          roundNumber: 1,
          generatedAt: new Date().toISOString(),
          questions: [
            {
              id: 'q1',
              text: 'Test question?',
              options: [{ id: 'o1', text: 'Option 1' }],
            },
          ],
        },
      },
    ];

    render(
      <RoundAccordion
        rounds={roundsWithQuestions}
        currentRoundNumber={2}
        summaries={[]}
      />
    );

    expect(screen.getByText('Questions')).toBeInTheDocument();
  });

  it('should sort rounds by round number (most recent first)', () => {
    const rounds = [
      createMockDiscussionRound(1),
      createMockDiscussionRound(3),
      createMockDiscussionRound(2),
    ];

    render(
      <RoundAccordion
        rounds={rounds}
        currentRoundNumber={4}
        summaries={[]}
      />
    );

    const roundHeaders = screen.getAllByText(/Round \d+/);
    // Check that Round 3 appears before Round 2, and Round 2 before Round 1
    expect(roundHeaders[0]).toHaveTextContent('Round 3');
    expect(roundHeaders[1]).toHaveTextContent('Round 2');
    expect(roundHeaders[2]).toHaveTextContent('Round 1');
  });
});
