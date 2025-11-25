import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClientHeader } from "@/components/client-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Bookmark, BookmarkCheck, CheckCircle2, Clock, Dumbbell, BarChart3, FileText, AlertCircle, Loader2, GripVertical, LayoutGrid, ChevronDown, ChevronUp, Target, Flame } from "lucide-react";
import { useState } from "react";

interface WorkoutPlan {
  _id: string;
  name: string;
  description?: string;
  durationWeeks: number;
  exercises: any;
  category?: string;
  goal?: string;
  difficulty?: string;
  createdAt: string;
}

interface WorkoutSession {
  _id: string;
  workoutPlanId: string;
  workoutName: string;
  duration: number;
  completedAt: string;
  notes?: string;
}

export default function ClientWorkoutPlans() {
  const { toast } = useToast();
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [selectedPlanForLogging, setSelectedPlanForLogging] = useState<string | null>(null);
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionDuration, setSessionDuration] = useState("30");
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [expandedNotePlanId, setExpandedNotePlanId] = useState<string | null>(null);

  // Get client ID from localStorage
  const clientId = localStorage.getItem("clientId");

  // Fetch assigned workout plans
  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-plans`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Fetch bookmarked workout plans
  const { data: bookmarks = [], isLoading: bookmarksLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-bookmarks`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 5000,
  });

  // Fetch workout history
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-history`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 10000,
  });

  // Fetch workout notes
  const { data: notesMap = {}, isLoading: notesLoading } = useQuery({
    queryKey: [`/api/clients/${clientId}/workout-notes`],
    enabled: !!clientId,
    staleTime: 0,
    refetchInterval: 10000,
  });

  // Bookmark mutation
  const bookmarkMutation = useMutation({
    mutationFn: async ({ planId, isBookmarked }: { planId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        return apiRequest('DELETE', `/api/clients/${clientId}/workout-bookmarks/${planId}`);
      } else {
        return apiRequest('POST', `/api/clients/${clientId}/workout-bookmarks/${planId}`);
      }
    },
    onMutate: async ({ planId, isBookmarked }) => {
      await queryClient.cancelQueries({ queryKey: [`/api/clients/${clientId}/workout-bookmarks`] });
      const previousBookmarks = queryClient.getQueryData([`/api/clients/${clientId}/workout-bookmarks`]);
      
      if (isBookmarked) {
        queryClient.setQueryData([`/api/clients/${clientId}/workout-bookmarks`], 
          (previousBookmarks || []).filter((b: any) => b.workoutPlanId !== planId)
        );
      } else {
        const plan = plans.find(p => p._id === planId);
        if (plan) {
          queryClient.setQueryData([`/api/clients/${clientId}/workout-bookmarks`], 
            [...(previousBookmarks || []), { workoutPlanId: planId, workoutPlan: plan }]
          );
        }
      }
      return { previousBookmarks };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-bookmarks`] });
      toast({ description: "Workout bookmark updated" });
    },
    onError: () => {
      toast({ description: "Failed to update bookmark", variant: "destructive" });
    },
  });

  // Log workout mutation
  const logWorkoutMutation = useMutation({
    mutationFn: async ({ planId, duration, notes }: { planId: string; duration: number; notes: string }) => {
      const plan = plans.find(p => p._id === planId);
      return apiRequest('POST', `/api/clients/${clientId}/workout-history`, {
        workoutPlanId: planId,
        workoutName: plan?.name || "Workout",
        duration,
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-history`] });
      setSelectedPlanForLogging(null);
      setSessionNotes("");
      setSessionDuration("30");
      toast({ description: "Workout session logged successfully!" });
    },
    onError: () => {
      toast({ description: "Failed to log workout", variant: "destructive" });
    },
  });

  // Save notes mutation
  const saveNotesMutation = useMutation({
    mutationFn: async ({ planId, notes }: { planId: string; notes: string }) => {
      return apiRequest('POST', `/api/clients/${clientId}/workout-notes/${planId}`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/workout-notes`] });
      toast({ description: "Notes saved successfully!" });
    },
    onError: () => {
      toast({ description: "Failed to save notes", variant: "destructive" });
    },
  });

  const isBookmarked = (planId: string) => bookmarks.some((b: any) => b.workoutPlanId === planId);
  const getPlanHistory = (planId: string) => history.filter((s: any) => s.workoutPlanId === planId);
  const getPlanNotes = (planId: string) => (notesMap as any)[planId] || "";

  if (!clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <p className="text-destructive">Unable to load workout plans</p>
        </div>
      </div>
    );
  }

  const getDifficultyColor = (difficulty?: string) => {
    switch (difficulty?.toLowerCase()) {
      case 'beginner': return 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200';
      case 'intermediate': return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
      case 'advanced': return 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200';
      default: return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200';
    }
  };

  const PlanCardView = ({ plan }: { plan: WorkoutPlan }) => (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 border-l-4 border-l-primary flex flex-col aspect-square">
      <div className="p-4 flex-1 overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-foreground mb-2">{plan.name}</h3>
            {plan.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{plan.description}</p>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: isBookmarked(plan._id) })}
            data-testid={`button-bookmark-workout-${plan._id}`}
            className="flex-shrink-0"
          >
            {isBookmarked(plan._id) ? (
              <BookmarkCheck className="h-6 w-6 fill-amber-400 text-amber-400" />
            ) : (
              <Bookmark className="h-6 w-6 text-muted-foreground" />
            )}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {plan.durationWeeks && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs font-medium">
              <Clock className="h-3.5 w-3.5" />
              {plan.durationWeeks} weeks
            </span>
          )}
          {plan.category && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 text-xs font-medium">
              <Target className="h-3.5 w-3.5" />
              {plan.category}
            </span>
          )}
          {plan.difficulty && (
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${getDifficultyColor(plan.difficulty)}`}>
              <Flame className="h-3.5 w-3.5" />
              {plan.difficulty}
            </span>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <Button
            variant="default"
            size="sm"
            onClick={() => setSelectedPlanForLogging(plan._id)}
            disabled={selectedPlanForLogging === plan._id}
            data-testid={`button-log-workout-${plan._id}`}
            className="flex-1"
          >
            Log Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedPlanId(expandedPlanId === plan._id ? null : plan._id)}
            data-testid={`button-expand-${plan._id}`}
            className="flex-1"
          >
            {expandedPlanId === plan._id ? 'Hide' : 'View'} Exercises
          </Button>
        </div>

        {selectedPlanForLogging === plan._id && (
          <div className="mt-4 pt-4 border-t space-y-3 bg-muted/50 -m-6 mt-0 p-6 rounded-b-lg">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Duration (minutes)</label>
              <input
                type="number"
                value={sessionDuration}
                onChange={(e) => setSessionDuration(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                data-testid="input-duration"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Session Notes</label>
              <Textarea
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="How did the workout go? Any challenges or improvements?"
                className="min-h-20 bg-background"
                data-testid="textarea-notes"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPlanForLogging(null)}
                data-testid="button-cancel-log"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => logWorkoutMutation.mutate({
                  planId: plan._id,
                  duration: parseInt(sessionDuration),
                  notes: sessionNotes,
                })}
                disabled={logWorkoutMutation.isPending}
                data-testid="button-save-workout"
              >
                {logWorkoutMutation.isPending ? "Saving..." : "Save Session"}
              </Button>
            </div>
          </div>
        )}

        {expandedPlanId === plan._id && plan.exercises && (
          <div className="mt-4 pt-4 border-t space-y-3">
            {Object.entries(plan.exercises).map(([day, exercises]: [string, any]) => (
              <div key={day} className="bg-gradient-to-r from-primary/10 to-primary/5 p-4 rounded-lg border border-primary/20">
                <p className="font-semibold mb-2 capitalize text-foreground">{day}</p>
                {Array.isArray(exercises) ? (
                  <ul className="space-y-1 text-sm">
                    {exercises.map((ex: any, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-muted-foreground">
                        <span className="text-primary font-bold">•</span>
                        <span>{typeof ex === 'string' ? ex : ex.name || JSON.stringify(ex)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No exercises configured</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );

  const PlanListView = ({ plan }: { plan: WorkoutPlan }) => (
    <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-4 flex-1">
        <GripVertical className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground mb-1">{plan.name}</h3>
          {plan.description && (
            <p className="text-sm text-muted-foreground line-clamp-1 mb-2">{plan.description}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {plan.durationWeeks && (
              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                {plan.durationWeeks} weeks
              </span>
            )}
            {plan.category && (
              <span className="text-xs px-2 py-1 rounded-full bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200">
                {plan.category}
              </span>
            )}
            {plan.difficulty && (
              <span className={`text-xs px-2 py-1 rounded-full ${getDifficultyColor(plan.difficulty)}`}>
                {plan.difficulty}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: isBookmarked(plan._id) })}
          data-testid={`button-bookmark-workout-${plan._id}`}
        >
          {isBookmarked(plan._id) ? (
            <BookmarkCheck className="h-5 w-5 fill-amber-400 text-amber-400" />
          ) : (
            <Bookmark className="h-5 w-5 text-muted-foreground" />
          )}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => setSelectedPlanForLogging(plan._id)}
          disabled={selectedPlanForLogging === plan._id}
          data-testid={`button-log-workout-${plan._id}`}
        >
          Log
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <ClientHeader currentPage="workout-history" />
      
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-foreground">Workout Plans</h1>
          <p className="text-muted-foreground">
            View your trainer-assigned workout plans, log sessions, bookmark favorites, and track your progress.
          </p>
        </div>

        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-muted/50 p-1 rounded-lg mb-6">
            <TabsTrigger value="plans" className="data-[state=active]:bg-background">Plans</TabsTrigger>
            <TabsTrigger value="bookmarks" className="data-[state=active]:bg-background">Bookmarks</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-background">History</TabsTrigger>
            <TabsTrigger value="notes" className="data-[state=active]:bg-background">Notes</TabsTrigger>
          </TabsList>

          {/* Plans Tab */}
          <TabsContent value="plans" className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{plans.length} workout plans assigned</p>
              <div className="flex gap-2 bg-muted/50 p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={viewMode === 'card' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('card')}
                  className="px-3"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('list')}
                  className="px-3"
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {plansLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : plans.length === 0 ? (
              <Card className="p-12 text-center bg-gradient-to-br from-muted/50 to-muted border-dashed">
                <Dumbbell className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-muted-foreground mb-2">No workout plans assigned yet</p>
                <p className="text-sm text-muted-foreground">Your trainer will assign custom workout plans here.</p>
              </Card>
            ) : (
              <div className={viewMode === 'card' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
                {plans.map((plan: WorkoutPlan) => (
                  <div key={plan._id}>
                    {viewMode === 'card' ? (
                      <PlanCardView plan={plan} />
                    ) : (
                      <PlanListView plan={plan} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Bookmarks Tab */}
          <TabsContent value="bookmarks" className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{bookmarks.length} bookmarked workouts</p>
              <div className="flex gap-2 bg-muted/50 p-1 rounded-lg">
                <Button
                  size="sm"
                  variant={viewMode === 'card' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('card')}
                  className="px-3"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('list')}
                  className="px-3"
                >
                  <GripVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {bookmarksLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : bookmarks.length === 0 ? (
              <Card className="p-12 text-center bg-gradient-to-br from-muted/50 to-muted border-dashed">
                <Bookmark className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-muted-foreground mb-2">No bookmarked workouts yet</p>
                <p className="text-sm text-muted-foreground">Bookmark your favorite plans for quick access.</p>
              </Card>
            ) : (
              <div className={viewMode === 'card' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
                {bookmarks.map((bookmark: any) => {
                  const plan = bookmark.workoutPlan || plans.find(p => p._id === bookmark.workoutPlanId);
                  return plan ? (
                    viewMode === 'card' ? (
                      <Card key={bookmark._id} className="p-6 bg-gradient-to-br from-amber-50 dark:from-amber-900/20 to-amber-50/50 dark:to-amber-900/10 border-amber-200 dark:border-amber-800">
                        <div className="flex items-start gap-3 mb-4">
                          <BookmarkCheck className="h-6 w-6 fill-amber-400 text-amber-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-foreground">{plan.name}</h3>
                            {plan.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{plan.description}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: true })}
                          data-testid={`button-remove-bookmark-${plan._id}`}
                          className="w-full"
                        >
                          Remove Bookmark
                        </Button>
                      </Card>
                    ) : (
                      <div key={bookmark._id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <BookmarkCheck className="h-5 w-5 fill-amber-400 text-amber-400 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-foreground">{plan.name}</p>
                            {plan.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{plan.description}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => bookmarkMutation.mutate({ planId: plan._id, isBookmarked: true })}
                          data-testid={`button-remove-bookmark-${plan._id}`}
                          className="flex-shrink-0"
                        >
                          Remove
                        </Button>
                      </div>
                    )
                  ) : null;
                })}
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{history.length} total sessions logged</p>
            </div>

            {historyLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : history.length === 0 ? (
              <Card className="p-12 text-center bg-gradient-to-br from-muted/50 to-muted border-dashed">
                <CheckCircle2 className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-muted-foreground mb-2">No workout sessions logged yet</p>
                <p className="text-sm text-muted-foreground">Start logging sessions from your workout plans.</p>
              </Card>
            ) : (
              <div className="space-y-6">
                {plans.map((plan: WorkoutPlan) => {
                  const planHistory = getPlanHistory(plan._id);
                  return planHistory.length > 0 ? (
                    <div key={plan._id}>
                      <div className="flex items-center gap-3 mb-4 pb-3 border-b">
                        <div className="h-3 w-3 rounded-full bg-primary"></div>
                        <h3 className="font-bold text-lg text-foreground">{plan.name}</h3>
                        <span className="ml-auto px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {planHistory.length} sessions
                        </span>
                      </div>
                      <div className="space-y-2 pl-6">
                        {planHistory.map((session: WorkoutSession) => (
                          <Card key={session._id} className="p-4 bg-gradient-to-r from-green-50 dark:from-green-900/20 to-green-50/50 dark:to-green-900/10 border-green-200 dark:border-green-800">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                                  <p className="font-semibold text-foreground">{session.workoutName}</p>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground ml-7">
                                  <span>{new Date(session.completedAt).toLocaleDateString()}</span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="h-4 w-4" />
                                    {session.duration} min
                                  </span>
                                </div>
                                {session.notes && (
                                  <p className="text-sm text-muted-foreground mt-2 ml-7 italic">{session.notes}</p>
                                )}
                              </div>
                              <BarChart3 className="h-6 w-6 text-green-600 dark:text-green-400 flex-shrink-0" />
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </TabsContent>

          {/* Notes Tab */}
          <TabsContent value="notes" className="space-y-4">
            <p className="text-sm text-muted-foreground mb-4">{plans.length} workout plans</p>

            {notesLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : plans.length === 0 ? (
              <Card className="p-12 text-center bg-gradient-to-br from-muted/50 to-muted border-dashed">
                <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium text-muted-foreground mb-2">No workout plans to add notes to</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {plans.map((plan: WorkoutPlan) => (
                  <div key={plan._id}>
                    <button
                      onClick={() => setExpandedNotePlanId(expandedNotePlanId === plan._id ? null : plan._id)}
                      className="w-full flex items-center justify-between p-4 bg-muted/50 hover:bg-muted/70 rounded-lg transition-colors border"
                    >
                      <div className="flex items-center gap-3 flex-1 text-left">
                        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-foreground">{plan.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {getPlanNotes(plan._id) ? 'Click to edit' : 'Click to add notes'}
                          </p>
                        </div>
                      </div>
                      {expandedNotePlanId === plan._id ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                    
                    {expandedNotePlanId === plan._id && (
                      <Card className="mt-2 p-6 bg-gradient-to-br from-blue-50 dark:from-blue-900/20 to-blue-50/50 dark:to-blue-900/10 border-blue-200 dark:border-blue-800">
                        <Textarea
                          key={plan._id}
                          defaultValue={getPlanNotes(plan._id)}
                          placeholder="Add personal notes about this workout plan..."
                          className="min-h-32 mb-4 bg-background resize-none"
                          data-testid={`textarea-plan-notes-${plan._id}`}
                          onChange={(e) => {
                            const notes = e.currentTarget.value;
                            setSessionNotes(notes);
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => saveNotesMutation.mutate({ planId: plan._id, notes: sessionNotes || getPlanNotes(plan._id) })}
                          disabled={saveNotesMutation.isPending}
                          data-testid={`button-save-notes-${plan._id}`}
                          className="w-full"
                        >
                          {saveNotesMutation.isPending ? "Saving..." : "Save Notes"}
                        </Button>
                      </Card>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
