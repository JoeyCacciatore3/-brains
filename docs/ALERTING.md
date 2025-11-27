# Alerting Guide

This guide covers the alerting system for the AI Dialogue Platform.

## Overview

The alerting system monitors system conditions and triggers alerts when thresholds are exceeded. Alerts are checked automatically every minute.

## Alert Types

### Error Rate Alerts

**Condition**: Error rate exceeds threshold (default: 5% in 5 minutes)

**Severity**:
- `critical`: Error rate > 20%
- `high`: Error rate > 10%
- `medium`: Error rate > 5%

**Action**: Investigate error logs and system health

### Provider Availability Alerts

**Condition**: LLM providers unavailable

**Severity**:
- `critical`: No providers available
- `high`: Some providers unavailable (< 3)

**Action**: Check provider API status and credentials

### Circuit Breaker Alerts

**Condition**: Circuit breakers open

**Severity**:
- `critical`: 2+ circuit breakers open
- `high`: 1 circuit breaker open

**Action**: Investigate provider failures and system load

### Database Alerts

**Condition**: Database health check fails

**Severity**: `critical`

**Action**: Check database connectivity and disk space

### Redis Alerts

**Condition**: Redis connection fails

**Severity**: `high`

**Action**: Check Redis server status (system falls back to in-memory)

### Disk Space Alerts

**Condition**: Disk space low or not writable

**Severity**: `critical`

**Action**: Free up disk space or expand storage

### Cost Alerts

**Condition**: Cost budget exceeded or approaching limit

**Severity**:
- `high`: Budget exceeded
- `medium`: Budget > 80% used

**Action**: Review usage and adjust budget if needed

### System Load Alerts

**Condition**: High CPU or memory usage

**Severity**: `high`

**Action**: Investigate resource usage and scale if needed

## Configuration

### Environment Variables

- `ALERTS_ENABLED`: Enable/disable alerts (default: true)
- `ALERT_ERROR_RATE_THRESHOLD`: Error rate threshold (default: 0.05)
- `ALERT_DISK_SPACE_THRESHOLD`: Disk space threshold (default: 0.1)
- `ALERT_WEBHOOK_URL`: Webhook URL for notifications (optional)

### Alert Thresholds

Adjust thresholds based on your requirements:
- Lower thresholds = more alerts (more sensitive)
- Higher thresholds = fewer alerts (less sensitive)

## Alert Response

### Critical Alerts

1. **Immediate Investigation**: Check system health and logs
2. **Service Impact**: Assess impact on users
3. **Recovery Actions**: Take steps to restore service
4. **Documentation**: Document incident and resolution

### High Alerts

1. **Investigation**: Review within 1 hour
2. **Monitoring**: Monitor closely for escalation
3. **Preventive Actions**: Take preventive measures if needed

### Medium Alerts

1. **Review**: Review within 24 hours
2. **Trend Analysis**: Check if trend is improving or worsening
3. **Optimization**: Consider optimizations if persistent

## Alert Channels

### Log-Based Alerts

Alerts are automatically logged:
- Critical/High: Error level
- Medium/Low: Warning level

### Webhook Notifications (Future)

Configure `ALERT_WEBHOOK_URL` to send alerts to external systems:
- Slack
- PagerDuty
- Custom webhook endpoints

## Best Practices

1. **Tune Thresholds**: Adjust thresholds based on your system's normal behavior
2. **Avoid Alert Fatigue**: Don't set thresholds too low
3. **Document Responses**: Document standard responses for common alerts
4. **Regular Review**: Review alert effectiveness monthly
5. **Escalation**: Set up escalation paths for critical alerts

## Troubleshooting

### Too Many Alerts

- Increase thresholds
- Review if alerts are legitimate
- Check for system issues causing false positives

### Missing Alerts

- Check `ALERTS_ENABLED` is true
- Verify alert conditions are being met
- Review alert check interval

### Alert Not Clearing

- Check if underlying issue is resolved
- Verify alert conditions are no longer met
- Review alert deduplication logic
