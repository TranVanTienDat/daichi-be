import type { Core } from "@strapi/strapi";

const config: Core.RouterConfig = {
  type: "content-api",
  routes: [
    {
      method: "POST",
      path: "/tasks/staff",
      handler: "api::task.task.createByStaff",
      config: {
        middlewares: [],
      },
    },
    {
      method: "GET",
      path: "/tasks/staff",
      handler: "api::task.task.getByStaff",
      config: {
        middlewares: [],
      },
    },
  ],
};

export default config;
