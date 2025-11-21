'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { clientLogger } from '@/lib/client-logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error with structured logging
    clientLogger.error('ErrorBoundary caught an error', {
      error: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Update state with error info
    this.setState({
      error,
      errorInfo,
    });

    // In production, you could send this to an error reporting service
    // Example: Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI - matches app theme (black bg, green borders)
      return (
        <div className="min-h-screen flex items-center justify-center bg-black p-4">
          <div className="max-w-md w-full bg-black rounded-xl p-6 border-2 border-green-500">
            <h1 className="text-2xl font-bold text-white mb-4">Something went wrong</h1>
            <p className="text-gray-300 mb-4">
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4">
                <summary className="text-gray-400 cursor-pointer mb-2">
                  Error details (development only)
                </summary>
                <pre className="text-xs text-red-300 bg-black border-2 border-green-500 p-3 rounded overflow-auto">
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 bg-green-500 text-black rounded hover:bg-green-400 transition-colors font-semibold"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-black border-2 border-green-500 text-green-500 rounded hover:bg-green-500/10 transition-colors"
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
