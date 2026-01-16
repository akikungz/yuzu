import pino, { transport } from "pino";

import { env } from "@yuzu/env";

// In test environment, use simple console logging
const init_transport = env.LOG_PRETTY == false
  ? undefined // Use default console transport
  : transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  });

export const logger = pino(init_transport);
