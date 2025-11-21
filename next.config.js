/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  // Add empty turbopack config to silence Next.js 16 warning
  turbopack: {},
  // Exclude server-only packages from client bundle
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Client-side: exclude Node.js modules and server-only packages
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        jsdom: false,
      };
      // Exclude server-only packages from client bundle
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, 'pdf-parse', 'jsdom', 'open'];
    }
    // Server-side: no special handling needed
    return config;
  },
  async headers() {
    const isProduction = process.env.NODE_ENV === 'production';

    // Security headers
    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // unsafe-eval and unsafe-inline are required for Next.js runtime
          // unsafe-inline is required for Tailwind CSS dynamic styles
          "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self'",
          "connect-src 'self' https://api.groq.com https://api.mistral.ai https://openrouter.ai",
        ].join('; '),
      },
    ];

    // Add HSTS header in production only
    if (isProduction) {
      securityHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }

    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // CORS headers for API routes
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          // Use server-side env variable (APP_URL) or fallback to NEXT_PUBLIC_APP_URL
          {
            key: 'Access-Control-Allow-Origin',
            value:
              process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
