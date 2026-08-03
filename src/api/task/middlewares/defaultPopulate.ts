export default (config: any, { strapi }: any) => {
  return async (ctx: any, next: any) => {
    if (!ctx.query.populate) {
      ctx.query.populate = ["createdBy", "updatedBy", "person_charge"];
    }
    await next();
  };
};
