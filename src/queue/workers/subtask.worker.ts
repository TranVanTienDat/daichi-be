import type { Core } from "@strapi/strapi";
import type { Job } from "bullmq";
import { QueueManager } from "../QueueManager";

export const SUBTASK_QUEUE = "subtask-processing";

export type BatchSubTaskJobData = {
  taskId: string;
  subTasks: Array<{
    title: string;
    status_reminder: string;
    additional_info?: string;
    dueDate: string;
    evidence: any[];
  }>;
  userId: number;
  batchId: string;
  batchSize: number;
  originalBatchId?: string;
};

export const registerSubTaskWorker = (strapiInstance: Core.Strapi) => {
  (globalThis as any).strapi = strapiInstance;
  const worker = QueueManager.getInstance().registerWorker<BatchSubTaskJobData>(
    SUBTASK_QUEUE,
    async (job: Job<BatchSubTaskJobData>) => {
      const { taskId, subTasks, userId, batchId, batchSize } = job.data;
      const results = {
        success: 0,
        failed: 0,
        errors: [] as Array<{ index: number; error: string; data: any }>,
      };

      try {
        const strapi = strapiInstance;

        const promises = subTasks.map(async (subTask, index) => {
          try {
            const createdSubTask = await strapi
              .documents("api::reminder-fee-task.reminder-fee-task")
              .create({
                data: {
                  ...subTask,
                  task: taskId,
                  created_by_user: userId,
                } as any,
              });

            results.success++;
            return {
              success: true,
              index,
              subTaskId: createdSubTask.documentId,
            };
          } catch (error) {
            results.failed++;
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            results.errors.push({
              index,
              error: errorMsg,
              data: subTask,
            });

            console.error(
              `Failed to create subtask ${index} in batch ${batchId}:`,
              error,
            );
            return {
              success: false,
              index,
              error: errorMsg,
            };
          }
        });

        const batchResults = await Promise.allSettled(promises);

        const progress = Math.round((results.success / subTasks.length) * 100);
        await job.updateProgress(progress);

        console.log(
          `Batch ${batchId} completed: ${results.success}/${subTasks.length} successful, ${results.failed} failed`,
        );

        return {
          batchId,
          total: subTasks.length,
          successful: results.success,
          failed: results.failed,
          errors: results.errors,
          results: batchResults,
        };
      } catch (error) {
        console.error(`Critical error processing batch ${batchId}:`, error);
        throw error;
      }
    },
    5,
  );

  worker.on("completed", (job, result) => {
    const { successful, failed, total } = result as {
      successful: number;
      failed: number;
      total: number;
      batchId: string;
    };
    console.log(
      `✅ Batch ${result.batchId} completed: ${successful}/${total} successful, ${failed} failed`,
    );
  });

  worker.on("failed", (job, err) => {
    console.error(
      `❌ Batch job ${job?.id || "unknown"} failed completely:`,
      err,
    );
  });
};

export const queueService = {
  async addSubTasksBatch(
    taskId: string,
    subTasks: any[],
    userId: number,
    batchSize: number = 10,
  ): Promise<{ batchId: string; jobIds: string[]; totalBatches: number }> {
    const queue = QueueManager.getInstance().getQueue<BatchSubTaskJobData>(
      SUBTASK_QUEUE,
    );
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const jobs: any[] = [];

    const batches = [];
    for (let i = 0; i < subTasks.length; i += batchSize) {
      batches.push(subTasks.slice(i, i + batchSize));
    }

    batches.forEach((batch, batchIndex) => {
      jobs.push({
        name: `batch-${batchIndex}`,
        data: {
          taskId,
          subTasks: batch,
          userId,
          batchId,
          batchSize: batch.length,
        },
        opts: {
          delay: batchIndex * 500,
        },
      });
    });

    const addedJobs = await queue.addBulk(jobs);
    const jobIds = addedJobs.map((job) => job.id!);

    console.log(
      `📦 Created ${batches.length} batches for ${subTasks.length} subtasks (batchId: ${batchId})`,
    );

    return { batchId, jobIds, totalBatches: batches.length };
  },

  async retryFailedSubTasks(
    batchId: string,
  ): Promise<{ retryBatchId: string; failedCount: number }> {
    const queue = QueueManager.getInstance().getQueue<BatchSubTaskJobData>(
      SUBTASK_QUEUE,
    );
    const jobs = await queue.getJobs(["completed", "failed"]);
    const batchJobs = jobs.filter((job) => job.data?.batchId === batchId);

    const failedSubTasks: any[] = [];
    let taskId = "";
    let userId = 0;

    batchJobs.forEach((job) => {
      if (job.returnvalue && job.returnvalue.errors) {
        taskId = job.data.taskId;
        userId = job.data.userId;

        job.returnvalue.errors.forEach((error: any) => {
          failedSubTasks.push(error.data);
        });
      }
    });

    if (failedSubTasks.length === 0) {
      return { retryBatchId: "", failedCount: 0 };
    }

    const retryBatchId = `retry_${batchId}_${Date.now()}`;

    const retryJob = await queue.add("retry-batch", {
      taskId,
      subTasks: failedSubTasks,
      userId,
      batchId: retryBatchId,
      batchSize: failedSubTasks.length,
      originalBatchId: batchId,
    });

    console.log(
      `🔄 Created retry batch ${retryBatchId} for ${failedSubTasks.length} failed subtasks`,
    );

    return { retryBatchId, failedCount: failedSubTasks.length };
  },

  async getBatchStatus(batchId: string) {
    const queue = QueueManager.getInstance().getQueue<BatchSubTaskJobData>(
      SUBTASK_QUEUE,
    );
    const jobs = await queue.getJobs([
      "waiting",
      "active",
      "completed",
      "failed",
    ]);

    const originalBatchJobs = jobs.filter(
      (job) => job.data?.batchId === batchId,
    );
    const retryBatchJobs = jobs.filter(
      (job) => job.data?.originalBatchId === batchId,
    );
    const allBatchJobs = [...originalBatchJobs, ...retryBatchJobs];

    let totalSubTasks = 0;
    let successfulSubTasks = 0;
    let failedSubTasks = 0;
    const errorDetails: any[] = [];
    const retryBatches: any[] = [];

    allBatchJobs.forEach((job) => {
      if (job.returnvalue && job.finishedOn) {
        totalSubTasks += job.returnvalue.total || 0;
        successfulSubTasks += job.returnvalue.successful || 0;
        failedSubTasks += job.returnvalue.failed || 0;
        if (job.returnvalue.errors) {
          errorDetails.push(...job.returnvalue.errors);
        }
      } else if (job.data?.subTasks) {
        totalSubTasks += job.data.subTasks.length;
      }

      if (job.data?.originalBatchId === batchId) {
        retryBatches.push({
          retryBatchId: job.data.batchId,
          status: job.finishedOn ? "completed" : "processing",
          failedCount: job.data.batchSize,
          successful: job.returnvalue?.successful || 0,
          failed: job.returnvalue?.failed || 0,
        });
      }
    });

    const status = {
      total: allBatchJobs.length,
      waiting: allBatchJobs.filter(
        (job) => job.opts.delay && Date.now() < job.timestamp + job.opts.delay,
      ).length,
      active: allBatchJobs.filter((job) => job.processedOn && !job.finishedOn)
        .length,
      completed: allBatchJobs.filter(
        (job) => job.finishedOn && !job.failedReason,
      ).length,
      failed: allBatchJobs.filter((job) => job.failedReason).length,

      subTasks: {
        total: totalSubTasks,
        successful: successfulSubTasks,
        failed: failedSubTasks,
        pending: totalSubTasks - successfulSubTasks - failedSubTasks,
      },
      errors: errorDetails,
      retryBatches,
      hasRetries: retryBatches.length > 0,
    };

    return status;
  },

  async getQueueStats() {
    const queue = QueueManager.getInstance().getQueue<BatchSubTaskJobData>(
      SUBTASK_QUEUE,
    );
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const failed = await queue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  },

  async cleanOldJobs() {
    const queue = QueueManager.getInstance().getQueue<BatchSubTaskJobData>(
      SUBTASK_QUEUE,
    );
    await queue.clean(24 * 60 * 60 * 1000, 100, "completed");
    await queue.clean(7 * 24 * 60 * 60 * 1000, 50, "failed");
  },
};
