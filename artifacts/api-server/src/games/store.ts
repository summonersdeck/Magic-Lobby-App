import { customAlphabet } from "nanoid";
import { eq, and, lt, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { gamesTable, gameTokensTable } from "@workspace/db/schema";

export type GameStatus = "waiting" | "active" | "ended";

export type ManaPool = {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
};

export type Player = {
  id: string;
  name: string;
  life: number;
  isHost: boolean;
  isConnected: boolean;
  isEliminated: boolean;
  position: number;
  color: string;
  commanderTax: number;
  commanderName: string;
  manaPool: ManaPool;
  poisonCounters: number;
  experienceCounters: number;
};

export type CommanderDamageEntry = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
};

export type GameLogKind =
  | "lifeChanged"
  | "commanderDamage"
  | "turnAdvanced"
  | "playerJoined"
  | "playerLeft"
  | "playerEliminated"
  | "gameStarted"
  | "gameReset"
  | "roll"
  | "orderRandomized"
  | "commanderNameSet"
  | "commanderTaxUpdated"
  | "poisonCounterUpdated"
  | "experienceCounterUpdated"
  | "playerRevived";

export type GameLogEntry = {
  id: string;
  at: string;
  kind: GameLogKind;
  message: string;
  actorId?: string;
  targetId?: string;
  amount?: number;
};

export type Game = {
  id: string;
  code: string;
  status: GameStatus;
  startingLife: number;
  turnNumber: number;
  currentTurnPlayerId: string | null;
  hostId: string;
  players: Player[];
  commanderDamage: CommanderDamageEntry[];
  log: GameLogEntry[];
  createdAt: string;
  // server-only — kept in-memory, stored separately in game_tokens table
  tokens: Map<string, string>; // token -> playerId
};

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

type StoredGameState = Omit<Game, "tokens">;

function gameToState(game: Game): StoredGameState {
  const { tokens: _tokens, ...rest } = game;
  return rest;
}

// ---------------------------------------------------------------------------
// In-memory write-through cache (survives within a single process lifetime)
// ---------------------------------------------------------------------------

const cacheByCode = new Map<string, Game>();
const cacheById = new Map<string, Game>();

function cacheSet(game: Game): void {
  cacheByCode.set(game.code, game);
  cacheById.set(game.id, game);
}

// ---------------------------------------------------------------------------
// DB persistence helpers
// ---------------------------------------------------------------------------

async function dbSave(game: Game): Promise<void> {
  await db
    .update(gamesTable)
    .set({ state: gameToState(game) as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(gamesTable.id, game.id));
}

async function loadFromDbByCode(code: string): Promise<Game | undefined> {
  const rows = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.code, code))
    .limit(1);
  if (!rows[0]) return undefined;
  const state = rows[0].state as StoredGameState;
  const tokenRows = await db
    .select({ token: gameTokensTable.token, playerId: gameTokensTable.playerId })
    .from(gameTokensTable)
    .where(eq(gameTokensTable.gameId, rows[0].id));
  const tokens = new Map<string, string>(tokenRows.map((r) => [r.token, r.playerId]));
  return { ...state, tokens };
}

async function loadFromDbById(id: string): Promise<Game | undefined> {
  const rows = await db
    .select()
    .from(gamesTable)
    .where(eq(gamesTable.id, id))
    .limit(1);
  if (!rows[0]) return undefined;
  const state = rows[0].state as StoredGameState;
  const tokenRows = await db
    .select({ token: gameTokensTable.token, playerId: gameTokensTable.playerId })
    .from(gameTokensTable)
    .where(eq(gameTokensTable.gameId, id));
  const tokens = new Map<string, string>(tokenRows.map((r) => [r.token, r.playerId]));
  return { ...state, tokens };
}

// ---------------------------------------------------------------------------
// Constants / generators
// ---------------------------------------------------------------------------

const PLAYER_COLORS = [
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#3b82f6",
  "#ec4899",
  "#14b8a6",
  "#84cc16",
];

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const generateCode = customAlphabet(codeAlphabet, 4);
const generateId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 16);
const generateToken = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  32,
);

const MAX_PLAYERS = 8;
const MAX_LOG = 200;

function nextColor(game: Game): string {
  const used = new Set(game.players.map((p) => p.color));
  for (const c of PLAYER_COLORS) {
    if (!used.has(c)) return c;
  }
  return PLAYER_COLORS[game.players.length % PLAYER_COLORS.length]!;
}

function nextPosition(game: Game): number {
  const used = new Set(game.players.map((p) => p.position));
  for (let i = 0; i < MAX_PLAYERS; i += 1) {
    if (!used.has(i)) return i;
  }
  return game.players.length;
}

function appendLog(game: Game, entry: Omit<GameLogEntry, "id" | "at">): void {
  game.log.unshift({
    id: generateId(),
    at: new Date().toISOString(),
    ...entry,
  });
  if (game.log.length > MAX_LOG) {
    game.log.length = MAX_LOG;
  }
}

async function uniqueCode(): Promise<string> {
  for (let attempts = 0; attempts < 50; attempts += 1) {
    const c = generateCode();
    if (!cacheByCode.has(c)) {
      const existing = await db
        .select({ id: gamesTable.id })
        .from(gamesTable)
        .where(eq(gamesTable.code, c))
        .limit(1);
      if (!existing[0]) return c;
    }
  }
  throw new Error("Could not allocate unique game code");
}

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

export async function createGame(input: {
  hostName: string;
  startingLife?: number;
}): Promise<{ game: Game; player: Player; token: string }> {
  const startingLife = input.startingLife ?? 40;
  const code = await uniqueCode();
  const id = generateId();
  const hostPlayer: Player = {
    id: generateId(),
    name: input.hostName.trim().slice(0, 32) || "Host",
    life: startingLife,
    isHost: true,
    isConnected: false,
    isEliminated: false,
    position: 0,
    color: PLAYER_COLORS[0]!,
    commanderTax: 0,
    commanderName: "",
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    poisonCounters: 0,
    experienceCounters: 0,
  };
  const token = generateToken();
  const game: Game = {
    id,
    code,
    status: "waiting",
    startingLife,
    turnNumber: 0,
    currentTurnPlayerId: null,
    hostId: hostPlayer.id,
    players: [hostPlayer],
    commanderDamage: [],
    log: [],
    createdAt: new Date().toISOString(),
    tokens: new Map([[token, hostPlayer.id]]),
  };
  appendLog(game, {
    kind: "playerJoined",
    message: `${hostPlayer.name} created the lobby`,
    actorId: hostPlayer.id,
  });

  await db.insert(gamesTable).values({
    id,
    code,
    state: gameToState(game) as Record<string, unknown>,
  });
  await db
    .insert(gameTokensTable)
    .values({ token, gameId: id, playerId: hostPlayer.id });

  cacheSet(game);
  return { game, player: hostPlayer, token };
}

export async function joinGame(
  code: string,
  input: { name: string },
): Promise<
  | { game: Game; player: Player; token: string }
  | { error: string; status: number }
> {
  const game = await getGameByCode(code.toUpperCase());
  if (!game) return { error: "Game not found", status: 404 };
  if (game.status === "ended") return { error: "Game has ended", status: 409 };
  if (game.players.length >= MAX_PLAYERS)
    return { error: "Lobby is full", status: 409 };

  const name = input.name.trim().slice(0, 32) || "Player";
  const player: Player = {
    id: generateId(),
    name,
    life: game.startingLife,
    isHost: false,
    isConnected: false,
    isEliminated: false,
    position: nextPosition(game),
    color: nextColor(game),
    commanderTax: 0,
    commanderName: "",
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    poisonCounters: 0,
    experienceCounters: 0,
  };
  game.players.push(player);
  appendLog(game, {
    kind: "playerJoined",
    message: `${player.name} joined`,
    actorId: player.id,
  });
  const token = generateToken();
  game.tokens.set(token, player.id);

  await dbSave(game);
  await db
    .insert(gameTokensTable)
    .values({ token, gameId: game.id, playerId: player.id });

  return { game, player, token };
}

export async function getGameByCode(code: string): Promise<Game | undefined> {
  const cached = cacheByCode.get(code);
  if (cached) return cached;
  const game = await loadFromDbByCode(code);
  if (game) cacheSet(game);
  return game;
}

export async function getGameById(id: string): Promise<Game | undefined> {
  const cached = cacheById.get(id);
  if (cached) return cached;
  const game = await loadFromDbById(id);
  if (game) cacheSet(game);
  return game;
}

export async function resolveToken(
  token: string,
): Promise<{ game: Game; player: Player } | undefined> {
  for (const game of cacheByCode.values()) {
    const playerId = game.tokens.get(token);
    if (playerId) {
      const player = game.players.find((p) => p.id === playerId);
      if (player) return { game, player };
    }
  }
  const rows = await db
    .select()
    .from(gameTokensTable)
    .where(eq(gameTokensTable.token, token))
    .limit(1);
  if (!rows[0]) return undefined;
  const game = await getGameById(rows[0].gameId);
  if (!game) return undefined;
  const player = game.players.find((p) => p.id === rows[0]!.playerId);
  if (!player) return undefined;
  return { game, player };
}

// ---------------------------------------------------------------------------
// Elimination check (sync — only mutates in-memory, caller must dbSave)
// ---------------------------------------------------------------------------

function checkElimination(game: Game, player: Player): boolean {
  if (player.isEliminated) return false;
  let eliminated = false;
  if (player.life <= 0) eliminated = true;
  if (!eliminated && player.poisonCounters >= 10) eliminated = true;
  if (!eliminated) {
    for (const entry of game.commanderDamage) {
      if (entry.toPlayerId === player.id && entry.amount >= 21) {
        eliminated = true;
        break;
      }
    }
  }
  if (eliminated) {
    player.isEliminated = true;
    appendLog(game, {
      kind: "playerEliminated",
      message: `${player.name} was eliminated`,
      targetId: player.id,
    });
    const alive = game.players.filter((p) => !p.isEliminated);
    if (alive.length <= 1) {
      game.status = "ended";
      const winner = alive[0];
      if (winner) {
        appendLog(game, {
          kind: "gameStarted",
          message: `${winner.name} wins the game`,
          actorId: winner.id,
        });
      }
    }
  }
  return eliminated;
}

// ---------------------------------------------------------------------------
// Mutation functions — mutate in-memory then persist
// ---------------------------------------------------------------------------

export async function updateLife(
  game: Game,
  actor: Player,
  targetId: string,
  delta: number,
): Promise<void> {
  if (!Number.isFinite(delta)) return;
  const target = game.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!actor.isHost && actor.id !== target.id) return;
  if (target.isEliminated) return;
  const clamped = Math.max(-50, Math.min(50, Math.trunc(delta)));
  target.life += clamped;
  appendLog(game, {
    kind: "lifeChanged",
    message: `${target.name} ${clamped >= 0 ? "+" : ""}${clamped} life (now ${target.life})`,
    actorId: actor.id,
    targetId: target.id,
    amount: clamped,
  });
  checkElimination(game, target);
  await dbSave(game);
}

export async function setCommanderDamage(
  game: Game,
  actor: Player,
  fromPlayerId: string,
  toPlayerId: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount)) return;
  const from = game.players.find((p) => p.id === fromPlayerId);
  const to = game.players.find((p) => p.id === toPlayerId);
  if (!from || !to) return;
  if (from.id === to.id) return;
  if (!actor.isHost && actor.id !== from.id && actor.id !== to.id) return;
  if (to.isEliminated) return;
  const next = Math.max(0, Math.min(99, Math.trunc(amount)));
  const existing = game.commanderDamage.find(
    (e) => e.fromPlayerId === from.id && e.toPlayerId === to.id,
  );
  const prev = existing?.amount ?? 0;
  const delta = next - prev;
  if (delta === 0) return;
  if (existing) {
    existing.amount = next;
  } else {
    game.commanderDamage.push({
      fromPlayerId: from.id,
      toPlayerId: to.id,
      amount: next,
    });
  }
  if (delta > 0) {
    to.life -= delta;
    appendLog(game, {
      kind: "commanderDamage",
      message: `${from.name} dealt ${delta} commander damage to ${to.name} (${next} total)`,
      actorId: actor.id,
      targetId: to.id,
      amount: delta,
    });
  } else {
    appendLog(game, {
      kind: "commanderDamage",
      message: `Commander damage from ${from.name} on ${to.name} set to ${next}`,
      actorId: actor.id,
      targetId: to.id,
      amount: delta,
    });
  }
  checkElimination(game, to);
  await dbSave(game);
}

export async function startGame(game: Game, actor: Player): Promise<void> {
  if (!actor.isHost) return;
  if (game.status !== "waiting") return;
  game.status = "active";
  game.turnNumber = 1;
  const order = [...game.players].sort((a, b) => a.position - b.position);
  const first = order.find((p) => !p.isEliminated) ?? order[0];
  game.currentTurnPlayerId = first?.id ?? game.hostId;
  appendLog(game, {
    kind: "gameStarted",
    message: `Game started — ${first?.name ?? "Host"} goes first`,
    actorId: actor.id,
  });
  await dbSave(game);
}

export async function randomizeOrder(game: Game, actor: Player): Promise<void> {
  if (!actor.isHost) return;
  if (game.status !== "waiting") return;
  if (game.players.length < 2) return;
  const positions = game.players.map((_, i) => i);
  for (let i = positions.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = positions[i]!;
    positions[i] = positions[j]!;
    positions[j] = tmp;
  }
  game.players.forEach((p, i) => {
    p.position = positions[i]!;
  });
  const ordered = [...game.players].sort((a, b) => a.position - b.position);
  appendLog(game, {
    kind: "orderRandomized",
    message: `Turn order randomized: ${ordered.map((p) => p.name).join(" → ")}`,
    actorId: actor.id,
  });
  await dbSave(game);
}

export async function nextTurn(game: Game, actor: Player): Promise<void> {
  if (game.status !== "active") return;
  if (!actor.isHost && actor.id !== game.currentTurnPlayerId) return;
  const outgoing = game.players.find((p) => p.id === game.currentTurnPlayerId);
  if (outgoing) clearMana(outgoing);
  const order = [...game.players].sort((a, b) => a.position - b.position);
  const aliveOrder = order.filter((p) => !p.isEliminated);
  if (aliveOrder.length === 0) return;
  const currentIdx = aliveOrder.findIndex(
    (p) => p.id === game.currentTurnPlayerId,
  );
  const nextIdx =
    currentIdx === -1 ? 0 : (currentIdx + 1) % aliveOrder.length;
  const nextPlayer = aliveOrder[nextIdx]!;
  game.currentTurnPlayerId = nextPlayer.id;
  game.turnNumber += 1;
  appendLog(game, {
    kind: "turnAdvanced",
    message: `Turn ${game.turnNumber} — ${nextPlayer.name}`,
    actorId: actor.id,
    targetId: nextPlayer.id,
  });
  await dbSave(game);
}

export async function setTurn(
  game: Game,
  actor: Player,
  playerId: string,
): Promise<void> {
  if (!actor.isHost) return;
  if (game.status !== "active") return;
  const target = game.players.find((p) => p.id === playerId);
  if (!target || target.isEliminated) return;
  const outgoing = game.players.find((p) => p.id === game.currentTurnPlayerId);
  if (outgoing) clearMana(outgoing);
  game.currentTurnPlayerId = target.id;
  appendLog(game, {
    kind: "turnAdvanced",
    message: `Turn passed to ${target.name}`,
    actorId: actor.id,
    targetId: target.id,
  });
  await dbSave(game);
}

export async function updatePoisonCounters(
  game: Game,
  actor: Player,
  targetId: string,
  delta: number,
): Promise<void> {
  const target = game.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!actor.isHost && actor.id !== target.id) return;
  const next = Math.max(0, Math.min(99, target.poisonCounters + delta));
  if (next === target.poisonCounters) return;
  target.poisonCounters = next;
  appendLog(game, {
    kind: "poisonCounterUpdated",
    message: `${target.name} has ${next} poison counter${next !== 1 ? "s" : ""}`,
    actorId: actor.id,
    targetId: target.id,
    amount: next,
  });
  checkElimination(game, target);
  await dbSave(game);
}

export async function updateExperienceCounters(
  game: Game,
  actor: Player,
  targetId: string,
  delta: number,
): Promise<void> {
  const target = game.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!actor.isHost && actor.id !== target.id) return;
  const next = Math.max(0, target.experienceCounters + delta);
  if (next === target.experienceCounters) return;
  target.experienceCounters = next;
  appendLog(game, {
    kind: "experienceCounterUpdated",
    message: `${target.name} has ${next} experience counter${next !== 1 ? "s" : ""}`,
    actorId: actor.id,
    targetId: target.id,
    amount: next,
  });
  await dbSave(game);
}

export async function revivePlayer(
  game: Game,
  actor: Player,
  targetId: string,
): Promise<void> {
  if (!actor.isHost) return;
  const target = game.players.find((p) => p.id === targetId);
  if (!target || !target.isEliminated) return;
  target.isEliminated = false;
  target.life = Math.max(1, game.startingLife);
  target.poisonCounters = 0;
  if (game.status === "ended") game.status = "active";
  appendLog(game, {
    kind: "playerRevived",
    message: `${target.name} was revived (mistake corrected)`,
    actorId: actor.id,
    targetId: target.id,
  });
  await dbSave(game);
}

export async function resetGame(game: Game, actor: Player): Promise<void> {
  if (!actor.isHost) return;
  for (const p of game.players) {
    p.life = game.startingLife;
    p.isEliminated = false;
    p.commanderTax = 0;
    p.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    p.poisonCounters = 0;
    p.experienceCounters = 0;
  }
  game.commanderDamage = [];
  game.status = "waiting";
  game.turnNumber = 0;
  game.currentTurnPlayerId = null;
  game.log = [];
  appendLog(game, {
    kind: "gameReset",
    message: "Game reset to starting state",
    actorId: actor.id,
  });
  await dbSave(game);
}

export async function kickPlayer(
  game: Game,
  actor: Player,
  playerId: string,
): Promise<{ kickedTokens: string[] }> {
  if (!actor.isHost) return { kickedTokens: [] };
  if (playerId === game.hostId) return { kickedTokens: [] };
  const target = game.players.find((p) => p.id === playerId);
  if (!target) return { kickedTokens: [] };

  game.players = game.players.filter((p) => p.id !== playerId);
  game.commanderDamage = game.commanderDamage.filter(
    (e) => e.fromPlayerId !== playerId && e.toPlayerId !== playerId,
  );
  if (game.currentTurnPlayerId === playerId) {
    const order = [...game.players].sort((a, b) => a.position - b.position);
    const alive = order.find((p) => !p.isEliminated);
    game.currentTurnPlayerId = alive?.id ?? null;
  }

  const kickedTokens: string[] = [];
  for (const [token, pid] of game.tokens.entries()) {
    if (pid === playerId) {
      kickedTokens.push(token);
      game.tokens.delete(token);
    }
  }

  appendLog(game, {
    kind: "playerLeft",
    message: `${target.name} was removed from the lobby`,
    actorId: actor.id,
    targetId: playerId,
  });

  await dbSave(game);
  await db
    .delete(gameTokensTable)
    .where(
      and(
        eq(gameTokensTable.gameId, game.id),
        eq(gameTokensTable.playerId, playerId),
      ),
    );

  return { kickedTokens };
}

export async function setStartingLife(
  game: Game,
  actor: Player,
  value: number,
): Promise<void> {
  if (!actor.isHost) return;
  if (game.status !== "waiting") return;
  if (!Number.isFinite(value)) return;
  const next = Math.max(1, Math.min(100, Math.trunc(value)));
  game.startingLife = next;
  for (const p of game.players) p.life = next;
  await dbSave(game);
}

export type RollKind = "coin" | "d6" | "d20";

export async function rollDice(
  game: Game,
  actor: Player,
  kind: RollKind,
): Promise<void> {
  let result: string;
  let amount: number;
  switch (kind) {
    case "coin": {
      const flip = Math.random() < 0.5 ? "Heads" : "Tails";
      result = `flipped a coin → ${flip}`;
      amount = flip === "Heads" ? 1 : 0;
      break;
    }
    case "d6": {
      amount = 1 + Math.floor(Math.random() * 6);
      result = `rolled D6 → ${amount}`;
      break;
    }
    case "d20": {
      amount = 1 + Math.floor(Math.random() * 20);
      result = `rolled D20 → ${amount}`;
      break;
    }
    default:
      return;
  }
  appendLog(game, {
    kind: "roll",
    message: `${actor.name} ${result}`,
    actorId: actor.id,
    amount,
  });
  await dbSave(game);
}

function clearMana(player: Player): void {
  player.manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export type ManaColor = keyof ManaPool;

export async function updateCommanderTax(
  game: Game,
  actor: Player,
  targetId: string,
  delta: number,
): Promise<void> {
  const target = game.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!actor.isHost && actor.id !== target.id) return;
  const next = Math.max(0, target.commanderTax + delta);
  target.commanderTax = next;
  appendLog(game, {
    kind: "commanderTaxUpdated",
    message: `${target.name}'s commander tax is now ${next}`,
    actorId: actor.id,
    targetId: target.id,
    amount: next,
  });
  await dbSave(game);
}

export async function setCommanderName(
  game: Game,
  actor: Player,
  targetId: string,
  commanderName: string,
): Promise<void> {
  const target = game.players.find((p) => p.id === targetId);
  if (!target) return;
  if (!actor.isHost && actor.id !== target.id) return;
  const trimmed = commanderName.trim().slice(0, 64);
  target.commanderName = trimmed;
  if (trimmed) {
    appendLog(game, {
      kind: "commanderNameSet",
      message: `${target.name}'s commander is ${trimmed}`,
      actorId: actor.id,
      targetId: target.id,
    });
  }
  await dbSave(game);
}

export async function updateMana(
  game: Game,
  actor: Player,
  color: ManaColor,
  delta: number,
): Promise<void> {
  if (game.status !== "active") return;
  if (actor.id !== game.currentTurnPlayerId && !actor.isHost) return;
  const target = game.players.find((p) => p.id === game.currentTurnPlayerId);
  if (!target) return;
  const COLORS: ManaColor[] = ["W", "U", "B", "R", "G", "C"];
  if (!COLORS.includes(color)) return;
  target.manaPool[color] = Math.max(0, target.manaPool[color] + delta);
  await dbSave(game);
}

export type GameSummary = {
  id: string;
  code: string;
  status: GameStatus;
  playerCount: number;
  hostName: string;
  startingLife: number;
  createdAt: string;
  updatedAt: string;
};

export async function listRecentGames(limit = 50): Promise<GameSummary[]> {
  const rows = await db
    .select()
    .from(gamesTable)
    .orderBy(desc(gamesTable.updatedAt))
    .limit(limit);

  return rows.map((row) => {
    const state = row.state as StoredGameState;
    return {
      id: row.id,
      code: row.code,
      status: state.status,
      playerCount: state.players.length,
      hostName:
        state.players.find((p) => p.id === state.hostId)?.name ?? "Unknown",
      startingLife: state.startingLife,
      createdAt: (row.createdAt as Date).toISOString(),
      updatedAt: (row.updatedAt as Date).toISOString(),
    };
  });
}

export async function cleanupOldGames(maxAgeHours = 12): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const rows = await db
    .select({ id: gamesTable.id, code: gamesTable.code })
    .from(gamesTable)
    .where(lt(gamesTable.updatedAt, cutoff));

  if (rows.length === 0) return { deleted: 0 };

  for (const row of rows) {
    await db.delete(gamesTable).where(eq(gamesTable.id, row.id));
    cacheByCode.delete(row.code);
    cacheById.delete(row.id);
  }

  return { deleted: rows.length };
}

export function setConnected(player: Player, connected: boolean): void {
  player.isConnected = connected;
}

export type PublicGame = Omit<Game, "tokens">;

export function toPublicGame(game: Game): PublicGame {
  const { tokens: _tokens, ...rest } = game;
  return rest;
}

export function computeStats(game: Game): {
  totalDamageDealt: { playerId: string; playerName: string; total: number }[];
  biggestSingleHit: {
    fromPlayerId: string;
    fromPlayerName: string;
    toPlayerId: string;
    toPlayerName: string;
    amount: number;
  } | null;
  eliminatedCount: number;
  turnsPlayed: number;
} {
  const totals = new Map<string, number>();
  for (const e of game.commanderDamage) {
    totals.set(e.fromPlayerId, (totals.get(e.fromPlayerId) ?? 0) + e.amount);
  }
  const totalDamageDealt = game.players.map((p) => ({
    playerId: p.id,
    playerName: p.name,
    total: totals.get(p.id) ?? 0,
  }));
  totalDamageDealt.sort((a, b) => b.total - a.total);
  let biggest: {
    fromPlayerId: string;
    fromPlayerName: string;
    toPlayerId: string;
    toPlayerName: string;
    amount: number;
  } | null = null;
  for (const e of game.commanderDamage) {
    if (!biggest || e.amount > biggest.amount) {
      const from = game.players.find((p) => p.id === e.fromPlayerId);
      const to = game.players.find((p) => p.id === e.toPlayerId);
      if (from && to) {
        biggest = {
          fromPlayerId: from.id,
          fromPlayerName: from.name,
          toPlayerId: to.id,
          toPlayerName: to.name,
          amount: e.amount,
        };
      }
    }
  }
  return {
    totalDamageDealt,
    biggestSingleHit: biggest,
    eliminatedCount: game.players.filter((p) => p.isEliminated).length,
    turnsPlayed: game.turnNumber,
  };
}
