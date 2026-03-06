function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.headers.accept?.includes('text/event-stream')
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

module.exports = { requireAuth };
