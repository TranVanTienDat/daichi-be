import type { Core } from "@strapi/strapi";
import { registerEmailWorker } from "./queue/workers/email.worker";

export default {
  register() {},

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    registerEmailWorker(strapi);
  },
};
