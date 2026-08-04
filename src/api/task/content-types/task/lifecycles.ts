const formatDate = (value: string) => {
  if (!value) return "";
  const deadline = new Date(value);

  return deadline.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export default {
  async afterCreate(event: any) {
    const { result } = event;

    try {
      const receivers: any[] = result?.person_charge ?? [];

      if (receivers.length === 0) {
        console.log("[Task Lifecycle] No receivers found for task:", result.id);
        return;
      }

      const taskUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/tasks?taskId=${result.documentId}`;

      // Gửi email cho từng người được assign
      await Promise.all(
        receivers.map((user: any) =>
          (strapi as any)
            .plugin("email-designer-5")
            .service("email")
            .sendTemplatedEmail(
              {
                to: user.email,
              },
              {
                templateReferenceId: 2,
                subject: "Nhận được nhiệm vụ mới",
              },
              {
                USER: {
                  fullName: user.fullName,
                },
                URL: taskUrl,
                TASK: {
                  name: result?.title,
                  assignedBy: result?.created_by_user?.fullName,
                  deadline: formatDate(result?.dueDate),
                },
              },
            )
            .then(() => {
              console.log(`[Task Lifecycle] Email sent to ${user.email}`);
            })
            .catch((err: any) => {
              console.error(
                `[Task Lifecycle] Failed to send email to ${user.email}:`,
                err,
              );
            }),
        ),
      );
    } catch (err) {
      console.error("[Task Lifecycle] afterCreate error:", err);
    }
  },
};
