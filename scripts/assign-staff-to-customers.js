"use strict";

/**
 * Assign staff (user) relationship to customers
 *
 * Usage:
 *   node scripts/assign-staff-to-customers.js --user-email=staff@example.com
 *   node scripts/assign-staff-to-customers.js --user-id=1
 *   node scripts/assign-staff-to-customers.js --user-email=staff@example.com --only-empty   (chỉ update customer chưa có staff)
 *   node scripts/assign-staff-to-customers.js --user-email=staff@example.com --dry-run       (xem trước, không ghi DB)
 *
 * Options:
 *   --user-email=<email>   Tìm user theo email rồi assign cho customers
 *   --user-id=<id>         Dùng thẳng user ID
 *   --only-empty           Chỉ update những customer chưa có staff (mặc định: true)
 *   --all                  Update tất cả customers (kể cả đã có staff)
 *   --dry-run              Chỉ in ra danh sách, không ghi DB
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    userEmail: null,
    userId: null,
    onlyEmpty: true, // mặc định chỉ update customer chưa có staff
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--user-email=")) {
      opts.userEmail = arg.split("=")[1];
    } else if (arg.startsWith("--user-id=")) {
      opts.userId = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--all") {
      opts.onlyEmpty = false;
    } else if (arg === "--only-empty") {
      opts.onlyEmpty = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    }
  }

  return opts;
}

async function assignStaffToCustomers() {
  const opts = parseArgs();

  if (!opts.userEmail && !opts.userId) {
    console.error(
      "❌ Bắt buộc phải truyền --user-email=<email> hoặc --user-id=<id>",
    );
    console.error(
      "   Ví dụ: node scripts/assign-staff-to-customers.js --user-email=staff@example.com",
    );
    process.exit(1);
  }

  // ── 1. Tìm user ──────────────────────────────────────────────────────────────
  let user;

  if (opts.userId) {
    user = await strapi.query("plugin::users-permissions.user").findOne({
      where: { id: opts.userId },
    });
  } else {
    user = await strapi.query("plugin::users-permissions.user").findOne({
      where: { email: opts.userEmail },
    });
  }

  if (!user) {
    console.error(
      `❌ Không tìm thấy user: ${opts.userId ? `id=${opts.userId}` : `email=${opts.userEmail}`}`,
    );
    process.exit(1);
  }

  console.log(`👤 Staff: [${user.id}] ${user.username} <${user.email}>`);
  if (opts.dryRun) console.log("🔍 DRY RUN — không ghi vào DB\n");

  // ── 2. Lấy danh sách customers ───────────────────────────────────────────────
  const filters = {};
  if (opts.onlyEmpty) {
    filters.staff = { id: { $null: true } };
  }

  const customers = await strapi.documents("api::customer.customer").findMany({
    filters,
    populate: ["staff"],
    pagination: { pageSize: 1000 },
  });

  if (customers.length === 0) {
    console.log("ℹ️  Không có customer nào cần update.");
    return;
  }

  console.log(`📋 Tìm thấy ${customers.length} customer cần update\n`);

  // ── 3. Update từng customer ──────────────────────────────────────────────────
  let updated = 0;
  let errors = 0;

  for (const customer of customers) {
    const label = `[${customer.customerCode}] ${customer.fullName}`;

    if (opts.dryRun) {
      const currentStaff = customer.staff
        ? `${customer.staff.username} <${customer.staff.email}>`
        : "(trống)";
      console.log(`  → ${label}  |  staff hiện tại: ${currentStaff}`);
      updated++;
      continue;
    }

    try {
      await strapi.documents("api::customer.customer").update({
        documentId: customer.documentId,
        data: {
          staff: user.id,
        },
      });
      console.log(`✅ ${label}`);
      updated++;
    } catch (err) {
      console.error(`❌ ${label} — ${err.message}`);
      errors++;
    }
  }

  // ── 4. Summary ───────────────────────────────────────────────────────────────
  console.log("\n── Summary ──────────────────────────────────────────────");
  if (opts.dryRun) {
    console.log(`🔍 Sẽ update : ${updated} customer`);
  } else {
    console.log(`✅ Updated   : ${updated}`);
    console.log(`❌ Errors    : ${errors}`);
  }
  console.log("─────────────────────────────────────────────────────────");
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";

  try {
    await assignStaffToCustomers();
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
