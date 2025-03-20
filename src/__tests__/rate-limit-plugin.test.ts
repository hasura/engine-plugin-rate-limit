import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import Redis from "ioredis";
import RateLimitPlugin, {
  RateLimitConfig,
  PreParseRequest,
} from "../rate_limit";
import { readFileSync } from "node:fs";

describe("RateLimitPlugin", async () => {
  let redis: Redis;
  let plugin: RateLimitPlugin;

  process.env.HASURA_DDN_PLUGIN_CONFIG_PATH = "src/__tests__/test_config";
  const testConfigPath = `${process.env.HASURA_DDN_PLUGIN_CONFIG_PATH}/rate-limit.json`;
  const testConfig = JSON.parse(
    readFileSync(testConfigPath, "utf8"),
  ) as RateLimitConfig;

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
    plugin = new RateLimitPlugin();
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
    process.env.HASURA_DDN_PLUGIN_CONFIG_PATH =
      "src/__tests__/unavailable_test_config";
    const unavailablePlugin = new RateLimitPlugin();

    try {
      // Wait for Redis connection to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await unavailablePlugin.handleRequest(
        mockRequest,
        mockHeaders,
      );
      assert.strictEqual(
        result.statusCode,
        500,
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
