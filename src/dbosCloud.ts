import { CancellationToken, window, ProgressLocation, CancellationTokenSource, env, Uri } from 'vscode';
import jwt, { JwtPayload } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { logger } from './extension';
import { sleep } from './utils';

interface CloudOptions {
  cloudDomain: string;
  loginDomain: string;
  clientId: string;
}

function getCloudDomain(host?: string) { return host ?? "cloud.dbos.dev"; }

function getCloudOptions(host?: string | CloudOptions ): CloudOptions {
  if (typeof host === 'object') { return host; }
  const cloudDomain = getCloudDomain(host);
  const isProduction = cloudDomain === "cloud.dbos.dev";
  const loginDomain = isProduction ? 'login.dbos.dev' : 'dbos-inc.us.auth0.com';
  const clientId = isProduction ? '6p7Sjxf13cyLMkdwn14MxlH7JdhILled' : 'G38fLmVErczEo9ioCFjVIHea6yd0qMZu';
  return { cloudDomain, loginDomain, clientId };
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function getDeviceCode(host?: string | CloudOptions, token?: CancellationToken): Promise<DeviceCodeResponse> {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    const { loginDomain, clientId } = getCloudOptions(host);
    const url = `https://${loginDomain}/oauth/device/code`;
    const request = <RequestInit>{
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: abort.signal,
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'sub',
        audience: 'dbos-cloud-api'
      })
    };
    const response = await fetch(url, request);
    if (!response.ok) { throw new Error(`getDeviceCode request failed: ${response.status} ${response.statusText}`); }
    const body = (await response.json()) as DeviceCodeResponse;
    logger.debug("getDeviceCode", { loginDomain, status: response.status, body });
    return body;
  } finally {
    tokenListener?.dispose();
  }
}

interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function getAuthToken(deviceCode: DeviceCodeResponse, host?: string | CloudOptions, token?: CancellationToken): Promise<AuthTokenResponse | undefined> {
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    const { loginDomain, clientId } = getCloudOptions(host);
    const url = `https://${loginDomain}/oauth/token`;
    const request = <RequestInit>{
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: abort.signal,
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode.device_code,
        client_id: clientId
      })
    };

    let elapsedTimeSec = 0;
    while (elapsedTimeSec < deviceCode.expires_in) {
      if (token?.isCancellationRequested) { 
        logger.debug("getAuthToken cancelled", { loginDomain, deviceCode });
        return undefined; 
      }
      
      await sleep(deviceCode.interval * 1000);
      elapsedTimeSec += deviceCode.interval;
      const response = await fetch(url, request);

      if (response.ok) {
        const body = await response.json();
        logger.debug("getAuthToken", { loginDomain, deviceCode, status: response.status, body });
        return body as AuthTokenResponse;
      } else if (response.status === 403) {
        // 403 response means the user hasn't logged in yet, so keep polling
        logger.debug("getAuthToken", { loginDomain, deviceCode, status: response.status });
      } else {
        throw new Error(`getAuthToken oauth/token request failed: ${response.status} ${response.statusText}`, { cause: { loginDomain, deviceCode, status: response.status }});
      }
    }
    logger.debug("getAuthToken timed out", { loginDomain, deviceCode });
    return undefined;
  } finally {
    tokenListener?.dispose();
  }
}

async function verifyToken(authToken: string | AuthTokenResponse, host?: string | CloudOptions, token?: CancellationToken): Promise<JwtPayload> {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;

  const decoded = jwt.decode($authToken, { complete: true });
  if (!decoded || !decoded.header.kid) { throw new Error('Invalid token'); }

  const { loginDomain } = getCloudOptions(host);
  const client = jwksClient({ jwksUri: `https://${loginDomain}/.well-known/jwks.json` });
  const key = await client.getSigningKey(decoded.header.kid);
  const signingKey = key.getPublicKey();

  const payload = await new Promise<JwtPayload>((resolve, reject) => {
    token?.onCancellationRequested(() => reject(new Error('Cancelled')));
    jwt.verify($authToken, signingKey, { algorithms: ['RS256'] }, (err, verifiedToken) => {
      if (err) {
        reject(err);
      } else {
        resolve(verifiedToken as JwtPayload);
      }
    });
  });
  logger.debug("verifyToken", { loginDomain, authToken: $authToken, payload });

  return payload;
}

async function getUser(authToken: string | AuthTokenResponse, host?: string | CloudOptions, token?: CancellationToken) {
  const $authToken = typeof authToken === 'string' ? authToken : authToken.access_token;
  const abort = new AbortController();
  const tokenListener = token?.onCancellationRequested(reason => { abort.abort(reason); });
  try {
    const { cloudDomain } = getCloudOptions(host);
    const url = `https://${cloudDomain}/v1alpha1/user`;
    const request = <RequestInit>{
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${$authToken}`
      },
      signal: abort.signal,
    };
    const response = await fetch(url, request);
    const body = await response.text();
    logger.debug("GET dbos-cloud/user", { cloudDomain, authToken: $authToken, status: response.status, body });
    return body;
  } finally {
    tokenListener?.dispose();
  }
}

export async function authenticate(host?: string) {
  try {
    const result = await window.withProgress({
      cancellable: true,
      location: ProgressLocation.Notification,
      title: `Log into DBOS Cloud`
    }, async (progress, token) => {
      // create a new CTS so we can cancel the progress window if openExternal call fails
      const cts = new CancellationTokenSource();
      try {
        // cancel the constructed CTS if the provided token requests cancellation
        token.onCancellationRequested(() => cts.cancel());
  
        const cloud = getCloudOptions(host);
        const deviceCodeResponse = await getDeviceCode(cloud, cts.token);
        progress.report({ message: `User code ${deviceCodeResponse.user_code}` });
  
        env.openExternal(Uri.parse(deviceCodeResponse.verification_uri_complete))
          .then(result => {
            if (!result) { 
              logger.error("authenticate.openExternal", { result });
              cts.cancel(); 
            }
          }, e => {
            // cancel the constructed CTS if openExternal call fails
            logger.error("authenticate.openExternal", e);
            cts.cancel();
          });
    
        const authTokenResponse = await getAuthToken(deviceCodeResponse, cloud, cts.token);
        if (!authTokenResponse) { return undefined; }
  
        const access_token = authTokenResponse.access_token;
        await verifyToken(access_token, cloud, cts.token);
        const userName = await getUser(access_token, cloud, cts.token);
        return { accessToken: access_token, userName, domain: getCloudDomain(host) };
      } finally {
        cts.dispose();
      }
    });
    logger.info("authenticate", result);
    return result;
  } catch (e) {
    logger.error("authenticate", e);
  }
}
