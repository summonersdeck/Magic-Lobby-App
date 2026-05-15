import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useCreateGame, useJoinGame } from "@workspace/api-client-react";
import { saveSession } from "../hooks/use-game-socket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, CheckCircle2, History } from "lucide-react";
import logoUrl from "@assets/summonerdeck_1777491015118.webp";

async function postCleanup(): Promise<{ deleted: number; message: string }> {
  const base = import.meta.env.VITE_API_URL ?? "";
  const res = await fetch(`${base}/api/games/cleanup`, { method: "POST" });
  if (!res.ok) throw new Error("Cleanup failed");
  return res.json();
}

export default function Home() {
  const [, setLocation] = useLocation();
  const createGame = useCreateGame();
  const joinGame = useJoinGame();

  const cleanup = useMutation({ mutationFn: postCleanup });

  const [createName, setCreateName] = useState("");
  const [createLife, setCreateLife] = useState(40);

  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName) return;
    createGame.mutate({ data: { hostName: createName, startingLife: createLife } }, {
      onSuccess: (res) => {
        saveSession({ token: res.token, playerId: res.playerId, code: res.game.code, isHost: true });
        setLocation(`/lobby/${res.game.code}`);
      }
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode || !joinName) return;
    joinGame.mutate({ code: joinCode.toUpperCase(), data: { name: joinName } }, {
      onSuccess: (res) => {
        saveSession({ token: res.token, playerId: res.playerId, code: res.game.code, isHost: false });
        setLocation(`/lobby/${res.game.code}`);
      }
    });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-background dark">
      <Card className="w-full max-w-md border-primary/20 shadow-2xl shadow-primary/10">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-24 h-24 rounded-2xl overflow-hidden border border-primary/20 shadow-lg shadow-primary/10">
            <img src={logoUrl} alt="Summoner's Deck" className="w-full h-full object-cover" />
          </div>
          <div>
            <CardTitle className="text-3xl font-serif text-primary">Commander Lobby</CardTitle>
            <CardDescription className="text-muted-foreground mt-2">Real-time companion for EDH pods</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="join" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-secondary/50">
              <TabsTrigger value="join">Join Game</TabsTrigger>
              <TabsTrigger value="create">Host Game</TabsTrigger>
            </TabsList>

            <TabsContent value="join">
              <form onSubmit={handleJoin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="join-code">Lobby Code</Label>
                  <Input
                    id="join-code"
                    placeholder="e.g. ABCD"
                    value={joinCode}
                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    maxLength={4}
                    className="font-mono uppercase text-lg text-center tracking-widest"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="join-name">Your Name</Label>
                  <Input
                    id="join-name"
                    placeholder="e.g. Urza"
                    value={joinName}
                    onChange={e => setJoinName(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full font-bold" disabled={joinGame.isPending}>
                  {joinGame.isPending ? "Joining..." : "Join Lobby"}
                </Button>
                {joinGame.isError && (
                  <p className="text-xs text-destructive text-center mt-2">
                    No se pudo unir. Verifica el código o que el servidor esté activo.
                    {" "}
                    <span className="opacity-60">
                      ({(joinGame.error as Error)?.message ?? "Error desconocido"})
                    </span>
                  </p>
                )}
              </form>
            </TabsContent>

            <TabsContent value="create">
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="create-name">Your Name (Host)</Label>
                  <Input
                    id="create-name"
                    placeholder="e.g. Yawgmoth"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-life">Starting Life</Label>
                  <Input
                    id="create-life"
                    type="number"
                    value={createLife}
                    onChange={e => setCreateLife(Number(e.target.value))}
                  />
                </div>
                <Button type="submit" className="w-full font-bold" disabled={createGame.isPending}>
                  {createGame.isPending ? "Creating..." : "Create Lobby"}
                </Button>
                {createGame.isError && (
                  <p className="text-xs text-destructive text-center mt-2">
                    No se pudo conectar al servidor. Verifica que el backend esté activo.
                    {" "}
                    <span className="opacity-60">
                      ({(createGame.error as Error)?.message ?? "Error desconocido"})
                    </span>
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>

          <div className="border-t border-border/40 pt-4 space-y-1">
            <Link href="/history">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:text-primary hover:bg-primary/10 gap-2 text-xs"
              >
                <History className="w-3.5 h-3.5" />
                Ver historial de partidas
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-2 text-xs"
              onClick={() => cleanup.mutate()}
              disabled={cleanup.isPending}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {cleanup.isPending
                ? "Limpiando..."
                : "Limpiar partidas antiguas (+12h)"}
            </Button>

            {cleanup.isSuccess && (
              <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {cleanup.data.deleted === 0
                  ? "No hay partidas antiguas para eliminar"
                  : `${cleanup.data.deleted} partida${cleanup.data.deleted !== 1 ? "s" : ""} eliminada${cleanup.data.deleted !== 1 ? "s" : ""}`}
              </div>
            )}

            {cleanup.isError && (
              <p className="text-center text-xs text-destructive mt-2">
                Error al limpiar. Intenta de nuevo.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
