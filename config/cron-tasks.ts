import upcomingBirthdayCustomers from "../src/cron/upcomingBirthdayCustomers";
import upcomingDeadlineTasks from "../src/cron/upcomingDeadlineTasks";
import updatePremiumDueDate from "../src/cron/updatePremiumDueDate";

export default {
  ...upcomingBirthdayCustomers,
  ...upcomingDeadlineTasks,
  ...updatePremiumDueDate,
};
