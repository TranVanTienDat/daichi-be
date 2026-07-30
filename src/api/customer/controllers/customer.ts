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
  "api::customer.customer",
  ({ strapi }) => ({
    // POST /api/customers/staff
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

      // Sanitize input trước
      const self = this as unknown as CoreController;
      const sanitizedInput = (await self.sanitizeInput(
        inputData,
        ctx,
      )) as Record<string, unknown>;

      // Override staff sau sanitize — tránh client tự gán staff
      sanitizedInput.staff = user.id;

      const customer = await strapi.documents("api::customer.customer").create({
        data: sanitizedInput as any,
        populate: ["staff"],
      });

      // Sanitize output trước khi trả về
      const sanitizedCustomer = await self.sanitizeOutput(customer, ctx);
      return self.transformResponse(sanitizedCustomer);
    },

    // GET /api/customers/staff
    async getByStaff(ctx: Context) {
      const user = ctx.state.user;
      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const self = this as unknown as CoreController;
      await self.validateQuery(ctx);
      const sanitizedQuery = await self.sanitizeQuery(ctx);

      // Merge filter của staff vào filters từ client
      const filters = {
        $and: [
          { staff: { id: { $eq: user.id } } },
          ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
        ],
      };

      const { pagination, sort, populate, fields } = sanitizedQuery;

      const page = Math.max(1, pagination?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
      const start = (page - 1) * pageSize;

      const [customers, count] = await Promise.all([
        strapi.documents("api::customer.customer").findMany({
          filters,
          populate,
          sort,
          fields,
          start,
          limit: pageSize,
        }),
        strapi.documents("api::customer.customer").count({ filters }),
      ]);

      const sanitizedCustomers = await self.sanitizeOutput(customers, ctx);

      return self.transformResponse(sanitizedCustomers, {
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
