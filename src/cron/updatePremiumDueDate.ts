import type { Core } from "@strapi/strapi";

export default {
  updatePremiumDueDate: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      const knex = strapi.db.connection;

      const result = await knex.raw(
        `
        UPDATE insurance_contracts
        SET
          premium_due_date = CASE payment_frequency
            WHEN 'ANNUAL'      THEN premium_due_date + INTERVAL '1 year'
            WHEN 'SEMI_ANNUAL' THEN premium_due_date + INTERVAL '6 months'
            WHEN 'QUARTERLY'   THEN premium_due_date + INTERVAL '3 months'
            WHEN 'MONTHLY'     THEN premium_due_date + INTERVAL '1 month'
          END,
          fee_collection_status = 'PENDING'
        WHERE ContractStatus = 'ACTIVE'
          AND premium_due_date IS NOT NULL
          AND payment_frequency IS NOT NULL
          AND premium_due_date <= CURRENT_DATE
        `,
      );

      const rowCount = result.rowCount ?? 0;

      strapi.log.info(`[PremiumDueDateCron] Updated ${rowCount} contracts.`);
    },
    options: {
      rule: "0 0 1 * * *",
      tz: "Asia/Ho_Chi_Minh",
    },
  },
};
