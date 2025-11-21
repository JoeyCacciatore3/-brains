'use client';

import { useState, useRef, useEffect } from 'react';
import { Brain, MessageSquare, ChevronDown, ChevronUp, X, FileText, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { InputSection } from './InputSection';
import { ResolutionBanner } from './ResolutionBanner';
import { RoundDisplay } from './RoundDisplay';
import { QuestionGenerator } from './QuestionGenerator';
import { ActionButtons } from './ActionButtons';
import { RoundAccordion } from './RoundAccordion';
import { InitialTopicDisplay } from './InitialTopicDisplay';
import { UserInputModal } from './UserInputModal';
import { useSocket } from '@/lib/socket/client';
import type { FileData } from '@/lib/validation';

export function DialogueHero() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;

  const {
    isConnected,
    connectionState,
    currentMessage,
    rounds,
    currentRound,
    currentQuestionSet,
    currentSummary,
    summaries,
    waitingForAction,
    isResolved,
    error,
    discussionId,
    startDialogue,
    submitAnswers,
    proceedDialogue,
    generateSummary,
    generateQuestions,
    sendUserInput,
    reset,
    reconnect,
  } = useSocket();

  const conversationEndRef = useRef<HTMLDivElement>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());
  const [dismissedSummaries, setDismissedSummaries] = useState<Set<number>>(new Set());
  const [initialTopic, setInitialTopic] = useState<string | null>(null);
  const [isUserInputModalOpen, setIsUserInputModalOpen] = useState(false);

  const scrollToBottom = () => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [rounds, currentRound, currentMessage]);

  // Clear loading states when summary/questions are generated
  useEffect(() => {
    if (currentSummary) {
      setIsGeneratingSummary(false);
    }
  }, [currentSummary]);

  useEffect(() => {
    if (currentQuestionSet) {
      setIsGeneratingQuestions(false);
    }
  }, [currentQuestionSet]);

  // Clear loading states on error
  useEffect(() => {
    if (error) {
      // Clear loading states if error occurs (user can retry)
      setIsGeneratingSummary(false);
      setIsGeneratingQuestions(false);
    }
  }, [error]);

  const handleStart = async (topic: string, files: FileData[]) => {
    reset();
    setInitialTopic(topic); // Store initial topic
    startDialogue(topic, files, userId);
  };

  const handleSubmitAnswers = (answers: Record<string, string[]>) => {
    if (currentQuestionSet) {
      submitAnswers(currentQuestionSet.roundNumber, answers);
    }
  };

  const handleProceed = () => {
    proceedDialogue();
  };

  const handleGenerateSummary = () => {
    setIsGeneratingSummary(true);
    generateSummary();
  };

  const handleGenerateQuestions = () => {
    setIsGeneratingQuestions(true);
    generateQuestions();
  };

  const handleUserInputClick = () => {
    setIsUserInputModalOpen(true);
  };

  const handleUserInputSubmit = (input: string) => {
    if (input.trim() && discussionId) {
      sendUserInput(input);
      setIsUserInputModalOpen(false);
    }
  };

  const isProcessing = currentMessage !== null;

  return (
    <div className="min-h-screen bg-black p-6">
      <div className="max-w-5xl mx-auto border-2 border-green-500 rounded-lg p-6">
        {/* Header */}
        <div className="text-center mb-8 border-b-2 border-green-500 pb-4">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Brain className="w-10 h-10 text-green-500" />
            <h1 className="text-4xl font-bold text-white">AI Dialogue Platform</h1>
          </div>
          <p className="text-white text-lg">
            Three AI minds collaborate to solve problems and analyze topics through dialogue
          </p>

          {/* Connection Status */}
          {connectionState === 'connecting' && (
            <div className="mt-2 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <p className="text-yellow-400 text-sm">🔄 Connecting to server... Please wait.</p>
            </div>
          )}

          {connectionState === 'reconnecting' && (
            <div className="mt-2 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
              <p className="text-yellow-400 text-sm">🔄 Reconnecting to server... Please wait.</p>
            </div>
          )}

          {connectionState === 'error' && (
            <div className="mt-2 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <div className="flex items-center justify-between gap-3">
                <p className="text-red-400 text-sm flex-1">
                  ⚠️ {error || 'Connection error. Please try reconnecting.'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={reconnect}
                    className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-xs rounded transition-colors"
                  >
                    Reload
                  </button>
                </div>
              </div>
            </div>
          )}

          {connectionState === 'connected' && error && (
            <div className="mt-2 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-red-400 text-sm font-semibold mb-1">⚠️ Error</p>
                    <p className="text-red-300 text-sm">{error}</p>
                    {/* Recovery suggestions */}
                    {error.includes('rate limit') && (
                      <p className="text-red-200 text-xs mt-2">
                        💡 Suggestion: Please wait a moment before trying again. Rate limits reset
                        automatically.
                      </p>
                    )}
                    {error.includes('network') ||
                      (error.includes('connection') && (
                        <p className="text-red-200 text-xs mt-2">
                          💡 Suggestion: Check your internet connection and try reconnecting.
                        </p>
                      ))}
                    {error.includes('provider') ||
                      (error.includes('API') && (
                        <p className="text-red-200 text-xs mt-2">
                          💡 Suggestion: The AI provider may be temporarily unavailable. Try again
                          in a moment.
                        </p>
                      ))}
                    {!error.includes('rate limit') &&
                      !error.includes('network') &&
                      !error.includes('connection') &&
                      !error.includes('provider') &&
                      !error.includes('API') && (
                        <p className="text-red-200 text-xs mt-2">
                          💡 Suggestion: Try the recovery options below, or refresh the page if the
                          issue persists.
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {error.includes('rate limit') ? (
                    <button
                      onClick={() => {
                        // Clear error after a delay
                        setTimeout(() => {
                          // Error will be cleared by socket client on next successful operation
                        }, 5000);
                      }}
                      className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs rounded transition-colors border border-red-500/30"
                    >
                      Dismiss
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          // Try to recover by resetting
                          reset();
                        }}
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors font-medium"
                      >
                        Reset & Start Fresh
                      </button>
                      {discussionId && (
                        <button
                          onClick={() => {
                            reconnect();
                          }}
                          className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs rounded transition-colors border border-blue-500/30"
                        >
                          Reconnect
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => window.location.reload()}
                    className="px-3 py-1.5 bg-gray-500/20 hover:bg-gray-500/30 text-gray-300 text-xs rounded transition-colors border border-gray-500/30"
                  >
                    Reload Page
                  </button>
                </div>
              </div>
            </div>
          )}

          {connectionState === 'connected' && !error && (
            <div className="mt-2 p-3 bg-black border-2 border-green-500 rounded">
              <p className="text-green-500 text-sm">✓ Connected</p>
            </div>
          )}
        </div>

        {/* Initial Topic Display */}
        {initialTopic && discussionId && (
          <InitialTopicDisplay topic={initialTopic} />
        )}

        {/* Input Section */}
        <InputSection
          onStart={handleStart}
          isProcessing={isProcessing}
          isConnected={isConnected}
          error={error || undefined}
          userId={userId}
        />

        {/* Summary Display - Enhanced */}
        {currentSummary && !dismissedSummaries.has(currentSummary.roundNumber) && (
          <div className="bg-black rounded p-6 mb-6 border-2 border-green-500">
            <div className="flex items-start justify-between mb-3">
              <button
                onClick={() => {
                  setExpandedSummaries((prev) => {
                    const next = new Set(prev);
                    if (next.has(currentSummary.roundNumber)) {
                      next.delete(currentSummary.roundNumber);
                    } else {
                      next.add(currentSummary.roundNumber);
                    }
                    return next;
                  });
                }}
                className="flex items-center gap-2 text-green-400 font-semibold hover:text-green-300 transition-colors"
              >
                {expandedSummaries.has(currentSummary.roundNumber) ? (
                  <ChevronDown className="w-5 h-5" />
                ) : (
                  <ChevronUp className="w-5 h-5" />
                )}
                <FileText className="w-5 h-5" />
                <span>Discussion Summary (Round {currentSummary.roundNumber})</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleGenerateSummary()}
                  className="p-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/20 rounded transition-colors"
                  title="Regenerate summary"
                  disabled={isGeneratingSummary}
                >
                  <RefreshCw className={`w-4 h-4 ${isGeneratingSummary ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    setDismissedSummaries((prev) => new Set(prev).add(currentSummary.roundNumber));
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-500/20 rounded transition-colors"
                  title="Dismiss summary"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {expandedSummaries.has(currentSummary.roundNumber) && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div className="bg-black rounded p-4 border-2 border-green-500">
                  <p className="text-white text-sm whitespace-pre-wrap">
                    {currentSummary.summary}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-black rounded p-3 border-2 border-green-500">
                    <div className="text-white mb-1">Token Savings</div>
                    <div className="text-green-500 font-semibold">
                      {currentSummary.tokenCountBefore - currentSummary.tokenCountAfter} tokens
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {currentSummary.tokenCountBefore} → {currentSummary.tokenCountAfter}
                    </div>
                  </div>
                  <div className="bg-black rounded p-3 border-2 border-green-500">
                    <div className="text-white mb-1">Replaces Rounds</div>
                    <div className="text-green-500 font-semibold">
                      {currentSummary.replacesRounds.length} round
                      {currentSummary.replacesRounds.length !== 1 ? 's' : ''}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {currentSummary.replacesRounds.join(', ')}
                    </div>
                  </div>
                  <div className="bg-black rounded p-3 border-2 border-green-500">
                    <div className="text-white mb-1">Created</div>
                    <div className="text-green-500 font-semibold">
                      {new Date(currentSummary.createdAt).toLocaleDateString()}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {new Date(currentSummary.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>

                {currentSummary.replacesRounds.length > 0 && (
                  <button
                    onClick={() => {
                      // Scroll to or expand those rounds in accordion
                      // This could be enhanced to actually expand those rounds
                      // For now, just a placeholder for future enhancement
                    }}
                    className="text-green-400 hover:text-green-300 text-sm underline"
                  >
                    View original rounds ({currentSummary.replacesRounds.join(', ')})
                  </button>
                )}
              </div>
            )}

            {!expandedSummaries.has(currentSummary.roundNumber) && (
              <div className="mt-2">
                <p className="text-white text-sm line-clamp-2">
                  {currentSummary.summary.substring(0, 150)}...
                </p>
                <div className="text-gray-400 text-xs mt-2 flex items-center gap-4">
                  <span>
                    Token savings:{' '}
                    {currentSummary.tokenCountBefore - currentSummary.tokenCountAfter} tokens
                  </span>
                  <span>•</span>
                  <span>Replaces rounds: {currentSummary.replacesRounds.join(', ')}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Note: User input is handled via action buttons after rounds, not via needsUserInput state */}

        {/* AI Info */}
        <div className="bg-black rounded p-4 mb-6 border-2 border-green-500">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-500" />
            The Three AIs
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-start gap-3 bg-black p-4 rounded border-2 border-green-500">
              <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 mt-1.5"></div>
              <div>
                <div className="text-white font-semibold">Analyzer AI</div>
                <div className="text-gray-400 text-sm mt-1">
                  Examines assumptions, explores implications, and challenges ideas to deepen
                  understanding
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-black p-4 rounded border-2 border-green-500">
              <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 mt-1.5"></div>
              <div>
                <div className="text-white font-semibold">Solver AI</div>
                <div className="text-gray-400 text-sm mt-1">
                  Focuses on practical solutions, implementation, and breaking down problems
                  systematically
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-black p-4 rounded border-2 border-green-500">
              <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0 mt-1.5"></div>
              <div>
                <div className="text-white font-semibold">Moderator AI</div>
                <div className="text-gray-400 text-sm mt-1">
                  Synthesizes ideas, bridges viewpoints, and guides the discussion toward
                  actionable conclusions
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resolution Banner */}
        {isResolved && <ResolutionBanner />}

        {/* Current Round Display */}
        {currentRound && (
          <div className="bg-black rounded p-6 border-2 border-green-500 mb-6">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-green-500" />
              Round {currentRound.roundNumber}
            </h2>
            <RoundDisplay
              round={currentRound}
              isCurrentRound={true}
            />
            <div ref={conversationEndRef} />
          </div>
        )}

        {/* Action Buttons - Show when waiting for action after round completion */}
        {currentRound && waitingForAction && !isResolved && (
          <ActionButtons
            onProceed={handleProceed}
            onGenerateSummary={handleGenerateSummary}
            onGenerateQuestions={handleGenerateQuestions}
            onUserInput={handleUserInputClick}
            isProcessing={isProcessing}
            isGeneratingSummary={isGeneratingSummary}
            isGeneratingQuestions={isGeneratingQuestions}
            disabled={!isConnected}
            discussionId={discussionId}
            isResolved={isResolved}
          />
        )}

        {/* User Input Modal */}
        <UserInputModal
          isOpen={isUserInputModalOpen}
          onClose={() => setIsUserInputModalOpen(false)}
          onSubmit={handleUserInputSubmit}
          isProcessing={isProcessing}
          error={error || undefined}
        />

        {/* Round Accordion - Previous Rounds */}
        {rounds.length > 0 && (
          <RoundAccordion
            rounds={rounds}
            currentRoundNumber={currentRound?.roundNumber || null}
            summaries={summaries}
          />
        )}

        {/* Streaming Message Display (for current round being generated) */}
        {currentMessage && !currentRound && (
          <div className="bg-black rounded p-6 border-2 border-green-500 mb-6">
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-green-500" />
              Generating Response...
            </h2>
            <div className="text-white">{currentMessage.persona} is thinking...</div>
            <div ref={conversationEndRef} />
          </div>
        )}

        {/* Question Generator */}
        {currentQuestionSet && !isResolved && (
          <QuestionGenerator
            questionSet={currentQuestionSet}
            onSubmit={handleSubmitAnswers}
            disabled={!isConnected || isProcessing}
            error={error || null}
          />
        )}
      </div>
    </div>
  );
}
