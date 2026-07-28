/**
 * customer controller
 */

import { factories } from "@strapi/strapi";
import { errors } from "@strapi/utils";

const { UnauthorizedError } = errors;

export default factories.createCoreController(
  "api::customer.customer",
  ({ strapi }) => {
    // Helper: lấy transformResponse từ core controller
    const coreController = strapi.controller("api::customer.customer") as any;
    const transformResponse = (data: any, meta?: any) =>
      coreController?.transformResponse?.(data, meta) ?? { data, meta };

    return {
      // ─────────────────────────────────────────────────────────────────────────
      // POST /api/customers/me
      // Tạo customer mới, tự động gán staff = user đang đăng nhập
      // ─────────────────────────────────────────────────────────────────────────
      async createByStaff(ctx) {
        const user = ctx.state.user;

        if (!user) {
          throw new UnauthorizedError(
            "Bạn cần đăng nhập để thực hiện thao tác này.",
          );
        }

        // Lấy data từ request body (hỗ trợ cả { data: {...} } lẫn flat object)
        const body = ctx.request.body as
          | { data?: Record<string, unknown> }
          | Record<string, unknown>;

        const inputData: Record<string, unknown> =
          (body as { data?: Record<string, unknown> })?.data ??
          (body as Record<string, unknown>) ??
          {};

        // Gán staff = user đang login, override bất kỳ giá trị nào client truyền lên
        inputData.staff = user.id;

        const customer = await strapi
          .documents("api::customer.customer")
          .create({
            data: inputData as any,
            populate: ["staff"],
          });

        return transformResponse(customer);
      },

      // ─────────────────────────────────────────────────────────────────────────
      // GET /api/customers/me
      // Lay danh sach customers theo staff dang dang nhap.
      // Admin (role.type === "admin" hoac role.name === "Admin") thay tat ca,
      // co the truyen ?staffId=<userId> de filter theo staff cu the.
      // Staff thuong chi thay customers cua chinh minh.
      // ─────────────────────────────────────────────────────────────────────────
      async getByStaff(ctx) {
        const user = ctx.state.user;

        if (!user) {
          throw new UnauthorizedError(
            "Bạn cần đăng nhập để thực hiện thao tác này.",
          );
        }

        // Lấy đầy đủ thông tin role
        const fullUser = await strapi
          .query("plugin::users-permissions.user")
          .findOne({ where: { id: user.id }, populate: ["role"] });

        const isAdmin =
          fullUser?.role?.type === "admin" || fullUser?.role?.name === "Admin";

        // Build filter theo staff
        let staffFilter: Record<string, unknown> = {};

        if (isAdmin) {
          // Admin: có thể filter theo ?staffId=xxx hoặc lấy tất cả
          const staffId = ctx.query?.staffId as string | undefined;
          if (staffId) {
            staffFilter = { staff: { id: { $eq: Number(staffId) } } };
          }
        } else {
          // Staff thường: chỉ thấy customer của mình
          staffFilter = { staff: { id: { $eq: user.id } } };
        }

        // Pagination
        const page = Math.max(1, Number(ctx.query?.page ?? 1));
        const pageSize = Math.min(
          100,
          Math.max(1, Number(ctx.query?.pageSize ?? 25)),
        );
        const start = (page - 1) * pageSize;

        // Populate
        const populate = ctx.query?.populate ?? ["staff"];

        const [customers, count] = await Promise.all([
          strapi.documents("api::customer.customer").findMany({
            filters: staffFilter as any,
            populate: populate as any,
            start,
            limit: pageSize,
            sort: (ctx.query?.sort as any) ?? { createdAt: "desc" },
          }),
          strapi.documents("api::customer.customer").count({
            filters: staffFilter as any,
          }),
        ]);

        return transformResponse(customers, {
          pagination: {
            page,
            pageSize,
            pageCount: Math.ceil(count / pageSize),
            total: count,
          },
        });
      },
    };
  },
);
