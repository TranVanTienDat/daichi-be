import type { Core } from "@strapi/strapi";

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    strapi.log.warn(
      "[Tele] register() done, TELEGRAM_BOT_TOKEN is missing. Service is available but bot initialization will be skipped.",
    );
    return;
  }

  strapi.log.info("[Tele] register() done");
};

export default register;
