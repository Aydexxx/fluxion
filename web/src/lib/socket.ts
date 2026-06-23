import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";

const URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

let socket: Socket | null = null;

/**
 * Lazily-created Socket.IO connection to the API. The JWT is supplied via the
 * auth callback so every (re)connection sends the current token — matching the
 * handshake auth the server enforces.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(URL, {
      autoConnect: true,
      auth: (cb) => cb({ token: getToken() ?? "" }),
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
