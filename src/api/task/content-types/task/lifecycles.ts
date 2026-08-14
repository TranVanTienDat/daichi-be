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

  async beforeUpdate(event: any) {
    console.log("event", event);

    const { params } = event;

    if (params?.where?.id) {
      const oldTask = await strapi.db.query("api::task.task").findOne({
        where: { id: params.where.id },
        populate: ["person_charge", "created_by_user"],
      });

      event.state = {
        oldTask,
      };
    }
  },

  async afterUpdate(event: any) {
    const { result, params } = event;

    try {
      const ctx = strapi.requestContext.get();
      const user = params?.data?._updatedByUser || ctx?.state?.user;

      let updatedByInfo = null;
      if (user) {
        updatedByInfo = {
          id: user.id || user.documentId,
          fullName:
            user.fullName ||
            user.username ||
            `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
            "Unknown User",
          email: user.email,
        };
      }

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

      // So sánh trạng thái cũ và mới để tạo chi tiết thay đổi
      const oldTask = event.state?.oldTask;

      console.log("oldTask", oldTask);
      const changes: string[] = [];

      const formatDate = (dateStr: string) => {
        if (!dateStr) return "";
        return new Date(dateStr).toLocaleDateString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
      };

      const formatPersonCharge = (users: any[]) => {
        if (!users || !Array.isArray(users)) return "";
        return users
          .map((u) => u.fullName || u.username || "Unknown")
          .join(", ");
      };

      // Theo dõi các field quan trọng và so sánh
      const trackableFields = {
        title: {
          label: "Tiêu đề",
          format: (val: any) => val || "Chưa có tiêu đề",
        },
        description: {
          label: "Mô tả",
          format: (val: any) => val || "Chưa có mô tả",
        },
        task_status: {
          label: "Trạng thái",
          format: (val: any) => {
            const statusMap: Record<string, string> = {
              TODO: "Cần làm",
              IN_PROGRESS: "Đang thực hiện",
              REVIEW: "Chờ duyệt",
              DONE: "Hoàn thành",
            };
            return statusMap[val] || val || "Chưa xác định";
          },
        },
        priority: {
          label: "Mức độ ưu tiên",
          format: (val: any) => {
            const priorityMap: Record<string, string> = {
              LOW: "Thấp",
              MEDIUM: "Trung bình",
              HIGH: "Cao",
              URGENT: "Khẩn cấp",
            };
            return priorityMap[val] || val || "Chưa xác định";
          },
        },
        dueDate: {
          label: "Thời hạn",
          format: (val: any) => (val ? formatDate(val) : "Chưa có thời hạn"),
        },
        person_charge: {
          label: "Người phụ trách",
          format: (val: any) =>
            val && Array.isArray(val) && val.length > 0
              ? formatPersonCharge(val)
              : "Chưa phân công",
        },
        secondary_info: {
          label: "Thông tin bổ sung",
          format: (val: any) => val || "Chưa có thông tin",
        },
        type: {
          label: "Loại task",
          format: (val: any) => {
            const typeMap: Record<string, string> = {
              reminder: "Nhắc nhở",
              fee_reminder: "Nhắc phí",
            };
            return typeMap[val] || val || "Chưa xác định";
          },
        },
      };

      // Chỉ so sánh những field thực sự có thay đổi giá trị (bỏ check updatedData.hasOwnProperty)
      for (const [field, config] of Object.entries(trackableFields)) {
        const oldValue = config.format(
          oldTask?.[field as keyof typeof oldTask],
        );
        const newValue = config.format((fullTask as any)[field]);

        // Chỉ thêm vào changes nếu giá trị thực sự khác nhau
        if (oldValue !== newValue) {
          changes.push(`${config.label}: ${oldValue} → ${newValue}`);
        }
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
          updateInfo: {
            updatedBy: updatedByInfo || {
              id: "system",
              fullName: "Hệ thống",
              email: null,
            },
            changes: changes.length > 0 ? changes : ["Cập nhật thông tin"],
            updatedAt: new Date().toISOString(),
          },
        });

      console.log(
        `[Task Lifecycle] Queued update notification for task ${result.id} → ${receivers.length} receiver(s), updated by: ${updatedByInfo?.fullName || "Unknown"}`,
      );
    } catch (err) {
      console.error("[Task Lifecycle] afterUpdate error:", err);
    }
  },
};
