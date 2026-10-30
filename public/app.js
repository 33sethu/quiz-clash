const socket = io();
const $ = id => document.getElementById(id);
const screens = ["homeScreen","lobbyScreen","questionScreen","scoreScreen","finishedScreen"];
let myId = null, myToken = null, roomCode = null, isHost = false, currentRoom = null;
let tickHandle = null, toastHandle = null, lastResult = null;

function showScreen(id) {
  screens.forEach(s => $(s).classList.toggle("hidden", s !== id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastHandle);
  toastHandle = setTimeout(() => el.classList.remove("show"), 3500);
}
function showError(message) { $("homeError").textContent = message; toast(message); }
function nickname() { return $("nickname").value.trim().slice(0,18); }
function saveSession() {
  if (roomCode && myToken) {
    try { sessionStorage.setItem("quizClashSession", JSON.stringify({ roomCode, token: myToken, nickname: nickname() })); } catch {}
  }
}
function clearSession() { try { sessionStorage.removeItem("quizClashSession"); } catch {} }
function createRoom() {
  $("homeError").textContent = "";
  if (!nickname()) return showError("Please enter a nickname first.");
  socket.emit("room:create", { nickname: nickname() });
}
function joinRoom() {
  $("homeError").textContent = "";
  if (!nickname()) return showError("Please enter a nickname first.");
  const code = $("roomCode").value.trim().toUpperCase();
  if (!code) return showError("Enter your room code.");
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("quizClashSession") || "null"); } catch { return null; } })();
  socket.emit("room:join", { code, nickname: nickname(), token: saved && saved.roomCode === code ? saved.token : null });
}
$("createBtn").addEventListener("click", createRoom);
$("joinBtn").addEventListener("click", joinRoom);
$("nickname").addEventListener("keydown", e => { if (e.key === "Enter") createRoom(); });
$("roomCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5); });
$("roomCode").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(); });
$("startBtn").addEventListener("click", () => socket.emit("game:start"));
$("copyCodeBtn").addEventListener("click", async () => {
  const url = new URL(location.href); url.searchParams.set("room", roomCode);
  try { await navigator.clipboard.writeText(url.toString()); toast("Invite link copied. Send it to your friends."); }
  catch { toast("Room code: " + roomCode + " — share this code with friends."); }
});
$("rematchBtn").addEventListener("click", () => socket.emit("game:rematch"));
$("homeBtn").addEventListener("click", () => { clearSession(); location.href = location.pathname; });

socket.on("connect", () => {
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem("quizClashSession") || "null"); } catch { return null; } })();
  if (saved && saved.roomCode && saved.token && !roomCode) {
    $("nickname").value = saved.nickname || "";
    socket.emit("room:join", { code: saved.roomCode, nickname: saved.nickname, token: saved.token });
  }
});
socket.on("room:joined", data => {
  roomCode = data.code; myId = data.playerId; myToken = data.token; isHost = data.host;
  $("displayCode").textContent = roomCode;
  $("gameRoomCode").textContent = roomCode;
  saveSession();
  const url = new URL(location.href); url.searchParams.set("room", roomCode); history.replaceState({}, "", url);
  showScreen("lobbyScreen");
});
socket.on("game:error", message => {
  if ($("homeScreen").classList.contains("hidden")) toast(message);
  else showError(message);
});
socket.on("room:update", room => {
  currentRoom = room;
  roomCode = room.code;
  $("displayCode").textContent = room.code;
  $("gameRoomCode").textContent = room.code;
  renderPlayers(room.players, room.hostId);
  if (room.status === "lobby") {
    $("startBtn").classList.toggle("hidden", room.hostId !== myId);
    $("lobbyHint").textContent = room.players.filter(p => p.connected).length < 2 ? "At least 2 connected players are needed to start." : (room.hostId === myId ? "Everyone is here? Start when you're ready." : "Waiting for the host to start the quiz.");
    showScreen("lobbyScreen");
  } else if (room.status === "question" && room.question) {
    renderQuestion(room);
    showScreen("questionScreen");
  } else if (room.status === "scoreboard") {
    showScreen("scoreScreen");
  } else if (room.status === "finished") {
    showFinal(room.players, room.hostId);
  }
});
function renderPlayers(players, hostId) {
  $("playerCount").textContent = players.length + "/8";
  $("playersList").innerHTML = players.map((p,i) => `<div class="player-chip"><span class="avatar">${escapeHtml(p.nickname.slice(0,1).toUpperCase())}</span><span class="player-name">${escapeHtml(p.nickname)}${p.connected ? "" : " (reconnecting)"}</span>${p.id === hostId ? '<span class="host-tag">HOST</span>' : ""}</div>`).join("");
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function renderQuestion(room) {
  $("questionCount").textContent = `QUESTION ${room.questionIndex + 1} OF ${room.totalQuestions}`;
  $("questionText").textContent = room.question.text;
  $("answersGrid").innerHTML = room.question.options.map((option,i) => `<button class="answer-btn" data-index="${i}"><span class="answer-letter">${"ABCD"[i]}</span><span>${escapeHtml(option)}</span></button>`).join("");
  $("answersGrid").querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
    if (btn.disabled) return;
    $("answersGrid").querySelectorAll("button").forEach(b => b.disabled = true);
    btn.classList.add("selected");
    $("answerStatus").textContent = "Answer submitted. Good luck!";
    socket.emit("answer:submit", { answerIndex: Number(btn.dataset.index) });
  }));
  $("answerStatus").textContent = "Choose your answer.";
  startTimer(room.deadline);
  renderMiniScores(room.players);
}
function startTimer(deadline) {
  clearInterval(tickHandle);
  const update = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    $("timerText").textContent = left;
    $("timerRing").classList.toggle("urgent", left <= 5);
    if (left <= 0) clearInterval(tickHandle);
  };
  update(); tickHandle = setInterval(update, 150);
}
function renderMiniScores(players) {
  $("miniScores").innerHTML = [...players].sort((a,b) => b.score-a.score).map(p => `<span class="mini-score">${escapeHtml(p.nickname)} <b>${p.score}</b></span>`).join("");
}
socket.on("answer:progress", data => {
  $("answeredText").textContent = `${data.answeredCount} answered`;
});
socket.on("question:result", result => {
  lastResult = result;
  clearInterval(tickHandle);
  $("correctAnswerText").textContent = "Correct answer: " + result.correctAnswer;
  $("scoreTitle").textContent = `After question ${currentRoom ? currentRoom.questionIndex + 1 : ""}`;
  const buttons = $("answersGrid").querySelectorAll("button");
  buttons.forEach((b,i) => {
    b.disabled = true;
    if (i === result.correctIndex) b.classList.add("correct");
    else if (b.classList.contains("selected")) b.classList.add("wrong");
  });
  $("answerStatus").textContent = "Question complete.";
  renderScoreList($("scoreList"), result.players);
  showScreen("scoreScreen");
});
socket.on("scoreboard", data => {
  renderScoreList($("scoreList"), data.players);
  renderScoreList($("finalList"), data.players);
  if (data.finished) showFinal(data.players, currentRoom && currentRoom.hostId);
});
function renderScoreList(target, players) {
  target.innerHTML = [...players].sort((a,b) => b.score-a.score || a.nickname.localeCompare(b.nickname)).map((p,i) => `<div class="score-row"><span class="rank ${i===0?"first":""}">${i+1}</span><span class="score-name">${escapeHtml(p.nickname)}${p.connected ? "" : " (offline)"}</span><span class="score-points">${p.score} pts</span></div>`).join("");
}
function showFinal(players, hostId) {
  clearInterval(tickHandle);
  const ranked = [...players].sort((a,b) => b.score-a.score || a.nickname.localeCompare(b.nickname));
  $("winnerTitle").textContent = ranked.length ? `${ranked[0].nickname} wins!` : "Quiz complete!";
  $("winnerSubtitle").textContent = ranked.length ? `With ${ranked[0].score} points. Great game, everyone.` : "Thanks for playing.";
  $("rematchBtn").classList.toggle("hidden", hostId !== myId);
  renderScoreList($("finalList"), ranked);
  showScreen("finishedScreen");
}
const params = new URLSearchParams(location.search);
if (params.get("room")) $("roomCode").value = params.get("room").toUpperCase().slice(0,5);
