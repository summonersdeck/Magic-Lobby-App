import { Router, type IRouter } from "express";
import {
  CreateGameBody,
  JoinGameBody,
  JoinGameParams,
  GetGameParams,
  GetGameStatsParams,
} from "@workspace/api-zod";
import {
  createGame,
  joinGame,
  getGameByCode,
  toPublicGame,
  computeStats,
  cleanupOldGames,
  listRecentGames,
} from "../games/store";

const router: IRouter = Router();

router.get("/games", async (req, res) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const games = await listRecentGames(limit);
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: "Failed to list games" });
  }
});

router.post("/games", async (req, res) => {
  const parsed = CreateGameBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  try {
    const { game, player, token } = await createGame(parsed.data);
    res.json({ token, playerId: player.id, game: toPublicGame(game) });
  } catch (err) {
    res.status(500).json({ error: "Failed to create game" });
  }
});

router.post("/games/cleanup", async (_req, res) => {
  try {
    const result = await cleanupOldGames(12);
    res.json({ deleted: result.deleted, message: `${result.deleted} partida(s) eliminada(s)` });
  } catch (err) {
    res.status(500).json({ error: "Failed to clean up games" });
  }
});

router.post("/games/:code/join", async (req, res) => {
  const params = JoinGameParams.safeParse(req.params);
  const body = JoinGameBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await joinGame(params.data.code, body.data);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      token: result.token,
      playerId: result.player.id,
      game: toPublicGame(result.game),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to join game" });
  }
});

router.get("/games/:code", async (req, res) => {
  const params = GetGameParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid code" });
    return;
  }
  try {
    const game = await getGameByCode(params.data.code);
    if (!game) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(toPublicGame(game));
  } catch (err) {
    res.status(500).json({ error: "Failed to get game" });
  }
});

router.get("/games/:code/stats", async (req, res) => {
  const params = GetGameStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid code" });
    return;
  }
  try {
    const game = await getGameByCode(params.data.code);
    if (!game) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(computeStats(game));
  } catch (err) {
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
