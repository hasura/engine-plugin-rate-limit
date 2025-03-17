import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import Redis from "ioredis";
import RateLimitPlugin, { Config, PreParseRequest } from "../rate_limit";

describe("RateLimitPlugin", async () => {
  let redis: Redis;
  let plugin: RateLimitPlugin;

  const testConfig: Config = {
    headers: { "hasura-m-auth": "test-auth" },
    redis_url: "redis://localhost:6379",
    rate_limit: {
      default_limit: 3,
      time_window: 60,
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

  const mockRequest: PreParseRequest = {
    rawRequest: {
      query: "query { users { id } }",
      variables: {},
      operationName: "GetUsers",
    },
    session: {
      role: "user",
      variables: {
        "user.id": "test-user-123",
      },
    },
  };

  const mockHeaders = {
    "x-user-id": "test-user-123",
    "x-client-id": "test-client-456",
  };

  before(async () => {
    redis = new Redis(testConfig.redis_url);
    plugin = new RateLimitPlugin(testConfig);
  });

  after(async () => {
    // Close both Redis connections
    await Promise.all([redis.quit(), plugin["redis"].disconnect()]);
  });

  test("should allow requests within rate limit", async () => {
    // Clear any existing rate limit data
    const key = `x-user-id:test-user-123:x-client-id:test-client-456:user.id:test-user-123`;
    await redis.del(key);

    // First request should be allowed
    const result1 = await plugin.handleRequest(mockRequest, mockHeaders);
    assert.strictEqual(
      result1.statusCode,
      204,
      "First request should be allowed",
    );

    // Second request should be allowed
    const result2 = await plugin.handleRequest(mockRequest, mockHeaders);
    assert.strictEqual(
      result2.statusCode,
      204,
      "Second request should be allowed",
    );
  });

  test("should block requests exceeding rate limit", async () => {
    const key = `x-user-id:test-user-123:x-client-id:test-client-456:user.id:test-user-123`;
    await redis.del(key);

    // Send requests up to the limit
    for (let i = 0; i < testConfig.rate_limit.default_limit; i++) {
      await plugin.handleRequest(mockRequest, mockHeaders);
    }

    // Next request should be blocked
    const result = await plugin.handleRequest(mockRequest, mockHeaders);
    assert.strictEqual(result.statusCode, 400, "Request should be blocked");
    assert.strictEqual(result.body?.extensions?.code, "RATE_LIMIT_EXCEEDED");
  });

  test("should exclude admin roles from rate limiting", async () => {
    const adminRequest = {
      ...mockRequest,
      session: {
        ...mockRequest.session,
        role: "admin",
      },
    };

    // Should allow admin requests regardless of rate limit
    const result = await plugin.handleRequest(adminRequest, mockHeaders);
    assert.strictEqual(
      result.statusCode,
      204,
      "Admin request should be allowed",
    );
  });

  test("should handle Redis unavailability according to fallback mode", async () => {
    // Create a new plugin instance with Redis connection to invalid port
    const unavailableConfig: Config = {
      ...testConfig,
      redis_url: "redis://localhost:6380", // Invalid port
      rate_limit: {
        ...testConfig.rate_limit,
        unavailable_behavior: {
          fallback_mode: "deny",
        },
      },
    };
    const unavailablePlugin = new RateLimitPlugin(unavailableConfig);

    try {
      // Wait for Redis connection to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await unavailablePlugin.handleRequest(
        mockRequest,
        mockHeaders,
      );
      assert.strictEqual(
        result.statusCode,
        503,
        "Should return service unavailable",
      );
      assert.strictEqual(result.body?.extensions?.code, "REDIS_UNAVAILABLE");
    } finally {
      // Force disconnect the Redis connection
      unavailablePlugin["redis"].disconnect();
    }
  });

  test("should build correct rate limit key", async () => {
    const key = `x-user-id:test-user-123:x-client-id:test-client-456:user.id:test-user-123`;
    await redis.del(key);

    await plugin.handleRequest(mockRequest, mockHeaders);

    // Check if the key exists in Redis
    const exists = await redis.exists(key);
    assert.strictEqual(exists, 1, "Rate limit key should exist in Redis");
  });
});
