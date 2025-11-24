'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { MessageSquare, ChevronDown, ChevronUp, X, FileText, RefreshCw } from 'lucide-react';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { InputSection } from './InputSection';
import { ResolutionBanner } from './ResolutionBanner';
import { RoundDisplay } from './RoundDisplay';
import { QuestionGenerator } from './QuestionGenerator';
import { ActionButtons } from './ActionButtons';
import { RoundAccordion } from './RoundAccordion';
import { InitialTopicDisplay } from './InitialTopicDisplay';
import { LoginButton } from '@/lib/components/auth/LoginButton';
import { UserMenu } from '@/lib/components/auth/UserMenu';
import { DeleteConfirmationDialog } from '@/lib/components/discussions/DeleteConfirmationDialog';
import { useSocket } from '@/lib/socket/client';
import type { FileData } from '@/lib/validation';

export function DialogueHero() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;
  const searchParams = useSearchParams();

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
    generateQuestions,
    reset,
    reconnect,
  } = useSocket();

  const conversationEndRef = useRef<HTMLDivElement>(null);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<number>>(new Set());
  const [dismissedSummaries, setDismissedSummaries] = useState<Set<number>>(new Set());
  const [initialTopic, setInitialTopic] = useState<string | null>(null);
  const [isLoadingDiscussion, setIsLoadingDiscussion] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const scrollToBottom = () => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load discussion from URL query parameter
  useEffect(() => {
    const discussionIdParam = searchParams?.get('discussionId');
    if (discussionIdParam && isConnected && !discussionId && !isLoadingDiscussion) {
      setIsLoadingDiscussion(true);
      // Fetch discussion data
      fetch(`/api/discussions`)
        .then((res) => res.json())
        .then((data) => {
          const discussion = data.discussions?.find((d: { id: string }) => d.id === discussionIdParam);
          if (discussion) {
            setInitialTopic(discussion.topic);
            // The discussion will be loaded when the socket connects and emits discussion-started
            // For now, we'll need to trigger a load-discussion event or modify start-dialogue
            // Since we don't have a load-discussion event, we'll show a message
            toast.success('Discussion loaded', { icon: '📚' });
          } else {
            toast.error('Discussion not found');
          }
        })
        .catch((error) => {
          console.error('Error loading discussion:', error);
          toast.error('Failed to load discussion');
        })
        .finally(() => {
          setIsLoadingDiscussion(false);
        });
    }
  }, [searchParams, isConnected, discussionId, isLoadingDiscussion]);

  useEffect(() => {
    scrollToBottom();
  }, [rounds, currentRound, currentMessage]);


  useEffect(() => {
    if (currentQuestionSet) {
      setIsGeneratingQuestions(false);
      toast.success('Questions generated successfully!', {
        icon: '❓',
      });
    }
  }, [currentQuestionSet]);

  // Clear loading states on error
  useEffect(() => {
    if (error) {
      // Clear loading states if error occurs (user can retry)
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

  const handleGenerateQuestions = () => {
    setIsGeneratingQuestions(true);
    generateQuestions();
  };

  const handleDeleteClick = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirmed = () => {
    // Reset socket state (clears discussionId, rounds, etc.)
    reset();
    // Clear initial topic
    setInitialTopic(null);
    // Close dialog
    setIsDeleteDialogOpen(false);
    // Show success message (toast is already shown by DeleteConfirmationDialog)
    toast.success('Discussion deleted. You can start a new discussion.');
  };

  const isProcessing = currentMessage !== null;

  const isAuthenticated = !!session?.user;

  return (
    <div className="min-h-screen bg-black p-6">
      {/* Connection Status - Top Left */}
      {connectionState === 'connected' && !error && (
        <div className="fixed top-4 left-4 flex items-center gap-2 z-50">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
          <p className="text-green-500 text-xs">Connected</p>
        </div>
      )}
      {/* Sign In Button - Top Right */}
      <div className="fixed top-4 right-4 z-50">
        {isAuthenticated ? <UserMenu /> : <LoginButton showPastDiscussions={true} />}
      </div>
      <div className="max-w-5xl mx-auto rounded-lg p-6">
        {/* Header */}
        <div className="text-center mb-8 pb-4">
          <div className="flex flex-col items-center mb-4">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Image
                src="/assets/brainslogo_pink.png"
                alt="br.AI.ns Logo Pink"
                width={120}
                height={120}
                className="object-contain"
                unoptimized
              />
              <Image
                src="/.github/assets/brainslogo.png?v=2"
                alt="br.AI.ns Logo"
                width={120}
                height={120}
                className="object-contain"
                unoptimized
              />
              <Image
                src="/assets/brainslogo_red.png"
                alt="br.AI.ns Logo Red"
                width={120}
                height={120}
                className="object-contain"
                unoptimized
              />
            </div>
            <h1 className="text-4xl font-bold text-white">br.AI.ns</h1>
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

        </div>

        {/* Initial Topic Display */}
        {initialTopic && discussionId && (
          <InitialTopicDisplay
            topic={initialTopic}
            discussionId={discussionId}
            onDelete={handleDeleteClick}
          />
        )}

        {/* Delete Confirmation Dialog */}
        {discussionId && initialTopic && (
          <DeleteConfirmationDialog
            discussionId={discussionId}
            topic={initialTopic}
            isOpen={isDeleteDialogOpen}
            onClose={() => setIsDeleteDialogOpen(false)}
            onDeleted={handleDeleteConfirmed}
          />
        )}

        {/* Input Section */}
        <InputSection
          onStart={handleStart}
          isProcessing={isProcessing}
          isConnected={isConnected}
          error={error || undefined}
          userId={userId}
        />


        {/* Resolution Banner */}
        {isResolved && <ResolutionBanner />}

        {/* Current Round Display */}
        {currentRound && (
          <div className="bg-black rounded px-6 pb-6 pt-0 mb-6">
            <h2 className="text-2xl font-semibold text-white mb-2 flex items-center gap-2 tracking-tight">
              <MessageSquare className="w-6 h-6 text-green-500" />
              Round {currentRound.roundNumber}
            </h2>
            <RoundDisplay
              round={currentRound}
              isCurrentRound={true}
            />
            {/* Action Buttons - Show when waiting for action after round completion */}
            {waitingForAction && !isResolved && (
              <div className="mt-4">
                <ActionButtons
                  onProceed={handleProceed}
                  onGenerateQuestions={handleGenerateQuestions}
                  isProcessing={isProcessing}
                  isGeneratingQuestions={isGeneratingQuestions}
                  disabled={!isConnected}
                  discussionId={discussionId}
                  isResolved={isResolved}
                />
              </div>
            )}
            <div ref={conversationEndRef} />
          </div>
        )}

        {/* Summary Display - Enhanced */}
        {currentSummary && !dismissedSummaries.has(currentSummary.roundNumber) && (
          <div className="bg-gray-800/40 rounded-lg p-6 mb-6 border border-gray-600/50">
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
                className="flex items-center gap-2 text-gray-300 font-semibold hover:text-gray-200 transition-colors"
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
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-600/50">
                  <p className="text-white text-sm whitespace-pre-wrap">
                    {currentSummary.summary}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600/50">
                    <div className="text-white mb-1">Token Savings</div>
                    <div className="text-gray-300 font-semibold">
                      {currentSummary.tokenCountBefore - currentSummary.tokenCountAfter} tokens
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {currentSummary.tokenCountBefore} → {currentSummary.tokenCountAfter}
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600/50">
                    <div className="text-white mb-1">Replaces Rounds</div>
                    <div className="text-gray-300 font-semibold">
                      {currentSummary.replacesRounds.length} round
                      {currentSummary.replacesRounds.length !== 1 ? 's' : ''}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {currentSummary.replacesRounds.join(', ')}
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600/50">
                    <div className="text-white mb-1">Created</div>
                    <div className="text-gray-300 font-semibold">
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
                    className="text-gray-400 hover:text-gray-300 text-sm underline"
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
          <div className="bg-gray-800/40 rounded-lg p-6 border border-gray-600/50 mb-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2 tracking-tight">
              <MessageSquare className="w-6 h-6 text-gray-400" />
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
