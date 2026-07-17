import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record?.artist_id || !record?.requester_email) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, username, cv_url")
      .eq("id", record.artist_id)
      .single();

    if (profileError || !profile?.cv_url) {
      console.error("Profile/CV error:", profileError);
      return new Response(JSON.stringify({ error: "No CV found for this artist" }), { status: 400 });
    }

    // Extract storage path from the full public URL
    // URL format: https://xxx.supabase.co/storage/v1/object/public/cv-files/userId/filename.pdf
    const cvPath = profile.cv_url.split("/cv-files/")[1];

    if (!cvPath) {
      return new Response(JSON.stringify({ error: "Could not parse CV file path" }), { status: 400 });
    }

    // Generate a signed URL valid for 7 days
    const { data: signedData, error: signedError } = await supabase.storage
      .from("cv-files")
      .createSignedUrl(cvPath, 604800);

    if (signedError || !signedData?.signedUrl) {
      console.error("Signed URL error:", signedError);
      return new Response(JSON.stringify({ error: "Could not generate download link" }), { status: 500 });
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
        to: record.requester_email,
        subject: `CV from ${artistName} — TRAC`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem; color: #333;">
            <h2 style="font-weight: 300; font-size: 1.8rem; margin-bottom: 1rem;">
              Hi ${record.requester_name},
            </h2>
            <p style="line-height: 1.6; margin-bottom: 1rem;">
              Thank you for your interest. <strong>${artistName}</strong> has shared their CV with you via TRAC.
            </p>
            <div style="margin: 2rem 0; text-align: center;">
              <a href="${signedData.signedUrl}"
                 style="background: #000; color: #fff; padding: 0.85rem 2.5rem; text-decoration: none;
                        border-radius: 6px; font-size: 1rem; display: inline-block; letter-spacing: 0.02em;">
                Download CV
              </a>
            </div>
            <p style="color: #888; font-size: 0.85rem; margin-top: 2rem; line-height: 1.5;">
              This download link expires in <strong>7 days</strong>. If you need a fresh link, please contact ${artistName} directly.
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
      return new Response(JSON.stringify({ error: "Email failed to send", detail: errText }), { status: 500 });
    }

    // Mark the request as sent
    await supabase
      .from("cv_requests")
      .update({ status: "sent" })
      .eq("id", record.id);

    console.log(`CV email sent to ${record.requester_email} for artist ${artistName}`);
    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
