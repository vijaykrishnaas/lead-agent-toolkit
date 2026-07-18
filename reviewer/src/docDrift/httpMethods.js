// Single shared source of truth for the HTTP verbs docDrift recognizes on
// both sides of the comparison (Express route calls and OpenAPI `paths`
// entries). Both parseExpressRoutes.js and parseOpenApi.js must use this
// same list — if the two sides recognize different verbs, a route defined
// with a verb only one side understands silently drops off that side's
// route list and compareRoutes() reports it as drift that doesn't
// actually exist.
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

module.exports = { HTTP_METHODS };
