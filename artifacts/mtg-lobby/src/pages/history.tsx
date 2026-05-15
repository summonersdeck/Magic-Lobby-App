import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ArrowLeft, Users, Swords, Clock, RefreshCw, LogIn } from "lucide-react";
import { useJoinGame } from "@workspace/api-client-react";
import { saveSession } from "../hooks/use-game-socket";

type GameStatus = "waiting" | "active" | "ended";

interface GameSummary {
  id: string;
  code: string;
  status: GameStatus;
  playerCount: number;
  hostName: string;
  startingLife: number;
  createdAt: string;
  updatedAt: string;
}

async function fetchGames(): Promise<GameSummary[]> {
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
  const res = await fetch(`${base}/api/games?limit=50`);
  if (!res.ok) throw new Error("Failed to fetch games");
  return res.json();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

const STATUS_CONFIG: Record<GameStatus, { label: string; variant: "default" | "secondary" | "outline"; dot: string }> = {
  waiting: { label: "En espera", variant: "secondary", dot: "bg-yellow-400" },
  active:  { label: "En curso",  variant: "default",   dot: "bg-emerald-400" },
  ended:   { label: "Terminada", variant: "outline",   dot: "bg-muted-foreground" },
};

export default function History() {
  const [, setLocation] = useLocation();
  const joinGame = useJoinGame();

  const { data: games, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["games-history"],
    queryFn: fetchGames,
    refetchOnWindowFocus: false,
  });

  const [joinTarget, setJoinTarget] = useState<GameSummary | null>(null);
  const [joinName, setJoinName] = useState("");

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinTarget || !joinName.trim()) return;
    joinGame.mutate(
      { code: joinTarget.code, data: { name: joinName.trim() } },
      {
        onSuccess: (res) => {
          saveSession({
            token: res.token,
            playerId: res.playerId,
            code: res.game.code,
            isHost: false,
          });
          setJoinTarget(null);
          setLocation(`/lobby/${res.game.code}`);
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] bg-background dark p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-serif text-primary flex items-center gap-2">
              <Swords className="w-5 h-5" />
              Historial de Partidas
            </CardTitle>
          </CardHeader>
        </Card>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="border-border/40 animate-pulse">
                <CardContent className="p-4 h-20" />
              </Card>
            ))}
          </div>
        )}

        {isError && (
          <Card className="border-destructive/30">
            <CardContent className="p-6 text-center text-muted-foreground">
              No se pudo cargar el historial. Verifica que el servidor esté activo.
            </CardContent>
          </Card>
        )}

        {games && games.length === 0 && (
          <Card className="border-border/40">
            <CardContent className="p-8 text-center text-muted-foreground">
              No hay partidas guardadas todavía.
            </CardContent>
          </Card>
        )}

        {games && games.length > 0 && (
          <div className="space-y-3">
            {games.map((game) => {
              const cfg = STATUS_CONFIG[game.status];
              const canJoin = game.status !== "ended";
              return (
                <Card
                  key={game.id}
                  className="border-border/40 hover:border-primary/30 transition-colors"
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-2xl font-bold text-primary tracking-widest shrink-0">
                          {game.code}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={cfg.variant} className="gap-1 text-xs shrink-0">
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {cfg.label}
                            </Badge>
                            <span className="text-xs text-muted-foreground truncate">
                              Host: {game.hostName}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Users className="w-3 h-3" />
                              {game.playerCount} jugador{game.playerCount !== 1 ? "es" : ""}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Swords className="w-3 h-3" />
                              {game.startingLife} vida
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {timeAgo(game.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {canJoin && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 shrink-0 border-primary/30 hover:bg-primary/10"
                          onClick={() => {
                            setJoinTarget(game);
                            setJoinName("");
                            joinGame.reset();
                          }}
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          Unirse
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!joinTarget} onOpenChange={(open) => { if (!open) setJoinTarget(null); }}>
        <DialogContent className="dark max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-primary">
              Unirse a partida{" "}
              <span className="font-mono tracking-widest">{joinTarget?.code}</span>
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Ingresa tu nombre para entrar al lobby.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleJoin} className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="history-join-name">Tu nombre</Label>
              <Input
                id="history-join-name"
                placeholder="e.g. Urza"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                autoFocus
              />
            </div>
            {joinGame.isError && (
              <p className="text-xs text-destructive">
                {(joinGame.error as Error)?.message ?? "No se pudo unir. Intenta de nuevo."}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setJoinTarget(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!joinName.trim() || joinGame.isPending}
              >
                {joinGame.isPending ? "Entrando..." : "Entrar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
