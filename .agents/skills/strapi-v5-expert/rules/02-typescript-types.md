# Rule: TypeScript & Typings

1. ВЕСЬ КОД ДОЛЖЕН БЫТЬ НА TYPESCRIPT. Не используй `.js` файлы для контроллеров, сервисов или роутов, если не указано иное.
2. ИСПОЛЬЗУЙ ВСТРОЕННЫЕ ТИПЫ STRAPI: Импортируй типы из `@strapi/strapi`.
3. ТИПИЗАЦИЯ ФАБРИК: При расширении core-контроллеров или сервисов используй фабрики `factories.createCoreController` и типизируй параметр `strapi`.

**Правильный синтаксис (Strapi 5):**
```typescript
import { factories } from '@strapi/strapi';
import type { Core } from '@strapi/strapi';

export default factories.createCoreController('api::restaurant.restaurant', ({ strapi }: { strapi: Core.Strapi }) => ({
  // Переопределение метода
  async find(ctx) {
    // Вызов базового метода
    const { data, meta } = await super.find(ctx);
    
    // Кастомная логика
    return { data, meta };
  }
}));