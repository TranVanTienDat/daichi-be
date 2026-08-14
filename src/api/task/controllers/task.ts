/**
 * task controller
 */

import { factories } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import type { Context } from "koa";

type CoreController = {
  sanitizeInput: (data: unknown, ctx: Context) => Promise<unknown>;
  sanitizeOutput: (data: unknown, ctx: Context) => Promise<unknown>;
  sanitizeQuery: (ctx: Context) => Promise<Record<string, any>>;
  validateQuery: (ctx: Context) => Promise<void>;
  transformResponse: (data: unknown, meta?: unknown) => unknown;
  [key: string]: unknown;
};

const { UnauthorizedError } = errors;

export default factories.createCoreController(
  "api::task.task",
  ({ strapi }) => ({
    // POST /api/tasks/staff
    async createByStaff(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const body = ctx.request.body as
        | { data?: Record<string, unknown> }
        | Record<string, unknown>;

      const inputData: Record<string, unknown> =
        (body as { data?: Record<string, unknown> })?.data ??
        (body as Record<string, unknown>) ??
        {};

      const self = this as unknown as CoreController;
      const sanitizedInput = (await self.sanitizeInput(
        inputData,
        ctx,
      )) as Record<string, unknown>;

      // Xử lý gắn user vào mảng person_charge của task
      let existingUsers: (number | string)[] = [];
      if (Array.isArray(sanitizedInput.person_charge)) {
        existingUsers = sanitizedInput.person_charge as (number | string)[];
      } else if (sanitizedInput.person_charge) {
        existingUsers = [sanitizedInput.person_charge as number | string];
      }

      if (!existingUsers.includes(user.id)) {
        existingUsers.push(user.id);
      }
      sanitizedInput.person_charge = existingUsers;

      // Tự động gán người tạo task
      sanitizedInput.created_by_user = user.id;

      const task = await strapi.documents("api::task.task").create({
        data: sanitizedInput as any,
        populate: ["person_charge", "created_by_user"],
      });

      const sanitizedTask = await self.sanitizeOutput(task, ctx);
      return self.transformResponse(sanitizedTask);
    },

    // GET /api/tasks/staff
    async getByStaff(ctx: Context) {
      const user = ctx.state.user;
      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      // Kiểm tra role của user
      const fullUser = await strapi
        .documents("plugin::users-permissions.user")
        .findOne({
          documentId: user.documentId,
          populate: ["role"],
        });

      const roleName = fullUser?.role?.name?.toLowerCase() || "";
      const roleType = fullUser?.role?.type?.toLowerCase() || "";
      const isAdmin = roleName.includes("admin") || roleType === "admin";

      const self = this as unknown as CoreController;
      await self.validateQuery(ctx);
      const sanitizedQuery = await self.sanitizeQuery(ctx);

      // Nếu là admin thì có quyền get hết
      // Ngược lại lấy theo staff: task có user trong person_charge HOẶC user là người tạo (created_by_user)
      const staffCondition = {
        $or: [
          { person_charge: { id: { $eq: user.id } } },
          { created_by_user: { id: { $eq: user.id } } },
        ],
      };

      const filters = isAdmin
        ? (sanitizedQuery.filters ?? {})
        : {
            $and: [
              staffCondition,
              ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
            ],
          };

      const { pagination, sort, populate, fields } = sanitizedQuery;

      // Mặc định populate "person_charge" và "created_by_user" nếu client không truyền populate
      const effectivePopulate = populate ?? [
        "person_charge",
        "created_by_user",
      ];

      const page = Math.max(1, pagination?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
      const start = (page - 1) * pageSize;

      const [tasks, count] = await Promise.all([
        strapi.documents("api::task.task").findMany({
          filters,
          populate: effectivePopulate,
          sort,
          fields,
          start,
          limit: pageSize,
        }),
        strapi.documents("api::task.task").count({ filters }),
      ]);

      const sanitizedTasks = await self.sanitizeOutput(tasks, ctx);

      return self.transformResponse(sanitizedTasks, {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(count / pageSize),
          total: count,
        },
      });
    },

    // POST /api/sub-tasks/bulk
    async bulkCreateWithSubTasks(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const body = ctx.request.body as
        | { data?: Record<string, unknown> }
        | undefined;
      const inputData = body?.data ?? ({} as Record<string, unknown>);

      const taskData = inputData.task as Record<string, unknown> | undefined;
      const subTasks = inputData.subTasks as
        | Record<string, unknown>[]
        | undefined;

      if (!taskData) {
        return ctx.badRequest("Thiếu thông tin task.");
      }

      const hasSubTasks = Array.isArray(subTasks) && subTasks.length > 0;
      const self = this as unknown as CoreController;

      // Create the parent task first
      const sanitizedTaskInput = (await self.sanitizeInput(
        taskData,
        ctx,
      )) as Record<string, unknown>;

      sanitizedTaskInput.created_by_user = user.id;

      const createdTask = await strapi.documents("api::task.task").create({
        data: sanitizedTaskInput as any,
        populate: ["person_charge", "created_by_user"],
      });

      // If no subtasks, return immediately
      if (!hasSubTasks) {
        const sanitizedTask = await self.sanitizeOutput(createdTask, ctx);
        return self.transformResponse(sanitizedTask);
      }

      // Add subtasks to queue for background processing
      const { queueService } = await import("../../../queue/workers/subtask.worker");
      const { batchId, jobIds, totalBatches } =
        await queueService.addSubTasksBatch(
          createdTask.documentId,
          subTasks,
          user.id,
          10, // Process 10 subtasks per batch
        );

      const sanitizedTask = await self.sanitizeOutput(createdTask, ctx);
      const taskResponse = self.transformResponse(sanitizedTask) as Record<
        string,
        unknown
      >;

      return {
        ...taskResponse,
        subTasks: {
          total: subTasks.length,
          batchId,
          jobIds,
          totalBatches,
          batchSize: 10,
          status: "queued",
          message: `Đã thêm ${subTasks.length} sub-tasks vào ${totalBatches} batch để xử lý. Sử dụng batchId để theo dõi tiến trình.`,
        },
      };
    },

    // GET /api/sub-tasks/batch/:batchId/status
    async getBatchStatus(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const { batchId } = ctx.params;

      if (!batchId) {
        return ctx.badRequest("Thiếu batchId.");
      }

      const { queueService } = await import("../../../queue/workers/subtask.worker");
      const batchStatus = await queueService.getBatchStatus(batchId);

      return {
        batchId,
        batches: {
          total: batchStatus.total,
          waiting: batchStatus.waiting,
          active: batchStatus.active,
          completed: batchStatus.completed,
          failed: batchStatus.failed,
        },
        subTasks: batchStatus.subTasks,
        isComplete:
          batchStatus.completed + batchStatus.failed === batchStatus.total,
        successRate:
          batchStatus.subTasks.total > 0
            ? Math.round(
                (batchStatus.subTasks.successful / batchStatus.subTasks.total) *
                  100,
              )
            : 0,
        errors: batchStatus.errors,
        retryBatches: batchStatus.retryBatches,
        hasRetries: batchStatus.hasRetries,
      };
    },

    // POST /api/sub-tasks/batch/:batchId/retry
    async retryFailedSubTasks(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const { batchId } = ctx.params;

      if (!batchId) {
        return ctx.badRequest("Thiếu batchId.");
      }

      const { queueService } = await import("../../../queue/workers/subtask.worker");
      const retryResult = await queueService.retryFailedSubTasks(batchId);

      if (retryResult.failedCount === 0) {
        return {
          message: "Không có subtask nào cần retry.",
          retryBatchId: null,
          failedCount: 0,
        };
      }

      return {
        message: `Đã tạo retry batch cho ${retryResult.failedCount} subtasks failed.`,
        originalBatchId: batchId,
        retryBatchId: retryResult.retryBatchId,
        failedCount: retryResult.failedCount,
      };
    },

    // GET /api/queue/stats
    async getQueueStats(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const { queueService } = await import("../../../queue/workers/subtask.worker");
      const queueStats = await queueService.getQueueStats();

      return queueStats;
    },

    // PUT /api/tasks/staff/:documentId
    async updateByStaff(ctx: Context) {
      const user = ctx.state.user;

      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const { documentId } = ctx.params;
      if (!documentId) {
        return ctx.badRequest("Thiếu documentId.");
      }

      const body = ctx.request.body as
        | { data?: Record<string, unknown> }
        | Record<string, unknown>;

      const inputData: Record<string, unknown> =
        (body as { data?: Record<string, unknown> })?.data ??
        (body as Record<string, unknown>) ??
        {};

      const self = this as unknown as CoreController;
      const sanitizedInput = (await self.sanitizeInput(
        inputData,
        ctx,
      )) as Record<string, unknown>;

      // Kiểm tra quyền: user phải là người phụ trách hoặc người tạo task
      const existingTask = await strapi.documents("api::task.task").findOne({
        documentId,
        populate: ["person_charge", "created_by_user"],
      });

      if (!existingTask) {
        return ctx.notFound("Task không tồn tại.");
      }

      const personChargeIds = (existingTask.person_charge || []).map(
        (u: any) => u.id,
      );
      const createdById = existingTask.created_by_user?.id;
      const isAuthorized =
        personChargeIds.includes(user.id) || createdById === user.id;

      // Kiểm tra admin role
      const fullUser = await strapi
        .documents("plugin::users-permissions.user")
        .findOne({
          documentId: user.documentId,
          populate: ["role"],
        });

      const roleName = fullUser?.role?.name?.toLowerCase() || "";
      const roleType = fullUser?.role?.type?.toLowerCase() || "";
      const isAdmin = roleName.includes("admin") || roleType === "admin";

      if (!isAuthorized && !isAdmin) {
        throw new UnauthorizedError("Bạn không có quyền cập nhật task này.");
      }

      // Set user context vào strapi để lifecycle có thể truy cập
      const requestContext = strapi.requestContext?.get();
      if (requestContext) {
        requestContext.state = { ...requestContext.state, user };
      }

      // Lưa thông tin user vào params để lifecycle có thể truy cập
      const updateParams = {
        documentId,
        data: {
          ...sanitizedInput,
        } as any,
        populate: {
          person_charge: true,
          created_by_user: true,
        },
      };

      // Thêm thông tin người cập nhật vào context cho lifecycle
      if (!updateParams.data._updatedByUser) {
        updateParams.data._updatedByUser = {
          id: user.id,
          documentId: user.documentId,
          fullName: user.fullName,
          username: user.username,
          email: user.email,
        };
      }

      const updatedTask = await strapi
        .documents("api::task.task")
        .update(updateParams);

      const sanitizedTask = await self.sanitizeOutput(updatedTask, ctx);
      return self.transformResponse(sanitizedTask);
    },
  }),
);
