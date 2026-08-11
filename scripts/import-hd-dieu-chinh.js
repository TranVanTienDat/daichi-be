"use strict";

require("dotenv").config();

/**
 * Import policy adjustment requests from Excel (HDBH_dieu_chinh_nghiep_vu.xlsx) into Strapi.
 * Each row creates a `policy-adjustment-request` record linked to the matching `insurance-contract`
 * (looked up by contract_number = Số HĐBH).
 *
 * Usage:   node scripts/import-hd-dieu-chinh.js [path-to-excel] [staff-email]
 * Example: node scripts/import-hd-dieu-chinh.js data/uploads/files/HDBH_dieu_chinh_nghiep_vu.xlsx staff@example.com
 *
 * Excel column mapping (0-indexed, data starts at row index 6 = Excel row 7):
 *  0  = STT
 *  1  = Số HĐBH              → insurance_contract (lookup)
 *  2  = Bên mua BH           → (bỏ qua)
 *  3  = Loại yêu cầu         → request_type
 *  4  = Tình trạng yêu cầu   → status_requirement (enum)
 *  5  = Thông tin YC bổ sung  → additional_info_notes
 *  6  = Ngày tiếp nhận       → received_date
 *  7  = Ngày thực hiện       → execution_date
 *  8  = Ngày hết hạn bổ sung → supplement_deadline
 *  9  = Văn phòng tiếp nhận  → receiving_office
 */

const path = require("path");
const XLSX = require("xlsx");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert an Excel serial date number OR dd/mm/yyyy string to ISO "YYYY-MM-DD".
 * Returns null if the value is empty / invalid.
 */
function mapDate(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "-") return null;

  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }

  const str = raw.toString().trim();
  // dd/mm/yyyy
  const dmyMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);
  return null;
}

/**
 * Map Vietnamese status text → Strapi enum value.
 * Enum: PENDING | IN_PROGRESS | WAITING_SUPPLEMENT | COMPLETED | REJECTED
 */
function mapStatus(raw) {
  if (!raw) return "PENDING";
  const v = raw.toString().trim();
  if (v === "Đang thực hiện")        return "IN_PROGRESS";
  if (v === "Hẹn thực hiện")         return "IN_PROGRESS";
  if (v === "Chờ bổ sung thông tin") return "WAITING_SUPPLEMENT";
  if (v === "Đã hoàn thành")         return "COMPLETED";
  if (v === "Từ chối")               return "REJECTED";
  if (v === "Chờ xử lý")            return "PENDING";
  return "PENDING";
}

/** Parse one Excel row → adjustment request payload. */
function mapRow(cols) {
  const str = (v) => (v != null ? v.toString().trim() : undefined);

  return {
    request_type:          str(cols[3]) || "",
    status_requirement:    mapStatus(cols[4]),
    additional_info_notes: str(cols[5]) || undefined,
    received_date:         mapDate(cols[6]),
    execution_date:        mapDate(cols[7]),
    supplement_deadline:   mapDate(cols[8]),
    receiving_office:      str(cols[9]) || undefined,
  };
}

// ─── Main import logic ───────────────────────────────────────────────────────

async function importAdjustmentRequests() {
  const excelPath =
    process.argv[2] ||
    path.join(
      __dirname,
      "..",
      "data",
      "uploads",
      "files",
      "HDBH_dieu_chinh_nghiep_vu.xlsx"
    );
  const staffEmail = process.argv[3];

  console.log(`\n📂 Reading Excel: ${excelPath}`);

  // ── Resolve optional staff user ──────────────────────────────────────────
  let staffUser = null;
  if (staffEmail) {
    console.log(`🔍 Looking up staff user: ${staffEmail}`);
    staffUser = await strapi
      .documents("plugin::users-permissions.user")
      .findFirst({ filters: { email: staffEmail.trim() } });

    if (staffUser) {
      console.log(
        `👤 Staff found: ${staffUser.username || staffUser.email} (documentId: ${staffUser.documentId})`
      );
    } else {
      console.warn(`⚠️  No staff user found for email "${staffEmail}"`);
    }
  }

  // ── Read workbook ────────────────────────────────────────────────────────
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // header:1 → array-of-arrays; defval:null → missing cells become null
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, header: 1 });

  // Data starts at Excel row 7 (index 6); skip header rows
  const dataRows = rawRows.slice(6);
  console.log(`📊 Found ${dataRows.length} data rows\n`);

  // ── Stats ────────────────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let noContract = 0;

  // ── Cache for contract lookups to avoid duplicate DB calls ───────────────
  const contractCache = new Map(); // contractNumber → documentId | null

  async function resolveContract(contractNumber) {
    if (contractCache.has(contractNumber)) return contractCache.get(contractNumber);

    const found = await strapi
      .documents("api::insurance-contract.insurance-contract")
      .findFirst({ filters: { contract_number: contractNumber } });

    const id = found ? found.documentId : null;
    contractCache.set(contractNumber, id);
    return id;
  }

  // ── Row loop ─────────────────────────────────────────────────────────────
  for (const cols of dataRows) {
    // Skip completely empty rows or rows without a contract number
    if (!cols || !cols[1]) {
      skipped++;
      continue;
    }

    const contractNumber = cols[1].toString().trim();
    if (!contractNumber) {
      skipped++;
      continue;
    }

    const payload = mapRow(cols);

    // received_date is required by schema
    if (!payload.received_date) {
      console.warn(`⚠️  Row "${contractNumber}" – missing received_date, skipping`);
      skipped++;
      continue;
    }

    // request_type is required
    if (!payload.request_type) {
      console.warn(`⚠️  Row "${contractNumber}" – missing request_type, skipping`);
      skipped++;
      continue;
    }

    try {
      // ── Link insurance contract ────────────────────────────────────────
      const contractDocId = await resolveContract(contractNumber);
      if (!contractDocId) {
        console.warn(
          `⚠️  [${contractNumber}] Insurance contract NOT FOUND in DB – skipping row`
        );
        noContract++;
        continue;
      }
      payload.insurance_contract = contractDocId;

      // ── Link staff user ────────────────────────────────────────────────
      if (staffUser) {
        payload.assigned_staff_id = staffUser.documentId || String(staffUser.id);
        payload.assigned_at = new Date().toISOString();
      }

      // ── Create adjustment request ──────────────────────────────────────
      await strapi
        .documents("api::policy-adjustment-request.policy-adjustment-request")
        .create({ data: payload });

      console.log(
        `✅ Created: [${contractNumber}] ${payload.policyholder_name} | ${payload.request_type} | ${payload.status_requirement}`
      );
      created++;
    } catch (err) {
      console.error(`❌ [${contractNumber}] ${err.message}`);
      errors++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n── Summary ──────────────────────────────────────");
  console.log(`✅ Created              : ${created}`);
  console.log(`🔗 Contracts not found  : ${noContract}`);
  console.log(`⏭️  Skipped (empty/bad)  : ${skipped}`);
  console.log(`❌ Errors               : ${errors}`);
  console.log("─────────────────────────────────────────────────\n");
}

// ─── Bootstrap Strapi & run ──────────────────────────────────────────────────

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";

  try {
    await importAdjustmentRequests();
  } finally {
    await app.destroy();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
