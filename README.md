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

The plugin can be configured using the configuration file `config.ts`.

```typescript
export const config: Config = {
  headers: {
    "hasura-m-auth": "your-auth-token",
  },
  redis_url: process.env.REDIS_URL || "redis://localhost:6379",
  rate_limit: {
    default_limit: 10, // 10 requests per window
    time_window: 60, // 60 seconds
    excluded_roles: ["admin"],
    key_config: {
      from_headers: ["x-user-id", "x-client-id"],
      from_session_variables: ["user.id"],
    },
    unavailable_behavior: {
      fallback_mode: "deny",
    },
  },
};
```

The configuration includes:
- `headers`: Authentication headers for Hasura DDN
- `redis_url`: Redis connection URL
- `rate_limit`: Rate limiting configuration. The rate limiting can be configured using the following parameters:
  - `default_limit`: The default rate limit per window
  - `time_window`: The time window in seconds
  - `excluded_roles`: Roles that are excluded from rate limiting
  - `key_config`: Configuration for generating rate limit keys
  - `unavailable_behavior`: Behavior when Redis is unavailable

## Development

### Prerequisites

- Node.js 22 or later
- Redis server
- Docker and Docker Compose (for containerized development)

### Local Development

1. Clone the repository:
   ```sh
   git clone https://github.com/hasura/engine-plugin-rate-limit.git
   cd engine-plugin-rate-limit
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Build the project:
   ```sh
   npm run build
   ```

4. Start the dependencies (for local development):
   ```sh
   docker-compose up redis
   ```

5. Start the development server with debug logs:
   ```sh
   DEBUG=rate-limit* node dist/index.js 
   ```

### Docker Development

Use Docker Compose to run the plugin with Redis:

```sh
docker-compose up
```

This will start:
- The rate limiting plugin on port 3001
- Redis server on port 6379
- Health checks every 30 seconds
- Jaeger on port 4002

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

Configure tracing endpoint and authentication:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces
OTEL_EXPORTER_PAT=your-pat-here
```

For DDN, you can use the following configuration:

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://gateway.otlp.hasura.io:443/v1/traces
OTEL_EXPORTER_PAT=your-pat-here
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
