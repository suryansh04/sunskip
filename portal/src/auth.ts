// Sign-in with Cognito's hosted page: authorization code + PKCE, no auth library (TRD §4.1).
// The ID token goes on every API call; the refresh token renews it, so officials stay signed in.

const DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const REDIRECT_URI = window.location.origin + "/callback";
const RENEW_EARLY_MS = 60000; // renew a minute before the ID token runs out

// Locally against our own API there is no login (API Gateway is what checks the token)
export const loginNeeded = Boolean(CLIENT_ID);

// A shared demo account for judges, shown on the sign-in page. Set at build time; its password is public on purpose.
export const DEMO = { email: import.meta.env.VITE_DEMO_EMAIL, password: import.meta.env.VITE_DEMO_PASSWORD };
const USER_POOL_API = `https://cognito-idp.${DOMAIN?.match(/auth\.([a-z0-9-]+)\.amazoncognito/)?.[1]}.amazonaws.com/`;

function base64url(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomText(length) {
  return base64url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function login(next = window.location.pathname + window.location.search) {
  const verifier = randomText(32);
  const state = randomText(16);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  sessionStorage.setItem("signIn", JSON.stringify({ verifier, state, next }));
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "openid email",
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  window.location.assign(`${DOMAIN}/oauth2/authorize?${query}`);
}

async function requestTokens(fields) {
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...fields }),
  });
  if (!res.ok) throw new Error("Sign-in failed");
  return res.json();
}

// The demo signs in through Cognito's user-pool API (no hosted page), so it renews there too
async function callUserPool(action, body) {
  const res = await fetch(USER_POOL_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-amz-json-1.1", "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}` },
    body: JSON.stringify({ ClientId: CLIENT_ID, ...body }),
  });
  if (!res.ok) throw new Error("Sign-in failed");
  const result = (await res.json()).AuthenticationResult;
  return { id_token: result.IdToken, expires_in: result.ExpiresIn, refresh_token: result.RefreshToken };
}

export async function demoLogin() {
  saveTokens(await callUserPool("InitiateAuth", { AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: DEMO.email, PASSWORD: DEMO.password } }));
  localStorage.setItem("signedInDirectly", "1");
}

function saveTokens(tokens) {
  localStorage.setItem("idToken", tokens.id_token);
  localStorage.setItem("idTokenExp", String(Date.now() + tokens.expires_in * 1000));
  if (tokens.refresh_token) localStorage.setItem("refreshToken", tokens.refresh_token);
}

function forgetTokens() {
  for (const key of ["idToken", "idTokenExp", "refreshToken", "signedInDirectly"]) localStorage.removeItem(key);
}

// On /callback: swap the one-time code for tokens. Returns the page to go back to.
export async function finishLogin() {
  const params = new URLSearchParams(window.location.search);
  const saved = JSON.parse(sessionStorage.getItem("signIn") || "null");
  sessionStorage.removeItem("signIn");
  if (!saved || !params.get("code") || params.get("state") !== saved.state) throw new Error("Sign-in failed");
  saveTokens(await requestTokens({ grant_type: "authorization_code", code: params.get("code"), redirect_uri: REDIRECT_URI, code_verifier: saved.verifier }));
  return saved.next;
}

let renewing = null;

// The ID token, renewed first when it is about to run out; null when signed out
export function freshToken(): Promise<string | null> {
  const token = localStorage.getItem("idToken");
  if (token && Date.now() < Number(localStorage.getItem("idTokenExp")) - RENEW_EARLY_MS) return Promise.resolve(token);
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return Promise.resolve(null);
  // One renewal at a time: calls that arrive while it runs wait for the same answer
  renewing ??= (
    localStorage.getItem("signedInDirectly")
      ? callUserPool("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken } })
      : requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken })
  )
    .then((tokens) => {
      saveTokens(tokens);
      return tokens.id_token;
    })
    .catch(() => {
      forgetTokens();
      return null;
    })
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

export function isLoggedIn() {
  return Boolean(localStorage.getItem("refreshToken"));
}

export function signedInEmail() {
  const token = localStorage.getItem("idToken");
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || null;
  } catch {
    return null;
  }
}

export function logout() {
  forgetTokens();
  window.location.assign(`${DOMAIN}/logout?${new URLSearchParams({ client_id: CLIENT_ID, logout_uri: window.location.origin + "/" })}`);
}

// Every call gets a fresh token; a 401 means the session is over, so sign in again
export function signCallsIn(api) {
  api.interceptors.request.use(async (config) => {
    const token = await freshToken();
    if (token) config.headers["Authorization"] = "Bearer " + token;
    return config;
  });
  api.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401) {
        forgetTokens();
        login();
      }
      return Promise.reject(err);
    },
  );
}
