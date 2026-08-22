/**
 * insurance-contract controller
 */

import { factories } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import type { Context } from "koa";
import ExcelJS from "exceljs";

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

      const contract = await strapi
        .documents("api::insurance-contract.insurance-contract")
        .create({
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

    // GET /api/insurance-contracts/fee-report?start=DD-MM-YYYY&end=DD-MM-YYYY
    async getFeeReport(ctx: Context) {
      const user = ctx.state.user;
      if (!user) {
        throw new UnauthorizedError(
          "Bạn cần đăng nhập để thực hiện thao tác này.",
        );
      }

      const startParam = ctx.query.feeStart as string | undefined;
      const endParam = ctx.query.feeEnd as string | undefined;

      if (!startParam || !endParam) {
        ctx.status = 400;
        return ctx.body = {
          error: "Thiếu tham số feeStart hoặc feeEnd. Định dạng: DD-MM-YYYY",
        };
      }

      const parseDate = (value: string): Date => {
        const [day, month, year] = value.split("-").map(Number);
        return new Date(year, month - 1, day);
      };

      let startDate: Date;
      let endDate: Date;
      try {
        startDate = parseDate(startParam);
        endDate = parseDate(endParam);
      } catch {
        ctx.status = 400;
        return (ctx.body = {
          error: "Định dạng ngày không hợp lệ. Sử dụng DD-MM-YYYY",
        });
      }

      const today = new Date();

      const contracts = (await strapi
        .documents("api::insurance-contract.insurance-contract")
        .findMany({
          filters: {
            $and: [
              { user: { id: { $eq: user.id } } },
              { ContractStatus: { $eq: "ACTIVE" } },
              { effective_date: { $notNull: true } },
              { payment_frequency: { $notNull: true } },
            ],
          },
          populate: {
            customer: {
              fields: ["fullName", "mobilePhone", "customerCode"],
            },
          },
        })) as any[];

      const computePremiumDueDate = (
        effectiveDate: Date,
        frequency: string,
      ): Date | null => {
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

        if (!monthsPerPeriod) return null;

        const monthsPassed =
          (today.getFullYear() - effectiveDate.getFullYear()) * 12 +
          (today.getMonth() - effectiveDate.getMonth());

        const periodsPassed = Math.floor(monthsPassed / monthsPerPeriod);

        const premiumDueDate = new Date(effectiveDate);
        premiumDueDate.setMonth(
          premiumDueDate.getMonth() + periodsPassed * monthsPerPeriod,
        );

        return premiumDueDate;
      };

      const filtered = contracts
        .map((contract) => {
          const effectiveDate = new Date(contract.effective_date as string);
          const premiumDueDate = computePremiumDueDate(
            effectiveDate,
            contract.payment_frequency as string,
          );

          if (!premiumDueDate) return null;

          const inRange =
            premiumDueDate >= startDate && premiumDueDate <= endDate;

          if (!inRange) return null;

          return {
            contract,
            premiumDueDateStr: premiumDueDate.toISOString().slice(0, 10),
          };
        })
        .filter(Boolean) as { contract: any; premiumDueDateStr: string }[];

      const frequencyLabelMap: Record<string, string> = {
        ANNUAL: "Năm",
        SEMI_ANNUAL: "Nửa năm",
        QUARTERLY: "Quý",
        MONTHLY: "Tháng",
      };

      const formatCurrency = (
        value: number | string | null | undefined,
      ): string => {
        const num = typeof value === "number" ? value : Number(value || 0);
        if (!Number.isFinite(num)) return "0";
        return num.toLocaleString("vi-VN");
      };

      const formatDate = (value: string | null | undefined): string => {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value || "";
        const day = String(date.getDate()).padStart(2, "0");
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
      };

      const computeStatus = (premiumDueDateStr: string): string => {
        if (!premiumDueDateStr) return "";
        const dueDate = new Date(premiumDueDateStr);
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

        if (dueStart > todayStart) return "Sắp đến hạn thu phí";
        if (dueStart.getTime() === todayStart.getTime()) return "Đến hạn thu phí";
        return "Quá hạn thu phí";
      };

      const formatted = filtered.map((item, index) => {
        const contract = item.contract;
        const customer = contract.customer || {};

        return {
          stt: index + 1,
          so_hop_dong: contract.contract_number || "",
          ma_khach_hang: customer.customerCode || "",
          ben_mua_bao_hiem: customer.fullName || "",
          ndbh_chinh: contract.insured_person_name || "",
          tinh_trang: computeStatus(item.premiumDueDateStr),
          ngay_hieu_luc: formatDate(contract.effective_date),
          ngay_dao_han: formatDate(contract.maturity_date),
          dinh_ky_dong_phi:
            frequencyLabelMap[contract.payment_frequency as string] ||
            contract.payment_frequency ||
            "",
          ngay_thu_phi: formatDate(item.premiumDueDateStr),
          phi_dinh_ky_co_ban_dinh_ky: formatCurrency(
            contract.periodic_or_base_premium,
          ),
          so_dien_thoai_khach_hang: customer.mobilePhone || "",
        };
      });

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("BaoCaoThuPhi");

      worksheet.columns = [
        { header: "STT", key: "stt", width: 8 },
        { header: "Số HĐBH", key: "so_hop_dong", width: 18 },
        { header: "Mã khách hàng", key: "ma_khach_hang", width: 18 },
        { header: "Bên mua BH", key: "ben_mua_bao_hiem", width: 30 },
        { header: "NĐBH chính", key: "ndbh_chinh", width: 30 },
        { header: "Tình trạng", key: "tinh_trang", width: 20 },
        { header: "Ngày hiệu lực", key: "ngay_hieu_luc", width: 14 },
        { header: "Ngày đáo hạn", key: "ngay_dao_han", width: 14 },
        { header: "Định kỳ đóng phí", key: "dinh_ky_dong_phi", width: 16 },
        { header: "Ngày thu phí", key: "ngay_thu_phi", width: 16 },
        {
          header: "Phí định kỳ/cơ bản định kỳ",
          key: "phi_dinh_ky_co_ban_dinh_ky",
          width: 24,
        },
        { header: "SĐT khách hàng", key: "so_dien_thoai_khach_hang", width: 18 },
      ];

      formatted.forEach((row) => {
        worksheet.addRow(row);
      });

      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF4472C4" },
        };
        cell.font = {
          bold: true,
          color: { argb: "FFFFFFFF" },
        };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
        };
      });

      const buffer = await workbook.xlsx.writeBuffer();

      ctx.set(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      ctx.set(
        "Content-Disposition",
        `attachment; filename=bao-cao-thu-phi-${startParam}-${endParam}.xlsx`,
      );
      ctx.body = buffer;
    },
  }),
);
