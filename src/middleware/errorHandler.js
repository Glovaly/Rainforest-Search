function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${err.stack || err.message || err}`);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.headers.accept?.includes('text/event-stream')
  ) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('layout', {
    title: 'Error',
    body: `<div class="error-page"><h2>Error ${status}</h2><p>${message}</p><a href="/">Go back</a></div>`,
    authenticated: req.session?.authenticated,
  });
}

module.exports = errorHandler;
