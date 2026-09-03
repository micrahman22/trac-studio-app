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

  try {
    const body = await req.json();
    const requestId = body?.id;

    if (!requestId) {
      return new Response(JSON.stringify({ error: "Missing id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // This function is called by anonymous public visitors submitting the
    // "Request CV" form, so there's no user JWT to validate here (unlike
    // send-cv-email, which is called by a logged-in artist). Instead, we
    // never trust the client-submitted payload directly - we re-fetch the
    // authoritative row by id and independently confirm it's a real,
    // still-pending request. cv_requests.id is an unguessable UUID and its
    // own RLS select policy restricts reads to the owning artist, so an
    // attacker cannot discover someone else's request id to feed in here.
    //
    // Claimed atomically, same pattern as send-cv-email's pending->approved
    // claim: flipping notified_at as part of the same UPDATE that checks it's
    // still null, instead of a separate SELECT-then-later-UPDATE. Concurrent
    // calls for the same id used to all pass the SELECT check before any of
    // them had written back, so all of them sent a real email - confirmed via
    // live pentest (5 concurrent calls, 5 duplicate emails). Only one
    // concurrent UPDATE can ever match "notified_at is null" and return a
    // row; whichever loses the race gets an empty result here and stops
    // immediately, before any email is sent.
    const { data: cvRequest, error: claimError } = await supabase
      .from("cv_requests")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("status", "pending")
      .is("notified_at", null)
      .select("id, artist_id, requester_name, requester_company, requester_email, requester_phone, message, status")
      .single();

    if (claimError || !cvRequest) {
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The claim above already flipped notified_at. Every failure path from
    // here on needs to hand it back to null - otherwise a request that hit
    // e.g. a transient Resend outage would be stuck permanently "notified"
    // with no email ever having gone out, and no way to retry.
    async function revertClaim() {
      await supabase
        .from("cv_requests")
        .update({ notified_at: null })
        .eq("id", requestId);
    }

    // Everything from here runs after the claim above has already set
    // notified_at - any exception between here and the final success
    // response, anticipated or not, must hand the claim back before this
    // function exits. The specific branches below still call revertClaim()
    // themselves so they can return their own clear error message; this
    // wrapping try/catch exists for anything they didn't anticipate (e.g. a
    // thrown network error from a query, rather than a normal returned
    // {error}) - without it, that kind of failure would leave the row stuck
    // at "notified" with no email ever having gone out.
    try {

    // Get artist's email via admin API
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(cvRequest.artist_id);
    if (userError || !user?.email) {
      console.error("Could not get artist email:", userError);
      await revertClaim();
      return new Response(JSON.stringify({ error: "Artist not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", cvRequest.artist_id)
      .single();

    const artistName = profile?.full_name || profile?.username || "there";

    const phoneRow = cvRequest.requester_phone
      ? '<p style="margin: 0 0 0.5rem 0;"><strong>Phone:</strong> ' + escapeHtml(cvRequest.requester_phone) + '</p>'
      : '';
    const messageRow = cvRequest.message
      ? '<p style="margin: 0.75rem 0 0 0;"><strong>Message:</strong><br>' + escapeHtml(cvRequest.message) + '</p>'
      : '';

    const emailHtml = [
      '<div style="font-family: -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif; max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden;">',
      '  <div style="padding: 1.75rem 2rem; border-bottom: 1px solid #e5e5e5;">',
      '    <span style="font-size: 1rem; font-weight: 600; letter-spacing: 0.1em; color: #000;">TRAC</span>',
      '  </div>',
      '  <div style="padding: 2rem; color: #333;">',
      '    <h2 style="font-weight: 300; font-size: 1.6rem; margin: 0 0 1rem;">',
      '      Hi ' + escapeHtml(artistName) + ',',
      '    </h2>',
      '    <p style="line-height: 1.6; margin: 0 0 1rem;">',
      '      Someone has requested your CV on TRAC:',
      '    </p>',
      '    <div style="background: #f9f9f9; border: 1px solid #e5e5e5; border-radius: 8px; padding: 1.25rem; margin: 0 0 1.5rem;">',
      '      <p style="margin: 0 0 0.5rem 0;"><strong>Name:</strong> ' + escapeHtml(cvRequest.requester_name) + '</p>',
      '      <p style="margin: 0 0 0.5rem 0;"><strong>Company / Gallery:</strong> ' + (escapeHtml(cvRequest.requester_company) || '-') + '</p>',
      '      <p style="margin: 0 0 0.5rem 0;"><strong>Email:</strong> ' + escapeHtml(cvRequest.requester_email) + '</p>',
      '      ' + phoneRow,
      '      ' + messageRow,
      '    </div>',
      '    <div style="text-align: center; margin-bottom: 1.5rem;">',
      '      <a href="' + APP_URL + '"',
      '         style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none; border-radius: 6px; font-size: 0.95rem; display: inline-block; letter-spacing: 0.02em;">',
      '        Review in Dashboard',
      '      </a>',
      '    </div>',
      '    <p style="color: #888; font-size: 0.85rem; line-height: 1.5; margin: 0;">',
      '      Log in to your TRAC dashboard to approve or deny this request. Your CV will not be shared until you approve.',
      '    </p>',
      '  </div>',
      '  <div style="padding: 1.25rem 2rem; border-top: 1px solid #e5e5e5; text-align: center;">',
      '    <p style="color: #999; font-size: 0.75rem; margin: 0; line-height: 1.5;">',
      '      Sent via <a href="https://tracstudio.app" style="color: #999; text-decoration: underline;">TRAC</a> - where artists build a career, not just a portfolio.',
      '    </p>',
      '  </div>',
      '</div>'
    ].join('\n');

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: user.email,
        subject: "New CV request from " + escapeHtml(cvRequest.requester_name) + " - TRAC",
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      await revertClaim();
      return new Response(JSON.stringify({ error: "Email failed", detail: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Status was already claimed as "notified" atomically above, before the
    // email was sent - nothing left to update here on success.
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    } catch (postClaimErr) {
      console.error("Unexpected error after claiming notify:", postClaimErr.message);
      await revertClaim();
      return new Response(JSON.stringify({ error: "Could not send notification. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
