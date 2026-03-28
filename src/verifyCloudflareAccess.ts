import * as jose from "jose";

const jwksByTeam = new Map<string, jose.JWTVerifyGetKey>();

/** Accept hostname or full URL (e.g. from wrangler vars). */
function normalizeTeamDomainHost(raw: string): string {
  const t = raw.trim();
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    return new URL(withScheme).hostname;
  } catch {
    return t.replace(/^https?:\/\//i, "");
  }
}

function getJwks(teamDomainHost: string): jose.JWTVerifyGetKey {
  let jwks = jwksByTeam.get(teamDomainHost);
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(
      new URL(`https://${teamDomainHost}/cdn-cgi/access/certs`),
    );
    jwksByTeam.set(teamDomainHost, jwks);
  }
  return jwks;
}

/**
 * Validates the Cloudflare Access application token from `CF-Access-JWT-Assertion`
 * against the team JWKS, issuer, and expected application audience (`aud`).
 */
export async function verifyCloudflareAccessRequest(
  request: Request,
  env: Pick<Env, "CLOUDFLARE_ACCESS_TEAM_DOMAIN" | "CLOUDFLARE_ACCESS_AUD">,
): Promise<boolean> {
  const teamDomainRaw = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CLOUDFLARE_ACCESS_AUD?.trim();
  if (!teamDomainRaw || !audience) return false;

  const teamDomainHost = normalizeTeamDomainHost(teamDomainRaw);

  const token = request.headers.get("CF-Access-JWT-Assertion")?.trim();
  if (!token) return false;

  const issuer = `https://${teamDomainHost}`;
  try {
    await jose.jwtVerify(token, getJwks(teamDomainHost), {
      issuer,
      audience,
    });
    return true;
  } catch {
    return false;
  }
}
