import jwt from 'jsonwebtoken';

let secret = 'bro_default_secret_key';

/**
 * Update the secret used for signing and verifying JWTs.
 * @param {string} newSecret 
 */
export function setJwtSecret(newSecret) {
  secret = newSecret;
}

/**
 * Signs a JWT payload.
 * @param {Object} payload - The data to embed in the token.
 * @param {jwt.SignOptions} [options] - jsonwebtoken sign options.
 * @returns {string} The signed JWT token.
 */
export function signJwt(payload, options = { expiresIn: '1d' }) {
  return jwt.sign(payload, secret, options);
}

/**
 * Verifies and decodes a JWT token.
 * @param {string} token - The JWT token to verify.
 * @returns {{ valid: boolean, payload?: any, error?: string }}
 */
export function verifyJwt(token) {
  try {
    const payload = jwt.verify(token, secret);
    return { valid: true, payload };
  } catch (error) {
    let message = 'Invalid token';
    if (error.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Signature verification failed';
    }
    return { valid: false, error: message };
  }
}
