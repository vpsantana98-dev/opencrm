import crypto from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/auth/admin-client";

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function verifySignedRequest(signedRequest: string, appSecret: string) {
  const [encodedSignature, encodedPayload] = signedRequest.split(".");
  if (!encodedSignature || !encodedPayload) return null;

  const signature = base64UrlDecode(encodedSignature);
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(signature, expected)
  ) {
    return null;
  }

  return JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as {
    user_id?: string;
  };
}

function publicBaseUrl(request: Request) {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    new URL(request.url).origin
  );
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const signedRequest = form?.get("signed_request");
  const appSecret = process.env.META_APP_SECRET?.trim();

  if (!appSecret || typeof signedRequest !== "string") {
    return NextResponse.json(
      { error: "Invalid data deletion request" },
      { status: 400 },
    );
  }

  const payload = verifySignedRequest(signedRequest, appSecret);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid signed request" },
      { status: 400 },
    );
  }

  const confirmationCode = crypto.randomBytes(12).toString("hex");

  if (payload.user_id) {
    await supabaseAdmin()
      .from("meta_agency_connections")
      .delete()
      .eq("meta_user_id", payload.user_id);
  }

  return NextResponse.json({
    url: `${publicBaseUrl(request)}/exclusao-de-dados?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
