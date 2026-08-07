# Implementation Plan: telegram-bot-plugin

## Overview

Plugin Strapi v5 local tích hợp Telegram Bot thông qua thư viện `node-telegram-bot-api`. Plugin cung cấp một BotService singleton có thể tái sử dụng trên toàn ứng dụng, hỗ trợ gửi tin nhắn/file/ảnh, đăng ký command handler, và quản lý vòng đời bot theo Strapi lifecycle (register → bootstrap → destroy). Plugin hỗ trợ cả chế độ polling (development) và webhook (production) thông qua biến môi trường.

**Mục tiêu chính:**

- Đóng gói toàn bộ logic Telegram API vào một service thống nhất
- Quản lý singleton TelegramBot instance với graceful shutdown
- Refactor cron job sinh nhật để sử dụng BotService thay vì raw HTTP fetch
- Validation đầu vào và error handling theo requirements
- Property-based testing cho correctness properties

## Tasks

- [x] 1. Setup Dependencies and Project Structure

  - [x] 1.1 Install Telegram Bot dependencies

    - Install `node-telegram-bot-api` as production dependency using yarn: `yarn add node-telegram-bot-api`
    - Install `@types/node-telegram-bot-api` as dev dependency using yarn: `yarn add -D @types/node-telegram-bot-api`
    - Install `fast-check` as dev dependency using yarn: `yarn add -D fast-check`
    - _Requirements: 1.1, 1.7_

  - [x] 1.2 Create plugin directory structure

    - Create `src/plugins/telegram-bot/` directory
    - Create subdirectories: `server/`, `server/services/`, `server/bot/`
    - Create entry point file `strapi-server.ts` (Strapi v5 local plugin convention)
    - _Requirements: 1.1_

  - [x] 1.3 Create TypeScript type definitions
    - Create `server/types.ts` with all exported types: `SendMessageOptions`, `SendDocumentOptions`, `SendPhotoOptions`, `CommandHandler`, `MessageHandler`, `CallbackQueryHandler`, `BotInfoResult`
    - Define validation constants: `MAX_MESSAGE_LENGTH`, `MAX_DOCUMENT_SIZE`, `MAX_PHOTO_SIZE`, `DEFAULT_WEBHOOK_PORT`
    - Export types for external module consumption
    - _Requirements: 1.7, 2.1, 2.2, 3.1, 3.2, 4.1, 8.3_

- [x] 2. Implement Core Infrastructure

  - [x] 2.1 Implement BotManager singleton

    - Create `server/bot/BotManager.ts` with singleton pattern
    - Implement `getInstance()` static method
    - Implement `init(strapi)` method: read env vars, validate token, choose mode (polling/webhook), create TelegramBot instance with error handling
    - Implement `shutdown(strapi)` method: graceful shutdown with 10s timeout, handle both polling and webhook modes
    - Implement `getBot()` and `isInitialized()` helper methods
    - Handle idempotency: calling `init()` multiple times should not create new instances
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x]\* 2.2 Write unit tests for BotManager

    - Test token missing → warn log + no instance created
    - Test token present + polling mode → `startPolling()` called
    - Test token present + webhook mode → `setWebhook()` called
    - Test idempotency: multiple `init()` calls create only one instance
    - Test graceful shutdown in polling mode
    - Test graceful shutdown in webhook mode
    - Test shutdown timeout handling
    - Test shutdown when instance not initialized
    - _Requirements: 1.2, 1.3, 1.4, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.3 Implement CommandRegistry

    - Create `server/bot/CommandRegistry.ts`
    - Implement `normalizeCommand(command: string): RegExp` — handle both "help" and "/help" formats, case-insensitive
    - Implement `register(bot, command, handler)` — normalize command to regex and call `bot.onText()`
    - Implement `registerMessageHandler(bot, handler)` — call `bot.on('message', handler)`
    - Implement `registerCallbackQueryHandler(bot, handler)` — call `bot.on('callback_query', handler)`
    - _Requirements: 4.2, 4.4, 4.5_

  - [x]\* 2.4 Write unit tests for CommandRegistry
    - Test `normalizeCommand("help")` produces correct regex
    - Test `normalizeCommand("/help")` produces same regex as "help"
    - Test case-insensitive regex matching
    - Test regex matches bot mention pattern (e.g., `/help@botname`)
    - _Requirements: 4.2_

- [x] 3. Implement BotService

  - [x] 3.1 Create BotService with sendMessage implementation

    - Create `server/services/telegram.ts` with `createBotService(strapi)` factory function
    - Implement `sendMessage(chatId, text, options?)` with input validation
    - Validate `chatId` is non-empty string
    - Validate `text` length is between 1 and 4096 characters
    - Default `parse_mode` to "HTML" when not specified
    - Forward options (parse_mode, reply_markup) to `bot.sendMessage()`
    - Implement not-ready guard: if `!isInitialized()`, log warn and return void
    - Wrap Telegram API errors and re-throw with descriptive messages
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 8.2_

  - [x] 3.2 Implement sendDocument and sendPhoto

    - Implement `sendDocument(chatId, document, options?)` in BotService
    - Implement `sendPhoto(chatId, photo, options?)` in BotService
    - Validate Buffer size: document ≤ 50 MB, photo ≤ 10 MB
    - Handle Buffer input: pass to Telegram with filename (document) or directly (photo)
    - Handle string input: pass through unchanged (Telegram file_id or URL)
    - Use default filename "document" when not provided
    - Implement not-ready guard for both methods
    - Wrap Telegram API errors and re-throw
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 8.2_

  - [x] 3.3 Implement command and event handlers

    - Implement `onCommand(command, handler)` — delegate to `CommandRegistry.register()`
    - Implement `onMessage(handler)` — delegate to `CommandRegistry.registerMessageHandler()`
    - Implement `onCallbackQuery(handler)` — delegate to `CommandRegistry.registerCallbackQueryHandler()`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.4 Implement status check methods

    - Implement `isReady(): boolean` — return `BotManager.getInstance().isInitialized()`
    - Implement `getBotInfo(): Promise<BotInfoResult>` — throw if not ready, otherwise call `bot.getMe()` and return `{ id, username, first_name }`
    - _Requirements: 8.1, 8.3, 8.4_

  - [x]\* 3.5 Write unit tests for BotService
    - Test `sendMessage` with valid inputs → delegates to bot
    - Test `sendMessage` with empty chatId → throws validation error
    - Test `sendMessage` with empty text → throws validation error
    - Test `sendMessage` with text > 4096 chars → throws validation error
    - Test `sendMessage` with custom parse_mode → forwards to bot
    - Test `sendMessage` with reply_markup → forwards to bot
    - Test `sendDocument` with Buffer ≤ 50 MB → forwards to bot
    - Test `sendDocument` with Buffer > 50 MB → throws validation error
    - Test `sendPhoto` with Buffer ≤ 10 MB → forwards to bot
    - Test `sendPhoto` with Buffer > 10 MB → throws validation error
    - Test `sendDocument` with string → passes through unchanged
    - Test `sendPhoto` with string → passes through unchanged
    - Test all send methods when `isReady() === false` → log warn + return void
    - Test `getBotInfo()` when ready → returns bot info
    - Test `getBotInfo()` when not ready → throws error
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2, 8.4_

- [x] 4. Checkpoint — Ensure core service tests pass

  - Run unit tests for BotManager, CommandRegistry, and BotService
  - Verify all validation logic and error handling work correctly
  - Ask user if questions arise

- [x] 5. Implement Property-Based Tests

  - [x]\* 5.1 Write property test for Property 1: Valid sendMessage inputs forwarded

    - **Property 1: Valid sendMessage inputs are forwarded to Telegram library**
    - **Validates: Requirements 2.2, 2.4**
    - Use `fast-check` to generate arbitrary non-empty chatId and text (1–4096 chars)
    - Assert `bot.sendMessage()` called with exact values and default parse_mode "HTML"
    - Run 100 iterations

  - [x]\* 5.2 Write property test for Property 2: Send options forwarded unchanged

    - **Property 2: Send options are forwarded unchanged**
    - **Validates: Requirements 2.3, 2.5**
    - Use `fast-check` to generate arbitrary parse_mode and reply_markup
    - Assert underlying `bot.sendMessage()` receives exact option fields
    - Run 100 iterations

  - [x]\* 5.3 Write property test for Property 3: Invalid sendMessage inputs throw before Telegram

    - **Property 3: Invalid sendMessage inputs throw validation errors before reaching Telegram**
    - **Validates: Requirements 2.6**
    - Use `fast-check` to generate invalid inputs: empty chatId, empty text, text > 4096
    - Assert Error thrown and `bot.sendMessage()` NOT called
    - Run 100 iterations

  - [x]\* 5.4 Write property test for Property 4: Valid Buffer inputs forwarded

    - **Property 4: Valid Buffer inputs to sendDocument and sendPhoto are forwarded**
    - **Validates: Requirements 3.3, 3.4**
    - Generate Buffers within size limits (≤ 50 MB for document, ≤ 10 MB for photo)
    - Assert exact Buffer forwarded to underlying library method
    - Run 100 iterations

  - [x]\* 5.5 Write property test for Property 5: Oversized Buffer inputs throw

    - **Property 5: Oversized Buffer inputs throw size validation errors**
    - **Validates: Requirements 3.6**
    - Generate Buffers exceeding limits (> 50 MB, > 10 MB)
    - Assert Error thrown identifying size limit, library method NOT called
    - Run 100 iterations

  - [x]\* 5.6 Write property test for Property 6: String media inputs passed through

    - **Property 6: String media inputs are passed through to the library unchanged**
    - **Validates: Requirements 3.5**
    - Generate arbitrary non-empty strings
    - Assert exact string value forwarded without transformation
    - Run 100 iterations

  - [x]\* 5.7 Write property test for Property 7: Command normalization consistency
    - **Property 7: Command string normalization is consistent and idempotent**
    - **Validates: Requirements 4.2**
    - Generate command strings with/without leading slash, various cases
    - Assert `normalizeCommand()` produces same RegExp for equivalent inputs
    - Assert regex matches case-insensitive command patterns
    - Run 100 iterations

- [x] 6. Implement Plugin Entry Point

  - [x] 6.1 Create plugin entry point with lifecycle hooks

    - Create `server/index.ts` with `register`, `bootstrap`, and `destroy` exports
    - In `register()`: call `strapi.add("plugin::telegram-bot.telegram", () => createBotService(strapi))`
    - In `bootstrap()`: call `await BotManager.getInstance().init(strapi)`
    - In `destroy()`: call `await BotManager.getInstance().shutdown(strapi)`
    - Create `strapi-server.ts` re-exporting `server/index.ts` (Strapi v5 convention)
    - _Requirements: 1.1, 1.2, 5.1_

  - [x] 6.2 Update plugin configuration

    - Add telegram-bot plugin entry to `config/plugins.ts` with `enabled: true` and `resolve: "./src/plugins/telegram-bot"`
    - _Requirements: 1.1_

  - [x] 6.3 Update environment variable documentation
    - Update `.env.example` with three variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_PORT`
    - Add description comments for each variable
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Refactor Cron Job to Use BotService

  - [x] 7.1 Refactor upcomingBirthdayCustomers cron job

    - Remove `sendTelegram()` function and raw fetch logic
    - Remove `process.env.TELEGRAM_BOT_TOKEN` read
    - Add `const botService = strapi.service("plugin::telegram-bot.telegram")` at task start
    - Add guard: if `!botService.isReady()`, log warn and return early
    - Replace `await sendTelegram(botToken, staff.telegramChatId, msg)` with `await botService.sendMessage(staff.telegramChatId, msg)`
    - Wrap each `sendMessage()` call in try/catch for per-message error isolation
    - Keep all existing logic: birthday classification, staff grouping, skip logic, HTML formatting, log counts
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Checkpoint — Integration validation

  - Verify plugin loads correctly in Strapi bootstrap
  - Verify cron job uses BotService instead of raw fetch
  - Test graceful shutdown when Strapi stops
  - Ask user if questions arise

## Notes

- **Optional tasks** marked with `*` are test-related sub-tasks that can be skipped for faster MVP
- Each implementation task references specific requirements for traceability
- Property-based tests use `fast-check` library with minimum 100 iterations per property
- Plugin follows Strapi v5 local plugin conventions (strapi-server.ts entry point)
- BotManager singleton ensures single TelegramBot instance across application lifecycle
- Graceful shutdown with 10s timeout prevents hanging during Strapi stop
- Cron job refactor centralizes all Telegram communication through BotService
- Environment variables allow different configurations per deployment environment (dev/staging/production)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 5, "tasks": ["3.5", "5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["5.4", "5.5", "5.6", "5.7"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] },
    { "id": 9, "tasks": ["7.1"] },
    { "id": 10, "tasks": ["8"] }
  ]
}
```
