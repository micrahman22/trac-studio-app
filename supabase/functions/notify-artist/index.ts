import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
const APP_URL = Deno.env.get("APP_URL") || "https://trac.art";

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
    const { record } = await req.json();

    if (!record?.artist_id || !record?.requester_name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get artist's email via admin API
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(record.artist_id);
    if (userError || !user?.email) {
      console.error("Could not get artist email:", userError);
      return new Response(JSON.stringify({ error: "Artist not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", record.artist_id)
      .single();

    const artistName = profile?.full_name || profile?.username || "there";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: user.email,
        subject: `New CV request from ${record.requester_name} — TRAC`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; color: #333;">
            <h2 style="font-weight: 300; font-size: 1.8rem; margin-bottom: 1rem;">
              Hi ${artistName},
            </h2>
            <p style="line-height: 1.6; margin-bottom: 0.5rem;">
              Someone has requested your CV on TRAC:
            </p>
            <div style="background: #f9f9f9; border: 1px solid #e5e5e5; border-radius: 8px; padding: 1.25rem; margin: 1.5rem 0;">
              <p style="margin: 0 0 0.5rem 0;"><strong>Name:</strong> ${record.requester_name}</p>
              <p style="margin: 0 0 0.5rem 0;"><strong>Company / Gallery:</strong> ${record.requester_company || '—'}</p>
              <p style="margin: 0 0 0.5rem 0;"><strong>Email:</strong> ${record.requester_email}</p>
              ${record.requester_phone ? `<p style="margin: 0 0 0.5rem 0;"><strong>Phone:</strong> ${record.requester_phone}</p>` : ''}
              ${record.message ? `<p style="margin: 0.75rem 0 0 0;"><strong>Message:</strong><br>${record.message}</p>` : ''}
            </div>
            <div style="margin: 2rem 0; text-align: center;">
              <a href="${APP_URL}"
                 style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none;
                        border-radius: 6px; font-size: 1rem; display: inline-block; letter-spacing: 0.02em;">
                Review in Dashboard
              </a>
            </div>
            <p style="color: #888; font-size: 0.85rem; line-height: 1.5;">
              Log in to your TRAC dashboard to approve or deny this request. Your CV will not be shared until you approve.
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
