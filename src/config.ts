import { Config } from "./rate_limit";

export const config: Config = {
  headers: {
    "hasura-m-auth": "your-auth-token",
  },
  redis_url: process.env.REDIS_URL || "redis://localhost:6379",
  rate_limit: {
    default_limit: 10, // 10 requests per window
    time_window: 60, // 60 seconds
    excluded_roles: [],
    key_config: {
      from_headers: [],
      from_session_variables: ["x-hasura-role"],
    },
    unavailable_behavior: {
      fallback_mode: "deny",
    },
  },
};
