import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const INVITE_FROM_EMAIL = Deno.env.get("INVITE_FROM_EMAIL") || FROM_EMAIL;
const TRANSFER_FROM_EMAIL = Deno.env.get("TRANSFER_FROM_EMAIL") || FROM_EMAIL;
const APP_URL = Deno.env.get("APP_URL") || "https://tracstudio.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Escapes a value for safe interpolation into the HTML email body below.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only mint-coa/initiate-transfer/finalize-transfer should ever reach this
  // function — it sends real email and trusts the id it's given to look up
  // who to email. The
  // platform's default JWT gateway check accepts any signed-in user's token,
  // not just service_role, so that alone isn't enough: require the caller to
  // present the service-role key itself as a shared secret.
  const authHeader = req.headers.get("Authorization") || "";
  const presentedKey = authHeader.replace(/^Bearer\s+/i, "");
  if (presentedKey !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const historyId = body?.history_id;
    const pendingTransferId = body?.pending_transfer_id;
    const rawEventType = body?.event_type;
    const eventType = ["transfer", "transfer_pending", "invite"].includes(rawEventType) ? rawEventType : "mint";

    if (eventType === "invite") {
      if (!pendingTransferId) {
        return new Response(JSON.stringify({ error: "Missing pending_transfer_id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (!historyId) {
      return new Response(JSON.stringify({ error: "Missing history_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Never trust a client-shaped payload for the email content - re-fetch
    // the authoritative row by id, same pattern for both id types.
    let ownerName: string | null;
    let recipientEmail: string;
    let artworkTitle: string;
    let artistId: string;

    if (eventType === "invite") {
      const { data: pending, error: pendingError } = await supabase
        .from("coa_pending_transfers")
        .select(`
          new_collector_email,
          blockchain_coas ( artist_id, artwork_id, artworks ( title ) )
        `)
        .eq("id", pendingTransferId)
        .single();

      if (pendingError || !pending) {
        return new Response(JSON.stringify({ error: "Pending transfer not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const coa = pending.blockchain_coas as unknown as { artist_id: string; artwork_id: string; artworks: { title: string } | null };
      ownerName = null; // Nothing to greet them by yet - they're not an owner in our system until this transfer finalizes.
      recipientEmail = pending.new_collector_email;
      artworkTitle = coa?.artworks?.title || "the artwork";
      artistId = coa.artist_id;
    } else {
      const { data: history, error: historyError } = await supabase
        .from("coa_ownership_history")
        .select(`
          owner_name, owner_email, transfer_date,
          blockchain_coas ( artist_id, artwork_id, artworks ( title ) )
        `)
        .eq("id", historyId)
        .single();

      if (historyError || !history) {
        return new Response(JSON.stringify({ error: "Ownership record not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const coa = history.blockchain_coas as unknown as { artist_id: string; artwork_id: string; artworks: { title: string } | null };
      ownerName = history.owner_name;
      recipientEmail = history.owner_email;
      artworkTitle = coa?.artworks?.title || "the artwork";
      artistId = coa.artist_id;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", artistId)
      .single();

    const artistName = profile?.full_name || profile?.username || "The artist";

    const actionText = eventType === "transfer"
      ? `recorded a transfer of <strong>${escapeHtml(artworkTitle)}</strong> to your TRAC Collector account`
      : eventType === "transfer_pending"
      ? `initiated a transfer of <strong>${escapeHtml(artworkTitle)}</strong> away from your TRAC Collector account. It isn't final yet`
      : eventType === "invite"
      ? `is sending you <strong>${escapeHtml(artworkTitle)}</strong> as a Certificate of Authenticity on TRAC. It isn't final yet`
      : `recorded you as the owner of a new certificate of authenticity for <strong>${escapeHtml(artworkTitle)}</strong>`;

    // transfer_pending, invite, and transfer all go to someone who's either
    // already registered or should be by the time this fires - "Sign up" is
    // wrong for any of them. transfer's recipient is always already
    // registered by the time finalize-transfer allows it to fire, but this
    // still verifies against collector_accounts instead of assuming that
    // invariant holds - if it's ever violated elsewhere, the wording stays
    // correct either way. mint is not checked here: its recipient is usually
    // new, out of scope for this change.
    let buttonText = "Sign up for Collector Dashboard to view certificate";
    if (eventType === "transfer_pending" || eventType === "invite" || eventType === "transfer") {
      const { data: collectorAccount } = await supabase
        .from("collector_accounts")
        .select("invite_status")
        .eq("email", recipientEmail.toLowerCase())
        .maybeSingle();
      if (collectorAccount?.invite_status === "registered") {
        // transfer fires once ownership is already recorded - "pending" is
        // wrong for it, unlike transfer_pending/invite which are still
        // ahead of that point.
        buttonText = eventType === "transfer"
          ? "View certificate in your Collector Dashboard"
          : "View pending transfer in your Collector Dashboard";
      }
    }

    const emailHtml = [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; color: #333;">',
      '  <h2 style="font-weight: 300; font-size: 1.8rem; margin-bottom: 1rem;">',
      '    Hi ' + escapeHtml(ownerName || "there") + ',',
      '  </h2>',
      '  <p style="line-height: 1.6; margin-bottom: 1rem;">',
      '    ' + escapeHtml(artistName) + ' has ' + actionText + ' on TRAC.',
      '  </p>',
      '  <div style="margin: 2rem 0; text-align: center;">',
      '    <a href="' + APP_URL + '/collector"',
      '       style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none; border-radius: 6px; font-size: 1rem; display: inline-block; letter-spacing: 0.02em;">',
      '      ' + buttonText,
      '    </a>',
      '  </div>',
      '  <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">',
      '    Sign in with this email address to view the certificate and its full ownership history.',
      '  </p>',
      '  <hr style="border: none; border-top: 1px solid #eee; margin: 2rem 0;">',
      '  <p style="color: #bbb; font-size: 0.75rem; text-align: center; margin: 0;">',
      '    Sent via <a href="https://tracstudio.app" style="color: #bbb;">TRAC Artist Platform</a>',
      '  </p>',
      '</div>',
    ].join("\n");

    const subjectPrefix = eventType === "transfer" ? "Ownership recorded - "
      : eventType === "transfer_pending" ? "Transfer initiated - "
      : eventType === "invite" ? "You have a certificate waiting - "
      : "New certificate - ";

    const senderEmail = (eventType === "invite" || eventType === "mint") ? INVITE_FROM_EMAIL
      : (eventType === "transfer" || eventType === "transfer_pending") ? TRANSFER_FROM_EMAIL
      : FROM_EMAIL;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: senderEmail,
        to: recipientEmail,
        subject: subjectPrefix + escapeHtml(artworkTitle) + " - TRAC",
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return new Response(JSON.stringify({ error: "Email failed", detail: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unhandled error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
