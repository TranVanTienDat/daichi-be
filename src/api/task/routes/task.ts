/**
 * task router
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreRouter("api::task.task", {
  config: {
    find: {
      middlewares: ["api::task.default-populate"],
    },
    findOne: {
      middlewares: ["api::task.default-populate"],
    },
  },
});
