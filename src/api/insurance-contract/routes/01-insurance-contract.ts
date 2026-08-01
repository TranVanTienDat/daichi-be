import type { Core } from "@strapi/strapi";

const config: Core.RouterConfig = {
  type: "content-api",
  routes: [
    {
      method: "POST",
      path: "/insurance-contracts/me",
      handler: "api::insurance-contract.insurance-contract.createByStaff",
      config: {
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/insurance-contracts/me",
      handler: "api::insurance-contract.insurance-contract.getByStaff",
      config: {
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/insurance-contracts/me/with-adjustment",
      handler:
        "api::insurance-contract.insurance-contract.getByStaffWithAdjustment",
      config: {
        middlewares: [],
      },
    },
  ],
};

export default config;
