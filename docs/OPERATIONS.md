# Operations Runbook

This guide covers common operational tasks and procedures for the AI Dialogue Platform.

## Common Issues and Solutions

### Database Locked

**Symptoms**: Database operations fail with "database is locked" error

**Solutions**:
1. Check for multiple instances running
2. Ensure WAL mode is enabled
3. Check file permissions
4. Restart the application

### LLM Provider Errors

**Symptoms**: LLM API calls failing

**Solutions**:
1. Verify API keys are correct and not expired
2. Check provider status pages
3. Review rate limits
4. Check circuit breaker status
5. Verify network connectivity

### High Error Rates

**Symptoms**: Error rate alerts triggering

**Solutions**:
1. Check error logs for patterns
2. Review recent code changes
3. Check system resources (CPU, memory, disk)
4. Verify external dependencies (LLM providers, Redis)
5. Review rate limiting configuration

### High Memory Usage

**Symptoms**: Memory alerts or performance degradation

**Solutions**:
1. Check for memory leaks in logs
2. Review active discussions count
3. Restart application if needed
4. Increase available memory
5. Review cache sizes

### Cost Budget Exceeded

**Symptoms**: Cost alerts triggering

**Solutions**:
1. Review cost breakdown by provider
2. Optimize provider selection
3. Reduce token usage
4. Adjust daily budget if needed
5. Review usage patterns

## Recovery Procedures

### Database Recovery

1. Stop the application
2. Check database file integrity
3. Restore from backup if needed
4. Verify file permissions
5. Restart application

### Service Recovery

1. Check health endpoint: `GET /api/health`
2. Review error logs
3. Check system resources
4. Restart application if needed
5. Verify service is responding

### Data Recovery

1. Stop the application
2. Restore from backup
3. Verify data integrity
4. Restart application
5. Test critical functionality

## Scaling Procedures

### Vertical Scaling

1. Increase server resources (CPU, memory)
2. Update configuration if needed
3. Restart application
4. Monitor performance

### Horizontal Scaling

1. Set up Redis for distributed rate limiting
2. Use shared file storage or object storage
3. Configure load balancer
4. Deploy multiple instances
5. Monitor distributed metrics

## Maintenance Tasks

### Regular Maintenance

**Daily**:
- Review error logs
- Check alert status
- Monitor cost usage

**Weekly**:
- Review metrics and trends
- Check disk space
- Review backup status

**Monthly**:
- Review and optimize costs
- Update dependencies
- Review and tune configuration
- Capacity planning

### Backup Procedures

1. **Database Backup**:
   ```bash
   cp data/conversations.db data/conversations.db.backup
   ```

2. **Discussion Files Backup**:
   ```bash
   cp -r data/discussions data/discussions.backup
   ```

3. **Full System Backup**:
   ```bash
   tar -czf backup-$(date +%Y%m%d).tar.gz data/
   ```

### Update Procedures

1. Pull latest code
2. Install dependencies: `npm install`
3. Run tests: `npm test`
4. Build: `npm run build`
5. Restart application
6. Verify health endpoint

## Monitoring

### Key Metrics to Watch

- Error rate (should be < 5%)
- Response times (p95 should be < 2s)
- Active discussions count
- Cost per day
- Provider availability

### Health Checks

Monitor the health endpoint regularly:
```bash
curl http://localhost:3000/api/health
```

### Log Review

Review logs regularly:
- `logs/error.log`: Error-level logs
- `logs/combined.log`: All logs

## Troubleshooting

### Application Won't Start

1. Check environment variables
2. Verify database path is writable
3. Check port availability
4. Review startup logs
5. Verify dependencies installed

### Performance Issues

1. Check system resources
2. Review slow operation logs
3. Check database query performance
4. Review LLM provider latency
5. Check for memory leaks

### Connection Issues

1. Check Socket.IO connection limits
2. Review rate limiting
3. Check network connectivity
4. Verify authentication
5. Review connection logs

## Emergency Procedures

### Service Outage

1. Check health endpoint
2. Review error logs
3. Check system resources
4. Restart application
5. Escalate if needed

### Data Loss

1. Stop application immediately
2. Assess data loss scope
3. Restore from backup
4. Verify data integrity
5. Resume service

### Security Incident

1. Isolate affected systems
2. Review access logs
3. Change credentials if needed
4. Review and patch vulnerabilities
5. Document incident

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review health check endpoint
- Check environment variables
- Verify API keys are valid
- Review this runbook
