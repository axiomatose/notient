# Notient API

## Development

Install dependencies:

```bash
npm install
```

Run the API locally:

```bash
npm start
```

Run automated tests:

```bash
npm test
```

## Environment

Copy `.env.example` to `.env` and provide a strong `JWT_SECRET`. By default the server writes its SQLite database to `./data/app.db`; override `DB_PATH` as needed.
