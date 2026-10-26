import { io } from "socket.io-client";

export const SOCKET_URL =
  process.env.REACT_APP_SOCKET_URL ||
  "https://zerodha-production-production.up.railway.app";

// Singleton socket connection shared across all components
export const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

export default socket;
