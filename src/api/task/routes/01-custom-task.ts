/**
 * Custom task routes for staff operations
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/tasks/staff",
      handler: "task.createByStaff",
    },
    {
      method: "GET",
      path: "/tasks/staff",
      handler: "task.getByStaff",
    },
    {
      method: "PUT",
      path: "/tasks/staff/:documentId",
      handler: "task.updateByStaff",
    },
    {
      method: "POST",
      path: "/sub-tasks/bulk",
      handler: "task.bulkCreateWithSubTasks",
    },
  ],
};
