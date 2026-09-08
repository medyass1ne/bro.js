import { z } from 'zod';

/**
 * Defines a route configuration for bro.js.
 * @param {Object} config - The route configuration.
 * @param {Function} config.handler - The route handler function receiving ctx.
 * @param {boolean} [config.auth] - Whether the route requires authentication.
 * @param {import('zod').ZodType} [config.params] - Zod schema for route parameters.
 * @param {import('zod').ZodType} [config.body] - Zod schema for request body.
 * @param {import('zod').ZodType} [config.query] - Zod schema for query parameters.
 * @returns {Object} The unchanged config object.
 */
export function defineRoute(config) {
  return config;
}

/**
 * Defines the global framework configuration.
 * @param {Object} config - The global configuration.
 * @param {string} [config.jwtSecret] - Secret key for JWT signing/verification.
 * @param {number} [config.port] - Server port to listen on.
 * @returns {Object} The unchanged config object.
 */
export function defineConfig(config) {
  return config;
}

export { z };
