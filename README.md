# Men's Doubles Badminton Registration

A working registration site for an inter-college men's doubles badminton
tournament. Two players register as one team, pay the ₹300 entry fee by UPI,
upload a payment screenshot, and the organizer verifies each payment by hand
before the team is accepted.

This is a real application, not a mockup: the form, the database, the file
uploads, the admin login, the screenshot viewer, the accept and reject actions,
the search, the filters and the statistics all run against a live backend.

## Requirements

* Node.js 22.5 or newer (built and tested on Node 24)
* No database server needed. SQLite is used through the built-in `node:sqlite`
  module, so the only npm dependencies are Express and Multer.

## Install and run

```bash
npm install
npm start
```

Then open:

* Registration page: `http://localhost:3000/`
* Organizer dashboard: `http://localhost:3000/admin`

The server prints these links, plus the address to use from a phone on the same
Wi-Fi network, when it starts.

For development with automatic restarts:

```bash
npm run dev
```

## Organizer sign in

The dashboard is protected by one organizer account, and the password lives in
a local `.env` file that git ignores, so it is never part of the repository.

Set it up once on a new machine:

```bash
cp .env.example .env
```

Then edit `.env`:

```
ADMIN_USERNAME=subhan
ADMIN_PASSWORD=your-password
```

`npm start` reads that file. A real environment variable still wins over it, so
you can also do `ADMIN_PASSWORD=other npm start` without touching the file.

* With no password configured anywhere, the server creates a random one on
  first start and prints it once in the terminal.
* On the disk the password is stored only as a scrypt hash, never as text.
* The account is created or refreshed on every start, and any other organizer
  account is deleted at the same time. A username used before cannot sign in.
* Signing out ends the session on the server as well as in the browser, so a
  copied cookie stops working immediately.

## The UPI QR code

Your QR code is installed as `public/qr/upi-qr.png` and shows on the payment
section as supplied. Nothing is generated, retouched or resized, so it keeps
scanning. To swap it, replace that file, keeping one of these names:

```
public/qr/upi-qr.png
public/qr/upi-qr.jpg
public/qr/upi-qr.jpeg
public/qr/upi-qr.webp
```

The page picks it up on the next load, with no code change. See
`public/qr/README.txt`. If the image is ever missing, the payment section shows
a short note asking the visitor to contact you.

## The institute crest

The crest in the header comes from the JPEG you supplied, prepared by:

```bash
npm run logo
```

That tool floods the solid background from the edges to make it transparent,
trims the empty border and writes `public/img/aitm-logo.png`. The JPEG cannot
carry transparency, so without this step the crest would sit in a black box.
It is used at 50px tall in the header of every page, and 42px on phones.

## How the flow works

1. The visitor reads the same-college rule and fills in the team details.
2. Both college names are compared after trimming, collapsing repeated spaces
   and lowercasing. Different colleges block the submit on the page and again
   on the server.
3. The visitor pays ₹300 by UPI, then uploads a JPG, JPEG, PNG or WEBP
   screenshot of up to 5 MB.
4. The registration is stored with status `PENDING`. No registration ID is
   shown, nothing is auto-approved and no "confirmed" message is displayed.
5. The organizer opens the dashboard, checks the payment screenshot, then
   accepts or rejects the team.
6. Only `ACCEPTED` teams appear in the accepted teams section.

## Rules enforced by the backend

* **Same college.** The comparison ignores capitalisation and extra spaces. The
  message shown to both players is:
  "Both players must be from the same college. Players from different colleges
  cannot register as a team."
* **Fixed entry fee.** Every registration is stored with `payment_amount = 300`.
  An amount sent by the browser is ignored.
* **Duplicates.** A team name, a player email address, or the same pair of
  players can appear only once among pending and accepted registrations.
  Rejected teams may register again with corrected details.
* **Uploads.** Only JPEG, PNG and WEBP are accepted. The file signature is
  checked, so a renamed executable or a text file with an image content type is
  refused. The size limit is 5 MB. Files are stored with random names and are
  never reachable as public URLs.
* **Access.** Public visitors can submit a registration and nothing else. The
  registration list, the screenshots and the accept and reject actions all
  require a signed in organizer.

## Where the data lives

| Item | Location | Notes |
| --- | --- | --- |
| Database | `data/app.db` | SQLite file, created on first start |
| Payment screenshots | `uploads/` | Private, served only through an authenticated route |
| Session key | `data/session-secret.key` | Generated on first start |
| Organizer password | `.env` | Ignored by git, copy `.env.example` to create it |
| Your UPI QR image | `public/qr/upi-qr.png` | Public, shown on the payment section |
| Institute crest | `public/img/aitm-logo.png` | Public, header of every page. Regenerate with `npm run logo` |
| Webfonts | `public/fonts/` | Self-hosted Inter and Space Grotesk, see the licence note in that folder |

Both `data/` and `uploads/` are ignored by git. Back them up together, they
belong to each other.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address, use `127.0.0.1` for local only |
| `ADMIN_USERNAME` | `subhan` | Organizer username |
| `ADMIN_PASSWORD` | from `.env` | Organizer password, kept out of git |
| `SESSION_SECRET` | generated file | Key used to sign session cookies |
| `DATA_DIR` | `./data` | Database and session key folder |
| `UPLOAD_DIR` | `./uploads` | Payment screenshot folder |
| `DB_FILE` | `$DATA_DIR/app.db` | Explicit database path |

## Using the dashboard during the event

* The four statistics at the top are counts taken straight from the database.
* The left navigation switches between the verification queue, all registrations
  and the accepted teams list. The numbers next to each item are live counts.
* **Refresh** reloads everything, so a team that registered a minute ago shows
  up without a page reload.
* Each card has **View Payment Screenshot**, **Accept Registration** and
  **Reject Registration**. Accepting asks for confirmation first. Rejecting
  requires a reason, and you can type a custom one by choosing "Other".

## Tests

```bash
npm test
```

The test starts a real server on a test port with its own database and upload
folder, then walks the whole flow: page content, validation, the same-college
rule, duplicate protection, upload type and size limits, blocked public access
to the admin API, sign in, statistics from the database, search and filters,
screenshot download, accept, reject with a reason, and signing out.

To regenerate the favicon files after editing the icon drawing:

```bash
npm run icons
```

## Deploying for real

* Put the site behind HTTPS (a reverse proxy such as nginx or Caddy is enough).
  The session cookie is marked `Secure` automatically when the request arrives
  over HTTPS.
* Set `ADMIN_PASSWORD` and `SESSION_SECRET` through the environment, so the
  chosen password is not the one written in `src/config.js`.
* Keep `uploads/` and `data/` on the server, outside the web root. They already
  are: Express only serves the `public` folder.
* The site sets a strict Content Security Policy, so keep scripts and styles in
  the existing files instead of adding inline ones.
