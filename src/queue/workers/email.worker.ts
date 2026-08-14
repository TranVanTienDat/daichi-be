import type { Core } from "@strapi/strapi";
import type { Job } from "bullmq";
import type { IBotService } from "../../plugins/tele/server/src/services/telegram";
import { QueueManager } from "../QueueManager";

export const EMAIL_QUEUE = "email-notifications";
export enum TASK_TYPE {
  FEE_REMINDER = "fee_reminder",
  REMINDER = "reminder",
}

export type TaskNotificationJobData = {
  type: "task-assigned" | "task-updated";
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
  updateInfo?: {
    updatedBy: {
      id?: string | number;
      fullName: string;
      email?: string;
    };
    changes: string[];
    updatedAt: string;
  };
  taskType: TASK_TYPE;
};

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

const formatDate = (value: string) => {
  if (!value) return "";
  return new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export const registerEmailWorker = (strapiInstance: Core.Strapi) => {
  QueueManager.getInstance().registerWorker<TaskNotificationJobData>(
    EMAIL_QUEUE,
    async (job: Job<TaskNotificationJobData>) => {
      const { type, receivers, task, updateInfo, taskType } = job.data;
      console.log("type:", taskType);
      const baseUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
      if (type === "task-assigned" || type === "task-updated") {
        const url = `${baseUrl}/tasks?tab=${taskType === TASK_TYPE.FEE_REMINDER ? "fee_reminder" : "general"}`;
        const taskUrl =
          taskType === TASK_TYPE.FEE_REMINDER
            ? `${baseUrl}/tasks/fee_reminder/${task.documentId}/edit`
            : `${baseUrl}/tasks?taskId=${task.documentId}`;

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

            // Escape tất cả biến động trước khi ghép vào message
            const fullName = escapeMarkdownV2(user.fullName);
            const taskTitle = escapeMarkdownV2(task.title);
            const dueDate = escapeMarkdownV2(formatDate(task.dueDate));

            let message: string;

            if (type === "task-assigned") {
              const createdBy = escapeMarkdownV2(task.createdByFullName);

              message = [
                "📋 *1 nhiệm vụ mới đã được tạo*",
                "",
                `Xin chào *${fullName}*`,
                "",
                `*Tên nhiệm vụ:* ${taskTitle}`,
                `*Người giao:* ${createdBy}`,
                `*Deadline:* ${dueDate}`,
              ].join("\n");
            } else {
              // task-updated
              const updatedBy = escapeMarkdownV2(
                updateInfo?.updatedBy?.fullName || "Hệ thống",
              );
              const updatedTime = escapeMarkdownV2(
                updateInfo?.updatedAt
                  ? formatDate(updateInfo.updatedAt)
                  : "Vừa xong",
              );

              // Format từng thay đổi trên một dòng
              const changesList = updateInfo?.changes || ["Cập nhật thông tin"];
              const formattedChanges = changesList
                .map((change) => `• ${escapeMarkdownV2(change)}`)
                .join("\n");

              message = [
                "🔄 *1 nhiệm vụ đã được cập nhật*",
                "",
                `Xin chào *${fullName}*`,
                "",
                `*Nhiệm vụ:* ${taskTitle}`,
                `*Người cập nhật:* ${updatedBy}`,
                `*Thời gian:* ${updatedTime}`,
                "",
                "*Các thay đổi:*",
                formattedChanges,
                "",
                `*Deadline:* ${dueDate}`,
              ].join("\n");
            }

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
      }
    },
  );
};
