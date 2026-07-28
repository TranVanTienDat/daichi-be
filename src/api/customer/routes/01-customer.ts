import type { Core } from "@strapi/strapi";

const config: Core.RouterConfig = {
  type: "content-api",
  routes: [
    {
      method: "POST",
      path: "/customers/me",
      handler: "api::customer.customer.createByStaff",
      config: {
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/customers/me",
      handler: "api::customer.customer.getByStaff",
      config: {
        middlewares: [],
      },
    },
  ],
};

export default config;
