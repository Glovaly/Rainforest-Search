require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./src/config');

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  })
);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/jobs'));
app.use('/', require('./src/routes/upload'));
app.use('/', require('./src/routes/download'));
app.use('/', require('./src/routes/sse'));

// Error handler
app.use(require('./src/middleware/errorHandler'));

app.listen(config.PORT, () => {
  console.log(`ASIN Finder running on port ${config.PORT}`);
});
