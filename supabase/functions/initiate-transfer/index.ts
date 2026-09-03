import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { coa_id, new_collector_email } = await req.json();

    if (!coa_id || !new_collector_email) {
      return json({ error: "Missing coa_id or new_collector_email" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_collector_email)) {
      return json({ error: "Invalid new collector email" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Artist-only, same ownership pattern as mint-coa: this can only ever
    // return a row the caller actually owns.
    const { data: coa, error: coaError } = await supabase
      .from("blockchain_coas")
      .select("id, artist_id")
      .eq("id", coa_id)
      .eq("artist_id", user.id)
      .single();

    if (coaError || !coa) {
      return json({ error: "Certificate not found" }, 404);
    }

    const { data: pending, error: pendingError } = await supabase
      .from("coa_pending_transfers")
      .insert({
        coa_id: coa.id,
        artist_id: user.id,
        new_collector_email: new_collector_email.toLowerCase(),
      })
      .select()
      .single();

    if (pendingError) {
      if (pendingError.code === "23505") {
        return json({ error: "A transfer is already pending for this certificate." }, 409);
      }
      console.error("coa_pending_transfers insert error:", pendingError);
      return json({ error: "Could not initiate transfer" }, 500);
    }

    // Notify the CURRENT holder (most recent coa_ownership_history row for
    // this coa) that a transfer is about to happen. This does not touch
    // coa_ownership_history at all — nothing about ownership changes yet.
    const { data: currentHistory } = await supabase
      .from("coa_ownership_history")
      .select("id")
      .eq("coa_id", coa.id)
      .order("transfer_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    let notified = false;
    if (currentHistory) {
      try {
        const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/notify-collector`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ history_id: currentHistory.id, event_type: "transfer_pending" }),
        });
        notified = notifyRes.ok;
        if (!notifyRes.ok) console.error("notify-collector failed:", await notifyRes.text());
      } catch (notifyErr) {
        console.error("notify-collector call failed:", notifyErr);
      }
    } else {
      console.error("No current ownership history found for coa", coa.id, "- skipping current-holder notification");
    }

    // Ensure a collector_accounts stub exists for the new collector, same
    // shape as mint-coa's stub - but check-then-insert, never upsert.
    // mint-coa's own upsert always overwrites invite_status back to
    // 'pending' on conflict, even if that email was already 'registered' -
    // silently downgrading a repeat collector until their next login
    // self-heals it via showDashboard(). Not fixing that here, just not
    // repeating it: if a row already exists, it's left untouched.
    const { data: existingCollector } = await supabase
      .from("collector_accounts")
      .select("id")
      .eq("email", new_collector_email.toLowerCase())
      .maybeSingle();

    if (!existingCollector) {
      await supabase.from("collector_accounts").insert({
        email: new_collector_email.toLowerCase(),
        invited_at: new Date().toISOString(),
        invite_status: "pending",
      });
    }

    // Invite the new collector. Passes pending_transfer_id, not a bare
    // email, so notify-collector re-fetches the authoritative row itself -
    // same pattern already used for history_id.
    let collectorInvited = false;
    try {
      const inviteRes = await fetch(`${SUPABASE_URL}/functions/v1/notify-collector`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pending_transfer_id: pending.id, event_type: "invite" }),
      });
      collectorInvited = inviteRes.ok;
      if (!inviteRes.ok) console.error("notify-collector (invite) failed:", await inviteRes.text());
    } catch (inviteErr) {
      console.error("notify-collector (invite) call failed:", inviteErr);
    }

    return json({ success: true, pending_transfer_id: pending.id, notified, collector_invited: collectorInvited });
  } catch (err) {
    console.error("Unhandled error:", err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
