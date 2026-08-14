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
    {
      method: "POST",
      path: "/sub-tasks/bulk",
      handler: "api::task.task.bulkCreateWithSubTasks",
      config: {
        middlewares: [],
      },
    },
  ],
};

export default config;
