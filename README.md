# CodeSense AI MERN

This project is now structured as a MERN app:

- `frontend/`: React + Vite frontend
- `backend/`: Express + Mongo/Mongoose backend

## Project structure

```text
frontend/
  src/
    config/
    constants/
    services/
    utils/
    App.jsx
    main.jsx

backend/
  src/
    config/
    controllers/
    models/
    routes/
    services/
    app.js
    index.js
```

## What changed

- The VS Code style IDE now lives in `frontend/src/App.jsx`
- AI requests are proxied through the Express backend at `/api/ai/messages`
- Workspaces can be stored through `/api/workspaces`
- Review history can be stored through `/api/reviews`
- MongoDB is supported through `MONGODB_URI`
- If MongoDB is not configured, the backend falls back to in-memory storage so local development still works

## Setup

1. Install dependencies:

```bash
npm install
npm install --prefix frontend
npm install --prefix backend
```

2. Create an environment file from `.env.example`

The root `.env` file is used by both the Vite frontend and the Express backend.

3. Start the MERN app:

```bash
npm run dev
```

4. Open the frontend:

```text
http://127.0.0.1:5173
```

5. The API runs at:

```text
http://127.0.0.1:5051
```

## Environment

Use these variables in your `.env` file:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/codesense-ai
PORT=5051
CLIENT_ORIGIN=http://127.0.0.1:5173,http://127.0.0.1:4173
VITE_API_PROXY_TARGET=http://127.0.0.1:5051
```
