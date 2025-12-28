# MCP Connect Security Guide

Comprehensive security documentation for deploying and operating MCP Connect in production environments.

---

## Table of Contents

1. [Security Overview](#security-overview)
2. [Authentication](#authentication)
3. [Authorization](#authorization)
4. [Transport Security](#transport-security)
5. [Secret Management](#secret-management)
6. [Input Validation](#input-validation)
7. [Rate Limiting & DDoS Protection](#rate-limiting--ddos-protection)
8. [Audit Logging](#audit-logging)
9. [Network Security](#network-security)
10. [Compliance](#compliance)
11. [Incident Response](#incident-response)
12. [Security Checklist](#security-checklist)

---

## Security Overview

MCP Connect acts as a gateway between your applications and MCP servers, making security paramount. This guide covers:

- **Defense in depth** - Multiple layers of security controls
- **Least privilege** - Minimal permissions for each component
- **Zero trust** - Verify every request, trust nothing by default

### Security Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │  TLS/HTTPS    │  Layer 1: Transport Security
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  WAF/Proxy    │  Layer 2: Edge Protection
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  Rate Limiter │  Layer 3: Traffic Control
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  API Auth     │  Layer 4: Authentication
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  Authorization│  Layer 5: Access Control
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  Input Valid. │  Layer 6: Data Validation
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │  MCP Connect  │  Application Layer
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌─────────┐   ┌─────────┐   ┌─────────┐
        │MCP Srv 1│   │MCP Srv 2│   │MCP Srv 3│
        └─────────┘   └─────────┘   └─────────┘
```

---

## Authentication

### API Key Authentication

MCP Connect uses API keys for authentication. Each key is a unique, cryptographically secure token.

**Best Practices:**

1. **Generate Strong Keys**
   ```bash
   # Generate a secure API key
   openssl rand -base64 32
   # Output: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
   ```

2. **Use Unique Keys Per Environment**
   ```bash
   # Development
   API_KEYS_DEV=dev-key-xxxxxxxxxx

   # Staging
   API_KEYS_STAGING=staging-key-xxxxxxxxxx

   # Production
   API_KEYS_PROD=prod-key-xxxxxxxxxx
   ```

3. **Rotate Keys Regularly**
   - Production: Every 90 days
   - Development: Every 30 days
   - After any suspected compromise: Immediately

4. **Key Naming Convention**
   ```
   {environment}-{purpose}-{random}
   prod-api-abc123
   staging-webhook-def456
   dev-testing-ghi789
   ```

### Key Rotation Process

```javascript
// 1. Add new key to configuration
const newKey = generateSecureKey();
await addApiKey(newKey, 'new-prod-key');

// 2. Update applications to use new key
// Deploy updates to all services

// 3. Monitor for old key usage
const oldKeyUsage = await getKeyUsageStats('old-prod-key');
if (oldKeyUsage.last7Days === 0) {
  // 4. Remove old key
  await revokeApiKey('old-prod-key');
}
```

### OAuth2 Support for MCP Servers

For MCP servers requiring OAuth2:

```json
{
  "auth": {
    "type": "oauth2",
    "clientId": "${OAUTH_CLIENT_ID}",
    "clientSecret": "${OAUTH_CLIENT_SECRET}",
    "tokenUrl": "https://auth.example.com/oauth/token",
    "scopes": ["read", "write"]
  }
}
```

**Security Considerations:**
- Store client secrets in environment variables or secret managers
- Use minimal required scopes
- Token refresh is handled automatically
- Tokens are cached securely in memory (not persisted)

---

## Authorization

### Role-Based Access Control (RBAC)

Define roles with specific permissions:

```json
{
  "roles": {
    "admin": {
      "permissions": ["*"]
    },
    "operator": {
      "permissions": [
        "servers:read",
        "servers:connect",
        "servers:disconnect",
        "tools:read",
        "tools:invoke"
      ]
    },
    "viewer": {
      "permissions": [
        "servers:read",
        "tools:read",
        "monitor:read"
      ]
    }
  }
}
```

### Permission Types

| Permission | Description |
|------------|-------------|
| `servers:read` | View server configurations |
| `servers:write` | Create/update servers |
| `servers:delete` | Delete servers |
| `servers:connect` | Connect to servers |
| `servers:disconnect` | Disconnect servers |
| `tools:read` | View available tools |
| `tools:invoke` | Invoke tools |
| `groups:read` | View server groups |
| `groups:write` | Manage groups |
| `webhooks:read` | View webhooks |
| `webhooks:write` | Manage webhooks |
| `audit:read` | View audit logs |
| `cache:read` | View cache stats |
| `cache:write` | Clear cache |
| `monitor:read` | View monitoring data |

### Per-Key Permissions

```json
{
  "keys": [
    {
      "id": "prod-api-abc123",
      "name": "Production API",
      "role": "operator",
      "serverAccess": ["server-1", "server-2"],
      "toolAccess": ["read_file", "write_file"]
    }
  ]
}
```

### Server-Level Access Control

Restrict which servers a key can access:

```json
{
  "id": "limited-key",
  "serverAccess": {
    "type": "allowlist",
    "servers": ["filesystem-server", "github-server"]
  }
}
```

### Tool-Level Access Control

Restrict which tools a key can invoke:

```json
{
  "id": "readonly-key",
  "toolAccess": {
    "type": "allowlist",
    "tools": ["read_file", "list_directory", "search_files"]
  }
}
```

---

## Transport Security

### HTTPS/TLS Configuration

**Required:** All production deployments must use HTTPS.

**Nginx Configuration:**
```nginx
server {
    listen 443 ssl http2;
    server_name mcp-connect.example.com;

    ssl_certificate /etc/ssl/certs/mcp-connect.crt;
    ssl_certificate_key /etc/ssl/private/mcp-connect.key;

    # Modern TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### WebSocket Security

For WebSocket transports:

```json
{
  "transport": {
    "type": "websocket",
    "url": "wss://secure-mcp.example.com/ws",
    "headers": {
      "Authorization": "Bearer ${MCP_TOKEN}"
    }
  }
}
```

**Requirements:**
- Always use `wss://` (WebSocket Secure)
- Validate certificates in production
- Implement heartbeat for connection validation

### Internal Communication

For MCP servers on the same network:

```json
{
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-server-filesystem"]
  }
}
```

**stdio transport** is inherently secure as it uses process pipes without network exposure.

---

## Secret Management

### Environment Variables

**Do:**
```bash
# Use environment variables for secrets
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
export DATABASE_URL=postgres://user:pass@host/db
```

**Don't:**
```json
// Never put secrets in config files
{
  "transport": {
    "env": {
      "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"  // BAD!
    }
  }
}
```

### Secret Managers

**AWS Secrets Manager:**
```javascript
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');

async function getSecrets() {
  const client = new SecretsManager();
  const response = await client.getSecretValue({
    SecretId: 'mcp-connect/production'
  });
  return JSON.parse(response.SecretString);
}
```

**HashiCorp Vault:**
```javascript
const vault = require('node-vault')({
  apiVersion: 'v1',
  endpoint: 'https://vault.example.com'
});

async function getSecrets() {
  const result = await vault.read('secret/data/mcp-connect');
  return result.data.data;
}
```

### Secret Rotation

Implement automatic secret rotation:

```javascript
class SecretRotator {
  constructor(secretManager) {
    this.secretManager = secretManager;
    this.cache = new Map();
    this.ttl = 3600000; // 1 hour
  }

  async getSecret(name) {
    const cached = this.cache.get(name);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const value = await this.secretManager.getSecret(name);
    this.cache.set(name, {
      value,
      expiresAt: Date.now() + this.ttl
    });

    return value;
  }
}
```

---

## Input Validation

### Request Validation

All inputs are validated using Zod schemas:

```typescript
import { z } from 'zod';

const ServerConfigSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  transport: TransportConfigSchema,
  auth: AuthConfigSchema,
  // ...
});

// Automatically rejects invalid input
app.post('/api/servers', async (req, res) => {
  const result = ServerConfigSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: result.error.issues
    });
  }
  // Proceed with validated data
});
```

### Tool Argument Validation

Tool arguments are validated against their schema:

```javascript
// Tool schema from MCP server
const toolSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    encoding: { type: 'string', enum: ['utf-8', 'binary'] }
  },
  required: ['path']
};

// Validation before invocation
function validateToolArgs(schema, args) {
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  if (!validate(args)) {
    throw new ValidationError(validate.errors);
  }
}
```

### Path Traversal Prevention

```javascript
const path = require('path');

function validatePath(userPath, allowedBase) {
  const resolved = path.resolve(allowedBase, userPath);

  // Ensure path is within allowed directory
  if (!resolved.startsWith(allowedBase)) {
    throw new SecurityError('Path traversal attempt detected');
  }

  return resolved;
}
```

### SQL Injection Prevention

For database operations:

```javascript
// Use parameterized queries
const result = await db.query(
  'SELECT * FROM servers WHERE id = $1',
  [serverId]
);

// Never string concatenate
// BAD: `SELECT * FROM servers WHERE id = '${serverId}'`
```

---

## Rate Limiting & DDoS Protection

### Rate Limit Configuration

```javascript
const rateLimits = {
  // Per API key
  perKey: {
    requestsPerMinute: 60,
    requestsPerDay: 10000
  },

  // Per IP (unauthenticated)
  perIp: {
    requestsPerMinute: 10,
    requestsPerDay: 100
  },

  // Per endpoint
  perEndpoint: {
    '/api/tools/*/invoke': {
      requestsPerMinute: 30
    },
    '/api/servers/bulk/*': {
      requestsPerMinute: 5
    }
  }
};
```

### Rate Limit Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1705315860
```

### DDoS Protection

**Cloudflare Configuration:**
```javascript
// Recommended Cloudflare settings
{
  "security_level": "high",
  "challenge_passage": 30,
  "browser_check": true,
  "privacy_pass": false,

  // Rate limiting rules
  "rate_limits": [
    {
      "match": { "path": "/api/*" },
      "threshold": 100,
      "period": 60,
      "action": "challenge"
    }
  ]
}
```

**Circuit Breaker:**
```javascript
// Automatic protection against downstream failures
const circuitBreaker = {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 3,      // Close after 3 successes
  timeout: 60000,           // Reset after 1 minute
  volumeThreshold: 10       // Minimum requests to evaluate
};
```

---

## Audit Logging

### What Gets Logged

| Event Category | Details Captured |
|----------------|------------------|
| Authentication | API key used, IP address, timestamp |
| Server Operations | Create, update, delete, connect, disconnect |
| Tool Invocations | Tool name, arguments (sanitized), duration, success/failure |
| Configuration Changes | What changed, who changed it, before/after |
| Security Events | Failed auth, rate limits, blocked requests |

### Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "event": "tool.invoked",
  "requestId": "req-abc123",
  "actor": {
    "type": "api_key",
    "id": "key-xyz789",
    "name": "Production API"
  },
  "resource": {
    "type": "tool",
    "name": "read_file",
    "serverId": "server-123"
  },
  "details": {
    "arguments": {
      "path": "/home/user/[REDACTED]"
    },
    "duration": 45,
    "success": true
  },
  "context": {
    "ip": "192.168.1.1",
    "userAgent": "MCP-Client/1.0"
  }
}
```

### Log Retention

```javascript
const logRetention = {
  securityEvents: '1 year',
  auditLogs: '90 days',
  accessLogs: '30 days',
  debugLogs: '7 days'
};
```

### Sensitive Data Redaction

```javascript
function redactSensitiveData(data) {
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

  return JSON.stringify(data, (key, value) => {
    if (sensitiveFields.some(f => key.toLowerCase().includes(f))) {
      return '[REDACTED]';
    }
    return value;
  });
}
```

---

## Network Security

### Firewall Rules

```bash
# Only allow HTTPS
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Allow health checks from load balancer
iptables -A INPUT -s 10.0.0.0/8 -p tcp --dport 3000 -j ACCEPT

# Drop everything else
iptables -A INPUT -j DROP
```

### Network Segmentation

```
┌─────────────────────────────────────────────────────────────┐
│ DMZ (Public)                                                 │
│  ┌─────────────┐                                            │
│  │ Load Balancer│                                           │
│  └──────┬──────┘                                            │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────────┐
│ Application Zone                                             │
│  ┌──────▼──────┐                                            │
│  │ MCP Connect │                                            │
│  └──────┬──────┘                                            │
└─────────┼───────────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────────┐
│ Internal Zone (Restricted)                                   │
│  ┌──────▼──────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ MCP Servers │  │  Database   │  │  Cache      │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### Container Security

```dockerfile
# Use non-root user
FROM node:20-alpine
RUN addgroup -g 1001 -S mcp && adduser -u 1001 -S mcp -G mcp
USER mcp

# Read-only filesystem
# --read-only in docker run

# No new privileges
# --security-opt=no-new-privileges in docker run
```

---

## Compliance

### GDPR Compliance

1. **Data Minimization** - Only collect necessary data
2. **Purpose Limitation** - Use data only for stated purposes
3. **Storage Limitation** - Implement log retention policies
4. **Right to Erasure** - Provide data deletion capabilities
5. **Data Portability** - Export audit logs on request

### SOC 2 Considerations

| Control | Implementation |
|---------|----------------|
| Access Control | API key authentication, RBAC |
| Logging | Comprehensive audit logging |
| Encryption | TLS for all communications |
| Availability | Health checks, circuit breakers |
| Change Management | Version-controlled configurations |

### HIPAA Considerations

If processing healthcare data:

1. Enable BAA with cloud providers
2. Encrypt data at rest and in transit
3. Implement PHI access logging
4. Configure 6-year log retention
5. Conduct regular security assessments

---

## Incident Response

### Security Incident Playbook

**1. Detection**
```bash
# Monitor for anomalies
curl -H "Authorization: Bearer admin-key" \
  "https://your-deployment/api/audit?action=auth.failed&limit=100"
```

**2. Containment**
```bash
# Revoke compromised key immediately
curl -X DELETE \
  -H "Authorization: Bearer admin-key" \
  "https://your-deployment/api/keys/compromised-key-id"

# Block suspicious IP
# Add to WAF blocklist
```

**3. Investigation**
```bash
# Export audit logs
curl -H "Authorization: Bearer admin-key" \
  "https://your-deployment/api/audit/export?from=2024-01-01&to=2024-01-15" \
  > incident-logs.json
```

**4. Recovery**
```bash
# Rotate all potentially affected credentials
# Deploy new API keys to all services
# Verify all servers are reconnected
```

**5. Post-Incident**
- Document timeline and actions taken
- Identify root cause
- Implement preventive measures
- Update security procedures

---

## Security Checklist

### Deployment Checklist

- [ ] HTTPS enabled with valid TLS certificate
- [ ] Strong API keys generated (32+ characters)
- [ ] Secrets stored in environment variables or secret manager
- [ ] Rate limiting configured and tested
- [ ] Audit logging enabled
- [ ] Log retention policy implemented
- [ ] Firewall rules configured
- [ ] Health check endpoints secured
- [ ] Error messages don't leak sensitive info
- [ ] CORS configured correctly

### Operational Checklist

- [ ] API keys rotated every 90 days
- [ ] Audit logs reviewed weekly
- [ ] Security patches applied promptly
- [ ] Access reviews conducted quarterly
- [ ] Incident response plan tested annually
- [ ] Backup and recovery tested
- [ ] Penetration testing conducted annually

### Monitoring Checklist

- [ ] Failed authentication attempts monitored
- [ ] Rate limit breaches alerted
- [ ] Circuit breaker state changes logged
- [ ] Unusual traffic patterns detected
- [ ] Server disconnections tracked
- [ ] Error rate thresholds configured

---

## Contact

For security issues, please report to: security@your-org.com

Do not disclose security vulnerabilities publicly until they have been addressed.
