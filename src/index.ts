import { SpanStatusCode, context, propagation } from "@opentelemetry/api";
import { CompositePropagator } from "@opentelemetry/core";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { B3Propagator, B3InjectEncoding } from "@opentelemetry/propagator-b3";
import { Resource } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import express from "express";
import RateLimitPlugin, { PreParseRequest } from "./rate_limit";
import { tracer } from "./tracer";
import { readFileSync } from "node:fs";
import { z } from "zod";

const configSchema = z.object({
  headers: z.object({
    "hasura-m-auth": z.string(),
  }),
});

type Config = z.infer<typeof configSchema>;

interface TraceHeaders {
  [key: string]: string;
}

// Register both W3C and B3 propagators
propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new B3Propagator({
        injectEncoding: B3InjectEncoding.MULTI_HEADER, // Use multi-header B3 format
      }),
    ],
  }),
);

const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "rate-limit-plugin",
  }),
});

const traceExporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    "http://localhost:4318/v1/traces",
  headers: {
    Authorization: `pat ${process.env.OTEL_EXPORTER_PAT || ""}`,
  },
});

provider.addSpanProcessor(new SimpleSpanProcessor(traceExporter));
provider.register();

registerInstrumentations({ instrumentations: [new HttpInstrumentation()] });

const app = express();
app.use(express.json());

// Read configuration from environment variables
const configDirectory = process.env.HASURA_DDN_PLUGIN_CONFIG_PATH || "config";
const configPath = `${configDirectory}/configuration.json`;
const rawConfig = JSON.parse(readFileSync(configPath, "utf8"));
const config = configSchema.parse(rawConfig);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Add middleware to extract trace context
app.use((req, res, next) => {
  const extractedContext = propagation.extract(context.active(), req.headers);
  return context.with(extractedContext, () => {
    next();
  });
});

// Add middleware for authentication
app.use(async (req, res, next) => {
  return tracer.startActiveSpan("authenticate-middleware", async (span) => {
    span.setAttribute("internal.visibility", String("user"));
    tracer.startActiveSpan("authenticate", async (authSpan) => {
      authSpan.setAttribute("internal.visibility", String("user"));

      if (config.headers["hasura-m-auth"] !== req.headers["hasura-m-auth"]) {
        authSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Invalid authentication token",
        });
        authSpan.end();
        res.status(400).json({ error: "Unauthorized request" });
      } else {
        authSpan.end();
        next();
      }
    });
    span.end();
  });
});

// Initialize the rate limit plugin
const rateLimiter = new RateLimitPlugin();

// Rate-limit endpoint
app.post("/rate-limit", async (req, res) => {
  return tracer.startActiveSpan("rate-limit", async (span) => {
    try {
      span.setAttribute("internal.visibility", String("user"));
      // Parse Express request body as PreParseRequest format
      const preParseRequest = req.body as PreParseRequest;
      if (preParseRequest.rawRequest.operationName) {
        span.setAttribute(
          "graphql.operation.name",
          preParseRequest.rawRequest.operationName,
        );
      }
      const headers = req.headers as Record<string, string>;
      const result = await rateLimiter.handleRequest(preParseRequest, headers);
      res.status(result.statusCode).json(result.body);
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(error),
      });
      span.recordException(error as Error);
      console.error("Rate limiting error:", error);
      res.status(500).json({ error: "Internal Server Error" });
    } finally {
      span.end();
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
