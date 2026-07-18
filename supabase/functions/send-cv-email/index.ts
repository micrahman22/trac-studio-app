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

    // Fetch the request and verify it belongs to this artist and is still pending
    const { data: cvRequest, error: requestError } = await supabase
      .from("cv_requests")
      .select("*")
      .eq("id", request_id)
      .eq("artist_id", user.id)
      .eq("status", "pending")
      .single();

    if (requestError || !cvRequest) {
      return new Response(JSON.stringify({ error: "Request not found or already processed" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch artist profile for CV URL
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, username, cv_url")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.cv_url) {
      return new Response(JSON.stringify({ error: "No CV found. Please upload your CV in Profile Settings first." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cvPath = profile.cv_url.split("/cv-files/")[1];
    if (!cvPath) {
      return new Response(JSON.stringify({ error: "Could not parse CV file path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate signed URL — 48 hours, server-side only, never exposed to browser
    const { data: signedData, error: signedError } = await supabase.storage
      .from("cv-files")
      .createSignedUrl(cvPath, 172800);

    if (signedError || !signedData?.signedUrl) {
      console.error("Signed URL error:", signedError);
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
        subject: `CV from ${artistName} — TRAC`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; color: #333;">
            <h2 style="font-weight: 300; font-size: 1.8rem; margin-bottom: 1rem;">
              Hi ${cvRequest.requester_name},
            </h2>
            <p style="line-height: 1.6; margin-bottom: 1rem;">
              Thank you for your interest. <strong>${artistName}</strong> has approved your request and shared their CV with you via TRAC.
            </p>
            <div style="margin: 2rem 0; text-align: center;">
              <a href="${signedData.signedUrl}"
                 style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none;
                        border-radius: 6px; font-size: 1rem; display: inline-block; letter-spacing: 0.02em;">
                Download CV
              </a>
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-top: 2rem; line-height: 1.5;">
              This download link expires in <strong>48 hours</strong>. If you need a fresh link, please contact ${artistName} directly.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 2rem 0;">
            <p style="color: #bbb; font-size: 0.75rem; text-align: center; margin: 0;">
              Sent via <a href="https://trac.art" style="color: #bbb;">TRAC Artist Platform</a>
            </p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend API error:", errText);
      return new Response(JSON.stringify({ error: "Email failed to send", detail: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as approved
    await supabase
      .from("cv_requests")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", request_id);

    console.log(`CV approved and emailed to ${cvRequest.requester_email}`);
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
