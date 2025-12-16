Victor Flow Backend (Express) — Bearer Token Proxy

Purpose
- Provide hosted endpoints for the Victor Sharp Channel Web App to use Flow Veo3
- Uses Bearer token from VS_FLOW_KEY JSON (access_token: ya29...) via Authorization header

Routes
- POST /api/flow/session/validate
- POST /api/flow/video/generate
- GET  /api/flow/video/status/:jobId
- GET  /api/flow/video/result/:jobId

Environment
- FLOW_BASE_URL=https://labs.google   (AS must confirm official upstream host)

Run locally
1) cd flow_backend_express
2) npm i
3) set FLOW_BASE_URL (optional)
4) npm start
Server listens on PORT (default 3001)

IMPORTANT
- The upstream paths in flowRoutes.js are placeholders:
  /fx/api/auth/session
  /fx/api/veo/generate
  /fx/api/veo/status/:id
  /fx/api/veo/result/:id

AS must replace them with the official Flow Veo3 endpoints.
