'use client';

import { useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { Button } from '@/lib/components/ui/Button';
import type { QuestionSet } from '@/types';

interface QuestionGeneratorProps {
  questionSet: QuestionSet;
  onSubmit: (answers: Record<string, string[]>) => void;
  disabled?: boolean;
  error?: string | null;
}

export function QuestionGenerator({
  questionSet,
  onSubmit,
  disabled = false,
  error: externalError,
}: QuestionGeneratorProps) {
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string[]>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const error = externalError || localError;

  const handleOptionToggle = (questionId: string, optionId: string) => {
    setSelectedAnswers((prev) => {
      const current = prev[questionId] || [];
      const isSelected = current.includes(optionId);

      return {
        ...prev,
        [questionId]: isSelected ? current.filter((id) => id !== optionId) : [...current, optionId],
      };
    });
    setLocalError(null); // Clear error when user makes a selection
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate that at least one question has an answer
    const hasAnswers = Object.values(selectedAnswers).some((answers) => answers.length > 0);

    if (!hasAnswers) {
      setLocalError('Please select at least one answer before submitting.');
      return;
    }

    onSubmit(selectedAnswers);
    setSelectedAnswers({}); // Clear selections after submit
  };

  return (
    <div className="bg-black rounded p-6 mb-6 border-2 border-green-500">
      <div className="flex items-start gap-3 mb-4">
        <MessageSquare className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-green-500 font-semibold mb-2">
            Questions for Round {questionSet.roundNumber}
          </h3>
          <p className="text-white text-sm mb-4">
            Please select your answers to help guide the discussion (you can select multiple options
            per question):
          </p>

          {error && (
            <div className="mb-4 p-3 bg-black border-2 border-green-500 rounded">
              <span className="text-white text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {questionSet.questions.map((question) => (
              <div key={question.id} className="bg-black p-4 rounded border-2 border-green-500">
                <label className="block text-white font-medium mb-3">{question.text}</label>
                <div className="space-y-2">
                  {question.options.map((option) => {
                    const isSelected = selectedAnswers[question.id]?.includes(option.id) || false;
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center gap-3 p-3 rounded cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-black border-2 border-green-500'
                            : 'bg-black border-2 border-green-500/50 hover:border-green-500'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleOptionToggle(question.id, option.id)}
                          disabled={disabled}
                          className="w-4 h-4 text-green-500 border-green-500 rounded focus:ring-green-500 focus:ring-2"
                        />
                        <span className="text-white flex-1">{option.text}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-4">
              <Button
                type="submit"
                disabled={disabled || Object.values(selectedAnswers).every((a) => a.length === 0)}
                className="flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Submit Answers
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
