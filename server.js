const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const QUESTIONS = [
  { q: "Which planet is known as the Red Planet?", a: ["Venus", "Mars", "Jupiter", "Mercury"], correct: 1 },
  { q: "What is the largest ocean on Earth?", a: ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean", "Arctic Ocean"], correct: 2 },
  { q: "How many sides does a hexagon have?", a: ["Five", "Six", "Seven", "Eight"], correct: 1 },
  { q: "Which animal is the largest mammal?", a: ["African elephant", "Blue whale", "Giraffe", "Great white shark"], correct: 1 },
  { q: "What is the capital city of Japan?", a: ["Kyoto", "Osaka", "Tokyo", "Hiroshima"], correct: 2 },
  { q: "Which gas do plants absorb from the atmosphere?", a: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correct: 2 },
  { q: "How many colours are traditionally named in a rainbow?", a: ["Five", "Six", "Seven", "Eight"], correct: 2 },
  { q: "Which instrument is used to measure temperature?", a: ["Barometer", "Thermometer", "Compass", "Altimeter"], correct: 1 },
  { q: "Which continent is the Sahara Desert in?", a: ["Asia", "South America", "Africa", "Australia"], correct: 2 },
  { q: "What is the process by which water changes into vapour called?", a: ["Condensation", "Freezing", "Evaporation", "Melting"], correct: 2 }
];

const rooms = new Map();
const timers = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function cleanName(value) {
  return String(value || "").trim().replace(/[<>]/g, "").slice(0, 18);
}
function clearRoomTimer(code) {
  if (timers.has(code)) clearTimeout(timers.get(code));
  timers.delete(code);
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, nickname: p.nickname, score: p.score, connected: p.connected
  })).sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
}
function snapshot(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("room:update", {
    code, hostId: room.hostId, status: room.status,
    players: publicPlayers(room), questionIndex: room.questionIndex,
    totalQuestions: QUESTIONS.length, deadline: room.deadline,
    question: room.status === "question" ? {
      text: QUESTIONS[room.questionIndex].q,
      options: QUESTIONS[room.questionIndex].a
    } : null,
    answeredCount: room.status === "question" ? room.answers.size : 0
  });
}
function scoreboard(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("scoreboard", {
    players: publicPlayers(room),
    questionNumber: Math.min(room.questionIndex + 1, QUESTIONS.length),
    totalQuestions: QUESTIONS.length,
    finished: room.status === "finished"
  });
}
function endQuestion(code) {
  const room = rooms.get(code);
  if (!room || room.status !== "question") return;
  clearRoomTimer(code);
  room.status = "scoreboard";
  room.deadline = null;
  const q = QUESTIONS[room.questionIndex];
  io.to(code).emit("question:result", {
    correctIndex: q.correct,
    correctAnswer: q.a[q.correct],
    players: publicPlayers(room)
  });
  snapshot(code);
  scoreboard(code);
  room.nextTimer = setTimeout(() => {
    if (!rooms.has(code)) return;
    if (room.questionIndex >= QUESTIONS.length - 1) {
      room.status = "finished";
      snapshot(code);
      scoreboard(code);
    } else {
      room.questionIndex += 1;
      startQuestion(code);
    }
  }, 4500);
}
function startQuestion(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.nextTimer) clearTimeout(room.nextTimer);
  room.nextTimer = null;
  room.status = "question";
  room.answers = new Set();
  room.deadline = Date.now() + 15000;
  snapshot(code);
  scoreboard(code);
  timers.set(code, setTimeout(() => endQuestion(code), 15000));
}
function createRoom(socket, nickname) {
  const code = makeCode();
  const player = { id: socket.id, nickname, score: 0, connected: true, token: crypto.randomUUID() };
  const room = {
    code, hostId: socket.id, players: new Map([[socket.id, player]]),
    status: "lobby", questionIndex: -1, answers: new Set(), deadline: null,
    nextTimer: null, createdAt: Date.now()
  };
  rooms.set(code, room);
  socket.join(code);
  socket.data.code = code;
  socket.data.token = player.token;
  socket.emit("room:joined", { code, playerId: socket.id, token: player.token, host: true });
  snapshot(code);
}
function removePlayer(socket) {
  const code = socket.data.code;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  const player = room.players.get(socket.id);
  if (player) {
    player.connected = false;
    player.socketId = socket.id;
    // Keep disconnected players briefly so a refresh can reconnect.
    player.disconnectedAt = Date.now();
  }
  if (room.hostId === socket.id) {
    const next = [...room.players.values()].find(p => p.connected);
    if (next) room.hostId = next.id;
  }
  snapshot(code);
  setTimeout(() => {
    const current = rooms.get(code);
    if (!current) return;
    const old = [...current.players.entries()].find(([, p]) => p.id === socket.id && !p.connected);
    if (old && Date.now() - (old[1].disconnectedAt || 0) >= 60000) {
      current.players.delete(old[0]);
      if (current.hostId === old[0]) {
        const next = [...current.players.values()].find(p => p.connected);
        current.hostId = next ? next.id : null;
      }
      if (current.players.size === 0) {
        clearRoomTimer(code);
        if (current.nextTimer) clearTimeout(current.nextTimer);
        rooms.delete(code);
      } else snapshot(code);
    }
  }, 61000);
  socket.data.code = null;
}
io.on("connection", socket => {
  socket.on("room:create", ({ nickname } = {}) => {
    nickname = cleanName(nickname);
    if (!nickname) return socket.emit("game:error", "Please enter a nickname.");
    createRoom(socket, nickname);
  });

  socket.on("room:join", ({ code, nickname, token } = {}) => {
    code = String(code || "").trim().toUpperCase();
    nickname = cleanName(nickname);
    const room = rooms.get(code);
    if (!nickname) return socket.emit("game:error", "Please enter a nickname.");
    if (!room) return socket.emit("game:error", "Room not found. Check the code and try again.");
    if (room.status !== "lobby" && !token) return socket.emit("game:error", "This game has already started.");
    if (token) {
      const oldEntry = [...room.players.entries()].find(([, p]) => p.token === token);
      if (oldEntry) {
        const [oldId, player] = oldEntry;
        room.players.delete(oldId);
        player.id = socket.id;
        player.nickname = nickname || player.nickname;
        player.connected = true;
        player.disconnectedAt = null;
        room.players.set(socket.id, player);
        if (room.hostId === oldId) room.hostId = socket.id;
        socket.join(code);
        socket.data.code = code;
        socket.data.token = token;
        socket.emit("room:joined", { code, playerId: socket.id, token, host: room.hostId === socket.id });
        snapshot(code);
        if (room.status === "question") {
          const q = QUESTIONS[room.questionIndex];
          socket.emit("room:update", { code, hostId: room.hostId, status: room.status,
            players: publicPlayers(room), questionIndex: room.questionIndex,
            totalQuestions: QUESTIONS.length, deadline: room.deadline,
            question: { text: q.q, options: q.a }, answeredCount: room.answers.size });
        }
        return;
      }
    }
    if (room.status !== "lobby") return socket.emit("game:error", "A new player cannot join after the game starts.");
    if (room.players.size >= 8) return socket.emit("game:error", "This room is full (maximum 8 players).");
    if ([...room.players.values()].some(p => p.connected && p.nickname.toLowerCase() === nickname.toLowerCase()))
      return socket.emit("game:error", "That nickname is already in use in this room.");
    const player = { id: socket.id, nickname, score: 0, connected: true, token: crypto.randomUUID() };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.code = code;
    socket.data.token = player.token;
    socket.emit("room:joined", { code, playerId: socket.id, token: player.token, host: false });
    snapshot(code);
  });

  socket.on("game:start", () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id) return socket.emit("game:error", "Only the host can start the game.");
    if (room.status !== "lobby" || [...room.players.values()].filter(p => p.connected).length < 2)
      return socket.emit("game:error", "At least 2 connected players are needed to start.");
    room.questionIndex = 0;
    for (const p of room.players.values()) p.score = 0;
    startQuestion(room.code);
  });

  socket.on("answer:submit", ({ answerIndex } = {}) => {
    const code = socket.data.code;
    const room = rooms.get(code);
    if (!room || room.status !== "question") return;
    const player = room.players.get(socket.id);
    if (!player || !player.connected || room.answers.has(socket.id)) return;
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return;
    if (Date.now() > room.deadline) return;
    room.answers.add(socket.id);
    const q = QUESTIONS[room.questionIndex];
    if (answerIndex === q.correct) {
      const remaining = Math.max(0, room.deadline - Date.now());
      const bonus = Math.floor((remaining / 15000) * 50);
      player.score += 100 + bonus;
    }
    io.to(code).emit("answer:progress", { answeredCount: room.answers.size,
      connectedCount: [...room.players.values()].filter(p => p.connected).length });
    if (room.answers.size >= [...room.players.values()].filter(p => p.connected).length) endQuestion(code);
  });

  socket.on("game:rematch", () => {
    const room = rooms.get(socket.data.code);
    if (!room || room.hostId !== socket.id || room.status !== "finished") return;
    if ([...room.players.values()].filter(p => p.connected).length < 2)
      return socket.emit("game:error", "At least 2 connected players are needed for another round.");
    room.status = "lobby";
    room.questionIndex = -1;
    room.deadline = null;
    room.answers = new Set();
    room.players.forEach(p => p.score = 0);
    snapshot(room.code);
  });

  socket.on("disconnect", () => removePlayer(socket));
});

app.get("/health", (_req, res) => res.json({ ok: true }));
server.listen(PORT, "0.0.0.0", () => console.log(`Quiz Clash listening on ${PORT}`));
