'use strict';

module.exports = {
  async up(knex) {
    await knex.schema.alterTable('contract_riders', (table) => {
      table.decimal('sum_insured', 20, 2).alter();
      table.decimal('periodic_premium', 20, 2).alter();
    });
  },

  async down(knex) {
    await knex.schema.alterTable('contract_riders', (table) => {
      table.decimal('sum_insured', 10, 2).alter();
      table.decimal('periodic_premium', 10, 2).alter();
    });
  },
};
