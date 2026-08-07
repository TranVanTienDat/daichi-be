import type {
  Message,
  CallbackQuery,
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  LinkPreviewOptions,
  ReplyParameters,
} from "node-telegram-bot-api";

export interface SendMessageOptions {
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
  link_preview_options?: LinkPreviewOptions;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_parameters?: ReplyParameters;
  reply_to_message_id?: number;
}

export interface SendDocumentOptions {
  filename?: string;
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2";
  disable_notification?: boolean;
}

export interface SendPhotoOptions {
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2";
  disable_notification?: boolean;
}

export type CommandHandler = (
  message: Message,
  match: RegExpExecArray | null,
) => void | Promise<void>;

export type MessageHandler = (message: Message) => void | Promise<void>;

export type CallbackQueryHandler = (
  callbackQuery: CallbackQuery,
) => void | Promise<void>;

export interface BotInfoResult {
  id: number;
  username: string;
  first_name: string;
}

export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
export const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
export const DEFAULT_WEBHOOK_PORT = 8443;
