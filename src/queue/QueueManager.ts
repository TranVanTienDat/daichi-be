import { Queue, Worker, type Job, type ConnectionOptions } from "bullmq";
import Redis from "ioredis";

type JobProcessor<T> = (job: Job<T>) => Promise<unknown>;

/**
 * QueueManager — Singleton quản lý toàn bộ Queue và Worker
 *
 * Usage:
 *   const qm = QueueManager.getInstance();
 *   await qm.getQueue("email-notifications").add("task-assigned", data);
 */
export class QueueManager {
  private static instance: QueueManager;

  private connection: Redis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();

  private constructor() {
    const isAiven = !!process.env.REDIS_TLS;

    this.connection = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null, // bắt buộc với BullMQ
      // Aiven / managed Redis yêu cầu TLS
      tls: isAiven ? { rejectUnauthorized: false } : undefined,
    });

    this.connection.on("connect", () =>
      console.log("[QueueManager] Redis connected"),
    );
    this.connection.on("error", (err) =>
      console.error("[QueueManager] Redis error:", err.message),
    );
  }

  /** Lấy singleton instance */
  static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  /** Lấy (hoặc tạo mới) một Queue theo tên */
  getQueue<T = any>(name: string): Queue<T> {
    if (!this.queues.has(name)) {
      const queue = new Queue<T>(name, {
        connection: this.connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      });
      this.queues.set(name, queue);
      console.log(`[QueueManager] Queue "${name}" registered`);
    }
    return this.queues.get(name) as Queue<T>;
  }

  /** Đăng ký Worker cho một Queue */
  registerWorker<T = any>(
    queueName: string,
    processor: JobProcessor<T>,
    concurrency = 5,
  ): Worker<T> {
    if (this.workers.has(queueName)) {
      console.warn(
        `[QueueManager] Worker for "${queueName}" already registered`,
      );
      return this.workers.get(queueName) as Worker<T>;
    }

    const worker = new Worker<T>(queueName, processor, {
      connection: this.connection,
      concurrency,
    });

    worker.on("completed", (job) =>
      console.log(`[QueueManager] [${queueName}] Job ${job.id} completed`),
    );
    worker.on("failed", (job, err) =>
      console.error(
        `[QueueManager] [${queueName}] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
      ),
    );

    this.workers.set(queueName, worker);
    console.log(`[QueueManager] Worker for "${queueName}" registered`);
    return worker;
  }

  /** Đóng tất cả queue và worker (dùng khi shutdown) */
  async closeAll(): Promise<void> {
    await Promise.all([
      ...[...this.workers.values()].map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
    await this.connection.quit();
    console.log("[QueueManager] All queues and workers closed");
  }
}
