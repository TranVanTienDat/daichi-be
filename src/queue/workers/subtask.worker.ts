import type { Core } from "@strapi/strapi";
import type { Job } from "bullmq";
import { QueueManager } from "../QueueManager";

export const SUBTASK_QUEUE = "subtask-processing";

export type SubTaskInput = {
  title: string;
  status_reminder: string;
  additional_info?: string;
  dueDate?: string;
  evidence?: any[];
};

export type BatchSubTaskJobData = {
  taskId: string;
  subTasks: SubTaskInput[];
  userId: number;
  batchId: string;
  batchSize: number;
  originalBatchId?: string;
};

export type BatchSubTaskJobResult = {
  batchId: string;
  total: number;
  successful: number;
  failed: number;
  errors: Array<{ index: number; error: string; data: SubTaskInput }>;
};

const getSubTaskQueue = () =>
  QueueManager.getInstance().getQueue<BatchSubTaskJobData>(SUBTASK_QUEUE);

export const registerSubTaskWorker = (strapiInstance: Core.Strapi) => {
  QueueManager.getInstance().registerWorker<BatchSubTaskJobData>(
    SUBTASK_QUEUE,
    async (job: Job<BatchSubTaskJobData>): Promise<BatchSubTaskJobResult> => {
      const { taskId, subTasks, batchId } = job.data;
      const results: BatchSubTaskJobResult = {
        batchId,
        total: subTasks.length,
        successful: 0,
        failed: 0,
        errors: [],
      };

      await Promise.allSettled(
        subTasks.map(async (subTask, index) => {
          try {
            await strapiInstance
              .documents("api::reminder-fee-task.reminder-fee-task")
              .create({
                data: {
                  ...subTask,
                  task: taskId,
                } as any,
              });
            results.successful++;
          } catch (error) {
            results.failed++;
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            results.errors.push({ index, error: errorMsg, data: subTask });
            strapiInstance.log.error(
              `[SubTaskWorker] Failed to create subtask ${index} in batch ${batchId}: ${errorMsg}`,
            );
          }
        }),
      );

      const progress = Math.round((results.successful / subTasks.length) * 100);
      await job.updateProgress(progress);

      strapiInstance.log.info(
        `[SubTaskWorker] Batch ${batchId} completed: ${results.successful}/${subTasks.length} successful, ${results.failed} failed`,
      );

      return results;
    },
  );
};

export const subTaskQueueService = {
  // Thêm nhiều subtask vào queue theo batch
  async addSubTasksBatch(
    taskId: string,
    subTasks: SubTaskInput[],
    userId: number,
    batchSize: number = 10,
  ): Promise<{ batchId: string; jobIds: string[]; totalBatches: number }> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const batches: SubTaskInput[][] = [];
    for (let i = 0; i < subTasks.length; i += batchSize) {
      batches.push(subTasks.slice(i, i + batchSize));
    }

    const jobs = batches.map((batch, batchIndex) => ({
      name: `batch-${batchIndex}`,
      data: {
        taskId,
        subTasks: batch,
        userId,
        batchId,
        batchSize: batch.length,
      },
      opts: {
        delay: batchIndex * 500, // Giãn cách các batch 500ms
      },
    }));

    const addedJobs = await getSubTaskQueue().addBulk(jobs);
    const jobIds = addedJobs.map((job) => job.id!);

    return { batchId, jobIds, totalBatches: batches.length };
  },

  // Retry các subtask bị lỗi của một batch
  async retryFailedSubTasks(
    batchId: string,
  ): Promise<{ retryBatchId: string; failedCount: number }> {
    const queue = getSubTaskQueue();
    const jobs = await queue.getJobs(["completed", "failed"]);
    const batchJobs = jobs.filter((job) => job.data?.batchId === batchId);

    const failedSubTasks: SubTaskInput[] = [];
    let taskId = "";
    let userId = 0;

    batchJobs.forEach((job) => {
      const returnValue = job.returnvalue as BatchSubTaskJobResult | undefined;
      if (returnValue?.errors?.length) {
        taskId = job.data.taskId;
        userId = job.data.userId;
        returnValue.errors.forEach((error) => {
          failedSubTasks.push(error.data);
        });
      }
    });

    if (failedSubTasks.length === 0) {
      return { retryBatchId: "", failedCount: 0 };
    }

    const retryBatchId = `retry_${batchId}_${Date.now()}`;

    await queue.add("retry-batch", {
      taskId,
      subTasks: failedSubTasks,
      userId,
      batchId: retryBatchId,
      batchSize: failedSubTasks.length,
      originalBatchId: batchId,
    });

    return { retryBatchId, failedCount: failedSubTasks.length };
  },

  // Trạng thái chi tiết của một batch (bao gồm các retry batch)
  async getBatchStatus(batchId: string) {
    const queue = getSubTaskQueue();
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
    const errorDetails: BatchSubTaskJobResult["errors"] = [];
    const retryBatches: any[] = [];

    allBatchJobs.forEach((job) => {
      const returnValue = job.returnvalue as BatchSubTaskJobResult | undefined;
      if (returnValue && job.finishedOn) {
        totalSubTasks += returnValue.total || 0;
        successfulSubTasks += returnValue.successful || 0;
        failedSubTasks += returnValue.failed || 0;
        if (returnValue.errors) {
          errorDetails.push(...returnValue.errors);
        }
      } else if (job.data?.subTasks) {
        totalSubTasks += job.data.subTasks.length;
      }

      if (job.data?.originalBatchId === batchId) {
        retryBatches.push({
          retryBatchId: job.data.batchId,
          status: job.finishedOn ? "completed" : "processing",
          failedCount: job.data.batchSize,
          successful: returnValue?.successful || 0,
          failed: returnValue?.failed || 0,
        });
      }
    });

    return {
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
  },

  // Thống kê queue
  async getQueueStats() {
    const queue = getSubTaskQueue();
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  },

  // Dọn dẹp job cũ
  async cleanOldJobs() {
    const queue = getSubTaskQueue();
    await queue.clean(24 * 60 * 60 * 1000, 100, "completed");
    await queue.clean(7 * 24 * 60 * 60 * 1000, 50, "failed");
  },
};
