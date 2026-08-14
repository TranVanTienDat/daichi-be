# 🔄 SubTask Retry Mechanism

## Problem & Solution

### ❌ **Problem**: 50 subtasks → 46 thành công, 4 lỗi

```bash
Batch 1: 9/10 ✅ (1 lỗi)    → Batch COMPLETED
Batch 2: 10/10 ✅           → Batch COMPLETED
Batch 3: 10/10 ✅           → Batch COMPLETED
Batch 4: 8/10 ✅ (2 lỗi)    → Batch COMPLETED
Batch 5: 9/10 ✅ (1 lỗi)    → Batch COMPLETED

❌ Kết quả: 4 subtasks failed KHÔNG được retry!
```

### ✅ **Solution**: Manual Retry Mechanism

```bash
1. Check batch status → thấy có 4 failed subtasks
2. Call retry API → tạo retry batch chỉ với 4 subtasks failed
3. Process retry batch → có thể recover 2-3 subtasks
4. Final result: 48-49/50 thành công thay vì 46/50
```

## 🚀 **API Usage**

### 1. Check Batch Status

```bash
GET /api/sub-tasks/batch/batch_123/status
```

**Response với failed subtasks:**

```json
{
  "batchId": "batch_123",
  "batches": {
    "total": 5,
    "completed": 5,
    "failed": 0
  },
  "subTasks": {
    "total": 50,
    "successful": 46, // ✅ 46 thành công
    "failed": 4, // ❌ 4 lỗi
    "pending": 0
  },
  "errors": [
    {
      "index": 4,
      "error": "dueDate is required",
      "data": {
        /* subtask data that failed */
      }
    },
    {
      "index": 18,
      "error": "title cannot be empty",
      "data": {
        /* subtask data that failed */
      }
    }
  ],
  "hasRetries": false, // Chưa có retry
  "retryBatches": []
}
```

### 2. Retry Failed SubTasks

```bash
POST /api/sub-tasks/batch/batch_123/retry
```

**Response:**

```json
{
  "message": "Đã tạo retry batch cho 4 subtasks failed.",
  "originalBatchId": "batch_123",
  "retryBatchId": "retry_batch_123_1734567890",
  "failedCount": 4
}
```

### 3. Check Status After Retry

```bash
GET /api/sub-tasks/batch/batch_123/status
```

**Response sau retry:**

```json
{
  "batchId": "batch_123",
  "batches": {
    "total": 6, // 5 original + 1 retry batch
    "completed": 6,
    "failed": 0
  },
  "subTasks": {
    "total": 54, // 50 original + 4 retry
    "successful": 49, // ✅ 46 + 3 recovered = 49!
    "failed": 1, // ❌ Only 1 still failed
    "pending": 0
  },
  "hasRetries": true, // Có retry rồi
  "retryBatches": [
    {
      "retryBatchId": "retry_batch_123_1734567890",
      "status": "completed",
      "failedCount": 4, // Retry 4 subtasks
      "successful": 3, // 3 recovered
      "failed": 1 // 1 vẫn lỗi
    }
  ],
  "errors": [
    {
      "index": 18,
      "error": "Database connection timeout",
      "data": {
        /* subtask vẫn lỗi sau retry */
      }
    }
  ]
}
```

## 📊 **Flow Diagram**

```
50 SubTasks Initial
     ↓
5 Batches Processing
     ↓
46 ✅ + 4 ❌ = 92% success
     ↓
POST /retry → Create retry batch with 4 failed
     ↓
Retry Batch Processing (4 subtasks)
     ↓
3 ✅ + 1 ❌ = 75% recovery
     ↓
Final: 49 ✅ + 1 ❌ = 98% total success!
```

## 🎯 **Benefits**

✅ **Higher Success Rate**: 98% thay vì 92%  
✅ **Manual Control**: User quyết định khi nào retry  
✅ **Error Tracking**: Biết chính xác subtask nào vẫn lỗi  
✅ **No Data Loss**: Không mất subtasks do temporary issues  
✅ **Transparent**: Full visibility vào retry process

## 🔧 **Technical Implementation**

### Retry Logic:

1. **Collect Failed**: Scan completed batches, extract failed subtasks
2. **Create Retry Batch**: New batch job chỉ với failed subtasks
3. **Link Original**: `originalBatchId` để track relationship
4. **Process**: Retry batch xử lý như batch thường
5. **Aggregate Status**: Combine original + retry results

### Error Scenarios:

- **Validation errors**: Có thể fix data và retry thành công
- **Network timeouts**: Retry thường recover được
- **Database locks**: Temporary issue, retry sau vài phút
- **Permission errors**: Cần admin fix, retry sẽ vẫn fail

## 🚨 **Best Practices**

1. **Check status first** trước khi retry
2. **Fix root cause** nếu có pattern lỗi
3. **Don't spam retry** - analyze errors trước
4. **Monitor logs** để hiểu failure patterns
5. **Consider batch size** - batch nhỏ hơn có thể ít lỗi hơn

## 💡 **Future Enhancements**

- **Auto-retry**: Tự động retry sau N phút
- **Retry limits**: Max 3 lần retry per subtask
- **Smart retry**: Delay retry dựa trên error type
- **Batch splitting**: Chia batch lớn thành batch nhỏ hơn khi có nhiều lỗi
