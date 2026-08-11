"use strict";

require("dotenv").config();

/**
 * Script mapping mối quan hệ giữa Customer và InsuranceContract dựa trên file Excel Tong_hop.xlsx
 *
 * Cột dữ liệu Excel (0-indexed):
 * Col 2  : Số HĐBH (contract_number)
 * Col 3  : Bên mua BH (fullName)
 * Col 27 : Mã Khách Hàng (customerCode - nếu có)
 *
 * Cú pháp chạy:
 * node scripts/map-customer-contracts.js [path-to-excel]
 * Ví dụ:
 * node scripts/map-customer-contracts.js data/uploads/files/Tong_hop.xlsx
 */

const path = require("path");
const XLSX = require("xlsx");

async function mapCustomerContracts() {
  const excelPath =
    process.argv[2] ||
    path.join(
      __dirname,
      "..",
      "data",
      "uploads",
      "files",
      "Tong_hop.xlsx"
    );

  console.log(`📂 Đang đọc file Excel: ${excelPath}`);

  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Lấy dữ liệu dưới dạng mảng 2 chiều (header: 1)
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null, header: 1 });

  if (rawRows.length < 2) {
    console.warn("⚠️ File Excel không có dữ liệu!");
    return;
  }

  // Bỏ qua hàng tiêu đề (Row 0)
  const dataRows = rawRows.slice(1);
  console.log(`📊 Tìm thấy tổng cộng ${dataRows.length} dòng dữ liệu`);

  let totalProcessed = 0;
  let linkedNew = 0;
  let alreadyLinked = 0;
  let missingContract = 0;
  let missingCustomer = 0;
  let errors = 0;
  let skipped = 0;

  for (const cols of dataRows) {
    if (!cols) {
      skipped++;
      continue;
    }

    const str = (v) => (v != null ? v.toString().trim() : undefined);

    const contractNumber = str(cols[2]); // Số HĐBH
    const customerName = str(cols[3]);   // Bên mua BH
    const customerCode = str(cols[27]);  // Mã Khách Hàng (nếu có)

    if (!contractNumber) {
      skipped++;
      continue;
    }

    totalProcessed++;

    try {
      // 1. Tìm Hợp đồng bảo hiểm theo contract_number
      const contract = await strapi
        .documents("api::insurance-contract.insurance-contract")
        .findFirst({
          filters: { contract_number: contractNumber },
          populate: ["customer"],
        });

      if (!contract) {
        console.warn(`⚠️ [HĐ ${contractNumber}] Không tìm thấy hợp đồng trong CSDL (Khách hàng: ${customerName || "N/A"})`);
        missingContract++;
        continue;
      }

      // 2. Tìm Khách hàng tương ứng
      let customer = null;

      // Ưu tiên 1: Tra cứu theo customerCode nếu có
      if (customerCode) {
        customer = await strapi
          .documents("api::customer.customer")
          .findFirst({
            filters: { customerCode },
          });
      }

      // Ưu tiên 2: Fallback tra cứu theo fullName nếu không tìm thấy bằng customerCode
      if (!customer && customerName) {
        customer = await strapi
          .documents("api::customer.customer")
          .findFirst({
            filters: { fullName: customerName },
          });
      }

      if (!customer) {
        console.warn(`⚠️ [HĐ ${contractNumber}] Không tìm thấy Khách hàng "${customerName || customerCode}" trong CSDL`);
        missingCustomer++;
        continue;
      }

      // 3. Kiểm tra xem Hợp đồng đã gán Khách hàng này chưa
      const currentCustDocId = contract.customer?.documentId || contract.customer?.id;
      const targetCustDocId = customer.documentId || customer.id;

      if (currentCustDocId === targetCustDocId) {
        alreadyLinked++;
        continue;
      }

      // 4. Cập nhật relationship customer trong insurance-contract
      await strapi
        .documents("api::insurance-contract.insurance-contract")
        .update({
          documentId: contract.documentId,
          data: {
            customer: customer.documentId || customer.id,
          },
        });

      console.log(
        `✅ [Đã liên kết] HĐ: ${contractNumber} 🔗 KH: ${customer.fullName} (${customer.customerCode})`
      );
      linkedNew++;
    } catch (err) {
      console.error(`❌ [Lỗi - HĐ ${contractNumber}] ${err.message}`);
      errors++;
    }
  }

  console.log("\n── 📊 BÁO CÁO TỔNG KẾT MAPPING CUSTOMER <-> CONTRACT ──");
  console.log(`📥 Tổng dòng đã xử lý          : ${totalProcessed}`);
  console.log(`✅ Liên kết mới thành công      : ${linkedNew}`);
  console.log(`⏭️  Đã liên kết từ trước        : ${alreadyLinked}`);
  console.log(`⚠️ Không tìm thấy Hợp đồng     : ${missingContract}`);
  console.log(`⚠️ Không tìm thấy Khách hàng    : ${missingCustomer}`);
  console.log(`⏩ Dòng rỗng / Bỏ qua           : ${skipped}`);
  console.log(`❌ Lỗi phát sinh                : ${errors}`);
  console.log("──────────────────────────────────────────────────────────\n");
}

async function main() {
  const { createStrapi, compileStrapi } = require("@strapi/strapi");
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = "error";
  try {
    await mapCustomerContracts();
  } finally {
    await app.destroy();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
