'use client';

import { signIn } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Loader2, Info } from 'lucide-react';
import { clientLogger } from '@/lib/client-logger';

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoadingGithub, setIsLoadingGithub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  // Fetch available providers on mount
  useEffect(() => {
    async function fetchProviders() {
      try {
        const response = await fetch('/api/auth/providers');
        if (response.ok) {
          const data = await response.json();
          setAvailableProviders(data.providers || []);
        } else {
          clientLogger.error('Failed to fetch providers', { status: response.status });
          // Fallback: assume no providers available
          setAvailableProviders([]);
        }
      } catch (error) {
        clientLogger.error('Error fetching providers', { error });
        // Fallback: assume no providers available
        setAvailableProviders([]);
      } finally {
        setIsLoadingProviders(false);
      }
    }

    fetchProviders();
  }, []);

  // Check for error in URL params (from NextAuth)
  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      let errorMessage = 'An error occurred during sign in.';
      switch (errorParam) {
        case 'Configuration':
          errorMessage = 'There is a problem with the server configuration.';
          break;
        case 'AccessDenied':
          errorMessage = 'You do not have permission to sign in.';
          break;
        case 'Verification':
          errorMessage = 'The verification token has expired or has already been used.';
          break;
        case 'OAuthSignin':
          errorMessage = 'Error occurred during OAuth sign in. Please try again.';
          break;
        case 'OAuthCallback':
          errorMessage = 'Error occurred during OAuth callback. Please try again.';
          break;
        case 'OAuthCreateAccount':
          errorMessage = 'Could not create OAuth account. Please try again.';
          break;
        case 'EmailCreateAccount':
          errorMessage = 'Could not create email account. Please try again.';
          break;
        case 'Callback':
          errorMessage = 'Error occurred during callback. Please try again.';
          break;
        case 'OAuthAccountNotLinked':
          errorMessage = 'This account is already linked to another user.';
          break;
        case 'EmailSignin':
          errorMessage = 'Error sending email. Please try again.';
          break;
        case 'CredentialsSignin':
          errorMessage = 'Invalid credentials. Please check your information and try again.';
          break;
        case 'SessionRequired':
          errorMessage = 'Please sign in to access this page.';
          break;
        default:
          errorMessage = `Sign in error: ${errorParam}`;
      }
      setError(errorMessage);
    }
  }, [searchParams]);

  const handleSignIn = async (provider: 'github') => {
    // Check if provider is available
    if (!availableProviders.includes(provider)) {
      setError('GitHub authentication is not configured. Please contact administrator.');
      return;
    }

    setError(null);
    setIsLoadingGithub(true);

    // Development mode debugging
    if (process.env.NODE_ENV === 'development') {
      clientLogger.debug('Initiating OAuth sign-in', {
        provider,
        callbackUrl: '/',
        nextAuthUrl: process.env.NEXT_PUBLIC_APP_URL || window.location.origin,
      });
    }

    try {
      // Try using redirect: false first to get the URL
      const result = await signIn(provider, {
        callbackUrl: '/',
        redirect: false,
      });

      if (result?.error) {
        const errorMessage = result.error
          ? `Sign in failed: ${result.error}`
          : 'Failed to sign in. Please try again.';
        setError(errorMessage);
        setIsLoadingGithub(false);

        if (process.env.NODE_ENV === 'development') {
          clientLogger.error('Sign in returned error', {
            provider,
            error: result.error,
            url: result.url,
          });
        }
        return;
      }

      // If we have a URL, redirect to it (this should be the OAuth provider URL)
      if (result?.url) {
        if (process.env.NODE_ENV === 'development') {
          clientLogger.debug('Redirecting to OAuth provider', {
            provider,
            url: result.url,
          });
        }
        // Redirect to OAuth provider
        window.location.href = result.url;
        // Note: We don't reset loading state here since we're redirecting
        return;
      }

      // Fallback: Construct the signin URL directly
      // NextAuth v5 uses this format: /api/auth/signin/{provider}
      const callbackUrl = encodeURIComponent('/');
      const signInUrl = `/api/auth/signin/${provider}?callbackUrl=${callbackUrl}`;

      if (process.env.NODE_ENV === 'development') {
        clientLogger.debug('Using fallback redirect', {
          provider,
          url: signInUrl,
        });
      }

      window.location.href = signInUrl;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.';
      clientLogger.error('Sign in error:', { error, provider });
      setError(errorMessage);
      setIsLoadingGithub(false);

      if (process.env.NODE_ENV === 'development') {
        clientLogger.error('Sign in exception details', {
          provider,
          error: error instanceof Error ? error.stack : String(error),
        });
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-xl p-8 max-w-md w-full mx-4 border border-white/20">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-gray-300 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Home</span>
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">Sign In</h1>
          <p className="text-gray-300 text-sm">
            Sign in to start discussions and access your conversation history
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={() => setError(null)}
                className="text-red-300 hover:text-red-200 text-xs mt-2 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {isLoadingProviders ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-400 text-sm">Loading authentication options...</span>
          </div>
        ) : availableProviders.length === 0 ? (
          <div className="mb-6 p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg flex items-start gap-3">
            <Info className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-yellow-400 text-sm font-medium">OAuth authentication is not configured</p>
              <p className="text-yellow-300 text-xs mt-1">
                Please contact the administrator to configure GitHub OAuth.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {availableProviders.includes('github') && (
              <button
                onClick={() => handleSignIn('github')}
                disabled={isLoadingGithub}
                className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoadingGithub ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path
                        fillRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Sign in with GitHub</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
