import Redis from "ioredis";
import fs from "fs";
import path from "path";
import debug from "debug";
import { randomUUID } from "crypto";
import { tracer } from "./tracer";
import { SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";

const log = debug("rate-limit");
const logKey = log.extend("key");
const logEval = log.extend("eval");

export const rateLimitConfigSchema = z.object({
  redis_url: z.string(),
  rate_limit: z.object({
    default_limit: z.number(),
    time_window: z.number(),
    excluded_roles: z.array(z.string()),
    key_config: z.object({
      from_headers: z.array(z.string()),
      from_session_variables: z.array(z.string()),
    }),
    unavailable_behavior: z.object({
      fallback_mode: z.union([z.literal("allow"), z.literal("deny")]),
    }),
  }),
});

export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;

export interface PreParseRequest {
  rawRequest: {
    query: string;
    variables: Record<string, any>;
    operationName?: string;
  };
  session: {
    role: string;
    variables: Record<string, string>;
  };
}

export default class RateLimitPlugin {
  private redis: Redis;
  private config: RateLimitConfig;

  constructor() {
    const configDirectory =
      process.env.HASURA_DDN_PLUGIN_CONFIG_PATH || "config";
    const configPath = `${configDirectory}/rate-limit.json`;
    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    this.config = rateLimitConfigSchema.parse(rawConfig);
    this.redis = new Redis(this.config.redis_url);

    // Handle Redis connection errors
    this.redis.on("error", (err) => {
      log("Redis connection error: %O", err);
      // You might want to emit this error to your error monitoring service
      // or handle it according to your application's needs
    });

    // Optional: Handle Redis connection events
    this.redis.on("connect", () => {
      log("Connected to Redis");
    });

    this.redis.on("ready", () => {
      log("Redis is ready to receive commands");
    });

    // Define the rate limit command
    this.redis.defineCommand("checkRateLimit", {
      numberOfKeys: 1,
      lua: fs.readFileSync(
        path.join(__dirname, "../scripts/lua_scripts/sliding_window_log.lua"),
        "utf8",
      ),
    });
  }

  private buildRateLimitKey(
    request: PreParseRequest,
    headers: Record<string, string>,
  ): string {
    return tracer.startActiveSpan("buildRateLimitKey", (span) => {
      try {
        span.setAttribute("internal.visibility", String("user"));
        const parts: string[] = [];

        // Add headers to key
        for (const header of this.config.rate_limit.key_config.from_headers) {
          const value = headers[header] || "";
          parts.push(`${header}:${value}`);
          logKey("Adding header to key: %s=%s", header, value);
        }

        // Add session variables to key
        for (const variable of this.config.rate_limit.key_config
          .from_session_variables) {
          const value = request.session.variables[variable] || "";
          parts.push(`${variable}:${value}`);
          logKey("Adding session variable to key: %s=%s", variable, value);
        }

        const key = parts.join(":");
        logKey("Generated key: %s", key);
        span.setAttribute("rate_limit.key", key);
        return key;
      } catch (error) {
        log("Error building rate limit key: %O", error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async handleRequest(
    request: PreParseRequest,
    headers: Record<string, string>,
  ) {
    return tracer.startActiveSpan("handleRequest", async (span) => {
      try {
        span.setAttribute("internal.visibility", String("user"));
        if (request.rawRequest.operationName) {
          span.setAttribute(
            "graphql.operation.name",
            request.rawRequest.operationName,
          );
        }
        span.setAttribute("session.role", request.session.role);

        // Check Redis connection status
        if (this.redis.status !== "ready") {
          log("Redis is not ready. Status: %s", this.redis.status);
          span.setAttribute("redis.status", this.redis.status);

          if (
            this.config.rate_limit.unavailable_behavior.fallback_mode ===
            "allow"
          ) {
            log("Redis unavailable - falling back to allow mode");
            span.setAttribute("rate_limit.fallback", "allow");
            span.addEvent("Redis unavailable - falling back to allow mode");
            span.end();
            return { statusCode: 204 };
          }

          span.setAttribute("rate_limit.fallback", "deny");
          span.addEvent("Redis unavailable - falling back to deny mode");
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Redis unavailable",
          });
          span.end();
          return {
            statusCode: 500,
            body: {
              message: "Service temporarily unavailable",
              extensions: {
                code: "REDIS_UNAVAILABLE",
              },
            },
          };
        }

        // Check if role is excluded
        if (
          this.config.rate_limit.excluded_roles.includes(request.session.role)
        ) {
          log("Request excluded due to role: %s", request.session.role);
          span.setAttribute("rate_limit.excluded", true);
          span.addEvent(
            "Request excluded as role is excluded from rate limiting",
          );
          span.end();
          return { statusCode: 204 }; // Continue
        }

        const key = this.buildRateLimitKey(request, headers);
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - this.config.rate_limit.time_window;

        // Create unique request ID using UUID
        const uniqueRequestId = `${request.rawRequest.operationName || "anonymous"}-${randomUUID()}`;
        span.setAttribute("request.id", uniqueRequestId);

        logEval("Evaluating rate limit for key: %s", key);
        logEval("Time window: %d to %d", windowStart, now);

        span.setAttribute("rate_limit.window.start", windowStart);
        span.setAttribute("rate_limit.window.end", now);
        span.setAttribute("rate_limit.key", key);

        // Use the defined command instead of eval
        const result = (await tracer.startActiveSpan(
          "checkRateLimit",
          async (innerSpan) => {
            try {
              innerSpan.setAttribute("internal.visibility", String("user"));
              innerSpan.setAttribute("rate_limit.key", key);
              innerSpan.setAttribute(
                "rate_limit.limit",
                this.config.rate_limit.default_limit,
              );
              innerSpan.setAttribute("rate_limit.window.start", windowStart);
              innerSpan.setAttribute("rate_limit.window.end", now);
              innerSpan.setAttribute("rate_limit.request.id", uniqueRequestId);
              return await (this.redis as any).checkRateLimit(
                key,
                this.config.rate_limit.default_limit,
                now,
                windowStart,
                this.config.rate_limit.time_window,
                uniqueRequestId,
              );
            } catch (error) {
              innerSpan.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(error),
              });
              throw error;
            } finally {
              innerSpan.end();
            }
          },
        )) as number;

        logEval(
          "Rate limit count: %d/%d",
          result,
          this.config.rate_limit.default_limit,
        );

        span.setAttribute("rate_limit.count", result);
        span.setAttribute(
          "rate_limit.limit",
          this.config.rate_limit.default_limit,
        );

        if (result >= this.config.rate_limit.default_limit) {
          log("Rate limit exceeded for key: %s", key);
          span.setAttribute("rate_limit.allowed", false);
          span.addEvent("Rate limit exceeded!");
          span.end();
          return {
            statusCode: 400,
            body: {
              message: "Rate limit exceeded",
              extensions: {
                code: "RATE_LIMIT_EXCEEDED",
              },
            },
          };
        }

        log("Request allowed for key: %s", key);
        span.setAttribute("rate_limit.allowed", true);
        span.end();
        return { statusCode: 204 }; // Continue
      } catch (error) {
        log("Error during rate limit check: %O", error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(error),
        });
        span.end();
        return {
          statusCode: 500,
          body: {
            message: "Internal server error during rate limit check",
            extensions: {
              code: "RATE_LIMIT_ERROR",
            },
          },
        };
      }
    });
  }
}
