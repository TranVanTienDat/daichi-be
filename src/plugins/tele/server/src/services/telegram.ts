import type { Core } from "@strapi/strapi";
import { InputFile } from "node-telegram-bot-api";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { BotManager } from "../bot/BotManager";
import { CommandRegistry } from "../bot/CommandRegistry";
import type {
  SendMessageOptions,
  SendDocumentOptions,
  SendPhotoOptions,
  CommandHandler,
  MessageHandler,
  CallbackQueryHandler,
  BotInfoResult,
} from "../types";
import {
  MAX_MESSAGE_LENGTH,
  MAX_DOCUMENT_SIZE,
  MAX_PHOTO_SIZE,
} from "../types";

export interface IBotService {
  sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<void>;

  sendDocument(
    chatId: string,
    document: Buffer | string,
    options?: SendDocumentOptions,
  ): Promise<void>;

  sendPhoto(
    chatId: string,
    photo: Buffer | string,
    options?: SendPhotoOptions,
  ): Promise<void>;

  onCommand(command: string, handler: CommandHandler): void;

  onMessage(handler: MessageHandler): void;

  onCallbackQuery(handler: CallbackQueryHandler): void;

  isReady(): boolean;

  getBotInfo(): Promise<BotInfoResult>;
}

export function createBotService(strapi: Core.Strapi): IBotService {
  return {
    async sendMessage(
      chatId: string,
      text: string,
      options?: SendMessageOptions,
    ): Promise<void> {
      if (!chatId || typeof chatId !== "string" || chatId.trim() === "") {
        throw new Error("chatId must be a non-empty string");
      }

      if (!text || text.length === 0) {
        throw new Error("text must be a non-empty string");
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        throw new Error(
          `text exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
        );
      }

      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn("[BotService] Bot is not ready, skipping sendMessage");
        return;
      }

      const bot = BotManager.getInstance().getBot()!;

      const {
        disable_web_page_preview: _disableWebPagePreview,
        reply_to_message_id: _replyToMessageId,
        ...safeOptions
      } = options ?? {};

      const linkPreviewOptions = options?.disable_web_page_preview
        ? { is_disabled: true }
        : options?.link_preview_options;

      const replyParameters = options?.reply_to_message_id
        ? { message_id: options.reply_to_message_id }
        : options?.reply_parameters;

      const mergedOptions = {
        parse_mode: "HTML" as const,
        ...safeOptions,
        ...(linkPreviewOptions
          ? { link_preview_options: linkPreviewOptions }
          : {}),
        ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      };

      try {
        await bot.api.sendMessage({
          chat_id: chatId,
          text,
          ...mergedOptions,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Telegram API error: ${reason}`);
      }
    },

    async sendDocument(
      chatId: string,
      document: Buffer | string,
      options?: SendDocumentOptions,
    ): Promise<void> {
      if (Buffer.isBuffer(document)) {
        if (document.length > MAX_DOCUMENT_SIZE) {
          throw new Error("document size exceeds maximum of 50 MB");
        }
      }

      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn("[BotService] Bot is not ready, skipping sendDocument");
        return;
      }

      const bot = BotManager.getInstance().getBot()!;

      const inputDocument = Buffer.isBuffer(document)
        ? new InputFile(document, {
            filename: options?.filename ?? "document",
            contentType: "application/octet-stream",
          })
        : existsSync(document)
          ? new InputFile(await readFile(document), {
              filename: options?.filename ?? basename(document),
            })
          : document;

      const { filename: _filename, ...requestOptions } = options ?? {};

      try {
        await bot.api.sendDocument({
          chat_id: chatId,
          document: inputDocument,
          ...requestOptions,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Telegram API error: ${reason}`);
      }
    },

    async sendPhoto(
      chatId: string,
      photo: Buffer | string,
      options?: SendPhotoOptions,
    ): Promise<void> {
      if (Buffer.isBuffer(photo)) {
        if (photo.length > MAX_PHOTO_SIZE) {
          throw new Error("photo size exceeds maximum of 10 MB");
        }
      }

      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn("[BotService] Bot is not ready, skipping sendPhoto");
        return;
      }

      const bot = BotManager.getInstance().getBot()!;

      const inputPhoto = Buffer.isBuffer(photo)
        ? new InputFile(photo, {
            filename: options?.caption ? "photo-with-caption" : "photo",
            contentType: "application/octet-stream",
          })
        : existsSync(photo)
          ? new InputFile(await readFile(photo), {
              filename: basename(photo),
            })
          : photo;

      try {
        await bot.api.sendPhoto({
          chat_id: chatId,
          photo: inputPhoto,
          ...options,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Telegram API error: ${reason}`);
      }
    },

    onCommand(command: string, handler: CommandHandler): void {
      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn(
          "[BotService] Bot is not ready, skipping onCommand registration",
        );
        return;
      }

      const bot = BotManager.getInstance().getBot()!;
      CommandRegistry.register(bot, command, handler);
    },

    onMessage(handler: MessageHandler): void {
      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn(
          "[BotService] Bot is not ready, skipping onMessage registration",
        );
        return;
      }

      const bot = BotManager.getInstance().getBot()!;
      CommandRegistry.registerMessageHandler(bot, handler);
    },

    onCallbackQuery(handler: CallbackQueryHandler): void {
      if (!BotManager.getInstance().isInitialized()) {
        strapi.log.warn(
          "[BotService] Bot is not ready, skipping onCallbackQuery registration",
        );
        return;
      }

      const bot = BotManager.getInstance().getBot()!;
      CommandRegistry.registerCallbackQueryHandler(bot, handler);
    },

    isReady(): boolean {
      return BotManager.getInstance().isInitialized();
    },

    async getBotInfo(): Promise<BotInfoResult> {
      if (!BotManager.getInstance().isInitialized()) {
        throw new Error("Telegram bot is not initialized");
      }

      const bot = BotManager.getInstance().getBot()!;

      try {
        const me = await bot.api.getMe();
        return {
          id: me.id,
          username: me.username ?? "",
          first_name: me.first_name,
        };
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Telegram API error: ${reason}`);
      }
    },
  };
}
