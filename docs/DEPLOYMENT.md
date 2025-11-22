# Deployment Guide

## Production Deployment

This guide covers deploying the AI Dialogue Platform to production environments.

## Prerequisites

- Node.js 20.9.0 or higher
- npm 10.0.0 or higher
- At least one LLM API key (Groq, Mistral, or OpenRouter)
- (Optional) Redis server for distributed rate limiting
- (Optional) ClamAV for virus scanning

## Environment Variables

### Required Variables

```bash
# At least one LLM API key is required
GROQ_API_KEY=your_groq_api_key
# OR
MISTRAL_API_KEY=your_mistral_api_key
# OR
OPENROUTER_API_KEY=your_openrouter_api_key

# Application URL (required for CORS)
NEXT_PUBLIC_APP_URL=https://your-domain.com
APP_URL=https://your-domain.com

# NextAuth secret (required for authentication)
NEXTAUTH_SECRET=your_nextauth_secret_here
```

### Optional Configuration

```bash
# Server Configuration
NODE_ENV=production
HOSTNAME=0.0.0.0
PORT=3000

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=10
RATE_LIMIT_WINDOW_MS=60000

# Session Configuration
SESSION_TIMEOUT_MINUTES=1440

# LLM Provider Timeouts (milliseconds)
LLM_TIMEOUT_GROQ=60000
LLM_TIMEOUT_MISTRAL=90000
LLM_TIMEOUT_OPENROUTER=120000

# Backup Configuration
BACKUP_ENABLED=true
BACKUP_RETENTION_DAYS=30
BACKUP_INTERVAL_HOURS=1
BACKUPS_DIR=data/backups

# Redis Configuration (for distributed rate limiting)
REDIS_URL=redis://localhost:6379
# OR
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Database Configuration
DATABASE_PATH=data/conversations.db

# Logging Configuration
LOG_LEVEL=info
NEXT_PUBLIC_LOG_LEVEL=info

# File Storage
DISCUSSIONS_DIR=data/discussions

# Security (Future Enhancement)
ENABLE_VIRUS_SCAN=false
CLAMAV_HOST=localhost
CLAMAV_PORT=3310
```

## Build Process

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Build the application:**

   ```bash
   npm run build
   ```

3. **Verify build:**

   ```bash
   npm run type-check
   ```

## Deployment Options

### Option 1: Vercel (Recommended)

1. **Connect your repository to Vercel**

2. **Configure environment variables** in Vercel dashboard

3. **Deploy** - Vercel will automatically build and deploy

4. **Note:** Socket.IO requires a custom server, so you may need to use Vercel's serverless functions or deploy to a different platform

### Option 2: Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

Build and run:

```bash
docker build -t ai-dialogue-platform .
docker run -p 3000:3000 --env-file .env.local ai-dialogue-platform
```

### Option 3: Traditional Server

1. **Clone repository** on server

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build application:**

   ```bash
   npm run build
   ```

4. **Set up process manager** (PM2 recommended):

   ```bash
   npm install -g pm2
   pm2 start npm --name "ai-dialogue" -- start
   pm2 save
   pm2 startup
   ```

5. **Set up reverse proxy** (nginx recommended):

   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Data Persistence

### Database

- SQLite database file: `data/conversations.db`
- Ensure `data/` directory is writable
- Consider backing up database regularly

### Discussion Files

- Location: `data/discussions/{userId}/`
- Format: JSON and Markdown files
- Ensure directory is writable
- Backups are stored in: `data/backups/{userId}/`

### Backup Strategy

1. **Automatic Backups:**
   - Enabled by default (`BACKUP_ENABLED=true`)
   - Runs hourly for active discussions
   - Retains backups for 30 days (configurable)

2. **Manual Backups:**
   - Copy `data/` directory
   - Include both database and discussion files

3. **Recovery:**
   - Restore from `data/backups/` directory
   - Copy files back to `data/discussions/`

## Monitoring

### Health Check Endpoint

**GET `/api/health`**

Returns system health status:

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy" },
    "llm": { "status": "healthy", "providers": ["groq", "mistral"] },
    "redis": { "status": "healthy" }
  },
  "timestamp": "2024-12-01T12:00:00.000Z"
}
```

### Logging

- **Production logs:** `logs/error.log` and `logs/combined.log`
- **Log rotation:** Automatic (5MB max, 5 files)
- **Log level:** Set via `LOG_LEVEL` environment variable

### Monitoring Recommendations

1. **Set up log aggregation** (e.g., Datadog, Loggly)
2. **Monitor health check endpoint**
3. **Track error rates**
4. **Monitor disk space** (for database and files)
5. **Set up alerts** for:
   - High error rates
   - Disk space low
   - Health check failures
   - LLM provider failures

## Security Best Practices

1. **Environment Variables:**
   - Never commit `.env` files
   - Use secure secret management
   - Rotate API keys regularly

2. **HTTPS:**
   - Always use HTTPS in production
   - Set up SSL certificates (Let's Encrypt recommended)

3. **Rate Limiting:**
   - Configure appropriate rate limits
   - Use Redis for distributed deployments

4. **File Uploads:**
   - File size limits enforced (10MB)
   - File type validation
   - (Future) Virus scanning

5. **Authentication:**
   - Use strong `NEXTAUTH_SECRET`
   - Enable OAuth providers securely
   - Configure session timeouts

6. **Logging:**
   - Log sanitization enabled by default
   - Sensitive data automatically redacted
   - Review logs regularly

## Scaling Considerations

### Horizontal Scaling

- Use Redis for distributed rate limiting
- File storage should be on shared filesystem or object storage
- Consider migrating to PostgreSQL for better concurrency

### Vertical Scaling

- Monitor memory usage (file operations)
- Consider increasing Node.js heap size if needed
- Monitor database file size (SQLite has limits)

### Performance Optimization

- Enable Redis caching (if implemented)
- Use CDN for static assets
- Consider database connection pooling
- Monitor LLM API response times

## Backup and Recovery

### Backup Procedures

1. **Database Backup:**
   ```bash
   cp data/conversations.db data/conversations.db.backup
   ```

2. **Discussion Files Backup:**
   - Automatic backups run hourly
   - Manual backup: `cp -r data/discussions data/discussions.backup`

3. **Full System Backup:**
   ```bash
   tar -czf backup-$(date +%Y%m%d).tar.gz data/
   ```

### Recovery Procedures

1. **Stop the application**

2. **Restore database:**
   ```bash
   cp data/conversations.db.backup data/conversations.db
   ```

3. **Restore discussion files:**
   ```bash
   cp -r data/discussions.backup/* data/discussions/
   ```

4. **Restart application**

## Troubleshooting

### Common Issues

1. **Port already in use:**
   - Change `PORT` environment variable
   - Or kill process using port 3000

2. **Database locked:**
   - Check for multiple instances running
   - Ensure WAL mode is enabled
   - Check file permissions

3. **LLM API errors:**
   - Verify API keys are correct
   - Check rate limits on provider side
   - Verify network connectivity

4. **File permission errors:**
   - Ensure `data/` directory is writable
   - Check user permissions
   - Verify disk space

### Debug Mode

Set `LOG_LEVEL=debug` for detailed logging (development only).

## Maintenance

### Regular Tasks

1. **Monitor disk space** (database and files)
2. **Review logs** for errors
3. **Check backup status**
4. **Update dependencies** regularly
5. **Rotate API keys** periodically

### Updates

1. **Pull latest code**
2. **Install dependencies:** `npm install`
3. **Run tests:** `npm test`
4. **Build:** `npm run build`
5. **Restart application**

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review health check endpoint
- Check environment variables
- Verify API keys are valid
