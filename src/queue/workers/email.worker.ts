import type { Core } from "@strapi/strapi";
import type { Job } from "bullmq";
import type { IBotService } from "../../plugins/tele/server/src/services/telegram";
import { QueueManager } from "../QueueManager";

export const EMAIL_QUEUE = "email-notifications";

export type TaskNotificationJobData = {
  type: "task-assigned";
  receivers: Array<{
    email: string;
    fullName: string;
  }>;
  task: {
    title: string;
    documentId: string;
    dueDate: string;
    createdByFullName: string;
  };
};

const formatDate = (value: string) => {
  if (!value) return "";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Nhận strapiInstance từ bootstrap() để tránh "strapi is not defined"
// vì BullMQ worker không có access vào global strapi
export const registerEmailWorker = (strapiInstance: Core.Strapi) => {
  QueueManager.getInstance().registerWorker<TaskNotificationJobData>(
    EMAIL_QUEUE,
    async (job: Job<TaskNotificationJobData>) => {
      const { type, receivers, task } = job.data;

      if (type === "task-assigned") {
        const taskUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/tasks?taskId=${task.documentId}`;

        // ── [EMAIL] Tạm comment lại, dùng Telegram thay thế ──────────────────
        // await Promise.all(
        //   receivers.map((user) =>
        //     (strapiInstance as any)
        //       .plugin("email-designer-5")
        //       .service("email")
        //       .sendTemplatedEmail(
        //         { to: user.email },
        //         { templateReferenceId: 1, subject: "Nhận được nhiệm vụ mới" },
        //         {
        //           USER: { fullName: user.fullName },
        //           URL: taskUrl,
        //           TASK: {
        //             fullName: task.title, // template dùng [TASK.fullName]
        //             assignedBy: task.createdByFullName,
        //             dueDate: formatDate(task.dueDate), // template dùng [TASK.dueDate]
        //           },
        //         },
        //       )
        //       .then(() => console.log(`[EmailWorker] Sent to ${user.email}`))
        //       .catch((err: any) => {
        //         console.error(`[EmailWorker] Failed for ${user.email}:`, err);
        //         throw err; // re-throw để BullMQ retry
        //       }),
        //   ),
        // );
        // ─────────────────────────────────────────────────────────────────────

        // ── [TELEGRAM] Gửi thông báo qua Telegram bot ────────────────────────
        const botService = strapiInstance
          .plugin("tele")
          ?.service("telegram") as IBotService | undefined;

        if (!botService?.isReady()) {
          strapiInstance.log.warn(
            "[EmailWorker] Telegram bot chưa sẵn sàng, bỏ qua gửi thông báo.",
          );
          return;
        }

        await Promise.all(
          receivers.map(async (user) => {
            // Lookup telegramChatId qua Strapi users-permissions service
            const [dbUser] = await strapiInstance
              .plugin("users-permissions")
              .service("user")
              .fetchAll({
                filters: { email: user.email },
                fields: ["telegramChatId"],
              });

            const chatId: string | undefined = dbUser?.telegramChatId;

            if (!chatId) {
              strapiInstance.log.warn(
                `[EmailWorker] User "${user.email}" chưa liên kết Telegram, bỏ qua.`,
              );
              return;
            }

            const message = `📋 *Nhiệm vụ mới*

Xin chào *${user.fullName}*

Nhiệm vụ mới:

*Tên nhiệm vụ:* ${task.title}
*Người giao:* ${task.createdByFullName}
*Deadline:* ${formatDate(task.dueDate)}`;

            await botService
              .sendMessage(chatId, message, {
                parse_mode: "MarkdownV2",
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "🔗 Xem chi tiết nhiệm vụ", url: taskUrl }],
                  ],
                },
              })
              .then(() =>
                strapiInstance.log.info(
                  `[EmailWorker] Đã gửi Telegram cho ${user.email} (chatId=${chatId})`,
                ),
              )
              .catch((err: unknown) => {
                strapiInstance.log.error(
                  `[EmailWorker] Gửi Telegram thất bại cho ${user.email}: ${err}`,
                );
                throw err; // re-throw để BullMQ retry
              });
          }),
        );
        // ─────────────────────────────────────────────────────────────────────
      }
    },
  );
};
