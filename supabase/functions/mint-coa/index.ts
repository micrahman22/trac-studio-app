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
    const { artwork_id, buyer_name, buyer_email, royalty_pct, sale_price, notes } = await req.json();

    if (!artwork_id || !buyer_name || !buyer_email) {
      return json({ error: "Missing artwork_id, buyer_name, or buyer_email" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) {
      return json({ error: "Invalid buyer email" }, 400);
    }

    // Verify the caller is authenticated via their own JWT (same pattern as
    // send-cv-email). This user is who we'll check artwork ownership against below
    // — never a client-supplied artist_id.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    // All data operations from here use service role — this is the entire
    // write boundary for blockchain_coas / coa_ownership_history now that RLS
    // grants authenticated no insert access to either table.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: flags } = await supabase
      .from("feature_flags")
      .select("minting_enabled")
      .eq("id", 1)
      .single();

    if (!flags?.minting_enabled) {
      return json({ error: "Minting isn't available yet." }, 403);
    }

    // Ownership check is baked into the query itself, not a separate branch:
    // this can only ever return a row if the artwork belongs to the caller.
    const { data: artwork, error: artworkError } = await supabase
      .from("artworks")
      .select("id, title, image_url, artist_id")
      .eq("id", artwork_id)
      .eq("artist_id", user.id)
      .single();

    if (artworkError || !artwork) {
      // Deliberately generic — doesn't reveal whether the artwork exists
      // under a different artist.
      return json({ error: "Artwork not found" }, 404);
    }

    const { data: artistProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const tokenId = `TRAC-${Date.now()}`;
    const txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

    const { data: coa, error: coaError } = await supabase
      .from("blockchain_coas")
      .insert({
        artist_id: user.id,
        artwork_id: artwork.id,
        token_id: tokenId,
        tx_hash: txHash,
        royalty_pct: Number.isFinite(royalty_pct) ? royalty_pct : 10,
        network: "Polygon Amoy",
        status: "minted",
        metadata: JSON.stringify({
          artwork_title: artwork.title,
          artist_name: artistProfile?.full_name || user.email,
          image_url: artwork.image_url,
          notes: notes || null,
        }),
      })
      .select()
      .single();

    if (coaError) {
      if (coaError.code === "23505") {
        return json({ error: "A certificate has already been minted for this artwork." }, 409);
      }
      console.error("blockchain_coas insert error:", coaError);
      return json({ error: "Could not mint certificate" }, 500);
    }

    const { data: historyRow, error: historyError } = await supabase
      .from("coa_ownership_history")
      .insert({
        coa_id: coa.id,
        artist_id: user.id,
        owner_name: buyer_name,
        owner_email: buyer_email.toLowerCase(),
        sale_price: sale_price ? Number(sale_price) : null,
        notes: notes || null,
        transfer_date: new Date().toISOString(),
        is_original_purchase: true,
      })
      .select()
      .single();

    if (historyError) {
      console.error("coa_ownership_history insert error:", historyError);
      // The COA row already exists at this point (source of truth for the mint
      // itself). Surface the error rather than trying to unwind it — the
      // provenance record can be reconciled manually if this rare path is hit.
      return json({ error: "Certificate minted, but recording ownership failed. Contact support." }, 500);
    }

    await supabase.from("collector_accounts").upsert(
      {
        email: buyer_email.toLowerCase(),
        display_name: buyer_name,
        invited_at: new Date().toISOString(),
        invite_status: "pending",
      },
      { onConflict: "email", ignoreDuplicates: false }
    );

    let notified = true;
    try {
      const notifyRes = await fetch(`${SUPABASE_URL}/functions/v1/notify-collector`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ history_id: historyRow.id, event_type: "mint" }),
      });
      notified = notifyRes.ok;
      if (!notifyRes.ok) console.error("notify-collector failed:", await notifyRes.text());
    } catch (notifyErr) {
      notified = false;
      console.error("notify-collector call failed:", notifyErr);
    }

    return json({
      success: true,
      coa_id: coa.id,
      token_id: tokenId,
      tx_hash: txHash,
      notified,
    });
  } catch (err) {
    console.error("Unhandled error:", err);
    return json({ error: err.message }, 500);
  }
});
