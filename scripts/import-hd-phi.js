"use strict";

require("dotenv").config();

/**
 * Import insurance fee contracts from Excel file into Strapi and link to Customer & User
 * Usage: node scripts/import-hd-phi.js [path-to-excel] [staff-email]
 * Example: node scripts/import-hd-phi.js data/uploads/files/hd_phi.xlsx staff@example.com
 *
 * Excel column order (0-indexed):
 * 0=STT, 1=Số HĐBH, 2=Bên mua BH, 3=NĐBH chính, 4=Địa chỉ thu phí,
 * 5=Điện thoại di động, 6=Ngày hiệu lực, 7=Định kỳ đóng phí, 8=Số tiền,
 * 9=Kỳ đóng phí, 10=Tình trạng thu phí, 11=Phí dự tính định kỳ,
 * 12=Phí định kỳ/cơ bản định kỳ, 13=Phí đóng trước cho kỳ tới,
 * 14=Phí cơ bản các kỳ trước chưa đóng, 15=Nợ APL (Vay tự động + Lãi),
 * 16=Ngày kết thúc thời gian gia hạn đóng phí
 */

const path = require("path");
const XLSX = require("xlsx");

function mapFrequency(raw) {
  if (!raw) return "ANNUAL";
  const v = raw.toString().trim();
  if (v.startsWith("Năm")) return "ANNUAL";
  if (v.startsWith("Nửa năm")) return "SEMI_ANNUAL";
  if (v.startsWith("Quý")) return "QUARTERLY";
  if (v.startsWith("Tháng")) return "MONTHLY";
  return "ANNUAL";
}

function mapDate(raw) {
  if (raw === null || raw === undefined || raw === "-") return null;
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const str = raw.toString().trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return str.substring(0, 10);
  return null;
}

function mapDecimal(raw) {
  if (raw === null || raw === undefined || raw === "-") return 0;
  const n = parseFloat(raw.toString().replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function mapRow(cols) {
  const str = (v) => (v != null ? v.toString().trim() : undefined);
  return {
    contract_number: str(cols[1]) || "",
    insured_person_name: str(cols[3]) || str(cols[2]) || "",
    contact_address: str(cols[4]),
    effective_date: mapDate(cols[6]),
    payment_frequency: mapFrequency(cols[7]),
    premium_due_date: mapDate(cols[9]),
    fee_collection_status: str(cols[10]),
    estimated_periodic_premium: mapDecimal(cols[11]),
    periodic_or_base_premium: mapDecimal(cols[12]) || mapDecimal(cols[8]),
    advance_premium_next_term: mapDecimal(cols[13]),
    unpaid_past_base_premium: mapDecimal(cols[14]),
    apl_loan_and_interest: mapDecimal(cols[15]),
    grace_period_end_date: mapDate(cols[16]),
  };
}

async function importInsuranceContracts() {
  const excelPath =
    process.argv[2] ||
    path.join(
      __dirname,
      "..",
      "data",
      "uploads",
      "files",
      "hd_phi.xlsx",
    );
  const staffEmail = process.argv[3];

  console.log(`📂 Reading Excel: ${excelPath}`);

  let staffUser = null;
  if (staffEmail) {
    console.log(`🔍 Searching staff user with email: ${staffEmail}`);
    staffUser = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({
        filters: { email: staffEmail.trim() },
      });

    if (staffUser) {
      console.log(`👤 Found staff user: ${staffUser.username || staffUser.email} (DocumentID: ${staffUser.documentId})`);
    } else {
      console.warn(`⚠️ Warning: No staff user found for email "${staffEmail}"`);
    }
  }

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, header: 1 });

  // Data rows start at index 6 (Row 7 in Excel)
  const dataRows = rawRows.slice(6);

  console.log(`📊 Found ${dataRows.length} data rows`);

  let created = 0,
    updated = 0,
    skipped = 0,
    errors = 0,
    linkedCustomerCount = 0,
    linkedUserCount = 0;

  for (const cols of dataRows) {
    if (!cols || !cols[1]) {
      skipped++;
      continue;
    }

    const payload = mapRow(cols);
    const str = (v) => (v != null ? v.toString().trim() : undefined);

    if (!payload.contract_number) {
      skipped++;
      continue;
    }

    try {
      // Link staff user if found
      if (staffUser) {
        payload.user = staffUser.documentId || staffUser.id;
        linkedUserCount++;
      }

      // Link customer if found by mobile phone or full name
      const customerName = str(cols[2]);
      const mobilePhone = str(cols[5]);
      let customer = null;

      if (mobilePhone) {
        customer = await strapi
          .documents("api::customer.customer")
          .findFirst({
            filters: { mobilePhone },
          });
      }
      if (!customer && customerName) {
        customer = await strapi
          .documents("api::customer.customer")
          .findFirst({
            filters: { fullName: customerName },
          });
      }

      if (customer) {
        payload.customer = customer.documentId || customer.id;
        linkedCustomerCount++;
      }

      const existing = await strapi
        .documents("api::insurance-contract.insurance-contract")
        .findFirst({
          filters: { contract_number: payload.contract_number },
        });

      if (existing) {
        await strapi.documents("api::insurance-contract.insurance-contract").update({
          documentId: existing.documentId,
          data: payload,
        });
        console.log(
          `🔄 Updated: ${payload.contract_number} (${payload.insured_person_name})` +
            (customer ? ` [Linked Customer]` : "") +
            (staffUser ? ` [Linked User]` : "")
        );
        updated++;
      } else {
        await strapi.documents("api::insurance-contract.insurance-contract").create({
          data: payload,
        });
        console.log(
          `✅ Created: ${payload.contract_number} (${payload.insured_person_name})` +
            (customer ? ` [Linked Customer]` : "") +
            (staffUser ? ` [Linked User]` : "")
        );
        created++;
      }
    } catch (err) {
      console.error(`❌ [${payload.contract_number}] ${err.message}`);
      errors++;
    }
  }

  console.log("\n── Summary ──────────────────────────────");
  console.log(`✅ Created          : ${created}`);
  console.log(`🔄 Updated          : ${updated}`);
  console.log(`👤 Linked User      : ${linkedUserCount}`);
  console.log(`🤝 Linked Customer  : ${linkedCustomerCount}`);
  console.log(`⏭️  Skipped          : ${skipped}`);
  console.log(`❌ Errors           : ${errors}`);
  console.log("─────────────────────────────────────────");
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";
  try {
    await importInsuranceContracts();
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
