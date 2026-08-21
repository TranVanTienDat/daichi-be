"use strict";

/**
 * Import customers from Excel file into Strapi
 * Usage: node scripts/import-customers.js [path-to-excel]
 *
 * Excel column order (0-indexed):
 * 0=STT, 1=Mã KH, 2=Bên Mua BH, 3=Biệt danh, 4=ĐT di động, 5=Nhóm KH,
 * 6=Tổng HĐ còn HLực, 7=Tổng HĐ mất HLực, 8=Ngày Sinh, 9=Điểm Thưởng,
 * 10=Giới Tính, 11=Tình Trạng HN, 12=Email, 13=ĐT Nhà, 14=ĐT CQ,
 * 15=Địa Chỉ 1, 16=Địa Chỉ 2, 17=D-Connect, 18=TG D-Connect,
 * 19=Căn cước, 20=eKYC, 21=TG eKYC
 */

const path = require("path");
const XLSX = require("xlsx");

function mapTier(raw) {
  if (!raw) return "loyal";
  const v = raw.toString().trim();
  if (v.startsWith("Kim")) return "diamond";
  if (v.startsWith("Vàng")) return "gold";
  if (v.startsWith("Bạc")) return "silver";
  return "loyal";
}

function mapMaritalStatus(raw) {
  if (!raw) return undefined;
  const v = raw.toString().trim();
  if (v === "Đã kết hôn") return "married";
  if (v === "Độc thân") return "single";
  if (v === "Ly hôn") return "divorced";
  if (v === "Góa") return "widowed";
  return undefined;
}

function mapBool(raw) {
  if (!raw) return false;
  return raw.toString().trim() === "Có";
}

function mapDatetime(raw) {
  if (raw === null || raw === undefined || raw === "-") return null;
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return new Date(
      d.y,
      d.m - 1,
      d.d,
      d.H || 0,
      d.M || 0,
      d.S || 0,
    ).toISOString();
  }
  const str = raw.toString().trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).toISOString();
  return null;
}

function mapDate(raw) {
  if (raw === null || raw === undefined || raw === "-") return null;
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const m = raw
    .toString()
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function mapInt(raw) {
  if (raw === null || raw === undefined || raw === "-") return 0;
  const n = parseFloat(raw.toString().replace(/,/g, ""));
  return isNaN(n) ? 0 : Math.round(n);
}

// Map a raw array row (by column index) to Strapi customer data
function mapRow(cols) {
  const str = (v) => (v != null ? v.toString().trim() : undefined);
  return {
    customerCode: str(cols[1]) || "",
    fullName: str(cols[2]) || "",
    nickname: cols[3] != null ? str(cols[3]) : undefined,
    mobilePhone: cols[4] != null ? str(cols[4]) : undefined,
    customerTier: mapTier(cols[5]),
    purchasedContractsCount: mapInt(cols[6]),
    expiredContractsCount: mapInt(cols[7]),
    dateOfBirth: mapDate(cols[8]),
    rewardPoints: mapInt(cols[9]),
    maritalStatus: mapMaritalStatus(cols[11]),
    email: cols[12] != null ? str(cols[12]) : undefined,
    homePhone: cols[13] != null ? str(cols[13]) : undefined,
    officePhone: cols[14] != null ? str(cols[14]) : undefined,
    address1: cols[15] != null ? str(cols[15]) : undefined,
    address2: cols[16] != null ? str(cols[16]) : undefined,
    hasUsedDConnect: mapBool(cols[17]),
    lastDConnectLoginAt: mapDatetime(cols[18]),
    hasUpdatedCitizen: mapBool(cols[19]),
    hasRegisteredEkyc: mapBool(cols[20]),
    lastEkycRegisteredAt: mapDatetime(cols[21]),
  };
}

async function importCustomers() {
  const excelPath =
    process.argv[2] ||
    path.join(
      __dirname,
      "..",
      "data",
      "uploads",
      "files",
      "products",
      "Danh_sach_khach_hang_pro.xlsx",
    );

  console.log(`📂 Reading Excel: ${excelPath}`);

  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // header:1 gives array-of-arrays — no unicode key issues
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, header: 1 });

  // Find header row (contains "STT" or numeric-like first cell) then skip it
  // Row 0: title, Row 1: empty, Row 2: headers, Row 3+: data
  const dataRows = rawRows.slice(3); // skip title, empty, header rows

  console.log(`📊 Found ${dataRows.length} data rows`);
  if (dataRows[0]) {
    console.log("🔎 First data row:", JSON.stringify(dataRows[0]));
  }

  let created = 0,
    skipped = 0,
    errors = 0;

  for (const cols of dataRows) {
    const data = mapRow(cols);

    if (!data.customerCode || !data.fullName) {
      skipped++;
      continue;
    }

    try {
      const existing = await strapi
        .documents("api::customer.customer")
        .findFirst({
          filters: { customerCode: data.customerCode },
        });

      if (existing) {
        console.log(`⏭️  Exists: ${data.customerCode}`);
        skipped++;
        continue;
      }

      await strapi.documents("api::customer.customer").create({ data });
      console.log(`✅ ${data.customerCode} - ${data.fullName}`);
      created++;
    } catch (err) {
      console.error(`❌ [${data.customerCode}] ${err.message}`);
      errors++;
    }
  }

  console.log("\n── Summary ──────────────────────────────");
  console.log(`✅ Created : ${created}`);
  console.log(`⏭️  Skipped : ${skipped}`);
  console.log(`❌ Errors  : ${errors}`);
  console.log("─────────────────────────────────────────");
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";
  try {
    await importCustomers();
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
