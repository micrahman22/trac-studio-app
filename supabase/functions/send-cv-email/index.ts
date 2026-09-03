import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

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
    const { request_id } = await req.json();

    if (!request_id) {
      return new Response(JSON.stringify({ error: "Missing request_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the artist is authenticated via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All data operations use service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Claim the request atomically by flipping status pending -> approved
    // as part of the same UPDATE that checks it's still pending, instead
    // of a separate SELECT-then-later-UPDATE. Two simultaneous calls for
    // the same request_id both used to pass the earlier SELECT check
    // before either had written back, so both would send a real email -
    // a genuine race, not just a narrow theoretical one. Only one
    // concurrent UPDATE can ever match "status = pending" and return a
    // row; whichever loses the race gets an empty result here and stops
    // immediately, before any email is sent.
    const { data: cvRequest, error: requestError } = await supabase
      .from("cv_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", request_id)
      .eq("artist_id", user.id)
      .eq("status", "pending")
      .select()
      .single();

    if (requestError || !cvRequest) {
      return new Response(JSON.stringify({ error: "Request not found or already processed" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The claim above already flipped status to approved. Every failure
    // path from here on needs to hand it back to pending - otherwise a
    // request that hit e.g. a transient Resend outage would be stuck
    // permanently "approved" with no email ever having gone out, and no
    // way for the artist to retry.
    async function revertToPending() {
      await supabase
        .from("cv_requests")
        .update({ status: "pending", approved_at: null })
        .eq("id", request_id)
        .eq("artist_id", user.id);
    }

    // Fetch artist profile for CV URL
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, username, cv_url")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.cv_url) {
      await revertToPending();
      return new Response(JSON.stringify({ error: "No CV found. Please upload your CV in Profile Settings first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cvPath = profile.cv_url.split("/cv-files/")[1];
    if (!cvPath) {
      await revertToPending();
      return new Response(JSON.stringify({ error: "Could not parse CV file path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URL: 48 hours, server-side only, never exposed to browser
    const { data: signedData, error: signedError } = await supabase.storage
      .from("cv-files")
      .createSignedUrl(cvPath, 172800);

    if (signedError || !signedData?.signedUrl) {
      console.error("Signed URL error:", signedError);
      await revertToPending();
      return new Response(JSON.stringify({ error: "Could not generate download link" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const artistName = profile.full_name || profile.username || "the artist";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: cvRequest.requester_email,
        subject: `CV from ${escapeHtml(artistName)} - TRAC`,
        html: `
          <div style="font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden;">
            <div style="padding: 1.75rem 2rem; border-bottom: 1px solid #e5e5e5;">
              <span style="font-size: 1rem; font-weight: 600; letter-spacing: 0.1em; color: #000;">TRAC</span>
            </div>
            <div style="padding: 2rem; color: #333;">
              <h2 style="font-weight: 300; font-size: 1.6rem; margin: 0 0 1rem;">
                Hi ${escapeHtml(cvRequest.requester_name)},
              </h2>
              <p style="line-height: 1.6; margin: 0 0 1.5rem;">
                Thank you for your interest. <strong>${escapeHtml(artistName)}</strong> has approved your request and shared their CV with you via TRAC.
              </p>
              <div style="text-align: center; margin-bottom: 1.5rem;">
                <a href="${signedData.signedUrl}"
                   style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none;
                          border-radius: 6px; font-size: 0.95rem; display: inline-block; letter-spacing: 0.02em;">
                  Download CV
                </a>
              </div>
              <p style="color: #888; font-size: 0.85rem; line-height: 1.5; margin: 0;">
                This download link expires in <strong>48 hours</strong>. If you need a fresh link, please contact ${escapeHtml(artistName)} directly.
              </p>
            </div>
            <div style="padding: 1.25rem 2rem; border-top: 1px solid #e5e5e5; text-align: center;">
              <p style="color: #999; font-size: 0.75rem; margin: 0; line-height: 1.5;">
                Sent via <a href="https://tracstudio.app" style="color: #999; text-decoration: underline;">TRAC</a> - where artists build a career, not just a portfolio.
              </p>
            </div>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend API error:", errText);
      await revertToPending();
      return new Response(JSON.stringify({ error: "Email failed to send", detail: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Status was already claimed as "approved" atomically above, before
    // the email was sent - nothing left to update here on success.
    console.log(`CV approved and emailed to ${cvRequest.requester_email}`);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
