"use strict";

require("dotenv").config();

/**
 * Import insurance active contracts from Excel file (hđ_con_hieu_luc.xlsx) into Strapi
 * and link to Customer (by fullName) & User (by email).
 *
 * Usage: node scripts/import-hd-con-hieu-luc.js [path-to-excel] [staff-email]
 * Example: node scripts/import-hd-con-hieu-luc.js data/uploads/files/hđ_con_hieu_luc.xlsx staff@example.com
 *
 * Excel column order (0-indexed):
 * 0=STT, 1=Số HĐBH, 2=Bên mua BH, 3=NĐBH chính, 4=Tình trạng,
 * 5=Ngày hiệu lực, 6=Ngày đáo hạn, 7=Tỉ lệ chia, 8=Định kỳ đóng phí,
 * 9=Phí dự tính định kỳ, 10=Phí định kỳ/cơ bản định kỳ,
 * 11=Phí cơ bản các kỳ trước chưa đóng, 12=Nợ APL(Vay đóng phí + Lãi), 13=Đã có người thụ hưởng
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

function mapContractStatus(raw) {
  if (!raw) return "ACTIVE";
  const v = raw.toString().trim();
  if (v === "Đang hiệu lực") return "ACTIVE";
  return "ACTIVE";
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
    ContractStatus: mapContractStatus(cols[4]),
    effective_date: mapDate(cols[5]),
    maturity_date: mapDate(cols[6]),
    payment_frequency: mapFrequency(cols[8]),
    estimated_periodic_premium: mapDecimal(cols[9]),
    periodic_or_base_premium: mapDecimal(cols[10]),
    unpaid_past_base_premium: mapDecimal(cols[11]),
    apl_loan_and_interest: mapDecimal(cols[12]),
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
      "hđ_con_hieu_luc.xlsx",
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
      console.log(
        `👤 Found staff user: ${staffUser.username || staffUser.email} (DocumentID: ${staffUser.documentId})`
      );
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

  // Auto-ensure missing database columns exist in PostgreSQL
  try {
    const knex = strapi.db.connection;
    const columnsToCheck = [
      { name: "apl_loan_and_interest", type: "double" },
      { name: "unpaid_past_base_premium", type: "double" },
      { name: "periodic_or_base_premium", type: "double" },
      { name: "estimated_periodic_premium", type: "double" },
      { name: "maturity_date", type: "date" },
    ];
    for (const col of columnsToCheck) {
      const has = await knex.schema.hasColumn("insurance_contracts", col.name);
      if (!has) {
        console.log(`🛠️ Auto-creating missing DB column in PostgreSQL: ${col.name}`);
        await knex.schema.table("insurance_contracts", (t) => {
          if (col.type === "double") t.double(col.name).nullable();
          else if (col.type === "date") t.date(col.name).nullable();
        });
      }
    }
  } catch (err) {
    console.warn("⚠️ Column sync warning:", err.message);
  }

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
    const customerName = cols[2] != null ? cols[2].toString().trim() : null;

    if (!payload.contract_number) {
      skipped++;
      continue;
    }

    try {
      // Link staff user if found by email
      if (staffUser) {
        payload.user = staffUser.documentId || staffUser.id;
        linkedUserCount++;
      }

      // Link customer by fullName (Bên mua BH)
      let customer = null;
      if (customerName) {
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
        await strapi
          .documents("api::insurance-contract.insurance-contract")
          .update({
            documentId: existing.documentId,
            data: payload,
          });
        console.log(
          `🔄 Updated: ${payload.contract_number} (${payload.insured_person_name})` +
            (customer ? ` [Linked Customer: ${customerName}]` : "") +
            (staffUser ? ` [Linked User: ${staffUser.email}]` : "")
        );
        updated++;
      } else {
        await strapi
          .documents("api::insurance-contract.insurance-contract")
          .create({
            data: payload,
          });
        console.log(
          `✅ Created: ${payload.contract_number} (${payload.insured_person_name})` +
            (customer ? ` [Linked Customer: ${customerName}]` : "") +
            (staffUser ? ` [Linked User: ${staffUser.email}]` : "")
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
