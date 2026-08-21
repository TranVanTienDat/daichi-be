/**
 * insurance-contract controller
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
  "api::insurance-contract.insurance-contract",
  ({ strapi }) => ({
    // POST /api/insurance-contracts/me
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

      sanitizedInput.user = user.id;

      const contract = await strapi.documents("api::insurance-contract.insurance-contract").create({
        data: sanitizedInput as any,
        populate: ["user"],
      });

      const sanitizedContract = await self.sanitizeOutput(contract, ctx);
      return self.transformResponse(sanitizedContract);
    },

    // GET /api/insurance-contracts/me
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

      const filters = {
        $and: [
          { user: { id: { $eq: user.id } } },
          ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
        ],
      };

      const { pagination, sort, populate, fields } = sanitizedQuery;

      const page = Math.max(1, pagination?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
      const start = (page - 1) * pageSize;

      const [contracts, count] = await Promise.all([
        strapi.documents("api::insurance-contract.insurance-contract").findMany({
          filters,
          populate,
          sort,
          fields,
          start,
          limit: pageSize,
        }),
        strapi.documents("api::insurance-contract.insurance-contract").count({ filters }),
      ]);

      const sanitizedContracts = await self.sanitizeOutput(contracts, ctx);

      return self.transformResponse(sanitizedContracts, {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(count / pageSize),
          total: count,
        },
      });
    },

    // GET /api/insurance-contracts/me/with-adjustment
    async getByStaffWithAdjustment(ctx: Context) {
      const user = ctx.state.user;
      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const self = this as unknown as CoreController;
      await self.validateQuery(ctx);
      const sanitizedQuery = await self.sanitizeQuery(ctx);

      const filters = {
        $and: [
          // Chỉ lấy hợp đồng của staff đang đăng nhập
          { user: { id: { $eq: user.id } } },
          // Chỉ lấy hợp đồng có ít nhất 1 policy_adjustment_request
          { policy_adjustment_requests: { id: { $notNull: true } } },
          ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
        ],
      };

      const { pagination, sort, populate, fields } = sanitizedQuery;

      const page = Math.max(1, pagination?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
      const start = (page - 1) * pageSize;

      const [contracts, count] = await Promise.all([
        strapi
          .documents("api::insurance-contract.insurance-contract")
          .findMany({
            filters,
            populate,
            sort,
            fields,
            start,
            limit: pageSize,
          }),
        strapi
          .documents("api::insurance-contract.insurance-contract")
          .count({ filters }),
      ]);

      const sanitizedContracts = await self.sanitizeOutput(contracts, ctx);

      return self.transformResponse(sanitizedContracts, {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(count / pageSize),
          total: count,
        },
      });
    },

    // GET /api/insurance-contracts/upcoming-fee
    async getUpcomingFeeContracts(ctx: Context) {
      const user = ctx.state.user;
      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const self = this as unknown as CoreController;
      await self.validateQuery(ctx);
      const sanitizedQuery = await self.sanitizeQuery(ctx);

      const { pagination, sort, populate, fields } = sanitizedQuery;

      const page = Math.max(1, pagination?.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 25));
      const start = (page - 1) * pageSize;

      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(startDate.getDate() - 60);
      const endDate = new Date(today);
      endDate.setMonth(endDate.getMonth() + 1);

      const contracts = (await strapi
        .documents("api::insurance-contract.insurance-contract")
        .findMany({
          filters: {
            $and: [
              { user: { id: { $eq: user.id } } },
              { ContractStatus: { $eq: "ACTIVE" } },
              { effective_date: { $notNull: true } },
              { payment_frequency: { $notNull: true } },
              ...(sanitizedQuery.filters ? [sanitizedQuery.filters] : []),
            ],
          },
          populate,
          sort,
          fields,
        })) as any[];

      const filtered = contracts.filter((contract) => {
        const effectiveDate = new Date(contract.effective_date as string);
        const frequency = contract.payment_frequency as string;

        const monthsPerPeriod =
          frequency === "ANNUAL"
            ? 12
            : frequency === "SEMI_ANNUAL"
              ? 6
              : frequency === "QUARTERLY"
                ? 3
                : frequency === "MONTHLY"
                  ? 1
                  : null;

        if (!monthsPerPeriod) return false;

        const monthsPassed =
          (today.getFullYear() - effectiveDate.getFullYear()) * 12 +
          (today.getMonth() - effectiveDate.getMonth());

        const periodsPassed = Math.floor(monthsPassed / monthsPerPeriod);

        const premiumDueDate = new Date(effectiveDate);
        premiumDueDate.setMonth(
          premiumDueDate.getMonth() + periodsPassed * monthsPerPeriod,
        );

        return premiumDueDate >= startDate && premiumDueDate <= endDate;
      });

      const total = filtered.length;
      const paginated = filtered.slice(start, start + pageSize);

      const sanitizedContracts = await self.sanitizeOutput(paginated, ctx);

      return self.transformResponse(sanitizedContracts, {
        pagination: {
          page,
          pageSize,
          pageCount: Math.ceil(total / pageSize),
          total,
        },
      });
    },
  }),
);
