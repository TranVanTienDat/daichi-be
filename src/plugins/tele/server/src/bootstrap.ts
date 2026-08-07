import type { Core } from "@strapi/strapi";
import { BotManager } from "./bot/BotManager";

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  strapi.log.info("[Tele] bootstrap() called");
  await BotManager.getInstance().init(strapi);
  strapi.log.info(
    `[Tele] bootstrap() done, isReady=${BotManager.getInstance().isInitialized()}`,
  );
};

export default bootstrap;
