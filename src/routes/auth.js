const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');

const router = express.Router();

// Hash the admin password once at startup
let adminPasswordHash = null;
(async () => {
  if (config.ADMIN_PASSWORD) {
    adminPasswordHash = await bcrypt.hash(config.ADMIN_PASSWORD, 10);
  }
})();

router.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!adminPasswordHash) {
    return res.render('login', {
      title: 'Login',
      error: 'Server not configured. Set ADMIN_PASSWORD environment variable.',
    });
  }

  if (
    username === config.ADMIN_USERNAME &&
    (await bcrypt.compare(password, adminPasswordHash))
  ) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/');
  }

  res.render('login', { title: 'Login', error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
