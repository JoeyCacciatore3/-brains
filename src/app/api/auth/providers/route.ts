import { NextResponse } from 'next/server';

/**
 * API endpoint to check which OAuth providers are configured
 * Returns list of available providers based on environment variables
 */
export async function GET() {
  const providers: string[] = [];

  // Check for GitHub OAuth credentials
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.push('github');
  }

  return NextResponse.json({ providers });
}
