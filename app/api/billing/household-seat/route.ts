import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { stripeFetch } from "@/lib/server/stripe";
import { getStripeKeys } from "@/lib/server/billing-keys";
import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MIN = 10;

interface MemberRow {
  household_id: string;
  user_id: string;
  role: "owner" | "member";
}

interface SubscriptionRow {
  user_id: string;
  stripe_subscription_id: string;
  status: string;
}

interface AddonRow {
  household_id: string;
  stripe_subscription_item_id: string;
  quantity: number;
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const verifier = supabasePublishable();
  if (!verifier) return Response.json({ error: "not configured" }, { status: 503 });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit("billing/household-seat", req, RATE_LIMIT_PER_MIN))) return tooManyRequests();

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });
  const { data: config } = await verifier
    .from("billing_config")
    .select("household_member_price, enabled")
    .eq("id", 1)
    .maybeSingle<{ household_member_price: string | null; enabled: boolean }>();
  if (!config?.enabled) return Response.json({ error: "billing disabled" }, { status: 403 });
  if (!config.household_member_price) return Response.json({ error: "billing not configured" }, { status: 503 });

  const { data: members } = await admin
    .from("household_members")
    .select("household_id, user_id, role")
    .eq("user_id", user.id)
    .returns<MemberRow[]>();
  const householdId = members?.[0]?.household_id;
  if (!householdId) return Response.json({ error: "no household" }, { status: 404 });
  if (members[0].role !== "owner") return Response.json({ error: "forbidden" }, { status: 403 });

  const userIds = (await admin
    .from("household_members")
    .select("user_id")
    .eq("household_id", householdId)
    .returns<{ user_id: string }[]>()).data?.map((row) => row.user_id) ?? [];
  const { data: subscriptions } = await admin
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status")
    .in("user_id", userIds)
    .in("status", ["active", "trialing"])
    .returns<SubscriptionRow[]>();
  const subscription = subscriptions?.[0];
  if (!subscription) return Response.json({ error: "no subscription" }, { status: 404 });

  const { data: existing } = await admin
    .from("household_seat_addons")
    .select("household_id, stripe_subscription_item_id, quantity")
    .eq("household_id", householdId)
    .maybeSingle<AddonRow>();
  const nextQuantity = (existing?.quantity ?? 0) + 1;
  const stripePath = existing
    ? `/subscription_items/${encodeURIComponent(existing.stripe_subscription_item_id)}`
    : "/subscription_items";
  const params: Record<string, string | number | boolean> = existing
    ? { quantity: nextQuantity }
    : {
        subscription: subscription.stripe_subscription_id,
        price: config.household_member_price,
        quantity: nextQuantity,
        "metadata[household_id]": householdId,
        "metadata[feature]": "household_extra_member",
      };
  const { secretKey } = await getStripeKeys();
  if (!secretKey) return Response.json({ error: "billing not configured" }, { status: 503 });
  const item = await stripeFetch<{ id?: string; quantity?: number }>(stripePath, {
    method: "POST",
    secretKey,
    params,
  });
  if (!item.ok || !item.data?.id) return Response.json({ error: "stripe error" }, { status: 502 });

  const { error } = await admin.from("household_seat_addons").upsert(
    {
      household_id: householdId,
      stripe_subscription_item_id: item.data.id,
      quantity: item.data.quantity ?? nextQuantity,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "household_id" },
  );
  if (error) return Response.json({ error: "db error" }, { status: 500 });
  return Response.json({ ok: true, quantity: item.data.quantity ?? nextQuantity });
}
