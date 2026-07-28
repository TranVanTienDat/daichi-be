/**
 * customer router
 *
 * - Standard CRUD routes (admin/Strapi panel)
 * - POST  /api/customers/me  → tạo customer, gán staff = user đang login
 * - GET   /api/customers/me  → lấy danh sách customers của user đang login
 */

import { factories } from "@strapi/strapi";

const coreRouter = factories.createCoreRouter("api::customer.customer");

// coreRouter.routes có thể là Route[] hoặc () => Route[] nên cần resolve trước
const coreRoutes =
  typeof coreRouter.routes === "function"
    ? coreRouter.routes()
    : coreRouter.routes;

export default {
  routes: [
    // ── Custom "me" routes (phải đứng TRƯỚC các core routes để không bị shadow) ──
    {
      method: "POST",
      path: "/customers/me",
      handler: "customer.createByStaff",
      config: {
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/customers/me",
      handler: "customer.getByStaff",
      config: {
        middlewares: [],
      },
    },
    // ── Core CRUD routes ──
    ...coreRoutes,
  ],
};
