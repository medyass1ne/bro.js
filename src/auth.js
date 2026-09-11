import jwt from 'jsonwebtoken';

/**
 * Signs a JWT payload.
 * @param {Object} payload - The data to embed in the token.
 * @param {string} secret - The JWT secret key.
 * @param {jwt.SignOptions} [options] - jsonwebtoken sign options.
 * @returns {string} The signed JWT token.
 */
export function signJwt(payload, secret, options = { expiresIn: '1d' }) {
  return jwt.sign(payload, secret, options);
}

/**
 * Verifies and decodes a JWT token.
 * @param {string} token - The JWT token to verify.
 * @param {string} secret - The JWT secret key.
 * @returns {{ valid: boolean, payload?: any, error?: string }}
 */
export function verifyJwt(token, secret) {
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
