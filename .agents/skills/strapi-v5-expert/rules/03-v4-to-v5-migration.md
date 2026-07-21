# Rule: Flat Response Format (v4 to v5)

1. ПЛОСКИЙ ФОРМАТ: В Strapi 5 ответы REST API больше не имеют глубокой вложенности `data` и `attributes`. 
2. ЗАПРЕТ: Никогда не пиши код, который обращается к `response.data.attributes.fieldName`. 
3. ДОСТУП К ДАННЫМ: Поля теперь находятся прямо на верхнем уровне объекта.

**Правильная структура ответа REST API (Strapi 5):**
```json
{
  "data": [
    {
      "id": 1,
      "documentId": "h90lgohlzfpjf3bvan72mzll",
      "title": "Test Article",
      "headerImage": {
        "id": 2,
        "documentId": "cf07g1dbusqr8mzmlbqvlegx",
        "url": "/uploads/image.jpg"
      }
    }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 25 } }
}

4. ПУБЛИКАЦИЯ: Вместо старого publicationState теперь используется параметр status: 'draft' | 'published'.