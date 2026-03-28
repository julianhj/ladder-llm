interface Env {
  OPENAI_API_KEY: string;
  /** Team domain hostname or URL, e.g. `yourteam.cloudflareaccess.com` or `https://yourteam.cloudflareaccess.com` */
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: string;
  /** Cloudflare Access application audience (AUD) for this deployment */
  CLOUDFLARE_ACCESS_AUD: string;
}
