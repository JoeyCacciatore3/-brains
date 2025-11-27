# Monitoring Guide

This guide covers the monitoring and observability features of the AI Dialogue Platform.

## Overview

The platform includes comprehensive monitoring capabilities including:
- Metrics collection
- Health checks
- Performance monitoring
- Cost tracking
- Alerting

## Metrics

### Metrics Collection

Metrics are collected automatically for:
- Request rates (per operation type)
- Error rates (per error type, per operation)
- Response times (p50, p95, p99)
- LLM API latency (per provider)
- Token usage (input/output per provider)
- Active discussions count
- Socket connection count
- Rate limit hits (per operation)
- Retry attempts and success rates

### Metrics Endpoint

**GET `/api/metrics`**

Returns metrics in Prometheus format for integration with monitoring systems.

Example:
```bash
curl http://localhost:3000/api/metrics
```

## Health Checks

### Health Check Endpoint

**GET `/api/health`**

Returns comprehensive health status including:
- Database connectivity
- Redis connectivity (if enabled)
- LLM provider availability
- Disk space
- Memory usage
- Active socket connections

Example response:
```json
{
  "status": "healthy",
  "timestamp": "2024-12-01T12:00:00.000Z",
  "checks": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" },
    "llm": { "status": "healthy", "details": { "providers": {...} } },
    "disk": { "status": "healthy" },
    "memory": { "status": "healthy" }
  },
  "metrics": {
    "activeDiscussions": 5,
    "socketConnections": 10
  }
}
```

### Health Status Levels

- `healthy`: All systems operational
- `degraded`: Some systems degraded but service available
- `unhealthy`: Critical systems unavailable

## Performance Monitoring

Performance monitoring tracks:
- Request duration
- Database query timing
- LLM API call timing
- File I/O operations timing
- Socket event processing time

Slow operations (exceeding threshold) are automatically logged and tracked.

## Cost Tracking

### Cost Tracking

Costs are tracked per:
- Discussion
- User
- Provider
- Time period (daily/weekly/monthly)

### Cost Endpoint

**GET `/api/costs`**

Returns cost tracking data:
- Cost by provider
- Daily costs
- Budget status
- User costs (if userId provided)

Query parameters:
- `userId` (optional): Filter by user
- `startDate` (optional): Start date for cost range
- `endDate` (optional): End date for cost range

Example:
```bash
curl "http://localhost:3000/api/costs?userId=user123&startDate=2024-12-01&endDate=2024-12-31"
```

## Monitoring Dashboard

### Dashboard Endpoint

**GET `/api/monitoring/dashboard`**

Returns comprehensive dashboard data including:
- System health summary
- Error rates by type
- Provider health status
- Cost summary
- Performance metrics
- Active discussions count
- Circuit breaker status
- Active alerts

## Alerting

### Alert Conditions

Alerts are triggered for:
- High error rate (> 5% in 5 minutes)
- Provider unavailability (all providers down)
- Rate limit exhaustion
- Database issues
- Disk space low (< 10% free)
- Cost threshold exceeded
- Performance degradation

### Alert Severity Levels

- `critical`: Immediate action required
- `high`: Action required soon
- `medium`: Monitor and investigate
- `low`: Informational

### Alert Endpoint

Alerts are automatically checked every minute. Active alerts can be retrieved via the dashboard endpoint.

## Configuration

### Environment Variables

Key monitoring configuration:
- `METRICS_ENABLED`: Enable/disable metrics (default: true)
- `METRICS_RETENTION_HOURS`: How long to retain metrics (default: 24)
- `PERFORMANCE_TRACK_ENABLED`: Enable performance tracking (default: true)
- `PERFORMANCE_SLOW_THRESHOLD_MS`: Slow operation threshold (default: 5000)
- `ALERTS_ENABLED`: Enable/disable alerts (default: true)
- `ALERT_ERROR_RATE_THRESHOLD`: Error rate threshold (default: 0.05)

See `env.example` for complete configuration options.

## Integration

### Prometheus

Metrics are exported in Prometheus format at `/api/metrics`. Configure Prometheus to scrape this endpoint:

```yaml
scrape_configs:
  - job_name: 'ai-dialogue-platform'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

### Grafana

Import the Prometheus data source and create dashboards for:
- Request rates
- Error rates
- Response times
- Cost tracking
- System health

## Best Practices

1. **Monitor Key Metrics**: Focus on error rates, response times, and cost
2. **Set Up Alerts**: Configure alerts for critical conditions
3. **Regular Review**: Review metrics weekly to identify trends
4. **Capacity Planning**: Use metrics to plan for growth
5. **Cost Optimization**: Monitor costs and optimize provider usage
