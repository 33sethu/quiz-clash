# Quiz Clash

A real-time multiplayer general knowledge quiz for 2–8 players.

## Run locally
1. Install Node.js 18 or newer from https://nodejs.org/
2. Open a terminal in this folder.
3. Run `npm install`
4. Run `npm start`
5. Open http://localhost:3000

## Deploy on Render
Create a **Web Service** from this GitHub repository.
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Instance type: Free (if available for your account/region)

Render provides the public URL after deployment.

## Important limitations of this starter version
- Room state is held in server memory. A server restart clears active rooms and scores.
- Free hosting may sleep or restart. This is suitable for a challenge/demo, not guaranteed always-on service.
- The game uses nicknames only; don't enter personal information.
- Reconnection uses a browser session token, and is intended for refresh/reconnect in the same browser session.
- Questions are a fixed general-knowledge set in `server.js`.
