import upcomingBirthdayCustomers from "../src/cron/upcomingBirthdayCustomers";
import upcomingDeadlineTasks from "../src/cron/upcomingDeadlineTasks";

export default {
  ...upcomingBirthdayCustomers,
  ...upcomingDeadlineTasks,
};
