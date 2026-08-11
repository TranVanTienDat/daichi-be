import { QueueManager } from "../../../../queue/QueueManager";
import {
  EMAIL_QUEUE,
  type TaskNotificationJobData,
} from "../../../../queue/workers/email.worker";

export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const receivers: any[] = result?.person_charge ?? [];

      if (receivers.length === 0) {
        console.log("[Task Lifecycle] No receivers for task:", result.id);
        return;
      }

      await QueueManager.getInstance()
        .getQueue<TaskNotificationJobData>(EMAIL_QUEUE)
        .add("task-assigned", {
          type: "task-assigned",
          receivers: receivers.map((user: any) => ({
            email: user.email,
            fullName: user.fullName,
          })),
          task: {
            title: result?.title,
            documentId: result?.documentId,
            dueDate: result?.dueDate,
            createdByFullName: result?.created_by_user?.fullName ?? "",
          },
        });

      console.log(
        `[Task Lifecycle] Queued notification for task ${result.id} → ${receivers.length} receiver(s)`,
      );
    } catch (err) {
      console.error("[Task Lifecycle] afterCreate error:", err);
    }
  },

  async afterUpdate(event: any) {
    const { result } = event;

    try {
      const fullTask = await strapi.documents("api::task.task").findOne({
        documentId: result.documentId,
        populate: ["person_charge", "created_by_user"],
      });

      if (!fullTask) return;

      const personCharge = fullTask.person_charge ?? [];
      const createdBy = fullTask.created_by_user;

      const receiverMap = new Map();

      if (createdBy?.email) {
        receiverMap.set(createdBy.email, {
          email: createdBy.email,
          fullName: createdBy.fullName,
        });
      }

      for (const user of personCharge) {
        if (user.email) {
          receiverMap.set(user.email, {
            email: user.email,
            fullName: user.fullName,
          });
        }
      }

      const receivers = Array.from(receiverMap.values());

      if (receivers.length === 0) {
        console.log(
          "[Task Lifecycle] No receivers for task update:",
          result.id,
        );
        return;
      }

      await QueueManager.getInstance()
        .getQueue<TaskNotificationJobData>(EMAIL_QUEUE)
        .add("task-updated", {
          type: "task-updated",
          receivers,
          task: {
            title: fullTask?.title as any,
            documentId: fullTask?.documentId as any,
            dueDate: fullTask?.dueDate as any,
            createdByFullName: createdBy?.fullName ?? "",
          },
        });

      console.log(
        `[Task Lifecycle] Queued update notification for task ${result.id} → ${receivers.length} receiver(s)`,
      );
    } catch (err) {
      console.error("[Task Lifecycle] afterUpdate error:", err);
    }
  },
};
