# Requirements Document

## Introduction

Plugin Strapi v5 tích hợp Telegram Bot sử dụng thư viện `node-telegram-bot-api`. Plugin đóng gói toàn bộ logic giao tiếp với Telegram API vào một Strapi service có thể tái sử dụng trên toàn ứng dụng. Plugin hỗ trợ hai chế độ kết nối (polling và webhook), quản lý vòng đời bot cùng với Strapi, và cho phép các module khác (như cron job sinh nhật) gửi tin nhắn, file, ảnh thông qua interface thống nhất thay vì gọi HTTP thô.

---

## Glossary

- **Plugin**: Local Strapi plugin đặt tại `src/plugins/telegram-bot/`
- **TelegramBot**: Instance của class `TelegramBot` từ thư viện `node-telegram-bot-api`
- **BotService**: Strapi service được expose tại `plugin::telegram-bot.telegram`, là interface chính để tương tác với bot
- **BotManager**: Module nội bộ của plugin, chịu trách nhiệm khởi tạo, lưu trữ và đóng singleton TelegramBot instance
- **CommandRegistry**: Module nội bộ cho phép đăng ký và quản lý các bot command handler
- **Polling_Mode**: Chế độ bot chủ động gọi Telegram API định kỳ để lấy update — dùng trong môi trường development
- **Webhook_Mode**: Chế độ Telegram chủ động gọi về server — dùng trong môi trường production
- **ChatId**: Định danh duy nhất của một Telegram chat (user, group, hoặc channel)
- **ParseMode**: Định dạng render nội dung tin nhắn: `"HTML"` hoặc `"MarkdownV2"`
- **InlineKeyboard**: Dạng reply_markup gồm các nút bấm đính kèm theo tin nhắn
- **GracefulShutdown**: Quy trình đóng kết nối bot và giải phóng tài nguyên có trật tự khi Strapi dừng
- **TELEGRAM_BOT_TOKEN**: Biến môi trường chứa token xác thực bot
- **TELEGRAM_WEBHOOK_URL**: Biến môi trường chứa URL công khai để Telegram gọi webhook về
- **TELEGRAM_WEBHOOK_PORT**: Biến môi trường chứa port webhook server lắng nghe

---

## Requirements

### Requirement 1: Khởi tạo Plugin và Đăng ký vào Strapi

**User Story:** As a Strapi developer, I want the telegram-bot plugin to initialize automatically when Strapi starts, so that the bot is ready to use without manual setup.

#### Acceptance Criteria

1. WHEN Strapi thực thi phase `register`, THE Plugin SHALL đăng ký `BotService` vào Strapi service container với key `plugin::telegram-bot.telegram`, để các module khác có thể resolve service này sau khi bootstrap hoàn tất.
2. WHEN Strapi bootstrap được gọi, THE BotManager SHALL khởi tạo đúng một TelegramBot instance duy nhất (singleton) — nếu bootstrap được gọi nhiều lần trong cùng một Strapi lifecycle, BotManager SHALL không tạo thêm instance mới.
3. IF `TELEGRAM_BOT_TOKEN` không được cấu hình hoặc có giá trị rỗng khi bootstrap, THEN THE BotManager SHALL log ở level `warn` với message xác định rõ rằng `TELEGRAM_BOT_TOKEN` chưa được set và việc khởi tạo bị bỏ qua — Strapi SHALL tiếp tục khởi động bình thường.
4. WHEN TelegramBot instance được khởi tạo và gặp lỗi runtime (ví dụ: token không hợp lệ, lỗi mạng), THE BotManager SHALL log ở level `error` với mô tả lỗi cụ thể, đặt trạng thái bot là chưa khởi tạo, và để Strapi tiếp tục hoạt động bình thường.
5. IF `TELEGRAM_WEBHOOK_URL` được cấu hình với giá trị không rỗng, THEN THE BotManager SHALL khởi tạo TelegramBot ở Webhook_Mode bằng cách gọi `bot.setWebhook(TELEGRAM_WEBHOOK_URL)`.
6. IF `TELEGRAM_WEBHOOK_URL` không được cấu hình hoặc có giá trị rỗng, THEN THE BotManager SHALL khởi tạo TelegramBot ở Polling_Mode bằng cách gọi `bot.startPolling()`.
7. THE Plugin SHALL export TypeScript type definitions cho tất cả method và type thuộc public interface của BotService mà các Strapi module khác có thể gọi.

---

### Requirement 2: Gửi Tin Nhắn Văn Bản

**User Story:** As a developer using the plugin, I want to send text messages to a Telegram chat via BotService, so that I can notify users without calling raw HTTP APIs.

#### Acceptance Criteria

1. THE BotService SHALL expose phương thức `sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<void>`.
2. WHEN `sendMessage` được gọi với `chatId` là chuỗi không rỗng và `text` có độ dài từ 1 đến 4096 ký tự, THE BotService SHALL gửi tin nhắn thông qua TelegramBot instance singleton.
3. WHERE `parse_mode` được chỉ định trong `options`, THE BotService SHALL truyền `parse_mode` đó xuống thư viện `node-telegram-bot-api`.
4. IF `parse_mode` không được chỉ định, THEN THE BotService SHALL mặc định dùng `parse_mode: "HTML"`.
5. WHEN `sendMessage` được gọi với `InlineKeyboard` trong `options.reply_markup`, THE BotService SHALL đính kèm các nút bấm inline vào tin nhắn.
6. IF `chatId` là chuỗi rỗng, hoặc `text` rỗng hoặc vượt quá 4096 ký tự, THEN THE BotService SHALL throw một Error với message xác định rõ trường nào không hợp lệ mà không gọi Telegram API.
7. IF `sendMessage` gặp lỗi từ Telegram API, THEN THE BotService SHALL throw một Error có message bao gồm lý do lỗi được trả về từ Telegram API.

---

### Requirement 3: Gửi File và Ảnh

**User Story:** As a developer, I want to send documents and images to a Telegram chat, so that I can share binary content like reports and photos through the bot.

#### Acceptance Criteria

1. THE BotService SHALL expose phương thức `sendDocument(chatId: string, document: Buffer | string, options?: SendDocumentOptions): Promise<void>`.
2. THE BotService SHALL expose phương thức `sendPhoto(chatId: string, photo: Buffer | string, options?: SendPhotoOptions): Promise<void>`.
3. WHEN `sendDocument` được gọi với một `Buffer` có kích thước không vượt quá 50 MB, THE BotService SHALL gửi Buffer đó như một file đính kèm Telegram, sử dụng `options.filename` nếu được cung cấp hoặc tên mặc định `"document"`.
4. WHEN `sendPhoto` được gọi với một `Buffer` có kích thước không vượt quá 10 MB, THE BotService SHALL gửi Buffer đó như một ảnh Telegram.
5. WHEN `sendDocument` hoặc `sendPhoto` được gọi với một `string`, THE BotService SHALL truyền giá trị đó xuống thư viện như Telegram file_id hoặc URL mà không xử lý thêm.
6. IF `sendDocument` được gọi với `Buffer` lớn hơn 50 MB, hoặc `sendPhoto` với `Buffer` lớn hơn 10 MB, THEN THE BotService SHALL throw một Error xác định rõ giới hạn kích thước bị vượt qua mà không gọi Telegram API.
7. IF `sendDocument` hoặc `sendPhoto` gặp lỗi từ Telegram API, THEN THE BotService SHALL throw một Error có message bao gồm lý do lỗi được trả về từ Telegram API.

---

### Requirement 4: Đăng Ký Command Handler

**User Story:** As a developer, I want to register bot command handlers via the plugin, so that the bot can respond to user commands like `/status` and `/help`.

#### Acceptance Criteria

1. THE BotService SHALL expose phương thức `onCommand(command: string, handler: CommandHandler): void` để đăng ký callback cho một lệnh bot cụ thể.
2. WHEN `onCommand` được gọi với một `command` string (ví dụ: `"help"` hoặc `"/help"`), THE CommandRegistry SHALL tự động tạo regexp tương ứng và đăng ký handler lên TelegramBot instance thông qua `bot.onText(regexp, callback)`.
3. WHEN một người dùng Telegram gửi một lệnh đã được đăng ký, THE BotService SHALL gọi handler tương ứng với đầy đủ thông tin `message` từ Telegram.
4. THE BotService SHALL expose phương thức `onMessage(handler: MessageHandler): void` để đăng ký callback lắng nghe tất cả tin nhắn thông qua `bot.on('message', handler)`.
5. THE BotService SHALL expose phương thức `onCallbackQuery(handler: CallbackQueryHandler): void` để đăng ký callback xử lý sự kiện inline keyboard thông qua `bot.on('callback_query', handler)`.

---

### Requirement 5: Graceful Shutdown

**User Story:** As a system operator, I want the bot to shut down cleanly when Strapi stops, so that open connections are properly closed and resources are released.

#### Acceptance Criteria

1. WHEN Strapi phát ra sự kiện `destroy`, THE BotManager SHALL đóng TelegramBot instance theo quy trình GracefulShutdown.
2. WHEN ở Polling_Mode và shutdown được kích hoạt, THE BotManager SHALL gọi `bot.stopPolling()` với timeout tối đa 10 giây trước khi giải phóng instance về trạng thái chưa khởi tạo.
3. WHEN ở Webhook_Mode và shutdown được kích hoạt, THE BotManager SHALL gọi `bot.closeWebHook()` với timeout tối đa 10 giây trước khi giải phóng instance về trạng thái chưa khởi tạo.
4. IF TelegramBot instance chưa được khởi tạo khi destroy được gọi, THEN THE BotManager SHALL bỏ qua GracefulShutdown mà không throw error.
5. IF `stopPolling()` hoặc `closeWebHook()` throw error hoặc vượt quá timeout 10 giây, THEN THE BotManager SHALL log lỗi ở level `error` kèm nguyên nhân, sau đó giải phóng instance về trạng thái chưa khởi tạo mà không block Strapi shutdown.
6. WHEN GracefulShutdown hoàn tất thành công, THE BotManager SHALL log ở level `info` một message xác nhận rằng bot đã dừng và instance đã được giải phóng.

---

### Requirement 6: Refactor Cron Job Sinh Nhật

**User Story:** As a developer, I want the birthday cron job to use BotService instead of raw fetch calls, so that Telegram communication is centralized and consistent.

#### Acceptance Criteria

1. THE `upcomingBirthdayCustomers` cron job SHALL gửi tin nhắn Telegram thông qua `strapi.service("plugin::telegram-bot.telegram").sendMessage()` thay vì gọi `fetch()` trực tiếp.
2. IF `BotService.isReady()` trả về `false` khi cron job bắt đầu, THEN THE cron job SHALL log ở level `warn` và bỏ qua toàn bộ việc gửi tin nhắn mà không làm crash cron.
3. WHEN `sendMessage()` throw error trong quá trình gửi cho một staff cụ thể, THE cron job SHALL log lỗi ở level `error` kèm tên staff, sau đó tiếp tục xử lý các staff còn lại (per-message error isolation).
4. THE cron job SHALL không còn chứa hàm `sendTelegram` inline dùng raw `fetch()`.
5. THE cron job SHALL giữ nguyên toàn bộ logic hiện tại bao gồm: phân loại sinh nhật hôm nay và sắp tới, group theo staff, skip staff không có `telegramChatId`, format tin nhắn HTML, log `sentCount` và `skipCount` ở cuối.

---

### Requirement 7: Cấu Hình Qua Biến Môi Trường

**User Story:** As a DevOps engineer, I want all bot configuration to come from environment variables, so that different environments (dev, staging, production) can be configured without code changes.

#### Acceptance Criteria

1. THE Plugin SHALL đọc `TELEGRAM_BOT_TOKEN` từ `process.env` để xác thực với Telegram API; nếu giá trị rỗng hoặc chỉ chứa whitespace thì xử lý tương đương trường hợp không được cấu hình.
2. IF `TELEGRAM_WEBHOOK_URL` được set với giá trị không rỗng, THEN THE Plugin SHALL khởi động ở Webhook_Mode; IF `TELEGRAM_WEBHOOK_URL` không được set hoặc rỗng, THEN THE Plugin SHALL mặc định khởi động ở Polling_Mode.
3. THE Plugin SHALL đọc `TELEGRAM_WEBHOOK_PORT` từ `process.env` để cấu hình port webhook server; IF giá trị không phải số nguyên hợp lệ hoặc không được set, THEN THE Plugin SHALL dùng giá trị mặc định `8443`.
4. THE Plugin SHALL cung cấp hoặc cập nhật file `.env.example` tại root project, liệt kê đầy đủ ba biến môi trường: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_PORT` kèm mô tả ngắn cho từng biến.

---

### Requirement 8: Kiểm Tra Trạng Thái Bot

**User Story:** As a developer, I want to check if the bot is initialized and running, so that dependent modules can gracefully skip Telegram operations when the bot is unavailable.

#### Acceptance Criteria

1. THE BotService SHALL expose phương thức `isReady(): boolean` trả về `true` khi TelegramBot instance đã được khởi tạo thành công, và `false` trong mọi trường hợp khác (chưa bootstrap, lỗi init, đã shutdown).
2. IF `isReady()` trả về `false`, THEN THE BotService SHALL log ở level `warn` và return sớm mà không thực hiện gửi tin nhắn khi các phương thức gửi được gọi.
3. WHEN `getBotInfo()` được gọi và `isReady()` là `true`, THE BotService SHALL trả về một object chứa `id` (number), `username` (string), và `first_name` (string) lấy từ Telegram API.
4. IF `getBotInfo()` được gọi khi `isReady()` là `false`, THEN THE BotService SHALL throw một Error với message `"TelegramBot is not initialized"`.
