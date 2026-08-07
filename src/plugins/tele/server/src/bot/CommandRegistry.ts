import { Bot } from "node-telegram-bot-api";
import type { Context } from "node-telegram-bot-api";
import type {
  CommandHandler,
  MessageHandler,
  CallbackQueryHandler,
} from "../types";

export class CommandRegistry {
  static normalizeCommand(command: string): RegExp {
    const normalized = command.startsWith("/")
      ? command.slice(1).toLowerCase()
      : command.toLowerCase();

    return new RegExp(`^\\/` + `${normalized}(@\\w+)?(\\s|$)`, "i");
  }

  static register(bot: Bot, command: string, handler: CommandHandler): void {
    const regex = CommandRegistry.normalizeCommand(command);
    bot.on("message", async (ctx: Context) => {
      const message = ctx.message;
      if (!message?.text) {
        return;
      }

      const match = regex.exec(message.text);
      if (!match) {
        return;
      }

      await handler(message, match);
    });
  }

  static registerMessageHandler(bot: Bot, handler: MessageHandler): void {
    bot.on("message", async (ctx: Context) => {
      if (!ctx.message) {
        return;
      }
      await handler(ctx.message);
    });
  }

  static registerCallbackQueryHandler(
    bot: Bot,
    handler: CallbackQueryHandler,
  ): void {
    bot.on("callback_query", async (ctx: Context) => {
      if (!ctx.callbackQuery) {
        return;
      }
      await handler(ctx.callbackQuery);
    });
  }
}
