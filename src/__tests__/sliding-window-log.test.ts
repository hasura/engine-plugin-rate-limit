import { test, describe, after } from "node:test";
import assert from "node:assert";
import { readFileSync } from "fs";
import { join } from "path";
import Redis from "ioredis";

describe("Sliding Window Log Rate Limiter", async () => {
  const redis = new Redis();

  // Load the Lua script
  const luaScript = readFileSync(
    join(__dirname, "../../scripts/lua_scripts/sliding_window_log.lua"),
    "utf-8",
  );

  // Define the rate limit command
  redis.defineCommand("checkRateLimit", {
    numberOfKeys: 1,
    lua: luaScript,
  });

  test("should allow requests within limit", async () => {
    const key = "test:rate:1";
    await redis.del(key);

    const limit = 3;
    const currentTime = Math.floor(Date.now() / 1000);
    const window = 60; // 60 seconds
    const prevTime = currentTime - window;

    // First request
    const result1 = await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req1",
    );
    assert.strictEqual(
      result1,
      0,
      "First request should show 0 previous requests",
    );

    // Second request
    const result2 = await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req2",
    );
    assert.strictEqual(
      result2,
      1,
      "Second request should show 1 previous request",
    );
  });

  test("should respect rate limit", async () => {
    const key = "test:rate:2";
    await redis.del(key);

    const limit = 2;
    const currentTime = Math.floor(Date.now() / 1000);
    const window = 60;
    const prevTime = currentTime - window;

    // Fill up to limit
    await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req1",
    );
    await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req2",
    );

    // Try one more request
    const result = await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req3",
    );
    assert.strictEqual(
      result >= limit,
      true,
      "Should indicate rate limit exceeded",
    );
  });

  test("should expire old requests", async () => {
    const key = "test:rate:3";
    await redis.del(key);

    const limit = 2;
    const window = 60;
    let currentTime = Math.floor(Date.now() / 1000);
    let prevTime = currentTime - window;

    // Add two requests
    await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req1",
    );
    await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req2",
    );

    // Move time forward past window
    currentTime += window + 1;
    prevTime = currentTime - window;

    // Should allow new request since old ones expired
    const result = await (redis as any).checkRateLimit(
      key,
      limit,
      currentTime,
      prevTime,
      window,
      "req3",
    );
    assert.strictEqual(
      result,
      0,
      "Should show 0 previous requests after window expired",
    );
  });

  after(async () => {
    // Cleanup
    await redis.quit();
  });
});
