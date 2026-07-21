# Rule: Document Service API & Identifiers

1. УСТАРЕВШИЙ API: Строго запрещено использовать `strapi.entityService`. Он объявлен устаревшим в Strapi 5.
2. НОВЫЙ API: Всегда используй `strapi.documents('api::uid.uid').methodName()`.
3. ИДЕНТИФИКАТОРЫ: В Strapi 5 основным идентификатором является `documentId` (строка из 24 символов). Обычный `id` (число) использовать для запросов НЕЛЬЗЯ.

**Правильный синтаксис (Strapi 5):**
```typescript
// ПОИСК ОДНОЙ ЗАПИСИ
const entry = await strapi.documents('api::article.article').findOne({
  documentId: 'abc123def456ghi789jkl012',
  populate: ['author', 'coverImage'], // Связи нужно популейтить явно
  status: 'published', // 'draft' по умолчанию, если включен Draft & Publish
});

// ОБНОВЛЕНИЕ
const updated = await strapi.documents('api::article.article').update({
  documentId: 'abc123def456ghi789jkl012',
  data: { title: 'New Title' },
});