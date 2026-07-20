// Push reminder cron (COMPETITION.md F5). Once a day, for every stored push
// subscription whose owner has opted in, checks two due events and sends a
// single localized reminder:
//   * dividend pay-day: a held equity/ETF whose confirmed announced pay date
//     (Yahoo calendar) is today and the position is still open;
//   * savings-plan due: an active plan whose occurrence lands today.
// `last_notified_on` de-dupes so re-running the cron never double-sends. A
// 404/410 from the push service deletes the dead subscription. No VAPID keys ->
// the job skips cleanly (200), so it's safe to include in the bulk sync.
//
// Auth is enforced at the middleware edge (CRON_SECRET) like every /api/cron/*.

import type { Transaction } from "@/lib/types";
import { sharesAt } from "@/lib/finance/portfolio";
import { dueOccurrences } from "@/lib/finance/savings-plans";
import { announcedByQuery, type AnnouncedDividend } from "@/lib/server/yahoo";
import { getVapidKeys } from "@/lib/server/push-keys";
import { sendPush } from "@/lib/server/push";
import { buildReminderPayload } from "@/lib/push/reminder";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import type { Locale } from "@/lib/i18n/locale";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LOCALES: readonly Locale[] = ["en", "de", "es"];
const asLocale = (v: unknown): Locale => (LOCALES.includes(v as Locale) ? (v as Locale) : "en");

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  notify_dividends: boolean;
  notify_savings: boolean;
  last_notified_on: string | null;
}

async function handle(): Promise<Response> {
  const keys = await getVapidKeys();
  if (!keys.publicKey || !keys.privateKey) {
    return Response.json({ skipped: "no vapid keys" });
  }
  const admin = supabaseSecret();
  if (!admin) return Response.json({ skipped: "no supabase" });

  const { data: subsData } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, notify_dividends, notify_savings, last_notified_on");
  const subs = (subsData ?? []) as SubRow[];
  if (subs.length === 0) return Response.json({ sent: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const savingsUsers = new Set(subs.filter((s) => s.notify_savings).map((s) => s.user_id));
  const dividendUsers = new Set(subs.filter((s) => s.notify_dividends).map((s) => s.user_id));
  const allUsers = [...new Set(subs.map((s) => s.user_id))];

  // Due assets per user, by event type.
  const savingsDue = new Map<string, string[]>();
  const dividendDue = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, user: string, name: string) => {
    const list = m.get(user);
    if (list) list.push(name);
    else m.set(user, [name]);
  };

  // Savings plans due today.
  if (savingsUsers.size > 0) {
    const { data } = await admin
      .from("savings_plans")
      .select("user_id, frequency, start_date, active, last_run_date, assets(instruments(name))")
      .eq("active", true)
      .in("user_id", [...savingsUsers]);
    for (const row of (data ?? []) as unknown[]) {
      const r = row as {
        user_id: string;
        frequency: string;
        start_date: string;
        active: boolean;
        last_run_date: string | null;
        assets?: { instruments?: { name?: string } } | null;
      };
      const plan = {
        active: r.active,
        startDate: r.start_date,
        interval: r.frequency,
        lastRunDate: r.last_run_date,
      };
      if (dueOccurrences(plan as never, today).includes(today)) {
        push(savingsDue, r.user_id, r.assets?.instruments?.name ?? "");
      }
    }
  }

  // Dividend pay-day today. The announced calendar lookup is deduped per price
  // key across users (several people can hold the same payer).
  if (dividendUsers.size > 0) {
    const { data } = await admin
      .from("assets")
      .select(
        "user_id, currency, instruments(isin, wkn, symbol, type, name, quote_source, quote_id), transactions(type, quantity, executed_at)",
      )
      .in("user_id", [...dividendUsers]);
    const announcedCache = new Map<string, AnnouncedDividend | null>();
    for (const row of (data ?? []) as unknown[]) {
      const r = row as {
        user_id: string;
        instruments?: {
          isin?: string | null;
          wkn?: string | null;
          symbol?: string | null;
          type?: string;
          name?: string;
          quote_source?: string | null;
          quote_id?: string | null;
        } | null;
        transactions?: { type: string; quantity: number; executed_at: string }[] | null;
      };
      const instr = r.instruments;
      if (!instr || (instr.type !== "STOCK" && instr.type !== "ETF")) continue;
      const priceKey = instr.isin ?? instr.wkn ?? instr.symbol;
      if (!priceKey) continue;

      const txs = (r.transactions ?? []).map(
        (t) => ({ type: t.type, quantity: Number(t.quantity), date: t.executed_at }) as Transaction,
      );
      if (sharesAt(txs, today) <= 0) continue;

      let announced = announcedCache.get(priceKey);
      if (announced === undefined) {
        const hint = instr.quote_source === "yahoo" && instr.quote_id ? instr.quote_id : undefined;
        announced = await announcedByQuery(priceKey, hint, instr.name).catch(() => null);
        announcedCache.set(priceKey, announced ?? null);
      }
      if (announced?.payDate === today) push(dividendDue, r.user_id, instr.name ?? "");
    }
  }

  if (savingsDue.size === 0 && dividendDue.size === 0) return Response.json({ sent: 0 });

  // Locales for message text.
  const { data: profileData } = await admin.from("profiles").select("id, locale").in("id", allUsers);
  const localeOf = new Map<string, Locale>();
  for (const p of (profileData ?? []) as { id: string; locale: string | null }[]) {
    localeOf.set(p.id, asLocale(p.locale));
  }

  let sent = 0;
  let gone = 0;
  for (const sub of subs) {
    if (sub.last_notified_on === today) continue;
    const payload = buildReminderPayload(
      localeOf.get(sub.user_id) ?? "en",
      dividendDue.get(sub.user_id) ?? [],
      savingsDue.get(sub.user_id) ?? [],
      sub.notify_dividends,
      sub.notify_savings,
    );
    if (!payload) continue;

    const result = await sendPush(
      keys,
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
    );
    if (result === "sent") {
      sent += 1;
      await admin.from("push_subscriptions").update({ last_notified_on: today }).eq("id", sub.id);
    } else if (result === "gone") {
      gone += 1;
      await admin.from("push_subscriptions").delete().eq("id", sub.id);
    }
  }

  return Response.json({ sent, gone });
}

export const POST = handle;
