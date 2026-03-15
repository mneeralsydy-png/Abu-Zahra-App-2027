# Private Dialer (أبو الزهراء)

## Overview

Private Dialer is a professional Arabic VoIP application called "أبو الزهراء" (Abu Al-Zahra). It's a web-based phone calling application that allows users to make phone calls through Twilio's API. The app features dual authentication (email/password + Google), a balance/credit system, call history tracking, and PayPal integration for adding funds. The interface is designed in Arabic (RTL layout) and styled as a mobile-first application resembling a native phone dialer with Capacitor Android support.

## User Preferences

Preferred communication style: Simple, everyday language.

## Latest Features (Implemented in v1.0.2)

### 1. Google Authentication
- **Status**: ✅ Implemented
- **Features**: 
  - Added red Google Sign-In button to login page
  - Uses Firebase Web SDK for browser testing
  - Falls back to Capacitor Firebase Authentication on mobile
  - Auto-creates user account on first Google login
  - Grants $1.00 credit on first login
- **Backend Endpoint**: `/api/firebase-auth` (POST) - validates Firebase token and creates/updates user

### 2. Long-Press on "0" Button
- **Status**: ✅ Implemented
- **Features**:
  - Press "0" for 500ms+ to input "+" symbol
  - Quick tap shows "0" as normal
  - Works on both touch devices and mouse
  - Uses touchstart/touchend and mousedown/mouseup events for cross-platform support

## System Architecture

### Backend (Node.js + Express)

- **Runtime**: Node.js with ES Modules (`import` syntax)
- **Framework**: Express.js v4 serving both API routes and static files
- **Entry point**: `server.js` (defined in package.json as main, runs on port 5000)
- **Authentication**: JWT-based auth using `jsonwebtoken`. Tokens are stored client-side in `localStorage`. An `authenticate` middleware validates tokens on protected routes.
- **Password hashing**: bcrypt for secure password storage
- **API prefix**: Routes are under `/api/` (e.g., `/api/login`, `/api/register`)

### Frontend (Vanilla HTML/CSS/JS)

- **Served as static files** from the `public/` directory
- **Single-page app pattern**: `index.html` acts as the main app with multiple "pages" toggled via CSS classes (`.page.active`, `.hidden`)
- **RTL Arabic interface**: Uses Cairo font from Google Fonts, Font Awesome icons
- **Mobile-first design**: Max-width 400px container, viewport locked to prevent scaling
- **Login flow**: `login.js` handles authentication via fetch calls to the API, stores JWT token, and redirects to `app.html` on success

### Database (SQLite)

- **Storage**: SQLite3 with file-based database (`./database.db`)
- **Schema**:
  - `users` table: `id` (INTEGER PK AUTOINCREMENT), `email` (TEXT UNIQUE), `password` (TEXT), `balance` (REAL DEFAULT 1.0)
  - `calls` table: `id` (INTEGER PK AUTOINCREMENT), `userId` (INTEGER), `toNumber` (TEXT), `duration` (INTEGER), `cost` (REAL), `timestamp` (DATETIME DEFAULT CURRENT_TIMESTAMP)
- **Note**: The database is initialized synchronously on server start using `db.serialize()`. New users start with a balance of 1.0 (likely USD).

### Key Design Decisions

1. **SQLite over PostgreSQL**: Chosen for simplicity and zero-configuration. File-based storage works well for a small-scale application. If scaling is needed, migration to PostgreSQL would be appropriate.
2. **Monolithic architecture**: Backend serves both the API and static frontend files from a single Express server, keeping deployment simple.
3. **JWT for auth**: Stateless authentication avoids session storage needs. The secret defaults to a hardcoded value (`PRIVATE_DIALER_SECRET`) but can be overridden via `JWT_SECRET` environment variable.
4. **ES Modules**: The project uses `import` syntax rather than `require`, so `"type": "module"` should be set in package.json (currently missing — may need to be added).

## External Dependencies

### Third-Party Services

1. **Twilio** (`twilio` npm package v4.23.0): Core telephony service for making phone calls. Requires `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` environment variables to be configured.

2. **PayPal SDK**: Client-side integration loaded via script tag for processing payments/adding balance. Uses a specific client ID embedded in the HTML. Currency is set to USD.

3. **EmailJS**: Client-side email service loaded via CDN (`emailjs-com@3.2.2`). Likely used for contact forms or notifications without needing a backend email service.

### Environment Variables Required

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio authentication token |
| `JWT_SECRET` | Secret key for JWT signing (optional, has default) |

### NPM Dependencies

- `express` - Web server framework
- `cors` - Cross-origin resource sharing middleware
- `sqlite3` - SQLite database driver
- `bcrypt` - Password hashing
- `jsonwebtoken` - JWT authentication
- `twilio` - Twilio API client

### CDN Dependencies (Frontend)

- Google Fonts (Cairo)
- Font Awesome 6.4.0
- PayPal SDK
- EmailJS SDK