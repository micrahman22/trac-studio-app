import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
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
    const rawEventType = body?.event_type;
    const eventType = rawEventType === "transfer" || rawEventType === "transfer_pending" ? rawEventType : "mint";

    if (!historyId) {
      return new Response(JSON.stringify({ error: "Missing history_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Only callable server-to-server (mint-coa/initiate-transfer/finalize-transfer
    // authenticate with the service-role key, which is required to reach this
    // Authorization-checked function at all). Even so, we never trust a
    // client-shaped payload for the
    // email content — re-fetch the authoritative row by id, same pattern as
    // notify-artist.
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
    const artworkTitle = coa?.artworks?.title || "the artwork";

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", coa.artist_id)
      .single();

    const artistName = profile?.full_name || profile?.username || "The artist";

    const actionText = eventType === "transfer"
      ? `recorded a transfer of <strong>${escapeHtml(artworkTitle)}</strong> to your TRAC Collector account`
      : eventType === "transfer_pending"
      ? `initiated a transfer of <strong>${escapeHtml(artworkTitle)}</strong> away from your TRAC Collector account. It isn't final yet`
      : `recorded you as the owner of a new certificate of authenticity for <strong>${escapeHtml(artworkTitle)}</strong>`;

    const emailHtml = [
      '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; color: #333;">',
      '  <h2 style="font-weight: 300; font-size: 1.8rem; margin-bottom: 1rem;">',
      '    Hi ' + escapeHtml(history.owner_name) + ',',
      '  </h2>',
      '  <p style="line-height: 1.6; margin-bottom: 1rem;">',
      '    ' + escapeHtml(artistName) + ' has ' + actionText + ' on TRAC.',
      '  </p>',
      '  <div style="margin: 2rem 0; text-align: center;">',
      '    <a href="' + APP_URL + '/collector"',
      '       style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none; border-radius: 6px; font-size: 1rem; display: inline-block; letter-spacing: 0.02em;">',
      '      Sign up for Collector Dashboard to view certificate',
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

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: history.owner_email,
        subject: (eventType === "transfer" ? "Ownership recorded — " : eventType === "transfer_pending" ? "Transfer initiated — " : "New certificate — ") + escapeHtml(artworkTitle) + " - TRAC",
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
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
