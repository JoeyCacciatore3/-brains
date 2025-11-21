import NextAuth, { type NextAuthConfig } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import { randomUUID } from 'crypto';
import { getDatabase } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * NextAuth configuration with OAuth providers
 */
// Only add providers if credentials are configured
const providers = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  );
}

// If no providers configured, add a placeholder to prevent errors
// (NextAuth will still work but authentication will be disabled)
if (providers.length === 0) {
  logger.warn('No OAuth providers configured. Authentication will be disabled.');
}

export const authOptions: NextAuthConfig = {
  providers: providers.length > 0 ? providers : [],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) {
        return false;
      }

      try {
        const db = getDatabase();
        const now = Date.now();

        // Check if user exists
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email) as
          | { id: string }
          | undefined;

        if (existingUser) {
          // Update user info
          db.prepare(
            `UPDATE users
             SET name = ?, image = ?, updated_at = ?
             WHERE id = ?`
          ).run(user.name || null, user.image || null, now, existingUser.id);
          return true;
        }

        // Create new user
        const userId = randomUUID();
        db.prepare(
          `INSERT INTO users (id, email, name, image, provider, provider_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          userId,
          user.email,
          user.name || null,
          user.image || null,
          account.provider || 'unknown',
          account.providerAccountId || account.id || '',
          now,
          now
        );

        logger.info('New user created', { userId, email: user.email, provider: account.provider });
        return true;
      } catch (error) {
        logger.error('Error in signIn callback', { error, email: user.email });
        return false;
      }
    },
    async session({ session }) {
      if (session.user?.email) {
        try {
          const db = getDatabase();
          const user = db
            .prepare('SELECT id FROM users WHERE email = ?')
            .get(session.user.email) as { id: string } | undefined;

          if (user) {
            if (session.user) {
              (session.user as { id?: string }).id = user.id;
            }
          }
        } catch (error) {
          logger.error('Error fetching user ID in session callback', { error });
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Export auth function for NextAuth v5
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
