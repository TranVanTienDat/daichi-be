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
};
