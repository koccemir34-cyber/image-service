// Shared authentication middleware
// Extracted from server.js where the same secret check was duplicated
// in both the /generate and /exif route handlers.

export function authMiddleware(secret) {
  return (req, res, next) => {
    if (secret && req.headers['x-secret'] !== secret) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  };
}
