import { registerEmailWorker } from "./queue/workers/email.worker";

export default {
  register() {},

  bootstrap() {
    // Đăng ký tất cả workers khi Strapi start
    registerEmailWorker();
  },
};
