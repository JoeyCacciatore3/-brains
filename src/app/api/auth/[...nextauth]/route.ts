import { getNextAuthInstance } from '@/lib/auth/config';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

// Check provider availability at runtime
function checkProvidersAtRuntime(): void {
  const hasGithubId = !!process.env.GITHUB_CLIENT_ID;
  const hasGithubSecret = !!process.env.GITHUB_CLIENT_SECRET;

  logger.debug('Runtime provider check', {
    hasGithubClientId: hasGithubId,
    hasGithubClientSecret: hasGithubSecret,
    providersAvailable: hasGithubId && hasGithubSecret,
  });

  if (!hasGithubId || !hasGithubSecret) {
    logger.warn('OAuth providers not available at runtime - authentication may fail', {
      hasGithubClientId: hasGithubId,
      hasGithubClientSecret: hasGithubSecret,
    });
  }
}

// Wrap handlers with error handling
async function handleRequest(
  handler: (req: NextRequest) => Promise<Response>,
  req: NextRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);

    // Check providers at runtime when handler is called
    checkProvidersAtRuntime();

    // Check if this is a sign-in request and providers are available
    const isSignInRequest = url.pathname.includes('/signin') || url.searchParams.has('provider');
    const hasGithubId = !!process.env.GITHUB_CLIENT_ID;
    const hasGithubSecret = !!process.env.GITHUB_CLIENT_SECRET;
    const providersAvailable = hasGithubId && hasGithubSecret;

    if (isSignInRequest && !providersAvailable) {
      logger.error('Sign-in attempted but no OAuth providers are configured', {
        path: url.pathname,
        hasGithubClientId: hasGithubId,
        hasGithubClientSecret: hasGithubSecret,
      });

      return NextResponse.json(
        {
          error: 'Configuration Error',
          message: 'OAuth providers are not configured. Please check your environment variables (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET).',
        },
        { status: 500 }
      );
    }

    logger.debug('NextAuth handler called', {
      method: req.method,
      path: url.pathname,
      searchParams: url.searchParams.toString(),
      providersAvailable,
    });

    const response = await handler(req);

    // Log non-OK responses for debugging
    if (!response.ok) {
      logger.warn('NextAuth handler returned non-OK response', {
        method: req.method,
        path: url.pathname,
        status: response.status,
        statusText: response.statusText,
      });
    }

    return response;
  } catch (error) {
    logger.error('Error in NextAuth handler', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      method: req.method,
      path: new URL(req.url).pathname,
    });

    // Return a proper error response
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An error occurred during authentication. Please try again.',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // Get NextAuth handlers with lazy initialization
  const handlers = getNextAuthInstance().handlers;
  return handleRequest(handlers.GET, req);
}

export async function POST(req: NextRequest) {
  // Get NextAuth handlers with lazy initialization
  const handlers = getNextAuthInstance().handlers;
  return handleRequest(handlers.POST, req);
}
