# Queue System cho SubTasks

## Tổng quan

Hệ thống queue được triển khai để xử lý việc tạo subtasks một cách bất đồng bộ, giải quyết vấn đề hiệu suất khi có nhiều subtasks cần được tạo đồng loạt.

## Công nghệ sử dụng

- **BullMQ**: Queue system mạnh mẽ cho Node.js
- **Redis**: Message broker và lưu trữ job data
- **ioredis**: Redis client với hiệu suất cao

## Cấu hình

### Environment Variables (.env)

```bash
# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=          # Để trống nếu không có password
REDIS_TLS=false          # Set true cho managed Redis services
```

### Queue Settings

- **Job Retry**: 3 lần với exponential backoff (2s, 4s, 8s)
- **Job Cleanup**:
  - Completed jobs: giữ 100 jobs gần nhất
  - Failed jobs: giữ 50 jobs gần nhất
  - Auto cleanup: mỗi giờ xóa completed jobs > 24h và failed jobs > 7 ngày
- **Processing**: Stagger execution 100ms giữa các jobs

## API Endpoints

### 1. Tạo Task với SubTasks (Cũ -> Queue)

**POST** `/api/sub-tasks/bulk`

**Request Body:**

```json
{
  "data": {
    "task": {
      "title": "Task chính",
      "description": "Mô tả task",
      "task_status": "TODO",
      "priority": "MEDIUM",
      "dueDate": "2026-08-29T00:00:00.000Z",
      "type": "fee_reminder",
      "person_charge": [2]
    },
    "subTasks": [
      {
        "title": "SubTask 1",
        "status_reminder": "not_reminded",
        "additional_info": "Info thêm",
        "dueDate": "2026-08-19T23:53:30.000Z",
        "evidence": []
      }
    ]
  }
}
```

**Response:**

```json
{
  "data": {
    "documentId": "task-document-id",
    "title": "Task chính",
    // ... task data
  },
  "subTasks": {
    "total": 12,
    "batchId": "batch_1234567890_abcd1234",
    "jobIds": ["1", "2", "3", ...],
    "status": "queued",
    "message": "Đã thêm 12 sub-tasks vào hàng đợi xử lý. Sử dụng batchId để theo dõi tiến trình."
  }
}
```

### 2. Theo dõi tiến trình Batch

**GET** `/api/sub-tasks/batch/:batchId/status`

**Response:**

```json
{
  "batchId": "batch_1234567890_abcd1234",
  "total": 12,
  "waiting": 8,
  "active": 2,
  "completed": 2,
  "failed": 0,
  "isComplete": false,
  "successRate": 17
}
```

### 3. Thống kê Queue

**GET** `/api/queue/stats`

**Response:**

```json
{
  "waiting": 45,
  "active": 5,
  "completed": 1234,
  "failed": 23
}
```

## Workflow Mới

### Trước khi có Queue (Vấn đề)

1. Frontend gửi 1 request với 50 subtasks
2. Backend xử lý tất cả trong 1 transaction
3. Database timeout nếu quá nhiều subtasks
4. Frontend phải chờ rất lâu
5. Nếu có lỗi, toàn bộ batch fail

### Sau khi có Queue (Giải pháp)

1. Frontend gửi request
2. Backend tạo main task ngay lập tức
3. SubTasks được đưa vào queue với batchId
4. Frontend nhận ngay response với batchId
5. Frontend có thể poll status bằng batchId
6. SubTasks được xử lý từ từ trong background
7. Nếu có subtask fail, các subtask khác vẫn tiếp tục

## Lợi ích

✅ **Hiệu suất**: Response time nhanh, không bị timeout
✅ **Độ tin cậy**: Retry mechanism, không mất data
✅ **Trải nghiệm**: User không phải chờ lâu
✅ **Monitoring**: Theo dõi real-time progress
✅ **Scalability**: Dễ dàng scale worker processes

## Monitoring & Debugging

### Log Messages

- ✅ `Queue service initialized successfully`
- 🧹 `Queue cleanup completed`
- ✅ `SubTask job {id} completed successfully`
- ❌ `SubTask job {id} failed: {error}`

### Debug Commands (Development)

```javascript
// Trong Strapi console hoặc lifecycle
const { queueService } = await import("./services/queue");

// Xem stats
const stats = await queueService.getQueueStats();

// Xem batch status
const status = await queueService.getBatchStatus("batch_123");

// Manual cleanup
await queueService.cleanOldJobs();
```

## Production Deployment

1. Đảm bảo Redis service đang chạy
2. Cấu hình REDIS\_\* environment variables
3. Deploy code với queue service
4. Monitor Redis memory usage và job processing

## Troubleshooting

### Redis Connection Issues

- Kiểm tra REDIS_HOST, REDIS_PORT
- Test connection: `redis-cli ping`
- Kiểm tra firewall, security groups

### Jobs Stuck in Queue

- Check worker logs cho errors
- Restart worker process
- Clear stuck jobs nếu cần

### High Memory Usage

- Tăng cleanup frequency
- Giảm job retention limits
- Monitor Redis memory
