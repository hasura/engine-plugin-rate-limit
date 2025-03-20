import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import Redis from "ioredis";
import RateLimitPlugin, {
  RateLimitConfig,
  PreParseRequest,
} from "../rate_limit";
import { readFileSync } from "node:fs";

describe("RateLimitPlugin", () => {
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

  beforeAll(async () => {
    redis = new Redis(testConfig.redis_url);
    plugin = new RateLimitPlugin();
  });

  afterAll(async () => {
    // Close both Redis connections
    await Promise.all([redis.quit(), plugin["redis"].disconnect()]);
  });

  test("should allow requests within rate limit", async () => {
    // Clear any existing rate limit data
    const key = `x-user-id:test-user-123:x-client-id:test-client-456:user.id:test-user-123`;
    await redis.del(key);

    // First request should be allowed
    const result1 = await plugin.handleRequest(mockRequest, mockHeaders);
    expect(result1.statusCode).toBe(204);

    // Second request should be allowed
    const result2 = await plugin.handleRequest(mockRequest, mockHeaders);
    expect(result2.statusCode).toBe(204);
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
    expect(result.statusCode).toBe(400);
    expect(result.body?.extensions?.code).toBe("RATE_LIMIT_EXCEEDED");
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
    expect(result.statusCode).toBe(204);
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
      expect(result.statusCode).toBe(500);
      expect(result.body?.extensions?.code).toBe("REDIS_UNAVAILABLE");
    } finally {
      // Force disconnect the Redis connection
      unavailablePlugin["redis"].disconnect();
    }
  });

  test("should build correct rate limit key", async () => {
    const key = `role:user:x-user-id:test-user-123:x-client-id:test-client-456:user.id:test-user-123`;
    await redis.del(key);

    await plugin.handleRequest(mockRequest, mockHeaders);

    // Check if the key exists in Redis
    const exists = await redis.exists(key);
    expect(exists).toBe(1);
  });
});
