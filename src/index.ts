import type { Core } from "@strapi/strapi";
import { registerEmailWorker } from "./queue/workers/email.worker";
import { registerSubTaskWorker } from "./queue/workers/subtask.worker";
import type { IBotService } from "./plugins/tele/server/src/services/telegram";

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    registerEmailWorker(strapi);
    registerSubTaskWorker(strapi);
    registerTelegramCommands(strapi);
  },
};

// ── Telegram bot commands ──────────────────────────────────────────────────────

function registerTelegramCommands(strapi: Core.Strapi) {
  const botService = strapi.plugin("tele")?.service("telegram") as
    | IBotService
    | undefined;

  if (!botService?.isReady()) {
    strapi.log.warn(
      "[TeleCommands] Bot chua san sang, bo qua dang ky command.",
    );
    return;
  }

  // Dang ky danh sach command voi Telegram → hien thi goi y khi user go "/"
  import("./plugins/tele/server/src/bot/BotManager")
    .then(({ BotManager }) => {
      const rawBot = BotManager.getInstance().getBot();
      if (!rawBot) return;
      return rawBot.api.setMyCommands({
        commands: [
          {
            command: "register",
            description: "Liên kết Telegram với tài khoản hệ thống",
          },
          {
            command: "me",
            description: "Kiểm tra trạng thái liên kết của bạn",
          },
        ],
      });
    })
    .then(() => {
      strapi.log.info(
        "[TeleCommands] Da cap nhat danh sach command voi Telegram.",
      );
    })
    .catch((err) => {
      strapi.log.warn(`[TeleCommands] Khong the set commands: ${err}`);
    });

  // /register <email>
  // Staff nhan lenh nay de lien ket Telegram chat_id voi tai khoan trong he thong.
  botService.onCommand("register", async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text ?? "";

    // Lay email tu noi dung tin nhan: "/register email@example.com"
    const parts = text.trim().split(/\s+/);
    const email = parts[1]?.toLowerCase();

    if (!email) {
      await botService.sendMessage(
        chatId,
        "⚠️ Vui lòng cung cấp email.\nVí dụ: <code>/register email@daichi.vn</code>",
      );
      return;
    }

    // Tim user theo email (khong phan biet hoa thuong)
    const knex = strapi.db.connection;
    const user = await knex("up_users")
      .select("id", "full_name", "telegram_chat_id")
      .whereRaw("LOWER(email) = ?", [email])
      .first();

    if (!user) {
      await botService.sendMessage(
        chatId,
        `❌ Không tìm thấy tài khoản với email <code>${email}</code>.\nKiểm tra lại email hoặc liên hệ admin.`,
      );
      return;
    }

    // Neu da dang ky chat_id khac → canh bao
    if (user.telegram_chat_id && user.telegram_chat_id !== chatId) {
      await botService.sendMessage(
        chatId,
        `⚠️ Tài khoản <b>${user.full_name}</b> đã được liên kết với một Telegram khác.\nNếu bạn muốn cập nhật, liên hệ admin.`,
      );
      return;
    }

    // Neu da dang ky chinh chat nay → bao da dang ky roi
    if (user.telegram_chat_id === chatId) {
      await botService.sendMessage(
        chatId,
        `✅ Tài khoản <b>${user.full_name}</b> đã được liên kết với Telegram này rồi. Không cần làm gì thêm!`,
      );
      return;
    }

    // Luu chat_id vao DB
    await knex("up_users").where("id", user.id).update({
      telegram_chat_id: chatId,
    });

    strapi.log.info(
      `[TeleCommands] Lien ket Telegram cho user "${user.full_name}" (id=${user.id}), chatId=${chatId}`,
    );

    await botService.sendMessage(
      chatId,
      `🎉 Liên kết thành công!\n\nXin chào <b>${user.full_name}</b>, từ nay bạn sẽ nhận được thông báo sinh nhật khách hàng qua Telegram này.`,
    );
  });

  // /me — Kiem tra trang thai lien ket cua chinh minh
  botService.onCommand("me", async (msg) => {
    const chatId = String(msg.chat.id);

    const knex = strapi.db.connection;
    const user = await knex("up_users")
      .select("id", "full_name", "email")
      .where("telegram_chat_id", chatId)
      .first();

    if (!user) {
      await botService.sendMessage(
        chatId,
        `❓ Telegram này chưa được liên kết với tài khoản nào.\n\nDùng lệnh: <code>/register email@daichi.vn</code>`,
      );
      return;
    }

    await botService.sendMessage(
      chatId,
      `✅ Đã liên kết với tài khoản:\n👤 <b>${user.full_name}</b>\n📧 ${user.email}`,
    );
  });

  strapi.log.info(
    "[TeleCommands] Da dang ky cac lenh Telegram: /register, /me",
  );
}
