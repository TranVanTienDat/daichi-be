import type { Core } from "@strapi/strapi";
import type { Job } from "bullmq";
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

        await Promise.all(
          receivers.map((user) =>
            (strapiInstance as any)
              .plugin("email-designer-5")
              .service("email")
              .sendTemplatedEmail(
                { to: user.email },
                { templateReferenceId: 1, subject: "Nhận được nhiệm vụ mới" },
                {
                  USER: { fullName: user.fullName },
                  URL: taskUrl,
                  TASK: {
                    fullName: task.title, // template dùng [TASK.fullName]
                    assignedBy: task.createdByFullName,
                    dueDate: formatDate(task.dueDate), // template dùng [TASK.dueDate]
                  },
                },
              )
              .then(() => console.log(`[EmailWorker] Sent to ${user.email}`))
              .catch((err: any) => {
                console.error(`[EmailWorker] Failed for ${user.email}:`, err);
                throw err; // re-throw để BullMQ retry
              }),
          ),
        );
      }
    },
  );
};
