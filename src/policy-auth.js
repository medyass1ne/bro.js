import crypto from 'node:crypto';

export class OidcProvider {
  constructor(issuerUrl, clientId) {
    this.issuerUrl = issuerUrl;
    this.clientId = clientId;
    this.jwksUrl = `${issuerUrl}/.well-known/jwks.json`;
    this.keys = null;
    this.lastFetch = 0;
  }
  
  async _fetchKeys() {
    if (this.keys && (Date.now() - this.lastFetch < 3600000)) return this.keys; // 1 hour cache
    const response = await fetch(this.jwksUrl);
    if (!response.ok) throw new Error('Failed to fetch JWKS');
    const data = await response.json();
    this.keys = data.keys;
    this.lastFetch = Date.now();
    return this.keys;
  }
  
  async verifyIdToken(token) {
    let jose;
    try { jose = await import('jose'); } catch { throw new Error('Install jose package to use OIDC Provider'); }
    const JWKS = jose.createRemoteJWKSet(new URL(this.jwksUrl));
    try {
      const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: this.issuerUrl,
        audience: this.clientId
      });
      return { valid: true, payload };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }
}

export class PolicyEvaluator {
  constructor() {
    this.policies = new Map();
  }

  definePolicy(action, evaluatorFn) {
    this.policies.set(action, evaluatorFn);
  }

  async authorize(user, action, resourceContext = {}) {
    const evaluator = this.policies.get(action);
    if (!evaluator) return false;
    return await evaluator(user, resourceContext);
  }
}

export class ApiKeyManager {
  constructor(dbAdapter) {
    this.db = dbAdapter;
  }

  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  generateKey(prefix = 'bro') {
    const random = crypto.randomBytes(32).toString('hex');
    const key = `${prefix}_${random}`;
    const hash = this.hashKey(key);
    return { key, hash };
  }

  async verifyKey(key) {
    if (!this.db) throw new Error('ApiKeyManager requires a database adapter');
    const hash = this.hashKey(key);
    // This is a stub implementation. Developers must subclass ApiKeyManager or implement custom logic to query their DB.
    throw new Error('Not implemented: ApiKeyManager.verifyKey is a stub and must be overridden with your database query logic.');
  }
}

export const tenantContextPlugin = {
  name: 'bro-tenant-context',
  order: 10,
  onContext: async (ctx) => {
    let tenantId = ctx.user?.tenantId;
    if (!tenantId && process.env.TRUST_TENANT_HEADER === 'true') {
      tenantId = ctx.req?.headers['x-tenant-id'];
    }
    if (tenantId) {
       return { tenant: { id: tenantId } };
    }
    return {};
  }
};

export class SecurityContextGenerator {
  generateCsrfToken() {
    // Generates a cryptographically secure token instead of Math.random()
    return crypto.randomBytes(32).toString('hex');
  }

  generateNonce() {
    // Generates a cryptographically secure nonce instead of Math.random()
    return crypto.randomBytes(16).toString('base64');
  }
}
