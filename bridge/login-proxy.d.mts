import type { Server } from "node:net";

export function localhostCallbackPort(authUrl: string): number | null;

export function startIpv4LoginProxy(port: number): Server;
