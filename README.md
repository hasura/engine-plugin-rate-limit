# Rate Limiting Plugin for Hasura DDN

## Overview

This plugin for Hasura DDN (Distributed Data Network) implements rate limiting functionality to protect your DDN supergraph
from excessive requests. It provides configurable rate limiting with Redis support for distributed environments and includes
OpenTelemetry integration for observability.

## How it works

1. The plugin starts an Express server that intercepts incoming requests
2. For each request, it:
   - Extracts the client identifier (IP address or custom header)
   - Checks the request count against configured limits
   - Either allows the request or returns a rate limit exceeded response

## Configuration

The plugin can be configured using the configuration files. The plugin reads the configuration from a directory.
The default directory is `config`, but it can be overridden using the `CONFIG_DIRECTORY` environment variable.
The configuration files are:

- `configuration.json`: Contains the authentication headers for the plugin server
- `rate-limit.json`: Contains the rate limiting configuration

The `configuration.json` file looks like this:

```json
{
  "headers": {
    "hasura-m-auth": "your-auth-token"
  }
}
```

For authenticating requests, the plugin expects the `hasura-m-auth` header to match the value in the configuration file.

The `rate-limit.json` file looks like this:

```json
{
  "redis_url": "redis://localhost:6379",
  "rate_limit": {
    "default_limit": 10,
    "time_window": 60,
    "excluded_roles": ["admin"],
    "key_config": {
      "from_headers": ["x-user-id", "x-client-id"],
      "from_session_variables": ["user.id"]
    },
    "unavailable_behavior": {
      "fallback_mode": "deny"
    }
  }
}
```

The rate limiting configuration includes:

- `redis_url`: Redis connection URL
- `rate_limit`: Rate limiting configuration. The rate limiting can be configured using the following parameters:
  - `default_limit`: The default rate limit per window
  - `time_window`: The time window in seconds
  - `excluded_roles`: Roles that are excluded from rate limiting
  - `key_config`: Configuration for generating rate limit keys
  - `unavailable_behavior`: Behavior when Redis is unavailable

## Using the plugin

### Prerequisites

- Docker and Docker Compose

### Docker Development

Add the following service to your DDN's `docker-compose.yaml`:

```yaml
rate-limit:
  build:
    context: https://github.com/hasura/engine-plugin-rate-limit.git
    target: production
  command: ["node", "dist/index.js"]
  container_name: rate-limit-plugin
  ports:
    - "3001:3001"
  environment:
    - PORT=3001
    - DEBUG=rate-limit*
    - OTEL_EXPORTER_OTLP_ENDPOINT=http://local.hasura.dev:4317/v1/traces
    - CONFIG_DIRECTORY=plugin_config
  depends_on:
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
    interval: 30s
    timeout: 10s
    retries: 3
  volumes:
    - ./rate_limit_config:/app/plugin_config

redis:
  image: redis:latest
  container_name: redis-local
  ports:
    - "6379:6379"
  command: redis-server --appendonly yes
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 3
```

This will start:

- The rate limiting plugin on port 3001
- Redis server on port 6379
- Health checks every 30 seconds

Next, create a directory named `rate_limit_config` in the same directory as your `docker-compose.yaml` file. And add the following files to it:

```bash
rate_limit_config/
├── configuration.json
└── rate-limit.json
```

The `configuration.json` file looks like this:

```json
{
  "headers": {
    "hasura-m-auth": "your-auth-token"
  }
}
```

The `rate-limit.json` file looks like this:

```json
{
  "redis_url": "redis://redis:6379",
  "rate_limit": {
    "default_limit": 10,
    "time_window": 60,
    "excluded_roles": [],
    "key_config": {
      "from_headers": [],
      "from_session_variables": ["x-hasura-role"]
    },
    "unavailable_behavior": {
      "fallback_mode": "deny"
    }
  }
}
```

On changing the configuration, please restart the plugin container.

## Using the plugin in DDN

Add the plugin configuration to your DDN metadata:

```yaml
kind: LifecyclePluginHook
version: v1
definition:
  pre: parse
  name: rate-limit
  url:
    valueFromEnv: RATE_LIMIT_PLUGIN_URL
  config:
    request:
      headers:
        additional:
          hasura-m-auth:
            valueFromEnv: RATE_LIMIT_PLUGIN_AUTH_TOKEN
      session: {}
      rawRequest:
        query: {}
        variables: {}
```

## Observability

The plugin includes OpenTelemetry integration for observability:

- Traces are exported to the configured OTLP endpoint
- Supports both W3C and B3 trace context propagation
- Includes HTTP instrumentation for detailed request tracking

Configure tracing endpoint and authentication for local development:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://local.hasura.dev:4317/v1/traces
OTEL_EXPORTER_PAT=your-pat-here
```

For DDN, you can use the following configuration:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://gateway.otlp.hasura.io:443/v1/traces
OTEL_EXPORTER_PAT=your-pat-here
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
Refer to [CONTRIBUTING.md](CONTRIBUTING.md) for more details.
