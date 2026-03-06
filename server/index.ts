import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

const corsOptions = {
  origin: ["https://crisis-sense-ai-two.vercel.app"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

function validateServerEnv(): void {
  const required = [
    "SUPABASE_URL",
    "INTERNAL_DASHBOARD_API_KEY",
    "SMOKE_USER_ID",
  ] as const;

  const missing: string[] = (required as readonly string[]).filter(
    (name) => !process.env[name] || process.env[name]?.trim().length === 0,
  );

  const hasServiceRoleKey =
    (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().length ?? 0) > 0 ||
    (process.env.SUPABASE_SERVICE_KEY?.trim().length ?? 0) > 0;

  if (!hasServiceRoleKey) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const isAnthropicKeyValid =
    Boolean(anthropicKey) &&
    anthropicKey !== "your-anthropic-api-key-here" &&
    (anthropicKey?.length ?? 0) >= 20;
  if (!isAnthropicKeyValid) {
    missing.push("ANTHROPIC_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}


validateServerEnv();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions));

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
