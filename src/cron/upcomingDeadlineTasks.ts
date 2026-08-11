import type { Core } from "@strapi/strapi";
import type { IBotService } from "../plugins/tele/server/src/services/telegram";

type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

interface TaskRow {
  id: number;
  title: string;
  dueDate: string;
  task_status: TaskStatus;
  priority: Priority;
  person_charge: Array<{
    id: number;
    fullName: string;
    telegramChatId: string | null;
  }>;
}

interface UserTaskGroup {
  fullName: string;
  telegramChatId: string;
  tasks: TaskRow[];
}

export default {
  upcomingDeadlineTasks: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      const botService = strapi.plugin("tele")?.service("telegram") as
        | IBotService
        | undefined;

      if (!botService || !botService.isReady()) {
        strapi.log.warn(
          "[DeadlineCron] Tele chua san sang, bo qua gui tin nhan.",
        );
        return;
      }

      // Lấy từ thời điểm hiện tại đến hết ngày T+4
      const now = new Date();

      const targetDateEnd = new Date(now);
      targetDateEnd.setDate(targetDateEnd.getDate() + 4);
      targetDateEnd.setHours(23, 59, 59, 999);

      try {
        const tasks = (await strapi.documents("api::task.task").findMany({
          filters: {
            dueDate: {
              $gte: now.toISOString(),
              $lte: targetDateEnd.toISOString(),
            },
            task_status: {
              $ne: "DONE",
            },
          },
          populate: ["person_charge"],
        })) as unknown as TaskRow[];

        if (!tasks || tasks.length === 0) {
          strapi.log.info(
            "[DeadlineCron] Khong co task nao den han trong 4 ngay toi.",
          );
          return;
        }

        strapi.log.info(
          `[DeadlineCron] Tim thay ${tasks.length} task sap den han.`,
        );

        // Nhóm task theo user (person_charge)
        const grouped = new Map<number, UserTaskGroup>();

        for (const task of tasks) {
          if (!task.person_charge || task.person_charge.length === 0) continue;

          for (const user of task.person_charge) {
            if (!user.telegramChatId) {
              strapi.log.warn(
                `[DeadlineCron] User "${user.fullName}" khong co telegramChatId. Bo qua.`,
              );
              continue;
            }

            if (!grouped.has(user.id)) {
              grouped.set(user.id, {
                fullName: user.fullName,
                telegramChatId: user.telegramChatId,
                tasks: [],
              });
            }
            grouped.get(user.id)!.tasks.push(task);
          }
        }

        let sentCount = 0;

        for (const [, group] of grouped) {
          const taskLines = group.tasks.map((t) => {
            const dateObj = new Date(t.dueDate);
            const dateStr = `${dateObj.getDate().toString().padStart(2, "0")}/${(dateObj.getMonth() + 1).toString().padStart(2, "0")}/${dateObj.getFullYear()} ${dateObj.getHours().toString().padStart(2, "0")}:${dateObj.getMinutes().toString().padStart(2, "0")}`;

            const priorityMap: Record<string, string> = {
              URGENT: "🔴 Khẩn cấp",
              HIGH: "🟠 Cao",
              MEDIUM: "🟡 Trung bình",
              LOW: "🟢 Thấp",
            };
            const priorityLabel = priorityMap[t.priority] ?? t.priority;

            return `\u2022 <b>${t.title}</b>\n  \u2514 Hạn chót: <b>${dateStr}</b>\n  \u2514 Ưu tiên: ${priorityLabel}`;
          });

          const message = [
            `🚨 <b>CÔNG VIỆC CHƯA HOÀN THÀNH SẮP ĐẾN HẠN</b>`,
            `Xin chào <b>${group.fullName}</b>, bạn có <b>${group.tasks.length}</b> công việc sẽ hết hạn trong 4 ngày tới:`,
            ``,
            ...taskLines,
            ``,
            `💡 Vui lòng kiểm tra và hoàn thành sớm nhé!`,
          ].join("\n");

          const taskUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/tasks`;

          try {
            await botService.sendMessage(group.telegramChatId, message, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🔗 Xem chi tiết nhiệm vụ", url: taskUrl }],
                ],
              },
            });
            sentCount++;
          } catch (err) {
            strapi.log.error(
              `[DeadlineCron] Gui Telegram that bai cho "${group.fullName}": ${err}`,
            );
          }
        }

        strapi.log.info(
          `[DeadlineCron] Hoan tat. Da gui thong bao cho ${sentCount} user.`,
        );
      } catch (error) {
        strapi.log.error(`[DeadlineCron] Loi khi chay cron: ${error}`);
      }
    },
    options: {
      rule: "0 0 7 * * *", // 6 AM
      tz: "Asia/Ho_Chi_Minh",
    },
  },
};
