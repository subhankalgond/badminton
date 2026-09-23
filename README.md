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
* A PostgreSQL database. This project uses Supabase, whose free plan is enough.
  Every registration and every payment screenshot is stored there, so the site
  keeps its data when the server restarts, is redeployed, or is suspended.

Nothing else is needed. There is no database server to run on your own machine,
no file to keep and no disk to mount.

## Step 1: create the database

1. Sign up at `supabase.com` and create a new project. Choose a region near
   you, and save the database password it asks for. It is shown only once.
2. Wait until the project finishes setting up.
3. In the project, click **Connect** at the top.
4. Choose **Session pooler**, then copy the URI it shows. It looks like this:

```
postgresql://postgres.abcdefghij:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

5. Replace `YOUR-PASSWORD` with the password from step 1. If the password
   contains any of `&`, `#`, `?` or a space, replace each one with its percent
   encoded form, for example `&` becomes `%26`.

Use the **Session pooler** and not the other two, for these reasons:

* **Direct connection** is IPv6 only on the free plan. Rendering hosts that
  reach it over IPv4 cannot connect at all.
* **Transaction pooler** does not support prepared statements, which a long
  running server with a connection pool does use.

The free plan includes 500 MB of storage. Payment screenshots live in the
database, so a few hundred teams fit comfortably.

## Step 2: point the site at it

Copy the example file and paste the connection line in:

```bash
cp .env.example .env
```

```
DB_URL=postgresql://postgres.abcdefghij:your-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
ADMIN_USERNAME=subhan
ADMIN_PASSWORD=your-organizer-password
```

Then check it, before starting anything:

```bash
npm run db:check
```

It connects, creates the tables, and prints the PostgreSQL version, the
database, the schema and how many registrations are stored. If something is
wrong it prints the reason and what to change.

### Install and run

```bash
npm install
npm start
```

Then open:

* Registration page: `http://localhost:3000/`
* Organizer dashboard: `http://localhost:3000/admin`

The server prints these links, the address to use from a phone on the same
Wi-Fi network, and the database it connected to, when it starts.

For development with automatic restarts:

```bash
npm run dev
```

The site creates its own tables on the first start, so there is nothing to
import. If it cannot connect, it stops with the reason and the fix, for example:

```
Cannot connect to the PostgreSQL database.

Target: postgres.abcdefghij@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
Driver said: password authentication failed for user "postgres.abcdefghij"

The database refused that password. Copy the connection line again, including the password.
```

Separate values are also accepted, for a provider that gives them one at a
time: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`. A connection
line describes the whole connection, so when `DB_URL` is present it wins over
those, which stops a leftover `DB_PORT` from quietly overriding the port inside
it.

Encryption is on by default for any host other than `localhost`, because
Supabase refuses a plain connection. Set `DB_SSL_CA` to the certificate from
**Connect > SSL configuration** to verify the server as well as encrypt.

## Organizer sign in

The dashboard is protected by one organizer account, and the password lives in
a local `.env` file that git ignores, so it is never part of the repository.

```
ADMIN_USERNAME=subhan
ADMIN_PASSWORD=your-password
```

`npm start` reads that file. A real environment variable still wins over it, so
you can also do `ADMIN_PASSWORD=other npm start` without touching the file.

* With no password configured anywhere, the server creates a random one on
  first start and prints it once in the terminal.
* The password is stored only as a scrypt hash, never as text.
* The account is created or refreshed on every start, and any other organizer
  account is deleted at the same time. A username used before cannot sign in.
* Signing out ends the session on the server as well as in the browser, so a
  copied cookie stops working immediately.
* Sign in attempts are limited to 10 per 15 minutes per address.

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

1. The visitor reads the same-college rule and fills in the team details:
   team name, and for each player a full name, email, mobile number and college.
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
* **Mobile numbers.** Both players must give a mobile number. Spaces, dashes
  and a country code are stripped, so `+91 98765 43210` is stored as
  `9876543210`, and a number that is not ten digits is refused. The two players
  cannot share one number.
* **Fixed entry fee.** Every registration is stored with `payment_amount = 300`.
  An amount sent by the browser is ignored.
* **Duplicates.** A team name, a player email address, or the same pair of
  players can appear only once among pending and accepted registrations.
  Rejected teams may register again with corrected details.
* **Uploads.** Only JPEG, PNG and WEBP are accepted. The file signature is
  checked, so a renamed executable or a text file with an image content type is
  refused. The size limit is 5 MB.
* **Access.** Public visitors can submit a registration and nothing else. The
  registration list, the screenshots and the accept and reject actions all
  require a signed in organizer.
* **Screenshots are private.** They are stored in the database and served only
  through an authenticated route, never as a public file.

## Where the data lives

| Item | Location | Notes |
| --- | --- | --- |
| Registrations | table `registrations` | Includes the entry fee, the status and the verification details |
| Duplicate protection | table `registration_keys` | One row per active team name, email and player pair |
| Payment screenshots | column `registrations.payment_screenshot_data` | Stored with the registration, so a restart cannot lose them |
| Organizer account | table `admins` | Password kept as a scrypt hash |
| Organizer password | `.env` on the machine running the site | Ignored by git, copy `.env.example` to create it |
| Session key | `SESSION_SECRET`, or derived from the organizer password | Nothing is written to disk for it |
| Your UPI QR image | `public/qr/upi-qr.png` | Public, shown on the payment section |
| Institute crest | `public/img/aitm-logo.png` | Public, header of every page. Regenerate with `npm run logo` |
| Webfonts | `public/fonts/` | Self-hosted Inter and Space Grotesk, see the licence note in that folder |

The tables are created in the `public` schema. The site creates them on start
and adds missing columns to an existing database, so an older database keeps
working after an update.

Nothing the site stores is kept on its own disk. That is deliberate: a host
that wipes its filesystem on every restart cannot lose a registration, because
there is no file to lose.

The earlier `data/` and `uploads/` folders, and MySQL, are no longer used by
this project. They can be deleted.

## Backups

The database holds everything, including the payment screenshots, so one dump
is a complete backup:

```bash
pg_dump "postgresql://postgres.abcdefghij:your-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" > badminton-backup.sql
```

`pg_dump` comes with the PostgreSQL client tools. It is a free download from
`postgresql.org`, and installing the client does not install or start a server.

Take a dump before the draw is made, and one more at the end of the event.
Restoring it puts the registrations and the screenshots back exactly as they
were.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address, use `127.0.0.1` for local only |
| `ADMIN_USERNAME` | `subhan` | Organizer username |
| `ADMIN_PASSWORD` | from `.env` | Organizer password, kept out of git |
| `DB_URL` | none | The connection line from Supabase. Required |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | none | The same connection split into five values, if you prefer |
| `DB_SSL` | on for any host other than localhost | Encrypt the database connection |
| `DB_SSL_CA` | none | Path to the server certificate, to verify the connection as well as encrypt it |
| `DB_SCHEMA` | `public` | Schema holding the tables. Only the tests change it |
| `SESSION_SECRET` | derived from the organizer password | Key used to sign session cookies |

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

The full suite runs against a PostgreSQL that lives inside the Node process,
with no database server, no account and no credentials anywhere:

```bash
npm run test:local
```

That is the one to use day to day. To run the same suite against your real
database instead, for instance to check the connection line before deploying:

```bash
npm test
```

The tests never touch your registrations either way. They create a separate
schema called `badminton_test`, build their own tables there, and drop it again
when they finish. The tables the site uses, in the `public` schema, are never
read or written by a test run.

The suite starts a real server on a test port and walks the whole flow: page
content, validation, the same-college rule, duplicate protection, upload type
and size limits, blocked public access to the admin API, sign in, statistics
from the database, search and filters, screenshot download compared byte for
byte with the upload, accept, reject with a reason, and signing out.

The test refuses to run unless the schema name is lowercase, ends in `_test`,
and is not `public`. Change it with `TEST_DB_SCHEMA` if you ever need to.

To regenerate the favicon files after editing the icon drawing:

```bash
npm run icons
```

## Deploying for real

The site is an ordinary long running Node process that keeps everything in
PostgreSQL, so a host has to give it a process that stays up and a database it
can reach. It does not need a persistent disk, and that is what makes the free
instance types usable.

A `Dockerfile` is included, which builds on Node 24, installs only the runtime
dependencies and runs as a non root user.

### Render, using the included `render.yaml`

1. In Render, choose **New > Blueprint** and pick this repository.
2. Render reads `render.yaml` and asks for two secrets: `DB_URL`, pasted from
   Supabase, and the organizer password. `SESSION_SECRET` is generated for you.
   Nothing secret is stored in the repository.
3. Create the Blueprint. Render builds the image and gives you an
   `onrender.com` address over HTTPS.

The blueprint asks for the free instance type, which is enough now that the
data is not on the disk. After the first deploy, check the logs for these lines:

```
Organizer login:   subhan (password from .env)
Database:          postgres.abcdefghij@aws-0-ap-south-1.pooler.supabase.com:5432/postgres (PostgreSQL 17.6, schema public, TLS on)
```

If the database line is missing, the server refused to start and printed why.

### Other hosts

* **Railway:** **New Project > Deploy from GitHub repo**, choose this
  repository, add the same database and organizer variables, and keep it at one
  replica.
* **Fly.io or any VPS:** build the included Docker image and set the same
  variables. Nothing has to be mounted.
* **Vercel and similar:** not a fit. This is a long lived server that holds its
  own rate limit counters in memory, and those platforms expect each request to
  be served by a short lived function. Making it work there means restructuring
  the server into a handler.

The deployed service lives at `https://badminton-2yvb.onrender.com`. The
shorter `badminton-registration.onrender.com` name belongs to an unrelated
project, not this one.

### Checklist

* Set `ADMIN_PASSWORD` in the host's environment variables, never in the code,
  and use a password that was never pushed to GitHub.
* Put the site behind HTTPS. Render does this for you. Behind your own reverse
  proxy, nginx or Caddy is enough. The session cookie is marked `Secure`
  automatically over HTTPS.
* Keep `DB_URL` out of screenshots and issue trackers. The startup banner prints
  the host and the user, never the password.
* Change the Supabase database password if the connection line was ever shared.
  **Project settings > Database > Reset database password** does that, and the
  site only needs the new line pasted in again.

## Keeping it awake

A free Render instance is stopped after 15 minutes without a request, and the
next visitor then waits about a minute while it starts again. A free Supabase
project is paused after a week without any activity, and a paused project
refuses connections until it is resumed from the dashboard.

One scheduled job handles both. `.github/workflows/keep-alive.yml` requests the
site every 5 minutes, and that request reaches the database, so it counts as
activity for Supabase as well. It is already in the repository and pointed at
this service's own address, `https://badminton-2yvb.onrender.com`. If the
service is ever renamed on Render, update the address at the bottom of that
file, or add a repository variable named `SITE_URL` under **Settings > Secrets
and variables > Actions > Variables**, which wins over the file.

It calls `/api/health`, which answers 200 only when the database is reachable as
well as the site. That way the ping reports the real state of things rather than
just that the web process is running.

Two things to know. GitHub runs scheduled workflows on a best effort basis, so a
ping can arrive a few minutes late, which the 15 minute window absorbs. And a
scheduled workflow is disabled automatically after 60 days without a commit, so
if the site has been untouched for two months, open the **Actions** tab and
enable it again.

If you would rather not depend on GitHub's scheduler, a free uptime service does
the same job and can also email you when the site goes down: point a monitor at
`https://your-site.onrender.com/api/health` every 5 minutes with cron-job.org or
UptimeRobot. Either way, keep the interval between 5 and 14 minutes, because 15
minutes of silence is what puts the web service to sleep.

One caution about the Render free plan: it includes 750 instance hours per
workspace per month, and keeping one service awake around the clock uses about
730 of them. If you run other free services in the same workspace, those will
run out of hours and be suspended until the month resets.
