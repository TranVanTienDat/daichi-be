"use strict";

import bootstrap from "./server/src/bootstrap";
import register from "./server/src/register";
import services from "./server/src/services";

module.exports = () => {
  return {
    register,
    services,
    bootstrap,
  };
};
