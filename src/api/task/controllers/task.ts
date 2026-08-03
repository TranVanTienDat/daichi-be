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

      // Nếu là admin thì có quyền get hết, ngược lại lấy theo staff (person_charge có id = user.id)
      const filters = isAdmin
        ? (sanitizedQuery.filters ?? {})
        : {
            $and: [
              { person_charge: { id: { $eq: user.id } } },
              ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
            ],
          };

      const { pagination, sort, populate, fields } = sanitizedQuery;

      // Mặc định populate "person_charge" và "created_by_user" nếu client không truyền populate
      const effectivePopulate = populate ?? ["person_charge", "created_by_user"];

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
  }),
);
