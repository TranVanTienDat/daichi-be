import type { Core } from "@strapi/strapi";
import type { IBotService } from "../plugins/tele/server/src/services/telegram";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMmDd(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntilBirthday(mmdd: string, today: Date): number {
  const thisYear = today.getFullYear();
  const bday = new Date(`${thisYear}-${mmdd}`);
  bday.setHours(0, 0, 0, 0);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  if (bday < todayMidnight) bday.setFullYear(thisYear + 1);
  return Math.round(
    (bday.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerRow = {
  customer_code: string;
  full_name: string;
  date_of_birth: string; // "YYYY-MM-DD"
  mobile_phone: string | null;
  staff_id: number | null;
  staff_full_name: string | null;
  staff_email: string | null;
  staff_telegram_chat_id: string | null;
};

type StaffGroup = {
  staffId: number;
  staffFullName: string;
  staffEmail: string;
  staffTelegramChatId: string;
  todayList: CustomerRow[];
  upcomingList: CustomerRow[];
};

// ── Raw SQL query ─────────────────────────────────────────────────────────────

/**
 * Query PostgreSQL: filter TO_CHAR(date_of_birth, 'MM-DD') khop voi
 * hom nay + 3 ngay tiep theo. JOIN luon voi up_users de lay thong tin staff.
 */
async function fetchBirthdayCustomers(
  strapi: Core.Strapi,
  today: Date,
): Promise<{ todayRows: CustomerRow[]; upcomingRows: CustomerRow[] }> {
  const knex = strapi.db.connection;

  const todayMmDd = toMmDd(today);

  const allMmDds = [todayMmDd, 1, 2, 3].map((offset, idx) => {
    if (idx === 0) return todayMmDd;
    const d = new Date(today);
    d.setDate(today.getDate() + (offset as number));
    return toMmDd(d);
  });

  // Strapi v5 stores manyToOne relations in a link table, not as a direct FK column.
  // The "staff" relation on customer is stored in "customers_staff_lnk" (customer_id, user_id).
  const rows: CustomerRow[] = await knex("customers as c")
    .select(
      "c.customer_code",
      "c.full_name",
      knex.raw("TO_CHAR(c.date_of_birth, 'YYYY-MM-DD') as date_of_birth"),
      "c.mobile_phone",
      "u.id as staff_id",
      "u.full_name as staff_full_name",
      "u.email as staff_email",
      "u.telegram_chat_id as staff_telegram_chat_id",
    )
    .leftJoin("customers_staff_lnk as lnk", "c.id", "lnk.customer_id")
    .leftJoin("up_users as u", "lnk.user_id", "u.id")
    .whereNotNull("c.date_of_birth")
    .whereRaw("TO_CHAR(c.date_of_birth, 'MM-DD') = ANY(?)", [allMmDds]);

  const todayRows: CustomerRow[] = [];
  const upcomingRows: CustomerRow[] = [];

  for (const row of rows) {
    const mmdd = row.date_of_birth.slice(5); // "YYYY-MM-DD" -> "MM-DD"
    if (mmdd === todayMmDd) todayRows.push(row);
    else upcomingRows.push(row);
  }

  return { todayRows, upcomingRows };
}

// ── Group theo staff ──────────────────────────────────────────────────────────

function groupByStaff(
  todayRows: CustomerRow[],
  upcomingRows: CustomerRow[],
): Map<number, StaffGroup> {
  const grouped = new Map<number, StaffGroup>();

  const addRow = (row: CustomerRow, bucket: "today" | "upcoming") => {
    if (!row.staff_id || !row.staff_telegram_chat_id) return;

    const key = row.staff_id;
    if (!grouped.has(key)) {
      grouped.set(key, {
        staffId: row.staff_id,
        staffFullName: row.staff_full_name ?? "",
        staffEmail: row.staff_email ?? "",
        staffTelegramChatId: row.staff_telegram_chat_id,
        todayList: [],
        upcomingList: [],
      });
    }
    const g = grouped.get(key)!;
    if (bucket === "today") g.todayList.push(row);
    else g.upcomingList.push(row);
  };

  for (const r of todayRows) addRow(r, "today");
  for (const r of upcomingRows) addRow(r, "upcoming");

  return grouped;
}

// ── Build messages ────────────────────────────────────────────────────────────

function buildMessages(group: StaffGroup, today: Date): string[] {
  const messages: string[] = [];

  if (group.todayList.length > 0) {
    const lines = group.todayList.map((c) => {
      const dobDisplay = c.date_of_birth.split("-").reverse().join("/");
      return `\u2022 \uD83C\uDF82 <b>${c.full_name}</b> (${c.customer_code}) \u2014 SN: ${dobDisplay}${c.mobile_phone ? ` | \uD83D\uDCDE ${c.mobile_phone}` : ""}`;
    });

    messages.push(
      [
        `\uD83C\uDF89 <b>SINH NHẬT HÔM NAY!</b>`,
        `Xin chào <b>${group.staffFullName}</b>, khách hàng của bạn có ngày sinh nhật hôm nay:`,
        ``,
        ...lines,
        ``,
        `\uD83C\uDF81 Hãy gửi lời chúc tốt đẹp đến khách hàng của mình nhé!`,
      ].join("\n"),
    );
  }

  if (group.upcomingList.length > 0) {
    group.upcomingList.sort((a, b) =>
      a.date_of_birth.slice(5).localeCompare(b.date_of_birth.slice(5)),
    );

    const lines = group.upcomingList.map((c) => {
      const mmdd = c.date_of_birth.slice(5);
      const dobDisplay = c.date_of_birth.split("-").reverse().join("/");
      const diffDays = daysUntilBirthday(mmdd, today);
      return `\u2022 <b>${c.full_name}</b> (${c.customer_code}) \u2014 \uD83D\uDCC5 ${dobDisplay} (con ${diffDays} ngay)${c.mobile_phone ? ` | \uD83D\uDCDE ${c.mobile_phone}` : ""}`;
    });

    messages.push(
      [
        `\uD83D\uDCC6 <b>Danh sách khách hàng có sinh nhật trong 3 ngày tới</b>`,
        `Xin chào <b>${group.staffFullName}</b>, khách hàng của bạn có ngày sinh nhật:`,
        ``,
        ...lines,
        ``,
        `\uD83D\uDCA1 Hãy gửi lời chúc tốt đẹp đến khách hàng của mình nhé!`,
      ].join("\n"),
    );
  }

  return messages;
}

// ── Main cron ─────────────────────────────────────────────────────────────────

export default {
  upcomingBirthdayCustomers: {
    task: async ({ strapi }: { strapi: Core.Strapi }) => {
      const botService = strapi.plugin("tele")?.service("telegram") as
        | IBotService
        | undefined;

      if (!botService || !botService.isReady()) {
        strapi.log.warn(
          "[BirthdayCron] Tele chua san sang, bo qua gui tin nhan.",
        );
        return;
      }

      const today = new Date();

      // Query DB — filter ngay tai PostgreSQL (hom nay + 3 ngay toi)
      const { todayRows, upcomingRows } = await fetchBirthdayCustomers(
        strapi,
        today,
      );

      const totalRelevant = todayRows.length + upcomingRows.length;
      if (totalRelevant === 0) {
        strapi.log.info(
          "[BirthdayCron] Khong co khach hang sinh nhat trong 4 ngay toi.",
        );
        return;
      }

      strapi.log.info(
        `[BirthdayCron] Hom nay: ${todayRows.length} khach | Sap toi (3 ngay): ${upcomingRows.length} khach.`,
      );

      const allRows = [...todayRows, ...upcomingRows];
      const noStaffCount = allRows.filter((r) => !r.staff_id).length;
      const noTelegramCount = allRows.filter(
        (r) => r.staff_id && !r.staff_telegram_chat_id,
      ).length;

      if (noStaffCount > 0) {
        strapi.log.warn(
          `[BirthdayCron] ${noStaffCount} khach khong co staff phu trach.`,
        );
      }
      if (noTelegramCount > 0) {
        strapi.log.warn(
          `[BirthdayCron] ${noTelegramCount} khach co staff nhung staff chua co telegramChatId.`,
        );
      }

      const grouped = groupByStaff(todayRows, upcomingRows);

      let sentCount = 0;

      for (const [, group] of grouped) {
        const messages = buildMessages(group, today);

        for (const msg of messages) {
          try {
            await botService.sendMessage(group.staffTelegramChatId, msg);
          } catch (err) {
            strapi.log.error(
              `[BirthdayCron] Gui Telegram that bai cho "${group.staffFullName}" (${group.staffEmail}): ${err}`,
            );
          }
        }

        strapi.log.info(
          `[BirthdayCron] Da gui Telegram cho staff "${group.staffFullName}" — hom nay: ${group.todayList.length}, sap toi: ${group.upcomingList.length}.`,
        );
        sentCount++;
      }

      strapi.log.info(
        `[BirthdayCron] Hoan tat. Da gui cho ${sentCount} staff.`,
      );
    },

    options: {
      rule: "*/3000 * * * * *",
    },
  },
};
