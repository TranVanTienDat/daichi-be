import type { Core } from "@strapi/strapi";
import { DEFAULT_WEBHOOK_PORT } from "../types";
import { Bot, webhookCallback } from "node-telegram-bot-api";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function normalizeHeaders(headers: IncomingHttpHeaders): Headers {
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
      continue;
    }

    normalized.set(key, value);
  }

  return normalized;
}

export class BotManager {
  private static instance: BotManager;

  private bot: Bot | null = null;
  private webhookServer: Server | null = null;
  private mode: "polling" | "webhook" | null = null;

  private constructor() {}

  static getInstance(): BotManager {
    if (!BotManager.instance) {
      BotManager.instance = new BotManager();
    }
    return BotManager.instance;
  }

  async init(strapi: Core.Strapi): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) {
      strapi.log.warn(
        "[BotManager] TELEGRAM_BOT_TOKEN is not set, skipping initialization.",
      );
      return;
    }

    if (this.bot !== null) {
      return;
    }

    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim();
    const mode: "polling" | "webhook" = webhookUrl ? "webhook" : "polling";

    const rawPort = process.env.TELEGRAM_WEBHOOK_PORT;
    const parsedPort = rawPort ? parseInt(rawPort, 10) : NaN;
    const port = Number.isFinite(parsedPort)
      ? parsedPort
      : DEFAULT_WEBHOOK_PORT;
    const webhookPath =
      process.env.TELEGRAM_WEBHOOK_PATH?.trim() || "/telegram";
    const webhookSecretToken =
      process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();

    try {
      this.bot = new Bot(token);
      this.bot.catch((err, ctx) => {
        const reason = err instanceof Error ? err.message : String(err);
        strapi.log.error(
          `[BotManager] Handler error at update ${ctx.update.update_id}: ${reason}`,
        );
      });

      if (mode === "polling") {
        this.bot.startPolling().catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          strapi.log.error(
            `[BotManager] Polling stopped with error: ${reason}`,
          );
        });
      }

      if (mode === "webhook" && webhookUrl) {
        if (!webhookSecretToken) {
          strapi.log.warn(
            "[BotManager] TELEGRAM_WEBHOOK_SECRET_TOKEN is not set. Webhook will run without header authentication.",
          );
        }

        const callback = webhookCallback(this.bot, {
          ...(webhookSecretToken
            ? { secretToken: webhookSecretToken }
            : { allowUnauthenticated: true }),
        });

        this.webhookServer = createServer((req, res) => {
          const requestPath = req.url ? req.url.split("?")[0] : "";
          if (requestPath !== webhookPath) {
            res.statusCode = 404;
            res.end("Not Found");
            return;
          }

          const chunks: Uint8Array[] = [];

          req.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          req.on("end", async () => {
            try {
              const protocol =
                typeof req.headers["x-forwarded-proto"] === "string"
                  ? req.headers["x-forwarded-proto"]
                  : "http";
              const host =
                typeof req.headers.host === "string"
                  ? req.headers.host
                  : "localhost";
              const fullUrl = `${protocol}://${host}${req.url ?? webhookPath}`;
              const body = Buffer.concat(chunks);

              const request = new Request(fullUrl, {
                method: req.method,
                headers: normalizeHeaders(req.headers),
                body:
                  req.method === "GET" || req.method === "HEAD"
                    ? undefined
                    : body,
              });

              const response = await callback(request);

              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });

              const responseBody = await response.arrayBuffer();
              res.end(Buffer.from(responseBody));
            } catch (err: unknown) {
              const reason = err instanceof Error ? err.message : String(err);
              strapi.log.error(
                `[BotManager] Webhook handling error: ${reason}`,
              );

              if (!res.headersSent) {
                res.statusCode = 500;
              }
              res.end("Internal Server Error");
            }
          });

          req.on("error", (err) => {
            strapi.log.error(
              `[BotManager] Webhook request stream error: ${err.message}`,
            );
            if (!res.headersSent) {
              res.statusCode = 500;
            }
            res.end("Internal Server Error");
          });
        });

        await withTimeout(
          new Promise<void>((resolve, reject) => {
            if (!this.webhookServer) {
              reject(new Error("Webhook server is not initialized"));
              return;
            }

            this.webhookServer.once("error", reject);
            this.webhookServer.listen(port, () => resolve());
          }),
          10_000,
        );

        await this.bot.api.setWebhook({
          url: webhookUrl,
          ...(webhookSecretToken ? { secret_token: webhookSecretToken } : {}),
        });
      }

      this.mode = mode;

      strapi.log.info(`[BotManager] Telegram bot initialized in ${mode} mode`);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      strapi.log.error(
        `[BotManager] Failed to initialize Telegram bot: ${reason}`,
      );

      if (this.webhookServer) {
        try {
          await withTimeout(
            new Promise<void>((resolve, reject) => {
              this.webhookServer?.close((closeErr) => {
                if (closeErr) {
                  reject(closeErr);
                  return;
                }
                resolve();
              });
            }),
            10_000,
          );
        } catch {
          // Ignore cleanup errors after init failure.
        }
      }

      this.webhookServer = null;
      this.bot = null;
      this.mode = null;
    }
  }

  async shutdown(strapi: Core.Strapi): Promise<void> {
    if (this.bot === null) {
      return;
    }

    const bot = this.bot;
    const mode = this.mode;
    const webhookServer = this.webhookServer;

    try {
      if (mode === "polling") {
        bot.stop();
      } else if (webhookServer) {
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            webhookServer.close((err) => {
              if (err) {
                reject(err);
                return;
              }
              resolve();
            });
          }),
          10_000,
        );
      }

      strapi.log.info(
        "[BotManager] Telegram bot stopped and instance released.",
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      strapi.log.error(`[BotManager] Shutdown error: ${reason}`);
    } finally {
      this.webhookServer = null;
      this.bot = null;
      this.mode = null;
    }
  }

  getBot(): Bot | null {
    return this.bot;
  }

  isInitialized(): boolean {
    return this.bot !== null;
  }
}
