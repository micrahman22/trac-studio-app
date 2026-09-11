import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const POLYGON_RPC_URL = Deno.env.get("POLYGON_RPC_URL")!;
const POLYGON_PRIVATE_KEY = Deno.env.get("PLATFORM_WALLET_PRIVATE_KEY")!;
const POLYGON_CONTRACT_ADDRESS = Deno.env.get("POLYGON_CONTRACT_ADDRESS")!;
const POLYGON_CHAIN_ID = 80002; // Polygon Amoy testnet - fixed, not a secret.

const C2PA_SIGNING_SERVICE_URL = Deno.env.get("C2PA_SIGNING_SERVICE_URL")!;
const C2PA_SERVICE_SHARED_SECRET = Deno.env.get("C2PA_SERVICE_SHARED_SECRET")!;

const CONTRACT_ABI = [
  "function mintCoa(string metadataURI) returns (uint256)",
  "function recordTransfer(uint256 tokenId, string note)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

// Built once per warm isolate, not per-request, and wrapped in ethers'
// NonceManager so nonce assignment is tracked in memory across requests
// instead of each request re-querying the chain's "pending" nonce fresh.
// Re-querying per request is exactly what caused concurrent mint-coa calls
// to collide on the same nonce and fail with a spurious "could not mint
// on-chain" 502 (confirmed live in the 2026-09-11 staging pentest) - built
// this way, concurrent calls landing on the same isolate get sequential
// nonces instead of racing. Guarded the same way the request-time check
// below always was: if secrets aren't configured, this stays null and every
// request gets the same clear 403 instead of a module-load crash.
let contract: InstanceType<typeof ethers.Contract> | null = null;
if (POLYGON_RPC_URL && POLYGON_PRIVATE_KEY && POLYGON_CONTRACT_ADDRESS) {
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC_URL, POLYGON_CHAIN_ID);
  const wallet = new ethers.NonceManager(new ethers.Wallet(POLYGON_PRIVATE_KEY, provider));
  contract = new ethers.Contract(POLYGON_CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
}

// Also built once per warm isolate - this client carries no per-request
// state (auth is passed explicitly on the one call that needs the caller's
// own JWT, via userClient below), so there's no reason to recreate it on
// every invocation.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

  // Declared here, above the try, so the outer catch can also resolve a
  // reservation if something unexpected throws after one was created but
  // before its normal resolution point ran. resolveReservation is
  // idempotent (the reservationResolved guard), so it's always safe to call
  // from the outer catch too, without risk of flipping an already-
  // 'completed' reservation back to 'failed' if something throws after the
  // real mint succeeded.
  let reservationId: string | null = null;
  let reservationResolved = false;
  async function resolveReservation(status: "completed" | "failed") {
    if (!reservationId || reservationResolved) return;
    reservationResolved = true;
    const { error } = await supabase.rpc("resolve_mint_reservation", {
      p_reservation_id: reservationId,
      p_status: status,
    });
    if (error) console.error("resolve_mint_reservation error:", error);
  }

  try {
    const { artwork_id, buyer_name, buyer_email, royalty_pct, sale_price, notes } = await req.json();

    if (!artwork_id || !buyer_name || !buyer_email) {
      return json({ error: "Missing artwork_id, buyer_name, or buyer_email" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) {
      return json({ error: "Invalid buyer email" }, 400);
    }
    // sale_price is optional (falsy values fall through to null below), but
    // once present it should look like a real sale - not negative, and
    // capped well above anything this platform's actual sales look like
    // (comfortably above a serious original-artwork sale) so a bogus/
    // overflow-style value can't land in coa_ownership_history or
    // royalty_notifications.
    if (sale_price !== undefined && sale_price !== null && sale_price !== "") {
      const parsedPrice = Number(sale_price);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 10_000_000) {
        return json({ error: "Sale price must be between 0 and 10,000,000." }, 400);
      }
    }
    if (notes && String(notes).length > 1000) {
      return json({ error: "Notes must be 1000 characters or fewer." }, 400);
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

    // All data operations from here use the module-scope service-role client
    // above — this is the entire write boundary for blockchain_coas /
    // coa_ownership_history now that RLS grants authenticated no insert
    // access to either table.
    const { data: flags } = await supabase
      .from("feature_flags")
      .select("minting_enabled")
      .eq("id", 1)
      .single();

    if (!flags?.minting_enabled) {
      return json({ error: "Minting isn't available yet." }, 403);
    }

    // Defense-in-depth alongside minting_enabled above, not a replacement for
    // it: if this environment's Polygon secrets were never set (e.g. a fresh
    // environment where minting_enabled got flipped true before the secrets
    // were actually configured), fail with a clear error here instead of
    // letting ethers throw an opaque one three steps down in the chain call.
    if (!contract) {
      console.error("mint-coa: minting_enabled is true but Polygon secrets are not fully configured");
      return json({ error: "Minting isn't available yet." }, 403);
    }

    // Per-artist mint throttle: 20/24h is well above any real usage seen so
    // far (busiest artist: 4 mints over ~33h; busiest artwork-upload burst:
    // 3 uploads in ~66s, so a real batch-minting session after a show is
    // still comfortably covered) while bounding how much gas a compromised
    // account can burn from the platform wallet before this kicks in.
    //
    // reserve_mint_slot() does the count-and-reserve atomically in one
    // Postgres function (advisory lock + count + insert, all one
    // transaction) - see supabase/mint_rate_limit_atomic_2026-09-12.sql. The
    // old version here was a plain COUNT query followed, several seconds
    // later (after a full on-chain confirmation), by the INSERT that
    // actually counted toward it - no lock spanned that gap, so concurrent/
    // staggered calls could all read the same stale count and all pass,
    // confirmed live in the 2026-09-11 staging pentest. Checked before the
    // ownership lookup or any chain call, so a blocked attempt costs
    // nothing, same as before.
    const RATE_LIMIT_WINDOW_HOURS = 24;
    const RATE_LIMIT_MAX_MINTS = 20;
    const { data: reservedId, error: reserveError } = await supabase.rpc("reserve_mint_slot", {
      p_artist_id: user.id,
      p_window_hours: RATE_LIMIT_WINDOW_HOURS,
      p_max_mints: RATE_LIMIT_MAX_MINTS,
    });

    if (reserveError) {
      console.error("reserve_mint_slot error:", reserveError);
      return json({ error: "Could not process mint request. Please try again." }, 500);
    }

    if (!reservedId) {
      return json({
        error: `You've reached the limit of ${RATE_LIMIT_MAX_MINTS} certificates minted per ${RATE_LIMIT_WINDOW_HOURS} hours. Please try again later.`,
      }, 429);
    }
    reservationId = reservedId;

    // Ownership check is baked into the query itself, not a separate branch:
    // this can only ever return a row if the artwork belongs to the caller.
    const { data: artwork, error: artworkError } = await supabase
      .from("artworks")
      .select("id, title, image_url, artist_id")
      .eq("id", artwork_id)
      .eq("artist_id", user.id)
      .single();

    if (artworkError || !artwork) {
      await resolveReservation("failed");
      // Deliberately generic — doesn't reveal whether the artwork exists
      // under a different artist.
      return json({ error: "Artwork not found" }, 404);
    }

    const { data: artistProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const metadata = {
      artwork_title: artwork.title,
      artist_name: artistProfile?.full_name || user.email,
      image_url: artwork.image_url,
      notes: notes || null,
    };
    const metadataURI = "data:application/json;base64," + btoa(JSON.stringify(metadata));

    // Real on-chain mint. Nothing gets written to blockchain_coas unless this
    // succeeds and confirms - there's no prior "reserved" row for mint, so a
    // chain failure just means returning an error, nothing to revert.
    let tokenId: string;
    let txHash: string;
    try {
      // contract is the module-scope, NonceManager-wrapped instance built at
      // isolate boot (see top of file) - not a fresh wallet/provider/contract
      // per request. That's what actually fixes the nonce-collision 502s:
      // a fresh NonceManager per request would still re-query the chain's
      // "pending" nonce independently on every concurrent call and could
      // read the same starting nonce as a sibling request. A single shared
      // instance keeps a running counter instead, so concurrent calls
      // landing on the same isolate get sequential nonces.
      const tx = await contract!.mintCoa(metadataURI);
      const receipt = await tx.wait(1);

      const transferLog = receipt.logs
        .map((log: unknown) => {
          try {
            return contract!.interface.parseLog(log as { topics: string[]; data: string });
          } catch {
            return null;
          }
        })
        .find((parsed: { name: string } | null) => parsed?.name === "Transfer");

      if (!transferLog) {
        throw new Error("Mint transaction confirmed but no Transfer event found in logs");
      }

      tokenId = transferLog.args.tokenId.toString();
      txHash = tx.hash;
    } catch (chainErr) {
      console.error("On-chain mint failed:", chainErr.message);
      await resolveReservation("failed");
      return json({ error: "Could not mint certificate on-chain. Please try again." }, 502);
    }

    const { data: coa, error: coaError } = await supabase
      .from("blockchain_coas")
      .insert({
        artist_id: user.id,
        artwork_id: artwork.id,
        token_id: tokenId,
        tx_hash: txHash,
        contract_address: POLYGON_CONTRACT_ADDRESS,
        chain_id: POLYGON_CHAIN_ID,
        // Clamped to the same 1-25 range the mint modal's own slider enforces
        // (app.html #bc-royalty-slider) - a direct call bypassing the UI
        // could otherwise send any value, e.g. 0 or 100000.
        royalty_pct: Number.isFinite(royalty_pct) ? Math.min(25, Math.max(1, royalty_pct)) : 10,
        network: "Polygon Amoy",
        status: "minted",
        metadata: JSON.stringify(metadata),
      })
      .select()
      .single();

    if (coaError) {
      await resolveReservation("failed");
      if (coaError.code === "23505") {
        return json({ error: "A certificate has already been minted for this artwork." }, 409);
      }
      console.error("blockchain_coas insert error:", coaError);
      return json({ error: "Could not mint certificate" }, 500);
    }

    // A real CoA now exists - this reservation is a genuine, permanent
    // consumption of this artist's rate-limit slot regardless of what
    // happens in the ownership-history/C2PA/notify steps below.
    await resolveReservation("completed");

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

    // C2PA Content Credentials: embeds a signed provenance manifest (artist,
    // mint date, tx hash, verify link) into the image file itself. Purely
    // additive on top of the blockchain CoA, which stays the source of truth
    // - a failure anywhere in this block must not fail the mint, same
    // defensive pattern as the notify-collector call a few lines below.
    try {
      const imageRes = await fetch(artwork.image_url);
      if (!imageRes.ok) throw new Error(`Could not fetch artwork image: ${imageRes.status}`);
      const imageFormat = imageRes.headers.get("content-type") || "image/jpeg";
      const imageBytes = await imageRes.blob();

      const signForm = new FormData();
      signForm.set("image", imageBytes, "artwork");
      signForm.set("format", imageFormat);
      signForm.set("artist_name", metadata.artist_name);
      signForm.set("artwork_title", artwork.title);
      signForm.set("mint_date", new Date().toISOString());
      signForm.set("tx_hash", txHash);
      signForm.set("token_id", tokenId);
      signForm.set("verify_url", `https://amoy.polygonscan.com/tx/${txHash}`);

      const signRes = await fetch(`${C2PA_SIGNING_SERVICE_URL}/sign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${C2PA_SERVICE_SHARED_SECRET}` },
        body: signForm,
      });

      if (!signRes.ok) {
        throw new Error(`Signing service returned ${signRes.status}: ${await signRes.text()}`);
      }

      const signedBytes = await signRes.blob();
      // Overwrites the same storage path - artwork.image_url stays valid with
      // no other row or UI needing to change. The credentialed file becomes
      // the one every viewer/downloader already gets.
      const objectPath = artwork.image_url.split("/artwork-images/")[1];
      const { error: uploadError } = await supabase.storage
        .from("artwork-images")
        .upload(objectPath, signedBytes, { contentType: imageFormat, upsert: true });

      if (uploadError) throw uploadError;

      await supabase
        .from("blockchain_coas")
        .update({ c2pa_embedded: true, c2pa_embedded_at: new Date().toISOString() })
        .eq("id", coa.id);
    } catch (c2paErr) {
      console.error("C2PA embedding failed (non-fatal):", (c2paErr as Error).message);
    }

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
    console.error("Unhandled error:", err.message);
    await resolveReservation("failed");
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
