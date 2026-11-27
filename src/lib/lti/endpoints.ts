// Moodle's LTI endpoints follow from its address (the "Platform ID").
export function moodleEndpointsClient(issuer: string) {
  const base = issuer.replace(/\/+$/, "");
  return { auth_url: `${base}/mod/lti/auth.php`, jwks_url: `${base}/mod/lti/certs.php`, token_url: `${base}/mod/lti/token.php` };
}
