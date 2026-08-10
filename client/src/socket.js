import { io } from "socket.io-client";

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

// Doesn't auto-connect: the server rejects any connection without a valid
// account token, so we wait until sign-in (or a restored session) supplies
// one via setAuthToken() before ever opening the socket.
export const socket = io(SERVER_URL, { autoConnect: false });

export function setAuthToken(token) {
  if (!token) {
    socket.disconnect();
    return;
  }
  socket.auth = { token };
  if (socket.connected) socket.disconnect();
  socket.connect();
}
