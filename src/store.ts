import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DeployedServer } from "./types.js";

const HOSTY_DIR = join(homedir(), ".hosty");
const SERVERS_FILE = join(HOSTY_DIR, "servers.json");

interface Store {
  servers: Record<string, DeployedServer>;
}

async function ensureDir(): Promise<void> {
  await mkdir(HOSTY_DIR, { recursive: true });
}

async function load(): Promise<Store> {
  try {
    const data = await readFile(SERVERS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return { servers: {} };
  }
}

async function save(store: Store): Promise<void> {
  await ensureDir();
  await writeFile(SERVERS_FILE, JSON.stringify(store, null, 2));
}

export async function saveServer(server: DeployedServer): Promise<void> {
  const store = await load();
  store.servers[server.name] = server;
  await save(store);
}

export async function getServer(name: string): Promise<DeployedServer | null> {
  const store = await load();
  return store.servers[name] || null;
}

export async function listServers(): Promise<DeployedServer[]> {
  const store = await load();
  return Object.values(store.servers);
}

export async function removeServer(name: string): Promise<boolean> {
  const store = await load();
  if (store.servers[name]) {
    delete store.servers[name];
    await save(store);
    return true;
  }
  return false;
}
