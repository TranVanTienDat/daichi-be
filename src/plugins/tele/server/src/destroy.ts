import type { Core } from "@strapi/strapi";
import { BotManager } from "./bot/BotManager";

const destroy = async ({ strapi }: { strapi: Core.Strapi }) => {
  await BotManager.getInstance().shutdown(strapi);
};

export default destroy;
