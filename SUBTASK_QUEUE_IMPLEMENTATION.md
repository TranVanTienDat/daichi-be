# SubTask Batch Processing Implementation

## 📦 **Batch Processing Strategy**

Thay vì xử lý từng subtask riêng lẻ, system bây giờ xử lý theo **batch** (nhóm):

- **Batch Size**: 10 subtasks/batch (có thể config)
- **Parallel Processing**: Mỗi batch xử lý 10 subtasks cùng lúc
- **Error Isolation**: 1 subtask lỗi không làm fail cả batch
- **Individual Retry**: Mỗi subtask trong batch có error handling riêng

## 🔧 **Error Handling Strategy**

### **Scenario**: Batch có 10 subtasks, 2 cái lỗi

```typescript
// Trong 1 batch job
const promises = subTasks.map(async (subTask, index) => {
  try {
    const created = await strapi.documents(...).create(...);
    results.success++; // ✅ Thành công
    return { success: true, subTaskId: created.documentId };
  } catch (error) {
    results.failed++; // ❌ Lỗi nhưng không crash batch
    results.errors.push({ index, error: error.message, data: subTask });
    return { success: false, error: error.message };
  }
});

// Chờ tất cả hoàn thành (success hoặc failed)
await Promise.allSettled(promises);
```

**Kết quả**: 8/10 subtasks thành công, batch vẫn completed với partial success!

## 📊 **API Response**

### Tạo Task (không đổi request format):

```json
{
  "data": {
    /* task data */
  },
  "subTasks": {
    "total": 50,
    "batchId": "batch_123",
    "totalBatches": 5, // 50 chia 10 = 5 batches
    "batchSize": 10,
    "status": "queued",
    "message": "Đã thêm 50 sub-tasks vào 5 batch để xử lý..."
  }
}
```

### Theo dõi tiến trình:

```bash
GET /api/sub-tasks/batch/batch_123/status
```

```json
{
  "batchId": "batch_123",
  "batches": {
    "total": 5, // 5 batch jobs
    "waiting": 2, // 2 batch đang chờ
    "active": 1, // 1 batch đang chạy
    "completed": 2, // 2 batch đã xong
    "failed": 0 // 0 batch fail hoàn toàn
  },
  "subTasks": {
    "total": 50, // Tổng 50 subtasks
    "successful": 32, // 32 subtasks thành công
    "failed": 3, // 3 subtasks lỗi
    "pending": 15 // 15 subtasks chưa xử lý
  },
  "isComplete": false,
  "successRate": 91, // 32/35 * 100 = 91%
  "errors": [
    {
      "index": 4,
      "error": "dueDate is required",
      "data": {
        /* subtask data */
      }
    }
  ]
}
```

## 🎯 **Lợi ích của Batch Processing**

✅ **Performance**: Xử lý 10 cái cùng lúc thay vì từng cái  
✅ **Partial Success**: 1 subtask lỗi không ảnh hưởng 9 cái khác  
✅ **Better Monitoring**: Track cả batch level và subtask level  
✅ **Error Details**: Biết chính xác subtask nào lỗi + lý do  
✅ **Scalable**: Dễ tune batch size theo load

## 🔄 **Flow Xử Lý**

```
50 SubTasks → [Batch 1: 10 items] → Process → 9 ✅ + 1 ❌
            → [Batch 2: 10 items] → Process → 10 ✅
            → [Batch 3: 10 items] → Process → 8 ✅ + 2 ❌
            → [Batch 4: 10 items] → Process → 10 ✅
            → [Batch 5: 10 items] → Process → 10 ✅

Final Result: 47/50 successful (94% success rate)
```

## ⚙️ **Configuration**

Có thể điều chỉnh batch size trong controller:

```typescript
const { batchId, jobIds, totalBatches } = await queueService.addSubTasksBatch(
  createdTask.documentId,
  subTasks,
  user.id,
  20, // Tăng batch size lên 20
);
```

## Files thay đổi/tạo mới

### 1. **src/services/queue.ts** (MỚI)

- Queue service với BullMQ + Redis
- Worker xử lý subtask jobs
- Batch processing với staggered execution
- Auto retry + cleanup

### 2. **src/api/task/controllers/task.ts**

- Chỉnh sửa `bulkCreateWithSubTasks`: đưa subtasks vào queue thay vì tạo đồng loạt
- Thêm `getBatchStatus`: API theo dõi tiến trình batch
- Thêm `getQueueStats`: API xem thống kê queue

### 3. **src/api/task/routes/01-task.ts**

- Thêm route: `GET /sub-tasks/batch/:batchId/status`
- Thêm route: `GET /queue/stats`

### 4. **src/index.ts** (MỚI)

- Bootstrap để init queue service khi Strapi start
- Auto cleanup jobs định kỳ

### 5. **types/global.d.ts** (MỚI)

- TypeScript declarations cho global Strapi instance

## Cách hoạt động

### Trước (Vấn đề):

```
FE → API → [Tạo 50 subtasks cùng lúc] → Response (chậm/timeout)
```

### Sau (Giải pháp):

```
FE → API → [Tạo main task + Queue 50 subtasks] → Response ngay với batchId
                     ↓ (background processing)
               [Worker xử lý từng subtask]
```

## API Usage

### Tạo task với subtasks (không đổi request format)

```bash
POST /api/sub-tasks/bulk
```

### Theo dõi tiến trình

```bash
GET /api/sub-tasks/batch/{batchId}/status
```

### Xem stats queue

```bash
GET /api/queue/stats
```

## Environment Requirements

Thêm vào `.env`:

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_TLS=false
```

## Lợi ích

✅ **Performance**: Response nhanh, không timeout  
✅ **Reliability**: Retry mechanism + error handling  
✅ **UX**: User không phải chờ lâu  
✅ **Monitoring**: Real-time progress tracking  
✅ **Scalability**: Có thể scale workers

## Next Steps

1. Test với Redis server
2. Monitor memory usage
3. Adjust queue settings theo load thực tế
4. Consider thêm dashboard UI cho admin
